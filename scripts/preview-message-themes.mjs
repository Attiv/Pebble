// Renders the message-detail templates from the real registry
// (src/lib/messageThemes.ts) and the real stylesheet (src/styles/index.css)
// into a standalone preview page.
//
// The markup mirrors what MessageDetail emits — the same class names and the
// same `data-msg-*` structural flags — so the page exercises the layout rules
// that ship in the app rather than a copy of them. The body is drawn in a
// shadow root that receives messageThemeContentCss(theme), again as in the app.
//
// Both palettes are embedded for every template, because a fixed one carries a
// `dark` variant that only the app's mode decides between: the page starts on
// the light palette and `?appTheme=dark` re-renders each mock through
// resolveMessageTheme(theme, true), exactly as MessageDetail does.
//
// Query params:
//   ?only=<id>       render a single template, full width
//   ?appTheme=dark   resolve every template against a dark app
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const repo = resolve(import.meta.dirname, "..");
const out = resolve(repo, ".workbuddy/preview");
mkdirSync(out, { recursive: true });

async function loadModule(sourcePath, name) {
  const source = readFileSync(sourcePath, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modulePath = resolve(out, name);
  writeFileSync(modulePath, js);
  return import(pathToFileURL(modulePath).href);
}

const { MESSAGE_THEMES, messageThemeContentCss, messageThemeVariables, resolveMessageTheme } =
  await loadModule(
    resolve(repo, "src/lib/messageThemes.ts"),
    "messageThemes.compiled.mjs",
  );

// Tailwind's at-rules are resolved by Vite at build time and would fail here.
const appCss = readFileSync(resolve(repo, "src/styles/index.css"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*@(import|source)\b/.test(line))
  .join("\n");

const EMAIL_HTML = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding-bottom:12px">
    <h1 style="margin:0 0 6px;font-size:19px;color:#111">Your weekly digest is ready</h1>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6">
      Here is everything that happened in the projects you follow. Reply to this
      message if you would rather not receive it.
    </p>
  </td></tr>
  <tr><td style="padding-bottom:12px">
    <p style="margin:0 0 8px;font-size:13px;color:#333;line-height:1.6">
      Three things worth reading this week — a note on <a href="https://example.com/a">release cadence</a>,
      a short piece on <a href="https://example.com/b">reviewing your own diff</a>, and the usual
      <a href="https://example.com/c">changelog roundup</a>.
    </p>
    <blockquote style="margin:0;padding:8px 12px;border-left:3px solid #d8d8d8;color:#555;font-size:13px">
      "Ship small, ship often, and write the test that would have caught it."
    </blockquote>
  </td></tr>
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e2e2e2;border-radius:6px">
      <tr>
        <td style="padding:10px 12px;font-size:13px;color:#333">Pull requests merged</td>
        <td style="padding:10px 12px;font-size:13px;color:#111;text-align:right">14</td>
      </tr>
      <tr>
        <td style="padding:10px 12px;font-size:13px;color:#333;border-top:1px solid #e2e2e2">Issues closed</td>
        <td style="padding:10px 12px;font-size:13px;color:#111;text-align:right;border-top:1px solid #e2e2e2">31</td>
      </tr>
    </table>
  </td></tr>
</table>
`.trim();

// Mirrors the <style> ShadowDomEmail injects. The host-context rule is the
// app's pre-existing light-sheet fallback and is reproduced verbatim so the
// ?appTheme=dark run shows what the app really does.
const BASE_SHADOW_CSS = `
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
  .pebble-email-content { box-sizing: border-box; max-width: 100%; overflow-x: auto; color: inherit; background: transparent; }
  :host-context([data-theme="dark"]) .pebble-email-content {
    display: inline-block;
    max-width: 100%;
    color-scheme: light;
    color: #202124;
    background: #fff;
  }
  table { border-collapse: collapse; }
`;

const varsToStyle = (theme) =>
  Object.entries(messageThemeVariables(theme))
    // Font stacks carry double quotes ("Segoe UI"); inside a double-quoted raw
    // HTML attribute they would terminate it early, so escape them.
    .map(([key, value]) => `${key}:${String(value).replace(/"/g, "&quot;")}`)
    .join(";");

const SUBJECT = "&#8220;&#31471;&#21320;&#33410;&#8221;&#20197;&#21450;&#26356;&#22810;&#22270;&#26495;";
const HEADER_ICONS = ["&#9200;", "&#127912;", "&#127760;", "&#10024;"];
const ACTION_ICONS = ["&#8617;", "&#8618;", "&#10148;", "&#9734;", "&#128451;", "&#128465;", "&#9638;"];

const backMarkup = `<span class="message-detail-back">&#8592;</span>`;

const actionsMarkup = `
      <div class="message-detail-actions">
        ${HEADER_ICONS.map((icon) => `<span class="message-detail-icon-button">${icon}</span>`).join("\n        ")}
      </div>`;

const avatarMarkup = `<span class="message-detail-avatar">PI</span>`;

const identityMarkup = `
      <div class="message-detail-identity">
        <div class="message-detail-from">
          <span class="message-detail-from-name">Pinterest</span>
          <span class="message-detail-from-address">&lt;recommendations@discover.pinterest.com&gt;</span>
        </div>
        <div class="message-detail-recipients">
          <span>To:&nbsp;Vittawlk &lt;vittawlk@gmail.com&gt;</span>
        </div>
        <div class="message-detail-contacts">
          <span class="preview-contact">&#128100;</span>
          <span class="preview-contact">&#128100;</span>
        </div>
        <div class="message-detail-date">Sep 18, 2026, 02:59 PM</div>
      </div>`;

const toolbarMarkup = (orientation) => `
      <div class="message-detail-toolbar">
        <div class="message-action-toolbar" data-orientation="${orientation}" style="display:flex;gap:2px;position:relative">
          ${ACTION_ICONS.map((icon) => `<span class="preview-action">${icon}</span>`).join("")}
        </div>
      </div>`;

const attachmentsMarkup = (variant) => `
      <div class="attachment-list" data-variant="${variant}">
        <div class="attachment-list-inner">
          <div class="attachment-list-title">Attachments (2)</div>
          <div class="attachment-list-items">
            <div class="attachment-list-row">
              <span class="attachment-list-icon">&#128209;</span>
              <span class="attachment-list-name">Q3-board-deck.pdf</span>
              <span class="attachment-list-size">248.1 KB</span>
              <span class="attachment-list-download">&#8681;</span>
            </div>
            <div class="attachment-list-row">
              <span class="attachment-list-icon">&#128247;</span>
              <span class="attachment-list-name">moodboard-hero.png</span>
              <span class="attachment-list-size">1.2 MB</span>
              <span class="attachment-list-download">&#8681;</span>
            </div>
          </div>
        </div>
      </div>`;

/** The notes/controls that differ per theme family rather than per mode. */
const CHROME_STYLE = [
  "display:flex",
  "flex-direction:column",
  "height:560px",
  "border-radius:10px",
  "overflow:hidden",
  "border:1px solid rgba(0,0,0,0.14)",
  "box-shadow:0 8px 24px rgba(20,20,30,0.12)",
].join(";");

function modeRender(theme, isDark) {
  const resolved = resolveMessageTheme(theme, isDark);
  const { layout } = resolved;
  return {
    style: `${CHROME_STYLE};${varsToStyle(resolved)}`,
    attributes: {
      "data-msg-structure": layout.structure,
      "data-msg-align": layout.align,
      "data-msg-toolbar": layout.toolbar,
      "data-msg-header-card": String(layout.headerCard),
      "data-msg-avatar": String(layout.avatar),
      "data-msg-full-bleed": String(layout.headerFullBleed),
    },
    meta: [
      resolved.tone,
      resolved.paletteMode,
      `${layout.structure} / ${layout.align}`,
      `toolbar ${layout.toolbar}`,
      layout.contentWidth,
      `body ${resolved.type.body.size}/${resolved.type.body.leading}`,
      `page ${resolved.page.background}`,
    ].join(" · "),
    css: BASE_SHADOW_CSS + messageThemeContentCss(resolved),
  };
}

const mocks = MESSAGE_THEMES.map((theme) => {
  const { layout } = theme;
  const inColumns = layout.structure === "columns";
  const orientation = layout.toolbar === "sidebar" ? "vertical" : "horizontal";
  const toolbar = toolbarMarkup(orientation);

  const aside = inColumns
    ? `
    <aside class="message-detail-aside">${avatarMarkup}${identityMarkup}${toolbar}${attachmentsMarkup("panel")}
    </aside>`
    : "";

  const light = modeRender(theme, false);
  const dark = modeRender(theme, true);

  return `
  <section class="mock" data-mock="${theme.id}">
    <header class="mock-label">
      <strong>${theme.id}</strong>
      <span class="mock-meta" data-meta-light="${light.meta}" data-meta-dark="${dark.meta}">${light.meta}</span>
    </header>
    <div
      class="message-detail-container"
      data-message-theme="${theme.id}"
      ${Object.entries(light.attributes).map(([k, v]) => `${k}="${v}"`).join("\n      ")}
      style="${light.style}"
    >
      <div class="message-detail-header">
        <div class="message-detail-header-inner">
          <div class="message-detail-topbar">
            ${backMarkup}
            <h2 class="message-detail-title">${SUBJECT}</h2>${actionsMarkup}
          </div>${inColumns ? "" : `\n          ${avatarMarkup}${identityMarkup}${layout.toolbar === "sidebar" ? "" : toolbar}`}
        </div>
      </div>

      <div class="message-detail-body-area">${aside}
        <div class="message-detail-reading">
          <div class="scroll-region message-body-scroll" style="flex:1;overflow:auto;display:flex;flex-direction:column;align-items:center;padding:var(--msg-page-padding)">
            <div class="message-body-surface" id="surface-${theme.id}" style="width:100%;max-width:var(--msg-content-width);box-sizing:border-box;background:var(--msg-surface-background);border:var(--msg-surface-border);border-radius:var(--msg-surface-radius);box-shadow:var(--msg-surface-shadow);padding:var(--msg-surface-padding)"></div>
          </div>${inColumns ? "" : attachmentsMarkup("bar")}
        </div>
      </div>
    </div>
    <script type="application/json" class="mock-payload">${JSON.stringify({
      id: theme.id,
      surfaceId: `surface-${theme.id}`,
      html: EMAIL_HTML,
      modes: { light, dark },
    })}</script>
  </section>`;
}).join("\n");

// Built from the registry so the deep links can never drift from the themes.
const quickLinks = MESSAGE_THEMES.map(
  (theme) => `<a href="?appTheme=dark&amp;only=${theme.id}">${theme.id}</a>`,
).join(" ·\n    ");

const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Pebble · 邮件详情主题预览</title>
<style>${appCss}</style>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px;
    background: #e6e6ea;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
    color: #1a1a1a;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .page-note { font-size: 13px; color: #5c5c66; margin: 0 0 8px; max-width: 860px; line-height: 1.6; }
  .page-modes { font-size: 12px; color: #5c5c66; margin: 0 0 24px; }
  .page-modes a { color: #b25a3a; }
  .grid { display: grid; gap: 28px; grid-template-columns: repeat(auto-fit, minmax(440px, 1fr)); align-items: start; }
  .mock-label { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: #4a4a52; padding: 0 2px 8px; flex-wrap: wrap; }
  .mock-label strong { font-size: 13px; letter-spacing: 0.02em; }
  .mock-label span { color: #74747e; }
  /* Stand-ins for the interactive bits (real app uses lucide icons + buttons). */
  .preview-action, .preview-contact {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 4px;
    font-size: 13px; line-height: 1; color: var(--msg-meta-color);
  }
  .preview-contact { width: 20px; height: 20px; font-size: 11px; }
  .message-detail-back { font-size: 15px; line-height: 1; }
</style>
</head>
<body>
  <h1>邮件详情主题 · 8 套（4 套中性排版 + 4 套品牌皮肤）</h1>
  <p class="page-note">
    本页由 <code>src/lib/messageThemes.ts</code> 的真实主题注册表与
    <code>src/styles/index.css</code> 的真实布局规则渲染：同一份邮件 HTML，
    只有 <code>--msg-*</code> 变量、<code>data-msg-*</code> 结构标记与 shadow 内的正文排版不同。
    card / mailbox 是 <em>adaptive</em>（配色就是应用自己的 <code>--color-*</code>，所以两种模式自动跟着走）；
    letter 与四套品牌皮肤是 <em>fixed</em>，各带一份自己的暗色变体（<code>dark</code>），
    深色模式下通过 <code>resolveMessageTheme()</code> 换上——和 App 里走的是同一条路径。
    邮件本身是浅色排版的，所以深色变体里「纸」仍是浅色：WeChat / Telegram / iMessage 用它自己官方夜色的深色卡片
    托一张白纸，Letter / Claude 则保留那张纸、只把书桌和文字变暗。
  </p>
  <p class="page-modes">
    对照明暗模式：<a href="?appTheme=dark">全部 · 深色</a> ·
    ${quickLinks}
  </p>
  <div class="grid">${mocks}
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    const mode = params.get("appTheme") === "dark" ? "dark" : "light";

    for (const el of document.querySelectorAll(".mock-payload")) {
      const payload = JSON.parse(el.textContent);
      const render = payload.modes[mode];
      const host = document.getElementById(payload.surfaceId);

      // The container carries its palette as inline custom properties, so the
      // mode switch is a re-write of those rather than a stylesheet rule.
      const container = host.closest(".message-detail-container");
      container.setAttribute("style", render.style);
      for (const [name, value] of Object.entries(render.attributes)) {
        container.setAttribute(name, value);
      }
      const meta = container.parentElement.querySelector(".mock-meta");
      if (meta) meta.textContent = meta.dataset["meta" + mode[0].toUpperCase() + mode.slice(1)];

      host.setAttribute("data-pebble-message-theme", payload.id);
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML =
        "<style>" + render.css + "</style>" +
        '<div class="pebble-email-content">' + payload.html + "</div>";
    }

    // ?only=<id> renders a single template for close inspection.
    const only = params.get("only");
    if (only) {
      for (const mock of document.querySelectorAll(".mock")) {
        if (mock.dataset.mock !== only) mock.remove();
      }
      document.querySelector(".grid").style.gridTemplateColumns = "1fr";
    }
    if (mode === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      document.body.style.background = "#111";
    }
  </script>
</body>
</html>
`;

writeFileSync(resolve(out, "message-themes-preview.html"), page);
console.log("wrote", resolve(out, "message-themes-preview.html"));
