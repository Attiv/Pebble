import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CLOSE_MESSAGE_DETAIL_EVENT,
  useCloseMessageDetail,
} from "../../src/hooks/useCloseMessageDetail";

/** Ask for the detail to close the way `useKeyboard` does, and report back. */
function requestClose(): boolean {
  const request = new CustomEvent(CLOSE_MESSAGE_DETAIL_EVENT, { cancelable: true });
  document.dispatchEvent(request);
  return request.defaultPrevented;
}

describe("useCloseMessageDetail", () => {
  it("closes the detail and reports the keystroke as used", () => {
    const closeDetail = vi.fn();
    renderHook(() => useCloseMessageDetail(true, closeDetail));

    let consumed = false;
    act(() => { consumed = requestClose(); });

    expect(closeDetail).toHaveBeenCalledTimes(1);
    expect(consumed).toBe(true);
  });

  // Without this the shortcut would swallow Escape in an empty inbox instead of
  // letting it fall through to the next thing Escape means in that view.
  it("stays silent when nothing is open", () => {
    const closeDetail = vi.fn();
    renderHook(() => useCloseMessageDetail(false, closeDetail));

    let consumed = true;
    act(() => { consumed = requestClose(); });

    expect(closeDetail).not.toHaveBeenCalled();
    expect(consumed).toBe(false);
  });

  it("only answers while its own view is the one showing a message", () => {
    const inboxClose = vi.fn();
    const searchClose = vi.fn();
    renderHook(() => useCloseMessageDetail(false, inboxClose));
    renderHook(() => useCloseMessageDetail(true, searchClose));

    act(() => { requestClose(); });

    expect(inboxClose).not.toHaveBeenCalled();
    expect(searchClose).toHaveBeenCalledTimes(1);
  });

  it("uses the latest handler without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ closeDetail }: { closeDetail: () => void }) => useCloseMessageDetail(true, closeDetail),
      { initialProps: { closeDetail: first } },
    );

    rerender({ closeDetail: second });
    act(() => { requestClose(); });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops answering once the view unmounts", () => {
    const closeDetail = vi.fn();
    const { unmount } = renderHook(() => useCloseMessageDetail(true, closeDetail));

    unmount();
    let consumed = true;
    act(() => { consumed = requestClose(); });

    expect(closeDetail).not.toHaveBeenCalled();
    expect(consumed).toBe(false);
  });
});
