import { describe, expect, it } from "vitest";
import {
  appendQuotedContextText,
  appendReplyQuoteHtml,
  buildComposeEditorContent,
  buildForwardMessageHtml,
  buildReplyQuoteHtml,
  shouldApplyInitialEditorContent,
  structureForwardHistory,
} from "../../src/hooks/useComposeEditor";
import type { Message } from "../../src/lib/ipc-types";
import type { TFunction } from "i18next";

const t = ((key: string, options?: Record<string, string>) => {
  if (key === "compose.quoteAttribution") {
    return `On ${options?.date}, ${options?.sender} wrote:`;
  }
  if (key === "compose.forwardedHeader") {
    return "Forwarded message";
  }
  if (key === "compose.forwardedFrom") {
    return `From: ${options?.sender}`;
  }
  if (key === "compose.forwardedSubject") {
    return `Subject: ${options?.subject}`;
  }
  if (key === "compose.forwardedMessage") {
    return "Forwarded message";
  }
  if (key === "compose.forwardedHistory") {
    return "Earlier message";
  }
  if (key === "compose.forwardedDate") {
    return `Date: ${options?.date}`;
  }
  if (key === "compose.forwardedTo") {
    return `To: ${options?.recipients}`;
  }
  if (key === "compose.forwardedCc") {
    return `Cc: ${options?.recipients}`;
  }
  return key;
}) as unknown as TFunction;

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: "message-1",
    account_id: "account-1",
    remote_id: "remote-1",
    message_id_header: "<message-1@example.com>",
    in_reply_to: null,
    references_header: null,
    thread_id: null,
    subject: "HTML message",
    snippet: "",
    from_address: "sender@example.com",
    from_name: "Sender",
    to_list: [],
    cc_list: [],
    bcc_list: [],
    has_attachments: false,
    is_read: true,
    is_starred: false,
    is_draft: false,
    date: 0,
    remote_version: null,
    is_deleted: false,
    deleted_at: null,
    created_at: 0,
    updated_at: 0,
    body_text: "",
    body_html_raw: "",
    ...overrides,
  };
}

