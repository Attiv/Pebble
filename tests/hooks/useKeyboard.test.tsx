import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BINDINGS, useShortcutStore } from "../../src/stores/shortcut.store";
import { useMailStore } from "../../src/stores/mail.store";

const mocks = vi.hoisted(() => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    getQueriesData: vi.fn(() => []),
  },
  archiveMessage: vi.fn(),
  updateMessageFlags: vi.fn(),
  getMessage: vi.fn(),
  patchMessagesCache: vi.fn(),
  readFirstCachedMessages: vi.fn(() => []),
}));

vi.mock("../../src/lib/query-client", () => ({
  queryClient: mocks.queryClient,
}));

vi.mock("../../src/lib/api", () => ({
  archiveMessage: mocks.archiveMessage,
  updateMessageFlags: mocks.updateMessageFlags,
  getMessage: mocks.getMessage,
}));

vi.mock("../../src/hooks/queries", () => ({
  patchMessagesCache: mocks.patchMessagesCache,
  readFirstCachedMessages: mocks.readFirstCachedMessages,
}));

vi.mock("../../src/lib/i18n", () => ({
  default: {
    t: (_key: string, fallback: string) => fallback,
  },
}));

import { useKeyboard } from "../../src/hooks/useKeyboard";
import { CLOSE_MESSAGE_DETAIL_EVENT } from "../../src/hooks/useCloseMessageDetail";
import { useUIStore } from "../../src/stores/ui.store";

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

describe("useKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.archiveMessage.mockResolvedValue("archived");
    useShortcutStore.setState({
      bindings: { ...DEFAULT_BINDINGS, "archive-message": "E" },
      recording: null,
    });
    useMailStore.setState({
      selectedMessageId: "message-1",
      selectedThreadId: null,
      threadView: false,
    });
  });

  it("refreshes folder unread counts after the archive shortcut succeeds", async () => {
    renderHook(() => useKeyboard());

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    });

    await waitFor(() => expect(mocks.archiveMessage).toHaveBeenCalledWith("message-1"));
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["folder-unread-counts"] });
  });
});

describe("useKeyboard — Escape closes an open message", () => {
  /** Stands in for whichever view is showing a message. */
  function answerDetailClose(consume: boolean) {
    const listener = vi.fn((event: Event) => {
      if (consume) event.preventDefault();
    });
    document.addEventListener(CLOSE_MESSAGE_DETAIL_EVENT, listener);
    return { listener, stop: () => document.removeEventListener(CLOSE_MESSAGE_DETAIL_EVENT, listener) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useShortcutStore.setState({ bindings: { ...DEFAULT_BINDINGS }, recording: null });
    useUIStore.setState({ activeView: "search" });
  });

  it("gives the keystroke to the open message, not to the view behind it", () => {
    const detail = answerDetailClose(true);
    renderHook(() => useKeyboard());

    pressEscape();

    expect(detail.listener).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().activeView).toBe("search");
    detail.stop();
  });

  it("falls through to the view when no message is open", () => {
    renderHook(() => useKeyboard());

    pressEscape();

    expect(useUIStore.getState().activeView).toBe("inbox");
  });

  // One keystroke, one layer: the popover closes itself on Escape, and the
  // message under it must survive that press.
  it("leaves Escape to a popover that is on screen", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-pebble-overlay", "true");
    document.body.appendChild(overlay);
    const detail = answerDetailClose(true);
    renderHook(() => useKeyboard());

    pressEscape();

    expect(detail.listener).not.toHaveBeenCalled();
    expect(useUIStore.getState().activeView).toBe("search");
    detail.stop();
    overlay.remove();
  });

  it("leaves Escape to a dialog that is on screen", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    const detail = answerDetailClose(true);
    renderHook(() => useKeyboard());

    pressEscape();

    expect(detail.listener).not.toHaveBeenCalled();
    expect(useUIStore.getState().activeView).toBe("search");
    detail.stop();
    dialog.remove();
  });
});
