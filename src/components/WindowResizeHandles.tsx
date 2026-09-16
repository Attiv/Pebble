import {
  useCallback,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

/**
 * Eight invisible grips along the window edges that resize the main window.
 *
 * macOS 26 (Tahoe) reworked the window corners, and the 19x19 hit area AppKit
 * uses to start a resize now sits mostly *outside* the rounded window (roughly
 * three quarters of it, by Apple's own geometry). So pressing the corner the way
 * people have always done it -- just inside the window -- no longer reaches
 * AppKit's resize tracking: the press falls through to the webview, or, once the
 * pointer is a few pixels outside, to the window *behind* Pebble, which activates
 * that app instead of resizing this one.
 *
 * Tauri cannot delegate this back to the OS either: tao returns `NotSupported`
 * from `drag_resize_window` on macOS (tao 0.34, macos/window.rs:963), so
 * `startResizeDragging` is a no-op here. These grips therefore drive the resize
 * from the frontend with `setSize`/`setPosition`.
 */

export type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

export interface WindowFrame {
  /** Frame origin in physical pixels, as reported by `outerPosition`. */
  x: number;
  y: number;
  /** *Content* size in physical pixels, as reported by `innerSize`. */
  width: number;
  height: number;
}

/**
 * Minimum window content size, mirroring `minWidth`/`minHeight` in
 * src-tauri/tauri.conf.json. Tauri applies those as *inner* size constraints, so
 * the frontend clamp has to measure the same thing.
 */
export const MIN_CONTENT_SIZE = { width: 800, height: 600 };

/**
 * Where a drag started moving which edge, in physical pixels. Pulled out of the
 * component so the geometry can be checked without a window to drag.
 *
 * `dx`/`dy` are deltas from the pointer position at drag start; the edge the user
 * is not holding stays pinned, including while the minimum size clamps the drag.
 */
export function resizeFrame(
  start: WindowFrame,
  dx: number,
  dy: number,
  direction: ResizeDirection,
  min: { width: number; height: number } = MIN_CONTENT_SIZE,
): WindowFrame {
  const left = direction.includes("West");
  const right = direction.includes("East");
  const top = direction.includes("North");
  const bottom = direction.includes("South");

  let width = start.width;
  let height = start.height;
  if (right) width = start.width + dx;
  if (left) width = start.width - dx;
  if (bottom) height = start.height + dy;
  if (top) height = start.height - dy;

  width = Math.max(min.width, width);
  height = Math.max(min.height, height);

  // Offsets are measured from the start frame, so a clamped axis keeps the held
  // edge under the pointer and pushes the opposite edge to its minimum instead.
  const x = left ? start.x + (start.width - width) : start.x;
  const y = top ? start.y + (start.height - height) : start.y;

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Hit area thickness for the four edges. Matches what macOS itself reserves. */
const EDGE = 5;
/** Hit area size for the corners. */
const CORNER = 12;
/**
 * The top-left corner must clear the native traffic lights, which sit in the
 * overlay titlebar a few pixels in from that corner.
 */
const TOP_LEFT_CORNER = 10;

interface HandleSpec {
  direction: ResizeDirection;
  cursor: string;
  style: CSSProperties;
}

const EDGE_HANDLES: HandleSpec[] = [
  { direction: "North", cursor: "ns-resize", style: { top: 0, left: 0, right: 0, height: EDGE } },
  { direction: "South", cursor: "ns-resize", style: { bottom: 0, left: 0, right: 0, height: EDGE } },
  { direction: "West", cursor: "ew-resize", style: { left: 0, top: 0, bottom: 0, width: EDGE } },
  { direction: "East", cursor: "ew-resize", style: { right: 0, top: 0, bottom: 0, width: EDGE } },
];

// Corners come last so they sit above the edges and win on the diagonal.
const CORNER_HANDLES: HandleSpec[] = [
  {
    direction: "NorthWest",
    cursor: "nwse-resize",
    style: { top: 0, left: 0, width: TOP_LEFT_CORNER, height: TOP_LEFT_CORNER },
  },
  { direction: "NorthEast", cursor: "nesw-resize", style: { top: 0, right: 0, width: CORNER, height: CORNER } },
  { direction: "SouthWest", cursor: "nesw-resize", style: { bottom: 0, left: 0, width: CORNER, height: CORNER } },
  { direction: "SouthEast", cursor: "nwse-resize", style: { bottom: 0, right: 0, width: CORNER, height: CORNER } },
];

const HANDLES = [...EDGE_HANDLES, ...CORNER_HANDLES];

interface DragState {
  direction: ResizeDirection;
  /** Pointer position at drag start, in CSS pixels on the screen. */
  pointerX: number;
  pointerY: number;
  /** Filled once the window state has been read back, a few ms after pointerdown. */
  start: WindowFrame | null;
  scale: number;
}

interface ResizeTarget {
  width: number;
  height: number;
  /** Null for directions that leave the frame origin alone. */
  x: number | null;
  y: number | null;
}

export default function WindowResizeHandles() {
  const dragRef = useRef<DragState | null>(null);
  const targetRef = useRef<ResizeTarget | null>(null);
  const appliedRef = useRef<ResizeTarget | null>(null);
  const runningRef = useRef(false);
  // Pushes the newest target to the backend, one at a time: a pointermove can
  // arrive while the previous round trip is still in flight, and only the latest
  // position matters.
  const flush = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (targetRef.current) {
        const target = targetRef.current;
        targetRef.current = null;
        appliedRef.current = target;
        const appWindow = getCurrentWindow();
        await appWindow
          .setSize(new PhysicalSize(target.width, target.height))
          .catch((err) => console.warn("Failed to resize the window", err));
        // Only directions that hold a left/top edge move the frame origin, so a
        // plain East/South drag does not fight the user's window placement.
        if (target.x !== null && target.y !== null) {
          /* eslint-disable-next-line no-restricted-syntax -- see above */
          await appWindow
            .setPosition(new PhysicalPosition(target.x, target.y))
            .catch((err) => console.warn("Failed to move the window", err));
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  // Only macOS lost the in-window corner target; every other platform still has
  // working native frame resizing, so leave their hit testing untouched.
  if (!navigator.userAgent.includes("Macintosh")) return null;

  function handlePointerDown(direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const element = event.currentTarget;
    element.setPointerCapture?.(event.pointerId);

    const drag: DragState = {
      direction,
      pointerX: event.screenX,
      pointerY: event.screenY,
      start: null,
      scale: 1,
    };
    dragRef.current = drag;
    appliedRef.current = null;

    const appWindow = getCurrentWindow();
    void Promise.all([appWindow.innerSize(), appWindow.outerPosition(), appWindow.scaleFactor()])
      .then(([size, position, scale]) => {
        if (dragRef.current !== drag) return;
        drag.scale = scale;
        drag.start = { x: position.x, y: position.y, width: size.width, height: size.height };
      })
      .catch((err) => console.warn("Failed to read the window size", err));
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !drag.start) return;

    const dx = Math.round((event.screenX - drag.pointerX) * drag.scale);
    const dy = Math.round((event.screenY - drag.pointerY) * drag.scale);
    const min = {
      width: Math.round(MIN_CONTENT_SIZE.width * drag.scale),
      height: Math.round(MIN_CONTENT_SIZE.height * drag.scale),
    };
    const frame = resizeFrame(drag.start, dx, dy, drag.direction, min);

    const movesOrigin = drag.direction.includes("West") || drag.direction.includes("North");
    const target: ResizeTarget = {
      width: frame.width,
      height: frame.height,
      x: movesOrigin ? frame.x : null,
      y: movesOrigin ? frame.y : null,
    };
    const applied = appliedRef.current;
    if (
      applied &&
      applied.width === target.width &&
      applied.height === target.height &&
      applied.x === target.x &&
      applied.y === target.y
    ) {
      return;
    }

    targetRef.current = target;
    void flush();
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (element.hasPointerCapture?.(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  return (
    <>
      {HANDLES.map(({ direction, cursor, style }) => (
        <div
          key={direction}
          data-resize-direction={direction}
          onPointerDown={(event) => handlePointerDown(direction, event)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          // The titlebar underneath is a `data-tauri-drag-region`; without this
          // the injected handler would start a window *move* from the top edge.
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            // Above the app shell and its scroll regions (z-index 1) so the grips
            // get the press first, but below popovers, dialogs and the compose
            // button (z-index 100+) so an open overlay stays fully clickable.
            zIndex: 20,
            cursor,
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
            ...style,
          }}
        />
      ))}
    </>
  );
}
