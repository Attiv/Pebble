import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useClickOutside } from "../../src/hooks/useClickOutside";

/** A real node to hang off a hand-made ref — the hook only reads `current`. */
function makeNode(): HTMLDivElement {
  const node = document.createElement("div");
  document.body.appendChild(node);
  return node;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useClickOutside", () => {
  it("closes on a mousedown outside the popover", () => {
    const node = makeNode();
    const onClose = vi.fn();
    renderHook(() => useClickOutside({ current: node }, true, onClose));

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open on a mousedown inside the popover", () => {
    const node = makeNode();
    const onClose = vi.fn();
    renderHook(() => useClickOutside({ current: node }, true, onClose));

    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const node = makeNode();
    const onClose = vi.fn();
    renderHook(() => useClickOutside({ current: node }, true, onClose));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves other keys alone", () => {
    const node = makeNode();
    const onClose = vi.fn();
    renderHook(() => useClickOutside({ current: node }, true, onClose));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
  });

  // The keyboard layer must be able to tell that a popover is on screen before
  // it takes Escape for the window, and it can only do that through the marker.
  it("marks the node while open and unmarks it on unmount", () => {
    const node = makeNode();
    const { unmount } = renderHook(() => useClickOutside({ current: node }, true, vi.fn()));

    expect(node.getAttribute("data-pebble-overlay")).toBe("true");

    unmount();

    expect(node.hasAttribute("data-pebble-overlay")).toBe(false);
  });

  it("neither listens nor marks while inactive", () => {
    const node = makeNode();
    const onClose = vi.fn();
    renderHook(() => useClickOutside({ current: node }, false, onClose));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
    expect(node.hasAttribute("data-pebble-overlay")).toBe(false);
  });

  it("unmarks the node when the popover closes", () => {
    const node = makeNode();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useClickOutside({ current: node }, active, vi.fn()),
      { initialProps: { active: true } },
    );

    expect(node.hasAttribute("data-pebble-overlay")).toBe(true);

    rerender({ active: false });

    expect(node.hasAttribute("data-pebble-overlay")).toBe(false);
  });
});
