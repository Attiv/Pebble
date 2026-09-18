import { useEffect, useRef, type RefObject } from "react";

/**
 * Dismiss a popover the moment the reader turns away from it.
 *
 * Two gestures count: a mousedown outside the popover, and Escape. Escape is
 * answered here and not by the global shortcut layer because the popover has to
 * go first — the keystroke that closes a popover must not also close the
 * message detail sitting underneath it. So while the popover is open its node
 * carries `data-pebble-overlay`, which is what `useKeyboard` looks for before
 * claiming Escape for the rest of the window.
 *
 * The popover keeps the gesture for the whole stack: a second press closes the
 * layer below, which is how "close the popover, then close the message" reads
 * as two deliberate steps instead of one that skips a level.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    node?.setAttribute("data-pebble-overlay", "true");

    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    // No preventDefault: a native `<select>` inside the popover (the translate
    // target picker) still has to be able to close itself on the same press.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      node?.removeAttribute("data-pebble-overlay");
    };
  }, [active, ref]);
}
