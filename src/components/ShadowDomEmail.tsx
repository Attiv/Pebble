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
        @keyframes pebble-image-shimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
        @keyframes pebble-image-spin {
          to { transform: rotate(360deg); }
        }
        .pebble-image-frame {
          position: relative !important;
          display: inline-grid !important;
          place-items: center !important;
          max-width: 100% !important;
          min-width: 48px;
          min-height: 48px;
          overflow: hidden !important;
          vertical-align: middle !important;
          border-radius: 6px;
          box-sizing: border-box !important;
          background: linear-gradient(90deg, #eef0f3 25%, #f8f9fa 50%, #eef0f3 75%);
          background-size: 200% 100%;
          animation: pebble-image-shimmer 1.35s ease-in-out infinite;
        }
        .pebble-image-frame--block {
          display: grid !important;
        }
        .pebble-image-frame--unsized {
          width: min(100%, 480px) !important;
          aspect-ratio: 16 / 9;
        }
        .pebble-image-frame > img {
          grid-area: 1 / 1 !important;
          display: block !important;
          width: 100% !important;
          height: 100% !important;
          max-width: 100% !important;
          object-fit: contain !important;
          color: transparent !important;
          opacity: 0 !important;
          transition: opacity 160ms ease-out;
        }
        .pebble-image-loading {
          grid-area: 1 / 1 !important;
          display: none !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          color: #6b7280 !important;
          font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
          pointer-events: none !important;
        }
        .pebble-image-loading::before {
          content: "";
          width: 16px;
          height: 16px;
          border: 2px solid rgba(107, 114, 128, 0.3);
          border-top-color: #6b7280;
          border-radius: 50%;
          animation: pebble-image-spin 0.8s linear infinite;
          box-sizing: border-box;
        }
        .pebble-image-frame[data-image-state="loading"] {
          animation: none;
          background: #f3f4f6;
        }
        .pebble-image-frame[data-image-state="loading"] .pebble-image-loading,
        .pebble-image-frame[data-image-state="error"] .pebble-image-loading {
          display: inline-flex !important;
        }
        .pebble-image-frame[data-image-state="loaded"] {
          animation: none;
          background: transparent;
          min-width: 0;
          min-height: 0;
        }
        .pebble-image-frame[data-image-state="loaded"] > img {
          color: inherit !important;
          opacity: 1 !important;
        }
        .pebble-image-frame[data-image-state="error"] {
          animation: none;
          background: #f3f4f6;
          border: 1px dashed #d1d5db;
        }
        .pebble-image-frame[data-image-state="error"] .pebble-image-loading::before {
          display: none;
        }
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

const IMAGE_LOADING_DELAY_MS = 450;

function numericImageDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Reserve each remote image's place before it paints, suppressing native alt
// text until the request settles. The placeholder begins as a shimmer and
// becomes an explicit loading indicator when the request takes longer.
export function prepareEmailImages(root: ParentNode): () => void {
  const cleanups: Array<() => void> = [];

  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const declaredWidth = numericImageDimension(image.getAttribute("width"));
    const declaredHeight = numericImageDimension(image.getAttribute("height"));

    // Tracking pixels should remain visually inert instead of becoming a
    // prominent loading placeholder.
    if (
      declaredWidth !== null && declaredHeight !== null
      && declaredWidth <= 2 && declaredHeight <= 2
    ) {
      image.alt = "";
      return;
    }

    const originalAlt = image.getAttribute("alt") ?? "";
    image.alt = "";

    const measured = image.getBoundingClientRect();
    const width = declaredWidth ?? (measured.width > 2 ? measured.width : null);
    const height = declaredHeight ?? (measured.height > 2 ? measured.height : null);
    const display = globalThis.getComputedStyle?.(image).display;

    const frame = document.createElement("span");
    frame.className = "pebble-image-frame";
    frame.dataset.imageState = "skeleton";
    if (display === "block") frame.classList.add("pebble-image-frame--block");

    if (width !== null) frame.style.width = width + "px";
    if (height !== null) frame.style.height = height + "px";
    if (width !== null && height !== null) {
      frame.style.aspectRatio = width + " / " + height;
    } else if (width !== null) {
      frame.style.minHeight = Math.min(180, Math.max(48, width * 0.5625)) + "px";
    } else if (height !== null) {
      frame.style.minWidth = Math.min(320, Math.max(48, height * 1.5)) + "px";
    } else {
      frame.classList.add("pebble-image-frame--unsized");
    }

    const loading = document.createElement("span");
    loading.className = "pebble-image-loading";
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.textContent = "Loading image…";

    image.parentNode?.insertBefore(frame, image);
    frame.append(image, loading);

    let settled = false;
    const loadingTimer = window.setTimeout(() => {
      if (!settled) frame.dataset.imageState = "loading";
    }, IMAGE_LOADING_DELAY_MS);

    const settle = (state: "loaded" | "error") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(loadingTimer);
      frame.dataset.imageState = state;
      image.alt = originalAlt;
      if (state === "error") {
        loading.textContent = originalAlt || "Image unavailable";
      }
    };
    const handleLoad = () => settle("loaded");
    const handleError = () => settle("error");

    image.addEventListener("load", handleLoad);
    image.addEventListener("error", handleError);
    if (image.complete) settle(image.naturalWidth > 0 ? "loaded" : "error");

    cleanups.push(() => {
      window.clearTimeout(loadingTimer);
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    });
  });

  return () => cleanups.forEach((cleanup) => cleanup());
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
    const cleanupImages = prepareEmailImages(shadow);

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
      cleanupImages();
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
