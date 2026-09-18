import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShadowDomEmail, shadowEmailCss } from "@/components/ShadowDomEmail";
import { getMessageTheme } from "@/lib/messageThemes";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openMailtoUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@/app/useMailtoOpen", () => ({
  openMailtoUrl: mocks.openMailtoUrl,
}));

describe("ShadowDomEmail", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.openMailtoUrl.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
    mocks.openMailtoUrl.mockResolvedValue(true);
  });

  it("uses app theme variables instead of hardcoded light text styles", async () => {
    document.documentElement.setAttribute("data-theme", "dark");

    const { container } = render(<ShadowDomEmail html="<p>Hello</p>" />);
    const host = container.firstChild as HTMLDivElement | null;

    await waitFor(() => {
      expect(host?.shadowRoot).not.toBeNull();
    });

    const shadowMarkup = host!.shadowRoot!.innerHTML;
    expect(shadowMarkup).toContain("var(--color-text-primary)");
    expect(shadowMarkup).toContain("var(--color-accent)");
    expect(shadowMarkup).not.toContain("color: #1a1a1a");
  });

  it("themes horizontal overflow inside email content", async () => {
    const { container } = render(<ShadowDomEmail html="<pre>long code line</pre>" />);
    const host = container.firstChild as HTMLDivElement | null;

    await waitFor(() => {
      expect(host?.shadowRoot).not.toBeNull();
    });

    const shadowMarkup = host!.shadowRoot!.innerHTML;
    expect(shadowMarkup).toContain("scrollbar-width: thin");
    expect(shadowMarkup).toContain("::-webkit-scrollbar-thumb");
  });

  it("keeps light-authored email html readable in dark theme", async () => {
    document.documentElement.setAttribute("data-theme", "dark");

    const { container } = render(
      <ShadowDomEmail html={'<div style="color: #000000">Dark inline text</div>'} />,
    );
    const host = container.firstChild as HTMLDivElement | null;

    await waitFor(() => {
      expect(host?.shadowRoot).not.toBeNull();
    });

    const shadowMarkup = host!.shadowRoot!.innerHTML;
    expect(shadowMarkup).toContain('class="pebble-email-content"');
    expect(shadowMarkup).toContain(':host-context([data-theme="dark"]) .pebble-email-content');
    expect(shadowMarkup).toContain("color-scheme: light");
    expect(shadowMarkup).toContain("background: #fff");
    expect(shadowMarkup).toContain("color: #202124");
  });

  /// The echoed original's look has to come from here, not from the echo itself.
  /// Carried as an inline `style` it never reached the paint in the app, so the
  /// reader saw the original running on from the translation instead of a muted
  /// line of its own. This rule is emitted independently of any theme.
  it("styles the echoed original from the shadow root", async () => {
    const html = '<p>Body<span class="pebble-source-echo">Original</span></p>';
    const { container } = render(<ShadowDomEmail html={html} />);
    const host = container.firstChild as HTMLDivElement | null;

    await waitFor(() => {
      expect(host?.shadowRoot?.querySelector(".pebble-email-content")).not.toBeNull();
    });

    const shadowMarkup = host!.shadowRoot!.innerHTML;
    expect(shadowMarkup).toContain(".pebble-source-echo {");
    expect(shadowMarkup).toContain("color: #8a8a8a");

    // The sanitizer has to keep the class the translation puts on the echo —
    // the class is now the only thing the look depends on.
    const echo = host!.shadowRoot!.querySelector(".pebble-source-echo")!;
    expect(echo.textContent).toBe("Original");
    expect(echo.getAttribute("class")).toBe("pebble-source-echo");
  });

  it("prevents full-height email wrappers from painting a gray viewport canvas", async () => {
    const html = `
      <table height="100%" style="height: 100%; background: #f1f1f1">
        <tbody><tr><td>Cloudflare content</td></tr></tbody>
      </table>
    `;

    const { container } = render(<ShadowDomEmail html={html} />);
    const host = container.firstChild as HTMLDivElement | null;

    await waitFor(() => {
      expect(host?.shadowRoot?.querySelector(".pebble-email-content")).not.toBeNull();
    });

    const shadowMarkup = host!.shadowRoot!.innerHTML;
    expect(shadowMarkup).toContain('.pebble-email-content > table[height="100%"]');
    expect(shadowMarkup).toContain('style="height: 100%; background: #f1f1f1"');
    expect(shadowMarkup).toContain("height: auto !important");
    expect(shadowMarkup).toContain("min-height: 0 !important");
  });

  it("renders approved email CSS inside the shadow content", async () => {
    const html = `
      <style>.hero { color: red; }</style>
      <link rel="stylesheet" href="https://cdn.example.com/mail.css">
      <p class="hero">Styled body</p>
    `;

    const { container } = render(<ShadowDomEmail html={html} />);
    const host = container.firstChild as HTMLDivElement | null;

    await waitFor(() => {
      expect(host?.shadowRoot?.querySelector(".pebble-email-content")).not.toBeNull();
    });

    const content = host!.shadowRoot!.querySelector(".pebble-email-content")!;
    expect(content.querySelector("style")?.textContent).toContain(".hero");
    expect(content.querySelector("link")?.getAttribute("href")).toBe("https://cdn.example.com/mail.css");
    expect(content.querySelector(".hero")?.textContent).toBe("Styled body");
  });

  /// The `<style>` element is inline content, and this app's CSP carries a
  /// nonce in `style-src`, which makes `'unsafe-inline'` inert — the webview
  /// refused it, and the echo came out as plain running-on body text. An
  /// adopted sheet is not inline content and no directive covers it.
  it("hands the stylesheet to the shadow root as an adopted sheet", async () => {
    const originalSheetCtor = globalThis.CSSStyleSheet;
    const hadPrototypeProp = "adoptedStyleSheets" in ShadowRoot.prototype;
    class FakeSheet {
      cssText = "";
      replaceSync(text: string) {
        this.cssText = text;
      }
    }
    Object.defineProperty(globalThis, "CSSStyleSheet", {
      value: FakeSheet,
      writable: true,
      configurable: true,
    });
    if (!hadPrototypeProp) {
      Object.defineProperty(ShadowRoot.prototype, "adoptedStyleSheets", {
        value: [],
        writable: true,
        configurable: true,
      });
    }

    try {
      const { container } = render(<ShadowDomEmail html="<p>Hello</p>" />);
      const host = container.firstChild as HTMLDivElement | null;

      await waitFor(() => {
        expect(host?.shadowRoot?.querySelector(".pebble-email-content")).not.toBeNull();
      });

      const shadow = host!.shadowRoot!;
      expect(shadow.adoptedStyleSheets).toHaveLength(1);
      expect(
        (shadow.adoptedStyleSheets[0] as unknown as { cssText: string }).cssText,
      ).toContain(".pebble-source-echo {");
      // Nothing inline is left to be refused.
      expect(shadow.querySelector("style")).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "CSSStyleSheet", {
        value: originalSheetCtor,
        writable: true,
        configurable: true,
      });
      if (!hadPrototypeProp) {
        delete (ShadowRoot.prototype as unknown as Record<string, unknown>).adoptedStyleSheets;
      }
    }
  });

  it("keeps the echo rule in the stylesheet itself, independent of the theme", () => {
    const css = shadowEmailCss(null);
    expect(css).toContain(".pebble-source-echo {");
    expect(css).toContain("color: #8a8a8a");
    expect(css).toContain("display: block");
    // A theme only ever adds to it; the echo rule cannot depend on one.
    expect(shadowEmailCss(getMessageTheme("card"))).toContain(".pebble-source-echo {");
  });

  it("opens http and https links through the external URL command", async () => {
    const { container } = render(
      <ShadowDomEmail html={'<a href="http://pebble.byebug.cn/">Pebble</a>'} />,
    );
    const host = container.firstChild as HTMLDivElement | null;

    await waitFor(() => {
      expect(host?.shadowRoot?.querySelector("a")).not.toBeNull();
    });

    fireEvent.click(host!.shadowRoot!.querySelector("a")!);

    expect(mocks.invoke).toHaveBeenCalledWith("open_external_url", {
      url: "http://pebble.byebug.cn/",
    });
  });

  it("opens mailto links through the compose mailto handler", async () => {
    const { container } = render(
      <ShadowDomEmail html={'<a href="mailto:qingj1314@163.com">qingj1314@163.com</a>'} />,
    );
    const host = container.firstChild as HTMLDivElement | null;

    await waitFor(() => {
      expect(host?.shadowRoot?.querySelector("a")).not.toBeNull();
    });

    fireEvent.click(host!.shadowRoot!.querySelector("a")!);

    expect(mocks.openMailtoUrl).toHaveBeenCalledWith("mailto:qingj1314@163.com");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
