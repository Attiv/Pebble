import { describe, expect, it } from "vitest";
import { buildForwardCards, type ForwardCardLabels } from "@/lib/forwardCard";

const labels: ForwardCardLabels = {
  badge: "转发邮件",
  quoted: "引用邮件",
  history: "历史邮件",
  from: "发件人",
  date: "日期",
  to: "收件人",
  cc: "抄送",
};

function container(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/** The shape a plain-text-ish client writes: one paragraph per line. */
const SUPABASE_FORWARD = `
  <p>Hi Aloysius,</p>
  <p>FYI</p>
  <p></p>
  <p>---------- 转发邮件 ----------</p>
  <p>发件人：ant.wilson@supabase.com</p>
  <p>主题：Your Supabase project is going to be paused.</p>
  <p>Your Supabase project is going to be paused.</p>
`;

describe("buildForwardCards", () => {
  it("turns a flattened divider and its header lines into one card", () => {
    const root = container(SUPABASE_FORWARD);

    expect(buildForwardCards(root, labels)).toBe(1);

    const card = root.querySelector(".pebble-forward-card");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".pebble-forward-badge")?.textContent).toBe("转发邮件");
    expect(card?.querySelector(".pebble-forward-card__subject")?.textContent)
      .toBe("Your Supabase project is going to be paused.");

    const meta = Array.from(card!.querySelectorAll(".pebble-forward-card__meta"));
    expect(meta.map((row) => row.querySelector(".pebble-forward-card__meta-label")?.textContent))
      .toEqual(["发件人"]);
    expect(meta[0].querySelector(".pebble-forward-card__meta-value")?.textContent)
      .toBe("ant.wilson@supabase.com");
    expect(card?.querySelector(".pebble-forward-card__body")?.textContent?.trim())
      .toBe("Your Supabase project is going to be paused.");
  });

  it("keeps the prose above the forward outside the card", () => {
    const root = container(SUPABASE_FORWARD);
    buildForwardCards(root, labels);

    const card = root.querySelector(".pebble-forward-card")!;
    expect(card.contains(root.querySelector("p"))).toBe(false);
    expect(root.textContent).toContain("FYI");
    expect(root.textContent).not.toContain("--------");
  });

  it("nests an older forward one level down instead of showing two equal cards", () => {
    const root = container(`
      <p>---------- 转发邮件 ----------</p>
      <p>发件人：outer@example.com</p>
      <p>主题：Outer hop</p>
      <p>outer body</p>
      <p>---------- 转发邮件 ----------</p>
      <p>发件人：inner@example.com</p>
      <p>主题：Inner hop</p>
      <p>inner body</p>
    `);

    expect(buildForwardCards(root, labels)).toBe(2);

    const outer = root.querySelector(".pebble-forward-card");
    expect(outer?.querySelector(".pebble-forward-card__subject")?.textContent).toBe("Outer hop");

    const history = outer?.querySelector(".pebble-forward-history");
    expect(history).not.toBeNull();
    expect(history?.querySelector(".pebble-forward-history__label")?.textContent).toBe("历史邮件");

    const inner = history?.querySelector(".pebble-forward-card");
    expect(inner?.querySelector(".pebble-forward-card__subject")?.textContent).toBe("Inner hop");
    expect(inner?.querySelector(".pebble-forward-card__body")?.textContent?.trim()).toBe("inner body");
  });

  it("splits a divider and header lines that share one element with <br>", () => {
    const root = container(
      '<div>---------- Forwarded message ---------<br>'
      + "<b>From:</b> Alice &lt;a@example.com&gt;<br>"
      + "<b>Date:</b> 1 October 2026<br>"
      + "<b>Subject:</b> Hello there<br>"
      + "Body line</div>",
    );

    expect(buildForwardCards(root, labels)).toBe(1);

    const card = root.querySelector(".pebble-forward-card")!;
    expect(card.querySelector(".pebble-forward-card__subject")?.textContent).toBe("Hello there");
    const values = Array.from(card.querySelectorAll(".pebble-forward-card__meta-value"))
      .map((value) => value.textContent);
    expect(values).toEqual(["Alice <a@example.com>", "1 October 2026"]);
    expect(card.querySelector(".pebble-forward-card__body")?.textContent?.trim()).toBe("Body line");
  });

  it("keeps an address clickable when the header line linked it", () => {
    const root = container(
      '<p>---------- Forwarded message ----------</p>'
      + '<p>From: <a href="mailto:alice@example.com">alice@example.com</a></p>'
      + "<p>body</p>",
    );

    buildForwardCards(root, labels);

    const link = root.querySelector(".pebble-forward-card__meta-value a");
    expect(link?.getAttribute("href")).toBe("mailto:alice@example.com");
    expect(root.querySelector(".pebble-forward-card__meta-label")?.textContent).toBe("发件人");
  });

  it("cards the Outlook header block that follows a rule", () => {
    const root = container(`
      <p>Hi Alvin,</p>
      <hr>
      <div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000"><b>From:</b> Service &lt;service@example.com&gt;<br><b>Sent:</b> Tuesday, 20 October 2026 08:14<br><b>To:</b> Alvin &lt;alvin@example.com&gt;<br><b>Subject:</b> Re: SBS White screen</font><div>&nbsp;</div></div>
      <div><p>Hi team,</p><p>body text</p></div>
    `);

    expect(buildForwardCards(root, labels)).toBe(1);

    const card = root.querySelector(".pebble-forward-card")!;
    // Outlook does not say whether the block is a forward or a reply quote.
    expect(card.querySelector(".pebble-forward-badge")?.textContent).toBe("引用邮件");
    expect(card.querySelector(".pebble-forward-card__subject")?.textContent)
      .toBe("Re: SBS White screen");

    const values = Array.from(card.querySelectorAll(".pebble-forward-card__meta-value"))
      .map((value) => value.textContent);
    expect(values).toEqual([
      "Service <service@example.com>",
      "Tuesday, 20 October 2026 08:14",
      "Alvin <alvin@example.com>",
    ]);
    expect(card.querySelector(".pebble-forward-card__body")?.textContent)
      .toContain("body text");
    expect(root.querySelector("hr")).toBeNull();
    expect(root.textContent).not.toContain("divRplyFwdMsg");
  });

  it("cards the Word variant, whose header lines hide <br> inside spans", () => {
    const root = container(`
      <div class="MsoNormal" align="center"><hr size="0" width="100%" align="center"></div>
      <div id="divRplyFwdMsg">
        <p class="MsoNormal"><b><span>发件人</span></b><b><span>:</span></b><span>Service &lt;s@example.com&gt;<br></span><b><span>发送时间</span></b><b><span>:</span></b><span>2026年10月20日<br></span><b><span>收件人</span></b><b><span>:</span></b><span>Alvin<br></span><b><span>主题</span></b><b><span>:</span></b><span>Re: 白屏</span></p>
      </div>
      <div>正文内容</div>
    `);

    expect(buildForwardCards(root, labels)).toBe(1);

    const card = root.querySelector(".pebble-forward-card")!;
    expect(card.querySelector(".pebble-forward-badge")?.textContent).toBe("引用邮件");
    expect(card.querySelector(".pebble-forward-card__subject")?.textContent).toBe("Re: 白屏");
    const values = Array.from(card.querySelectorAll(".pebble-forward-card__meta-value"))
      .map((value) => value.textContent);
    expect(values).toEqual(["Service <s@example.com>", "2026年10月20日", "Alvin"]);
    expect(card.querySelector(".pebble-forward-card__body")?.textContent?.trim()).toBe("正文内容");
    // The rule's centred wrapper goes with it, not just the rule.
    expect(root.querySelector(".MsoNormal")).toBeNull();
  });

  it("ignores a rule that is not followed by a header block", () => {
    const html = "<p>above</p><hr><p>just a divider</p>";
    const root = container(html);

    expect(buildForwardCards(root, labels)).toBe(0);
    expect(root.innerHTML).toBe(html);
  });

  it("leaves a message without a forward divider untouched", () => {
    const html = "<p>Just a normal message</p><p>with two paragraphs</p>";
    const root = container(html);

    expect(buildForwardCards(root, labels)).toBe(0);
    expect(root.innerHTML).toBe(html);
  });

  it("does not re-card a card it already built", () => {
    const root = container(SUPABASE_FORWARD);

    buildForwardCards(root, labels);
    const once = root.innerHTML;
    expect(buildForwardCards(root, labels)).toBe(0);
    expect(root.innerHTML).toBe(once);
  });
});

