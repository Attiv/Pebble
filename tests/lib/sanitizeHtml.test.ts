import { describe, expect, it } from "vitest";
import { sanitizeHtml, reapplyInlineStyles } from "../../src/lib/sanitizeHtml";

describe("sanitizeHtml", () => {
  it("preserves safe inline email styles", () => {
    const sanitized = sanitizeHtml(
      '<p style="color: red; text-align: center; margin: 8px">Hello</p>',
    );

    expect(sanitized).toContain("style=");
    expect(sanitized).toContain("color:");
    expect(sanitized).toContain("text-align:");
  });

  it("removes unsafe inline style content", () => {
    const sanitized = sanitizeHtml(
      '<p style="background-image: url(javascript:alert(1)); color: blue">Hello</p>',
    );

    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).toContain("color:");
  });

  it("preserves safe background shorthand used by email buttons", () => {
    const sanitized = sanitizeHtml(
      '<a style="background: #f38020; color: #ffffff; border: 1px solid #f38020">Open dashboard</a>',
    );

    expect(sanitized).toContain("background:");
    expect(sanitized).toContain("#f38020");
    expect(sanitized).toContain("color:");
  });

  it("preserves safe border radius used by email cards", () => {
    const sanitized = sanitizeHtml(
      '<table style="border-radius:20px; background-color:#ffffff"><tbody><tr><td>Body</td></tr></tbody></table>',
    );

    expect(sanitized).toContain("border-radius:20px");
    expect(sanitized).toContain("background-color:#ffffff");
  });

  it("removes unsafe background shorthand urls", () => {
    const sanitized = sanitizeHtml(
      '<p style="background: url(https://evil.example/track); color: blue">Hello</p>',
    );

    expect(sanitized).not.toContain("evil.example");
    expect(sanitized).toContain("color:");
  });

  it("keeps zero-height email spacer image constraints", () => {
    const sanitized = sanitizeHtml(
      '<img src="https://example.com/spacer.png" width="600" height="1" style="display:block;max-height:0px;min-height:0px;min-width:600px;width:600px">',
    );

    expect(sanitized).toContain("max-height:0px");
    expect(sanitized).toContain("min-height:0px");
    expect(sanitized).toContain("min-width:600px");
    expect(sanitized).toContain('height="1"');
  });

  it("preserves hidden preheader clipping styles", () => {
    const sanitized = sanitizeHtml(
      '<div style="max-width:0px;max-height:0px;overflow:hidden;visibility:hidden;opacity:0">马凯，为您推荐 2 条新动态</div>',
    );

    expect(sanitized).toContain("max-width:0px");
    expect(sanitized).toContain("max-height:0px");
    expect(sanitized).toContain("overflow:hidden");
    expect(sanitized).toContain("visibility:hidden");
    expect(sanitized).toContain("opacity:0");
  });

  it("uses only body content from full html documents", () => {
    const sanitized = sanitizeHtml(
      "<html><head><title>Leaked subject</title><style>p{color:red}</style></head><body><p>Visible body</p></body></html>",
    );

    expect(sanitized).toContain("Visible body");
    expect(sanitized).not.toContain("Leaked subject");
    expect(sanitized).not.toContain("p{color:red}");
  });

  it("preserves backend-approved embedded style tags", () => {
    const sanitized = sanitizeHtml(
      '<style>.hero{color:red}</style><p class="hero">Visible body</p>',
    );

    expect(sanitized).toContain("<style>");
    expect(sanitized).toContain(".hero{color:red}");
    expect(sanitized).toContain('class="hero"');
  });

  it("preserves backend-approved stylesheet links", () => {
    const sanitized = sanitizeHtml(
      '<link rel="stylesheet" href="https://cdn.example.com/mail.css"><p>Visible body</p>',
    );

    expect(sanitized).toContain('rel="stylesheet"');
    expect(sanitized).toContain('href="https://cdn.example.com/mail.css"');
  });

  it("removes non-stylesheet link tags", () => {
    const sanitized = sanitizeHtml(
      '<link rel="preload" href="https://cdn.example.com/mail.css"><p>Visible body</p>',
    );

    expect(sanitized).not.toContain("<link");
    expect(sanitized).toContain("Visible body");
  });

  it("removes inline styles with escaped url tokens", () => {
    const sanitized = sanitizeHtml(
      `<p style="color: u\\72l('https://evil.example/track')">hello</p>`,
    );

    expect(sanitized).not.toContain("evil.example");
    expect(sanitized).not.toContain("u\\72l");
  });

  it("preserves safe link attributes for email body links", () => {
    const sanitized = sanitizeHtml(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>',
    );

    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
  });

  it("normalizes existing email links to safe external navigation attributes", () => {
    const sanitized = sanitizeHtml(
      '<a href="mailto:support@example.com" target="_top" rel="opener">support@example.com</a>',
    );

    expect(sanitized).toContain('href="mailto:support@example.com"');
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
    expect(sanitized).not.toContain("_top");
    expect(sanitized).not.toContain('rel="opener"');
  });

  /// A marketing grid sizes its cells with `table-layout`, and covers its
  /// thumbnails with `background-size`/`object-fit` off the cell's `background`
  /// attribute. Dropping those four families collapsed the grid.
  it("preserves the layout properties an email grid is built from", () => {
    const sanitized = sanitizeHtml(
      '<table style="table-layout:fixed"><tbody><tr>' +
        '<td background="https://i.pinimg.com/400x300/a.jpg" style="background-size:cover;background-position:50%;background-repeat:no-repeat">' +
        '<img src="https://i.pinimg.com/400x300/a.jpg" style="object-fit:cover;box-sizing:border-box">' +
        "</td></tr></tbody></table>",
    );

    expect(sanitized).toContain("table-layout:fixed");
    expect(sanitized).toContain("background-size:cover");
    expect(sanitized).toContain("background-position:50%");
    expect(sanitized).toContain("background-repeat:no-repeat");
    expect(sanitized).toContain("object-fit:cover");
    expect(sanitized).toContain("box-sizing:border-box");
  });
});

