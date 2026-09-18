import { useRef, useLayoutEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openMailtoUrl } from "@/app/useMailtoOpen";
import { sanitizeHtml, reapplyInlineStyles } from "@/lib/sanitizeHtml";
import { messageThemeContentCss, type MessageTheme } from "@/lib/messageThemes";
import { SOURCE_ECHO_CSS } from "@/lib/sourceEcho";

interface ShadowDomEmailProps {
  html: string;
  className?: string;
  /**
   * Optional message-detail theme. The theme only contributes reading
   * typography and a content sheet colour — the mail's own markup, the
   * sanitizer and the link handling are untouched by it.
   */
  theme?: MessageTheme | null;
}

/**
 * The shadow root's whole stylesheet, as data.
 *
 * Kept separate from delivery so the same rules can travel either as a
 * constructable stylesheet or as a `<style>` element, and so tests can assert
 * on the rules without standing up a shadow root.
 */
export function shadowEmailCss(theme?: MessageTheme | null): string {
  return `
        :host {
          all: initial;
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          color: var(--color-text-primary);
          background: transparent;
          word-break: break-word;
        }
        img { max-width: 100%; height: auto; }
        a { color: var(--color-accent); }
        .pebble-email-content {
          box-sizing: border-box;
          max-width: 100%;
          overflow-x: auto;
          color: inherit;
          background: transparent;
        }
        :host-context([data-theme="dark"]) .pebble-email-content {
          display: inline-block;
          max-width: 100%;
          color-scheme: light;
          color: #202124;
          background: #fff;
        }
        pre {
          white-space: pre-wrap;
          overflow-x: auto;
          scrollbar-color: var(--color-scrollbar-thumb) transparent;
          scrollbar-width: thin;
        }
        pre::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        pre::-webkit-scrollbar-thumb {
          border: 3px solid transparent;
          border-radius: 999px;
          background-clip: content-box;
          background-color: var(--color-scrollbar-thumb);
        }
        pre:hover::-webkit-scrollbar-thumb {
          background-color: var(--color-scrollbar-thumb-hover);
        }
        table { border-collapse: collapse; }
        .pebble-email-content > table[height="100%"],
        .pebble-email-content > div[height="100%"],
        .pebble-email-content > center[height="100%"],
        .pebble-email-content > table[style*="height:100%" i],
        .pebble-email-content > table[style*="height: 100%" i],
        .pebble-email-content > table[style*="height:100vh" i],
        .pebble-email-content > table[style*="height: 100vh" i],
        .pebble-email-content > div[style*="height:100%" i],
        .pebble-email-content > div[style*="height: 100%" i],
        .pebble-email-content > div[style*="height:100vh" i],
        .pebble-email-content > div[style*="height: 100vh" i],
        .pebble-email-content > center[style*="height:100%" i],
        .pebble-email-content > center[style*="height: 100%" i],
        .pebble-email-content > center[style*="height:100vh" i],
        .pebble-email-content > center[style*="height: 100vh" i] {
          height: auto !important;
          min-height: 0 !important;
        }
        td, th { word-break: normal; overflow-wrap: normal; }
        body, div { word-wrap: break-word; overflow-wrap: break-word; }
        .blocked-image {
          display: inline-block;
          padding: 6px 12px;
          font-size: 12px;
          color: #888;
          background: #f5f5f5;
          border: 1px dashed #ccc;
          border-radius: 4px;
          text-align: center;
          max-width: 100%;
          box-sizing: border-box;
        }
        ${SOURCE_ECHO_CSS}
        ${theme ? messageThemeContentCss(theme) : ""}`;
}

/**
 * Hand the stylesheet to the shadow root as a constructable stylesheet.
 *
 * A `<style>` element is *inline* content, and under a CSP whose `style-src`
 * carries a nonce — which is what Tauri generates for the bundled styles —
 * `'unsafe-inline'` counts for nothing. The webview therefore refused the
 * `<style>` this component used to inject, and with it everything the shadow
 * root was relying on: the echo's muted line, the theme's typography and the
 * mail's own sizing. An adopted sheet is not inline content, so no CSP
 * directive covers it.
 *
 * Returns false where the engine has no constructable stylesheets (jsdom, and
 * WebKit before 16.4). The `<style>` element stays as the fallback there.
 */
export function adoptShadowSheet(shadow: ShadowRoot, css: string): boolean {
  const Sheet = globalThis.CSSStyleSheet as
    | (typeof CSSStyleSheet & { prototype: { replaceSync?: unknown } })
    | undefined;
  if (!Sheet || typeof Sheet.prototype?.replaceSync !== "function") return false;
  try {
    const sheet = new Sheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
    return shadow.adoptedStyleSheets?.length === 1;
  } catch {
    return false;
  }
}

export function ShadowDomEmail({ html, className, theme }: ShadowDomEmailProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // The shadow body must be ready before paint; otherwise the reader can flash
  // from the fallback text into the sanitized HTML a frame later.
  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const shadow = hostRef.current.shadowRoot
      || hostRef.current.attachShadow({ mode: "open" });

    const css = shadowEmailCss(theme);
    const safeHtml = sanitizeHtml(html);
    const adopted = adoptShadowSheet(shadow, css);

    shadow.innerHTML = adopted
      ? `<div class="pebble-email-content">${safeHtml}</div>`
      : `<style>${css}</style>
      <div class="pebble-email-content">${safeHtml}</div>`;

    // The message's own `style` attributes are refused by the same CSP that
    // killed the `<style>` element, so what they carry has to be handed back
    // through the CSSOM once the markup is in place.
    reapplyInlineStyles(shadow);

    const handleClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      const href = anchor?.getAttribute("href")?.trim();
      if (!href) return;

      if (/^mailto:/i.test(href)) {
        event.preventDefault();
        void openMailtoUrl(href);
        return;
      }

      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        void invoke("open_external_url", { url: href })
          .catch((err) => console.warn("Failed to open email body link", err));
      }
    };

    shadow.addEventListener("click", handleClick);
    return () => {
      shadow.removeEventListener("click", handleClick);
    };
  }, [html, theme]);

  return (
    <div
      ref={hostRef}
      className={className}
      data-pebble-message-theme={theme?.id}
    />
  );
}