/** The header `buildForwardMessageHtml` writes: flat rows, no label column. */
const SENT_FROM_PEBBLE = `
  <div class="pebble-forward-card">
    <div class="pebble-forward-card__header">
      <div class="pebble-forward-badge">转发邮件</div>
      <div class="pebble-forward-card__subject">Fwd: SBS Request for APK</div>
      <div class="pebble-forward-card__meta" style="margin:0;font-size:12px;color:#475467">发件人：Aloysius &lt;a@example.com&gt;</div>
      <div class="pebble-forward-card__meta" style="margin:0;font-size:12px;color:#475467">日期：2026/10/20 08:50:50</div>
      <div class="pebble-forward-card__meta" style="margin:0;font-size:12px;color:#475467">抄送：Anand &lt;b@example.com&gt;</div>
    </div>
    <div class="pebble-forward-card__body">body</div>
  </div>
`;

describe("cards that arrived already built", () => {
  it("gives a Pebble-sent card the same label/value header", () => {
    const root = container(SENT_FROM_PEBBLE);

    buildForwardCards(root, labels);

    const rows = Array.from(root.querySelectorAll(".pebble-forward-card__meta"));
    expect(rows.map((row) => row.querySelector(".pebble-forward-card__meta-label")?.textContent))
      .toEqual(["发件人", "日期", "抄送"]);
    expect(rows.map((row) => row.querySelector(".pebble-forward-card__meta-value")?.textContent))
      .toEqual(["Aloysius <a@example.com>", "2026/10/20 08:50:50", "Anand <b@example.com>"]);
    // The sender's inline font/colour must not survive onto the rebuilt row.
    expect(rows[0].getAttribute("style")).toBeNull();
    expect(root.querySelector(".pebble-forward-card__subject")?.textContent)
      .toBe("Fwd: SBS Request for APK");
  });

  it("keeps a link inside a flat row clickable", () => {
    const root = container(SENT_FROM_PEBBLE.replace(
      "发件人：Aloysius &lt;a@example.com&gt;",
      '发件人：<a href="mailto:a@example.com">Aloysius</a>',
    ));

    buildForwardCards(root, labels);

    const link = root.querySelector(".pebble-forward-card__meta-value a");
    expect(link?.getAttribute("href")).toBe("mailto:a@example.com");
    expect(root.querySelector(".pebble-forward-card__meta-value")?.textContent).toBe("Aloysius");
  });

  it("leaves a row that is not a header field alone", () => {
    const root = container(SENT_FROM_PEBBLE.replace(
      "抄送：Anand &lt;b@example.com&gt;",
      "本邮件仅供内部使用",
    ));

    buildForwardCards(root, labels);

    const rows = Array.from(root.querySelectorAll(".pebble-forward-card__meta"));
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toBe("本邮件仅供内部使用");
    expect(rows[2].querySelector(".pebble-forward-card__meta-label")).toBeNull();
  });
});
