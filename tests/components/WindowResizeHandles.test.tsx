import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WindowResizeHandles, { resizeFrame } from "../../src/components/WindowResizeHandles";

const mocks = vi.hoisted(() => ({
  appWindow: {
    innerSize: vi.fn(),
    outerPosition: vi.fn(),
    scaleFactor: vi.fn(),
    setSize: vi.fn(),
    setPosition: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mocks.appWindow,
}));

const MAC_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

/**
 * React listens for `pointerdown`/`pointermove` by event name, so a MouseEvent
 * carrying the pointer fields is enough -- jsdom has no PointerEvent.
 */
function pointer(target: Element, type: string, init: MouseEventInit & { pointerId?: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  target.dispatchEvent(event);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function grip(container: HTMLElement, direction: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-resize-direction="${direction}"]`);
  if (!element) throw new Error(`missing ${direction} grip`);
  return element;
}

describe("resizeFrame", () => {
  const start = { x: 100, y: 200, width: 1000, height: 700 };

  it("grows and shrinks the edges the pointer is holding", () => {
    expect(resizeFrame(start, 120, 60, "SouthEast")).toEqual({
      x: 100,
      y: 200,
      width: 1120,
      height: 760,
    });
  });

  it("moves the frame origin with the left and top edges it is holding", () => {
    expect(resizeFrame(start, -80, -50, "NorthWest")).toEqual({
      x: 20,
      y: 150,
      width: 1080,
      height: 750,
    });
  });

  it("clamps to the minimum without pushing the held edge away from the pointer", () => {
    const frame = resizeFrame(start, 400, 300, "NorthWest", { width: 800, height: 600 });

    expect(frame.width).toBe(800);
    expect(frame.height).toBe(600);
    // The bottom/right edges stay where they were, so the window grows leftwards.
    expect(frame.x).toBe(300);
    expect(frame.y).toBe(300);
  });

  it("leaves the origin alone for edges that do not hold the frame", () => {
    const frame = resizeFrame(start, 200, 200, "SouthEast");

    expect(frame.x).toBe(start.x);
    expect(frame.y).toBe(start.y);
  });
});

describe("WindowResizeHandles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appWindow.innerSize.mockResolvedValue({ width: 1200, height: 800 });
    mocks.appWindow.outerPosition.mockResolvedValue({ x: 100, y: 200 });
    mocks.appWindow.scaleFactor.mockResolvedValue(1);
    mocks.appWindow.setSize.mockResolvedValue(undefined);
    mocks.appWindow.setPosition.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "userAgent", {
      value: MAC_USER_AGENT,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (darwin) AppleWebKit/537.36 jsdom",
      configurable: true,
    });
  });

  it("exposes a grip on every edge and corner", () => {
    const { container } = render(<WindowResizeHandles />);

    const directions = [...container.querySelectorAll("[data-resize-direction]")].map((element) =>
      element.getAttribute("data-resize-direction"),
    );

    expect(directions).toEqual([
      "North",
      "South",
      "West",
      "East",
      "NorthWest",
      "NorthEast",
      "SouthWest",
      "SouthEast",
    ]);
  });

  it("resizes the window when a corner is dragged", async () => {
    const { container } = render(<WindowResizeHandles />);
    const southEast = grip(container, "SouthEast");

    pointer(southEast, "pointerdown", { button: 0, screenX: 500, screenY: 500 });
    await settle();
    pointer(southEast, "pointermove", { screenX: 540, screenY: 530 });
    await settle();

    expect(mocks.appWindow.setSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1240, height: 830 }),
    );
    // A bottom-right drag must not move the window.
    expect(mocks.appWindow.setPosition).not.toHaveBeenCalled();
  });

  it("carries the frame origin along when a left edge is dragged", async () => {
    const { container } = render(<WindowResizeHandles />);
    const west = grip(container, "West");

    pointer(west, "pointerdown", { button: 0, screenX: 100, screenY: 500 });
    await settle();
    pointer(west, "pointermove", { screenX: 60, screenY: 500 });
    await settle();

    expect(mocks.appWindow.setSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1240, height: 800 }),
    );
    expect(mocks.appWindow.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: 60, y: 200 }),
    );
  });

  it("keeps the opposite edge pinned once the minimum size clamps the drag", async () => {
    const { container } = render(<WindowResizeHandles />);
    const north = grip(container, "North");

    pointer(north, "pointerdown", { button: 0, screenX: 500, screenY: 100 });
    await settle();
    pointer(north, "pointermove", { screenX: 500, screenY: 350 });
    await settle();

    expect(mocks.appWindow.setSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1200, height: 600 }),
    );
    expect(mocks.appWindow.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: 100, y: 400 }),
    );
  });

  it("stops resizing after the pointer is released", async () => {
    const { container } = render(<WindowResizeHandles />);
    const southEast = grip(container, "SouthEast");

    pointer(southEast, "pointerdown", { button: 0, screenX: 500, screenY: 500 });
    await settle();
    pointer(southEast, "pointermove", { screenX: 520, screenY: 510 });
    pointer(southEast, "pointerup", { screenX: 520, screenY: 510 });
    await settle();

    const calls = mocks.appWindow.setSize.mock.calls.length;
    pointer(southEast, "pointermove", { screenX: 700, screenY: 700 });
    await settle();

    expect(mocks.appWindow.setSize.mock.calls.length).toBe(calls);
  });

  it("ignores drags that start on a non-primary button", async () => {
    const { container } = render(<WindowResizeHandles />);
    const southEast = grip(container, "SouthEast");

    pointer(southEast, "pointerdown", { button: 2, screenX: 500, screenY: 500 });
    await settle();
    pointer(southEast, "pointermove", { screenX: 560, screenY: 560 });
    await settle();

    expect(mocks.appWindow.setSize).not.toHaveBeenCalled();
  });

  it("stays out of the way on platforms whose native frame still resizes", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      configurable: true,
    });

    const { container } = render(<WindowResizeHandles />);

    expect(container.querySelectorAll("[data-resize-direction]")).toHaveLength(0);
  });
});