describe("buildComposeEditorContent", () => {
  it("keeps quoted reply content out of the editable reply body", () => {
    const content = buildComposeEditorContent({
      composeMode: "reply",
      composeReplyTo: makeMessage({
        body_html_raw:
          "&lt;html&gt;&lt;body&gt;&lt;p&gt;&lt;strong&gt;Hello&lt;/strong&gt; team&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;",
      }),
      isReply: true,
      signatureHtml: "",
    });

    expect(content).toContain("<p><br></p>");
    expect(content).not.toContain("<blockquote");
    expect(content).not.toContain("<strong>Hello</strong> team");
    expect(content).not.toContain("&lt;strong&gt;");
  });

  it("keeps the forwarded message out of the editable body", () => {
    const content = buildComposeEditorContent({
      composeMode: "forward",
      composeReplyTo: makeMessage({
        body_html_raw: "<p>Forwarded body that belongs in its own card</p>",
      }),
      isReply: false,
      signatureHtml: "<p>Signature</p>",
    });

    expect(content).toBe("<p><br></p><p>Signature</p>");
    expect(content).not.toContain("Forwarded body");
  });

  it("builds the original reply as separate quoted HTML", () => {
    const quote = buildReplyQuoteHtml({
      composeReplyTo: makeMessage({
        body_html_raw:
          "&lt;html&gt;&lt;body&gt;&lt;p&gt;&lt;strong&gt;Hello&lt;/strong&gt; team&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;",
      }),
      t,
    });

    expect(quote).toContain("<blockquote");
    expect(quote).toContain("Sender wrote");
    expect(quote).toContain("<strong>Hello</strong> team");
    expect(quote).not.toContain("&lt;strong&gt;");
  });

  it("removes document CSS and remote-loading resources from quoted messages", () => {
    const quote = buildReplyQuoteHtml({
      composeReplyTo: makeMessage({
        body_html_raw:
          '<style>#root { display: none }</style>' +
          '<link rel="stylesheet" href="https://tracker.example/mail.css">' +
          '<p style="color: red">Hello</p>' +
          '<img src="https://tracker.example/pixel" srcset="https://tracker.example/2x 2x">',
      }),
      t,
    });

    expect(quote).toContain("Hello");
    expect(quote).toContain("color: red");
    expect(quote).not.toContain("<style");
    expect(quote).not.toContain("<link");
    expect(quote).not.toContain("tracker.example");
    expect(quote).not.toContain("srcset");
  });

  it("appends the quoted reply only when sending", () => {
    expect(appendReplyQuoteHtml("<p>Reply</p>", "<blockquote><p>Original</p></blockquote>"))
      .toBe("<p>Reply</p><br/><br/><blockquote><p>Original</p></blockquote>");
    expect(appendReplyQuoteHtml("<p>Reply</p>", "")).toBe("<p>Reply</p>");
  });

  it("appends the quoted context to the plain-text part too", () => {
    expect(appendQuotedContextText("Reply", "Original")).toBe("Reply\n\nOriginal");
    expect(appendQuotedContextText("", "Original")).toBe("Original");
    expect(appendQuotedContextText("Reply", "")).toBe("Reply");
  });

  it("wraps the latest forward in a labelled card with metadata", () => {
    const html = buildForwardMessageHtml({
      composeReplyTo: makeMessage({
        subject: "Quarterly review",
        from_name: "Sender",
        from_address: "sender@example.com",
        to_list: [{ name: "Me", address: "me@example.com" }],
        date: 1700000000,
        body_html_raw: "<p>Forwarded body</p>",
      }),
      t,
    });

    expect(html).toContain('class="pebble-forward-card"');
    expect(html).toContain("Forwarded message");
    expect(html).toContain("Quarterly review");
    expect(html).toContain("From: Sender &lt;sender@example.com&gt;");
    expect(html).toContain("To: Me &lt;me@example.com&gt;");
    expect(html).toContain('class="pebble-forward-card__body"');
    expect(html).toContain("Forwarded body");
  });

  it("keeps the card readable in mail clients with inline styles", () => {
    const html = buildForwardMessageHtml({
      composeReplyTo: makeMessage({ body_html_raw: "<p>Forwarded body</p>" }),
      t,
      inlineStyles: true,
    });

    expect(html).toContain('class="pebble-forward-card" style="margin:20px 0 0');
    expect(html).toContain('class="pebble-forward-card__body" style="padding:16px');
  });

  it("rebuilds nested levels from flattened forward dividers", () => {
    const html = buildForwardMessageHtml({
      composeReplyTo: makeMessage({
        body_html_raw: [
          "<p>My note</p>",
          "<p>---------- Forwarded message ----------</p>",
          "<p>From: first@example.com</p>",
          "<p>First body</p>",
          "<p>---------- 转发邮件 ----------</p>",
          "<p>From: second@example.com</p>",
          "<p>Second body</p>",
        ].join(""),
      }),
      t,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    const histories = doc.querySelectorAll(".pebble-forward-history");
    expect(histories.length).toBe(2);
    expect(histories[0].contains(histories[1])).toBe(true);
    expect(doc.querySelectorAll(".pebble-forward-history__label").length).toBe(2);
    expect(html).toContain("First body");
    expect(html).toContain("Second body");
  });

  it("demotes an existing forward card to a nested history level", () => {
    const html = buildForwardMessageHtml({
      composeReplyTo: makeMessage({
        body_html_raw:
          '<div class="pebble-forward-card">' +
          '<div class="pebble-forward-card__body">Older hop</div>' +
          "</div>",
      }),
      t,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll(".pebble-forward-card").length).toBe(2);
    const histories = doc.querySelectorAll(".pebble-forward-history");
    expect(histories.length).toBe(1);
    expect(histories[0].textContent).toContain("Earlier message");
    expect(histories[0].textContent).toContain("Older hop");
  });

  it("leaves bodies without forward dividers untouched", () => {
    const body = "<p>Hello</p><p>World</p>";
    expect(structureForwardHistory(body, { label: "Earlier message" })).toBe(body);
  });

  it("does not re-apply generated content after the editor was initialized", () => {
    expect(shouldApplyInitialEditorContent({
      editorExists: true,
      initialized: true,
      signatureReady: true,
      hasRestoredDraft: false,
    })).toBe(false);
  });

  it("waits for async signature loading before initializing new compose content", () => {
    expect(shouldApplyInitialEditorContent({
      editorExists: true,
      initialized: false,
      signatureReady: false,
      hasRestoredDraft: false,
    })).toBe(false);
    expect(shouldApplyInitialEditorContent({
      editorExists: true,
      initialized: false,
      signatureReady: true,
      hasRestoredDraft: false,
    })).toBe(true);
  });
});
