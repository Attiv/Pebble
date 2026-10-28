import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, RenderedHtml } from "../../src/lib/api";
import { useMessageLoader } from "../../src/hooks/useMessageLoader";
import { getMessageWithHtml, getRenderedHtml } from "../../src/lib/api";

vi.mock("../../src/lib/api", () => ({
  getMessageWithHtml: vi.fn(),
  getRenderedHtml: vi.fn(),
}));

vi.mock("../../src/hooks/mutations/useUpdateFlagsMutation", () => ({
  useUpdateFlagsMutation: () => ({ mutate: vi.fn() }),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    account_id: "account-1",
    remote_id: "remote-1",
    message_id_header: null,
    in_reply_to: null,
    references_header: null,
    thread_id: "thread-1",
    subject: "Subject",
    snippet: "Snippet",
    from_address: "sender@example.com",
    from_name: "Sender",
    to_list: [],
    cc_list: [],
    bcc_list: [],
    has_attachments: false,
    is_read: true,
    is_starred: false,
    is_draft: false,
    date: 1_700_000_000,
    remote_version: null,
    is_deleted: false,
    deleted_at: null,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    body_text: "Body",
    body_html_raw: "<p>Body</p>",
    ...overrides,
  };
}

function makeRendered(html = "<p>Body</p>"): RenderedHtml {
  return {
    html,
    trackers_blocked: [],
    images_blocked: 0,
  };
}

/**
 * The hook reads the query cache to avoid reloading a message it already has,
 * so it needs a client even though nothing in these cases is cached.
 */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useMessageLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not request a second HTML render after the initial message load", async () => {
    vi.mocked(getMessageWithHtml).mockResolvedValue([makeMessage(), makeRendered()]);

    const { result } = renderHook(() => useMessageLoader("message-1", "Strict"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getMessageWithHtml).toHaveBeenCalledOnce();
    expect(getMessageWithHtml).toHaveBeenCalledWith("message-1", "Strict");
    expect(getRenderedHtml).not.toHaveBeenCalled();
  });

  it("re-renders HTML without reloading the message when privacy mode changes", async () => {
    vi.mocked(getMessageWithHtml).mockResolvedValue([makeMessage(), makeRendered()]);
    vi.mocked(getRenderedHtml).mockResolvedValue(makeRendered("<p>Strict again</p>"));

    const { rerender } = renderHook(
      ({ privacyMode }) => useMessageLoader("message-1", privacyMode),
      { initialProps: { privacyMode: "Strict" as const }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(getMessageWithHtml).toHaveBeenCalledOnce());

    rerender({ privacyMode: "LoadOnce" as const });

    await waitFor(() => expect(getRenderedHtml).toHaveBeenCalledOnce());
    expect(getRenderedHtml).toHaveBeenCalledWith("message-1", "LoadOnce");
    expect(getMessageWithHtml).toHaveBeenCalledOnce();
  });

  it("exposes message load failures instead of collapsing them into a missing message", async () => {
    vi.mocked(getMessageWithHtml).mockRejectedValue(new Error("IPC failed"));

    const { result } = renderHook(() => useMessageLoader("message-1", "Strict"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.message).toBeNull();
    expect(result.current.error).toBe("IPC failed");
  });

  it("exposes privacy re-render failures without clearing the loaded message", async () => {
    vi.mocked(getMessageWithHtml).mockResolvedValue([makeMessage(), makeRendered()]);
    vi.mocked(getRenderedHtml).mockRejectedValue(new Error("render failed"));

    const { result, rerender } = renderHook(
      ({ privacyMode }) => useMessageLoader("message-1", privacyMode),
      { initialProps: { privacyMode: "Strict" as const }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.message?.id).toBe("message-1"));

    rerender({ privacyMode: "LoadOnce" as const });

    await waitFor(() => expect(result.current.error).toBe("render failed"));
    expect(result.current.message?.id).toBe("message-1");
  });
});
