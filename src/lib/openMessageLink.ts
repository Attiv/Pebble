import { invoke } from "@tauri-apps/api/core";
import { openMailtoUrl } from "@/app/useMailtoOpen";

/** A `mailto:` link belongs to the compose flow, not to the system browser. */
export function isMailtoLink(href: string): boolean {
  return /^mailto:/i.test(href);
}

/** Only web links are handed to the OS; anything else stays inside the app. */
export function isWebLink(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/** Whether the app knows how to follow this href at all. */
export function isSupportedLink(href: string): boolean {
  return isMailtoLink(href) || isWebLink(href);
}

/**
 * Follow a link found in a message body.
 *
 * One implementation for both gestures that can ask for it — the plain click
 * on the anchor and the "open" entry in that link's context menu — so the two
 * can never drift apart.
 */
export async function openMessageLink(href: string): Promise<void> {
  if (isMailtoLink(href)) {
    await openMailtoUrl(href);
    return;
  }
  if (isWebLink(href)) {
    await invoke("open_external_url", { url: href });
  }
}