describe("reapplyInlineStyles", () => {
  /// Under the app's CSP the webview keeps the `style` attribute's text but
  /// applies none of it, so the element's CSSOM starts empty. jsdom has no such
  /// policy — it parses the attribute eagerly, which would make any assertion on
  /// `element.style` pass for free. This hands the element a CSSOM that starts
  /// empty and records what gets written into it instead.
  function blindedCssom(element: Element): Record<string, string> {
    const written: Record<string, string> = {};
    Object.defineProperty(element, "style", {
      configurable: true,
      value: {
        setProperty(name: string, value: string, priority = "") {
          written[`${name}|${priority}`] = value;
        },
      },
    });
    return written;
  }

  it("hands every surviving declaration to the CSSOM", () => {
    const host = document.createElement("div");
    host.innerHTML = '<p style="color: red; text-align: center; margin: 8px">Hello</p>';
    const written = blindedCssom(host.querySelector("p")!);

    expect(reapplyInlineStyles(host)).toBe(3);
    expect(written).toEqual({
      "color|": "red",
      "text-align|": "center",
      "margin|": "8px",
    });
  });

  it("carries !important, which is how a message hides its Outlook fallbacks", () => {
    const host = document.createElement("div");
    host.innerHTML =
      '<div style="display:none !important"><span>Outlook-only overlay</span></div>';
    const written = blindedCssom(host.querySelector("div")!);

    reapplyInlineStyles(host);

    expect(written["display|important"]).toBe("none");
  });

  it("keeps the attribute, which the shadow stylesheet matches on", () => {
    const host = document.createElement("div");
    host.innerHTML = '<table style="height: 100%; background: #f1f1f1"></table>';

    reapplyInlineStyles(host);

    // `table[style*="height:100%"]` in the shadow stylesheet still has to see it.
    expect(host.querySelector("table")!.getAttribute("style")).toContain("height");
  });

  it("draws the line in the same place the attribute form does", () => {
    const host = document.createElement("div");
    host.innerHTML =
      '<p style="background: url(https://evil.example/track); color: blue">x</p>';
    const written = blindedCssom(host.querySelector("p")!);

    reapplyInlineStyles(host);

    expect(written).toEqual({ "color|": "blue" });
  });

  it("writes nothing for an element with nothing safe in it", () => {
    const host = document.createElement("div");
    host.innerHTML =
      '<p style="behavior: url(#default#time2); -moz-binding: url(x)">x</p>';
    const written = blindedCssom(host.querySelector("p")!);

    expect(reapplyInlineStyles(host)).toBe(0);
    expect(written).toEqual({});
  });

  it("reaches the message inside a shadow root", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<div style="background-size:cover;object-fit:cover">cell</div>';
    const written = blindedCssom(shadow.querySelector("div")!);

    expect(reapplyInlineStyles(shadow)).toBe(2);
    expect(written).toEqual({ "background-size|": "cover", "object-fit|": "cover" });
  });
});
