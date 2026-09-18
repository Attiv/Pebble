import { describe, expect, it } from "vitest";
import { SOURCE_ECHO_CLASS, SOURCE_ECHO_CSS } from "../../src/lib/sourceEcho";

/**
 * The echoed original is styled by class, from the shadow root.
 *
 * It used to carry the same declarations as an inline `style` attribute, and in
 * the app they never reached the paint: a reader reported "翻译的时候译文和原文
 * 没有分段,还在一行", and measuring their screenshot confirmed it — the echoed
 * English is painted in the surrounding 16px body colour instead of 12px
 * `#8a8a8a`, so it runs on from the translation rather than starting its own
 * line. Nothing about the look may depend on surviving the sanitizer again.
 */
describe("source echo styling", () => {
  it("addresses the echo by class", () => {
    expect(SOURCE_ECHO_CSS).toContain(`.${SOURCE_ECHO_CLASS} {`);
    expect(SOURCE_ECHO_CLASS).toBe("pebble-source-echo");
  });

  it("puts the original on its own line, in muted small type", () => {
    expect(SOURCE_ECHO_CSS).toContain("display: block");
    expect(SOURCE_ECHO_CSS).toContain("font-size: 12px");
    expect(SOURCE_ECHO_CSS).toContain("line-height: 1.6");
    expect(SOURCE_ECHO_CSS).toContain("color: #8a8a8a");
    expect(SOURCE_ECHO_CSS).toContain("border-left");
    expect(SOURCE_ECHO_CSS).toContain("padding-left");
  });

  /// These are direct declarations on the echo, so they already beat the
  /// `font-size`/`color` the sender's own `<div>` passes down by inheritance.
  /// An `!important` would be a second, silent thing to keep in sync — and
  /// `!important` is exactly the crutch that made the inline style look right
  /// while it was being dropped.
  it("needs no !important to outrank the message's own text", () => {
    expect(SOURCE_ECHO_CSS).not.toContain("!important");
  });
});
