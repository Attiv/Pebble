/**
 * Recognition of the divider lines mail clients put in front of a forwarded
 * block. Kept deliberately narrow: an isolated line such as
 * `---------- Forwarded message ----------` or
 * `------------------ 原始邮件 ------------------`.
 *
 * Shared by the composer (which rebuilds the hierarchy) and the reader (which
 * turns the block into a card), so both agree on what counts as a forward.
 */
const FORWARD_MARKER_WORDS = [
  "forwarded message",
  "forward message",
  "original message",
  "original",
  "转发邮件",
  "轉寄郵件",
  "转发消息",
  "已转发邮件",
  "原始邮件",
  "原始郵件",
  "原邮件",
];

export function isForwardedMessageMarker(text: string): boolean {
  // Cheap exit first: most candidates are whole paragraphs or entire bodies,
  // and rewriting them twice just to reject them is the expensive part.
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 120) return false;

  const normalized = trimmed.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  if (!normalized) return false;

  const dashed = normalized.match(/^-{2,}\s*(.*?)\s*-{2,}$/);
  if (dashed) {
    const inner = dashed[1].replace(/[:：]$/, "").trim().toLowerCase();
    return FORWARD_MARKER_WORDS.some((word) => inner === word || inner.includes(word));
  }

  const bare = normalized.replace(/[:：]$/, "").trim().toLowerCase();
  return bare === "begin forwarded message" || bare === "forwarded message";
}
