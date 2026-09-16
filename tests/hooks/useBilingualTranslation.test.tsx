import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, RenderedHtml } from "../../src/lib/api";
import { translateText } from "../../src/lib/api";
import { useBilingualTranslation } from "../../src/hooks/useBilingualTranslation";
import { useUIStore } from "../../src/stores/ui.store";

vi.mock("../../src/lib/api", () => ({
  translateText: vi.fn(),
}));

const translateMock = vi.mocked(translateText);

/** Long enough that the reader is given the source line underneath it. */
const LONG_ENGLISH = "The report is attached, please review it before Friday.";
const LONG_ENGLISH_2 = "Second paragraph that is also comfortably over the limit.";
const LONG_ENGLISH_3 = "Third paragraph that is also comfortably over the limit.";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    body_text: "Body",
    body_html_raw: "<p>Body</p>",
    ...overrides,
  } as Message;
}

function makeRendered(html: string): RenderedHtml {
  return { html, images_blocked: 0, trackers_blocked: [] };
}

function reply(translated: string) {
  return { translated, segments: [] };
}

async function toggle(
  hook: { current: ReturnType<typeof useBilingualTranslation> },
) {
  await act(async () => {
    await hook.current.handleBilingualToggle();
  });
}

describe("useBilingualTranslation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ language: "zh" });
  });

  /// The reported bug: a reader whose interface is Chinese asked for a
  /// translation and was sent the text back in English.
  it("translates into the language the interface is displayed in", async () => {
    translateMock.mockResolvedValue(reply("报告已随附。"));
    const { result } = renderHook(() =>
      useBilingualTranslation("message-lang", null, makeMessage({ body_text: LONG_ENGLISH })),
    );

    await toggle(result);

    expect(translateMock).toHaveBeenCalledWith(LONG_ENGLISH, "auto", "zh");
  });

  it("echoes the original under each translated paragraph in an HTML message", async () => {
    translateMock.mockResolvedValue(reply("报告已随附，请在周五前查阅。"));
    const { result } = renderHook(() =>
      useBilingualTranslation(
        "message-html",
        makeRendered(`<p>${LONG_ENGLISH}</p>`),
        makeMessage(),
      ),
    );

    await toggle(result);

    expect(result.current.bilingualError).toBeNull();
    expect(result.current.bilingualResult?.translated).toContain("报告已随附，请在周五前查阅。");
    expect(result.current.bilingualResult?.translated).toContain(LONG_ENGLISH);
  });

  it("does not echo fragments that are not paragraphs", async () => {
    translateMock.mockResolvedValue(reply("文档"));
    const { result } = renderHook(() =>
      useBilingualTranslation("message-fragment", makeRendered("<a>Docs</a>"), makeMessage()),
    );

    await toggle(result);

    const translated = result.current.bilingualResult?.translated ?? "";
    expect(translated).toContain("文档");
    expect(translated).not.toContain("Docs");
  });

  /// Before this, an engine that answered with nothing left the English body on
  /// screen looking like a translation that had worked.
  it("reports an answer with no text instead of showing the original as the translation", async () => {
    translateMock.mockResolvedValue(reply(""));
    const { result } = renderHook(() =>
      useBilingualTranslation("message-empty", makeRendered(`<p>${LONG_ENGLISH}</p>`), makeMessage()),
    );

    await toggle(result);

    expect(result.current.bilingualError?.code).toBe("empty");
    expect(result.current.bilingualResult).toBeNull();
  });

  it("reports an engine that returned the source unchanged", async () => {
    translateMock.mockResolvedValue(reply(LONG_ENGLISH));
    const { result } = renderHook(() =>
      useBilingualTranslation("message-echo", null, makeMessage({ body_text: LONG_ENGLISH })),
    );

    await toggle(result);

    expect(result.current.bilingualError?.code).toBe("unchanged");
  });

  it("warns when only part of the message could be translated", async () => {
    translateMock.mockResolvedValue({
      translated: "第一段译文。\n⸻\n第二段译文。",
      segments: [],
    });
    const rendered = makeRendered(
      `<p>${LONG_ENGLISH}</p><p>${LONG_ENGLISH_2}</p><p>${LONG_ENGLISH_3}</p>`,
    );
    const { result } = renderHook(() =>
      useBilingualTranslation("message-partial", rendered, makeMessage()),
    );

    await toggle(result);

    expect(result.current.bilingualWarning).toEqual({ code: "partial", done: 2, total: 3 });
    // The separator line is punctuation from the batch, not a paragraph.
    expect(result.current.bilingualResult?.translated).not.toContain("⸻");
    // The paragraph the engine never answered for keeps its original wording.
    expect(result.current.bilingualResult?.translated).toContain(LONG_ENGLISH_3);
  });

  it("does not warn when the engine deliberately left a paragraph alone", async () => {
    // "Best regards" is correctly left as-is: no paragraph went unanswered, so
    // there is nothing to warn the reader about.
    translateMock.mockResolvedValue({ translated: "报告已随附。\n⸻\nBest regards", segments: [] });
    const rendered = makeRendered(`<p>${LONG_ENGLISH}</p><p>Best regards</p>`);
    const { result } = renderHook(() =>
      useBilingualTranslation("message-names", rendered, makeMessage()),
    );

    await toggle(result);

    expect(result.current.bilingualWarning).toBeNull();
    expect(result.current.bilingualError).toBeNull();
    expect(result.current.bilingualResult?.translated).toContain("报告已随附。");
  });

  it("surfaces a failed request with the engine's message", async () => {
    translateMock.mockRejectedValue("LLM error 401 Unauthorized");
    const { result } = renderHook(() =>
      useBilingualTranslation("message-error", null, makeMessage({ body_text: LONG_ENGLISH })),
    );

    await toggle(result);

    expect(result.current.bilingualError?.code).toBe("failed");
    expect(result.current.bilingualError?.detail).toContain("401");
  });

  it("pairs the translation with the source paragraph by paragraph for plain text", async () => {
    translateMock.mockResolvedValue({
      translated: "第一行。\n第二行。",
      segments: [
        { source: "First line.", target: "第一行。" },
        { source: "Second line.", target: "第二行。" },
      ],
    });
    const { result } = renderHook(() =>
      useBilingualTranslation(
        "message-plain",
        null,
        makeMessage({ body_text: "First line.\nSecond line." }),
      ),
    );

    await toggle(result);

    expect(result.current.bilingualResult?.segments).toEqual([
      { source: "First line.", target: "第一行。" },
      { source: "Second line.", target: "第二行。" },
    ]);
    expect(result.current.bilingualResult?._isHtml).toBe(false);
  });

  it("asks for no translation when the message has no body", async () => {
    const { result } = renderHook(() =>
      useBilingualTranslation(
        "message-nobody",
        null,
        makeMessage({ body_text: "", body_html_raw: "" }),
      ),
    );

    await toggle(result);

    expect(translateMock).not.toHaveBeenCalled();
    expect(result.current.bilingualError?.code).toBe("noText");
  });
});
