import type { CSSProperties } from "react";

/**
 * Message-detail themes.
 *
 * A theme is *plain data*: every colour, type-scale and layout decision behind
 * one way of drawing a message. `MessageDetail` publishes a theme as CSS custom
 * properties (`--msg-*`) on its root element plus a few data attributes
 * (`data-msg-*`) for the handful of structural switches, and the stylesheet in
 * `src/styles/index.css` does the rest.
 *
 * Two axes live in here on purpose:
 *
 * - **layout** — how the zones are arranged (one column or two, cards or
 *   hairlines, avatar present or not, where the action toolbar sits).
 * - **palette / type** — the colours and the type scale that ride on top.
 *
 * They are kept as separate groups so one more theme is one more entry here and
 * nothing else: a unit test asserts every field is filled in, so a half-written
 * theme fails loudly instead of silently rendering unstyled.
 *
 * ## The eight templates
 *
 * Two families, listed in that order in {@link MESSAGE_THEMES}:
 *
 * **Neutral** — the general-purpose arrangements, which defer to the app's own
 * tokens (`paletteMode: "adaptive"`) except where the whole point is a material:
 *
 * 1. **Card** — the default; a centred 760px reading column built from a header
 *    card and a body card. Hierarchy comes from elevation.
 * 2. **Mailbox** — the same column flattened: full-bleed hairlines, no cards,
 *    denser type, actions on the sender's own line.
 * 3. **Letter** — warm paper, a centred circular monogram above a serif subject,
 *    a wider line height for long reads.
 * 4. **Console** — two columns, with the sender, actions and attachments in a
 *    dark rail beside a message on its own white sheet.
 *
 * **Brand skins** — modelled on a reading surface people already know, because a
 * familiar shape is faster to navigate than a novel one. All four own their
 * colours (`paletteMode: "fixed"`): a brand skin that followed the app's
 * light/dark tokens would stop being that brand. They are safe in either app
 * theme because every one of them is a light palette with light surfaces, so
 * mail text is dark-on-light either way.
 *
 * 5. **Claude** — ivory page, centred narrow column, serif subject, muted
 *    terracotta. Roomy and low-chrome; the calmest of the four.
 * 6. **WeChat** — flat grey page, square white cards with no shadow, the largest
 *    body type, WeChat green for actions and its slate blue for links.
 * 7. **Telegram** — two columns, with the sender, the actions and the
 *    attachments in a white rail beside the message; Telegram's blue throughout.
 * 8. **iMessage** — iOS system grey behind very round white cards, a neutral
 *    monogram, iOS blue for links.
 *
 * A brand skin may share an arrangement with a neutral one — WeChat is Mailbox
 * in different clothes, Telegram is Console — and that is the point: what a
 * test forbids is a theme that differs from an existing one by palette alone.
 */

export type MessageThemeId =
  | "card"
  | "mailbox"
  | "letter"
  | "console"
  | "claude"
  | "wechat"
  | "telegram"
  | "imessage";

export const MESSAGE_THEME_STORAGE_KEY = "pebble-message-theme";
export const DEFAULT_MESSAGE_THEME: MessageThemeId = "card";

/** How the header and the body are arranged relative to each other. */
export interface MessageThemeLayout {
  /** One column, or a reading column next to a details column. */
  structure: "stacked" | "columns";
  /** Width of the reading column. `"none"` means "fill the pane". */
  contentWidth: string;
  /** Horizontal padding between the pane edge and the reading column. */
  gutter: string;
  /** Space between the header and the reading surface. */
  sectionGap: string;
  /** Header text alignment. */
  align: "start" | "center";
  /** Give the header its own elevated card. */
  headerCard: boolean;
  /**
   * Let the header's background and rule span the whole pane instead of
   * aligning with the reading column.
   */
  headerFullBleed: boolean;
  /** Show a sender monogram. */
  avatar: boolean;
  /** Where the action toolbar (reply / forward / …) lives. */
  toolbar: "inline" | "below" | "sidebar";
  /** Left padding that lines the toolbar up under the sender name. */
  toolbarIndent: string;
}

export interface MessageThemeType {
  /** UI chrome font. */
  fontFamily: string;
  /** Font used for the subject line (may be a display/serif face). */
  displayFamily: string;
  title: { size: string; weight: number; spacing: string; leading: number; color: string };
  sender: { size: string; weight: number; color: string };
  meta: { size: string; color: string };
  /** Small labels such as the recipient row or the attachment count. */
  label: { size: string; weight: number; spacing: string; transform: "none" | "uppercase"; color: string };
  body: { fontFamily: string; size: string; weight: number; leading: number; color: string; linkColor: string };
}

export interface MessageTheme {
  id: MessageThemeId;
  labelKey: string;
  descriptionKey: string;
  tone: "light" | "dark";
  paletteMode: "adaptive" | "fixed";
  /**
   * The brand colour, for buttons and state — deliberately separate from the
   * link colour, because the two differ in some brands (WeChat acts in green,
   * links in slate blue).
   */
  accent: string;
  /** Rule drawn between zones (header, attachments, sidebar). */
  divider: string;
  /** Colour chips + layout hint drawn in the picker. */
  preview: {
    page: string;
    card: string;
    title: string;
    text: string;
    accent: string;
  };
  layout: MessageThemeLayout;
  page: { background: string };
  header: {
    background: string;
    border: string;
    cardBackground: string;
    cardBorder: string;
    cardRadius: string;
    cardShadow: string;
    padding: string;
  };
  surface: {
    background: string;
    border: string;
    radius: string;
    shadow: string;
    padding: string;
  };
  avatar: { size: string; radius: string; background: string; color: string; fontSize: string };
  type: MessageThemeType;
  /** Rules handed to the sanitized HTML inside `ShadowDomEmail`. */
  body: {
    lightSheet: boolean;
    sheetBackground: string;
    sheetTextColor: string;
  };
}

const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif';
const CJK_SANS =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif';
/** Serif stand-in for the display face Anthropic sets its headings in. */
const SERIF_DISPLAY =
  '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", serif';
const SERIF_STACK = 'Georgia, "Iowan Old Style", "Songti SC", "Times New Roman", serif';

/**
 * 1. Card — a centred reading column built from two cards.
 * Neutral chrome that follows the app theme; hierarchy comes from elevation.
 */
const card: MessageTheme = {
  id: "card",
  labelKey: "messageThemes.card",
  descriptionKey: "messageThemes.cardDesc",
  tone: "light",
  paletteMode: "adaptive",
  accent: "var(--color-accent)",
  divider: "1px solid var(--color-border)",
  preview: { page: "#f2f2f4", card: "#ffffff", title: "#17181c", text: "#6b7280", accent: "#d4714e" },
  layout: {
    structure: "stacked",
    contentWidth: "760px",
    gutter: "20px",
    sectionGap: "16px",
    align: "start",
    headerCard: true,
    headerFullBleed: false,
    avatar: true,
    toolbar: "below",
    toolbarIndent: "44px",
  },
  page: { background: "var(--color-bg-hover)" },
  header: {
    background: "transparent",
    border: "none",
    cardBackground: "var(--color-bg)",
    cardBorder: "1px solid var(--color-border)",
    cardRadius: "12px",
    cardShadow: "0 1px 2px rgba(16, 18, 24, 0.05)",
    padding: "14px 18px 12px",
  },
  surface: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    radius: "12px",
    shadow: "0 1px 2px rgba(16, 18, 24, 0.05)",
    padding: "20px 22px",
  },
  avatar: {
    size: "36px",
    radius: "10px",
    background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
    color: "var(--color-accent)",
    fontSize: "13px",
  },
  type: {
    fontFamily: SYSTEM_SANS,
    displayFamily: SYSTEM_SANS,
    title: { size: "19px", weight: 650, spacing: "-0.015em", leading: 1.35, color: "var(--color-text-primary)" },
    sender: { size: "13.5px", weight: 600, color: "var(--color-text-primary)" },
    meta: { size: "12px", color: "var(--color-text-secondary)" },
    label: {
      size: "11px",
      weight: 600,
      spacing: "0.06em",
      transform: "uppercase",
      color: "var(--color-text-secondary)",
    },
    body: {
      fontFamily: SYSTEM_SANS,
      size: "14px",
      weight: 400,
      leading: 1.65,
      color: "var(--color-text-primary)",
      linkColor: "var(--color-accent)",
    },
  },
  body: { lightSheet: false, sheetBackground: "transparent", sheetTextColor: "var(--color-text-primary)" },
};

/**
 * 2. Mailbox — full-bleed hairlines, no cards, the densest of the four.
 * Closest to a native mail client: the reading pane is the page itself.
 */
const mailbox: MessageTheme = {
  id: "mailbox",
  labelKey: "messageThemes.mailbox",
  descriptionKey: "messageThemes.mailboxDesc",
  tone: "light",
  paletteMode: "adaptive",
  accent: "var(--color-accent)",
  divider: "1px solid var(--color-border)",
  preview: { page: "#ffffff", card: "#f6f6f8", title: "#111315", text: "#5f6470", accent: "#d4714e" },
  layout: {
    structure: "stacked",
    contentWidth: "none",
    gutter: "20px",
    sectionGap: "12px",
    align: "start",
    headerCard: false,
    headerFullBleed: true,
    avatar: true,
    toolbar: "inline",
    toolbarIndent: "0",
  },
  page: { background: "var(--color-bg)" },
  header: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    cardBackground: "transparent",
    cardBorder: "none",
    cardRadius: "0",
    cardShadow: "none",
    padding: "10px 20px 9px",
  },
  surface: {
    background: "transparent",
    border: "none",
    radius: "0",
    shadow: "none",
    padding: "0",
  },
  avatar: {
    size: "32px",
    radius: "50%",
    background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
    color: "var(--color-accent)",
    fontSize: "12px",
  },
  type: {
    fontFamily: SYSTEM_SANS,
    displayFamily: SYSTEM_SANS,
    title: { size: "15px", weight: 600, spacing: "-0.005em", leading: 1.3, color: "var(--color-text-primary)" },
    sender: { size: "12.5px", weight: 600, color: "var(--color-text-primary)" },
    meta: { size: "11.5px", color: "var(--color-text-secondary)" },
    label: {
      size: "10.5px",
      weight: 600,
      spacing: "0.06em",
      transform: "uppercase",
      color: "var(--color-text-secondary)",
    },
    body: {
      fontFamily: SYSTEM_SANS,
      size: "13.5px",
      weight: 400,
      leading: 1.55,
      color: "var(--color-text-primary)",
      linkColor: "var(--color-accent)",
    },
  },
  body: { lightSheet: false, sheetBackground: "transparent", sheetTextColor: "var(--color-text-primary)" },
};

/**
 * 3. Letter — a centred correspondence: monogram above the subject, generous
 * air, larger serif body. Owns its warm palette.
 */
const letter: MessageTheme = {
  id: "letter",
  labelKey: "messageThemes.letter",
  descriptionKey: "messageThemes.letterDesc",
  tone: "light",
  paletteMode: "fixed",
  accent: "#a2603a",
  divider: "1px solid #e7dcc9",
  preview: { page: "#f4efe6", card: "#fffdf8", title: "#35302a", text: "#8b7f6d", accent: "#a2603a" },
  layout: {
    structure: "stacked",
    contentWidth: "640px",
    gutter: "28px",
    sectionGap: "24px",
    align: "center",
    headerCard: false,
    headerFullBleed: false,
    avatar: true,
    toolbar: "below",
    toolbarIndent: "0",
  },
  page: { background: "#f4efe6" },
  header: {
    background: "transparent",
    border: "none",
    cardBackground: "transparent",
    cardBorder: "none",
    cardRadius: "0",
    cardShadow: "none",
    padding: "4px 0 0",
  },
  surface: {
    background: "#fffdf8",
    border: "1px solid #e7dcc9",
    radius: "3px",
    shadow: "0 1px 2px rgba(90, 70, 40, 0.06)",
    padding: "34px 38px",
  },
  avatar: {
    size: "56px",
    radius: "50%",
    background: "#e8dcc6",
    color: "#7a5b36",
    fontSize: "20px",
  },
  type: {
    fontFamily: SYSTEM_SANS,
    displayFamily: SERIF_STACK,
    title: { size: "22px", weight: 700, spacing: "0.005em", leading: 1.4, color: "#35302a" },
    sender: { size: "14px", weight: 600, color: "#35302a" },
    meta: { size: "12.5px", color: "#8b7f6d" },
    label: {
      size: "11px",
      weight: 600,
      spacing: "0.1em",
      transform: "uppercase",
      color: "#9c8f7c",
    },
    body: {
      fontFamily: SERIF_STACK,
      size: "15px",
      weight: 400,
      leading: 1.85,
      color: "#3b3229",
      linkColor: "#a2603a",
    },
  },
  body: { lightSheet: false, sheetBackground: "transparent", sheetTextColor: "#3b3229" },
};

/**
 * 4. Console — two columns for wide panes: sender, actions and attachments on
 * the left, the message on the right. Deliberately dark, so light-authored
 * mail is parked on a white sheet.
 */
const consoleTheme: MessageTheme = {
  id: "console",
  labelKey: "messageThemes.console",
  descriptionKey: "messageThemes.consoleDesc",
  tone: "dark",
  paletteMode: "fixed",
  accent: "#5aa9ff",
  divider: "1px solid rgba(255, 255, 255, 0.07)",
  preview: { page: "#0f1115", card: "#171b22", title: "#eef2f7", text: "#8d97a6", accent: "#5aa9ff" },
  layout: {
    structure: "columns",
    contentWidth: "none",
    gutter: "18px",
    sectionGap: "14px",
    align: "start",
    headerCard: false,
    headerFullBleed: true,
    avatar: true,
    toolbar: "sidebar",
    toolbarIndent: "0",
  },
  page: { background: "#0f1115" },
  header: {
    background: "#12151b",
    border: "1px solid rgba(255, 255, 255, 0.07)",
    cardBackground: "transparent",
    cardBorder: "none",
    cardRadius: "0",
    cardShadow: "none",
    padding: "11px 18px 10px",
  },
  surface: {
    background: "#171b22",
    border: "1px solid rgba(255, 255, 255, 0.07)",
    radius: "10px",
    shadow: "0 1px 2px rgba(0, 0, 0, 0.4)",
    padding: "22px 24px",
  },
  avatar: {
    size: "40px",
    radius: "10px",
    background: "rgba(90, 169, 255, 0.16)",
    color: "#5aa9ff",
    fontSize: "14px",
  },
  type: {
    fontFamily: SYSTEM_SANS,
    displayFamily: SYSTEM_SANS,
    title: { size: "17px", weight: 650, spacing: "-0.01em", leading: 1.35, color: "#eef2f7" },
    sender: { size: "13px", weight: 600, color: "#eef2f7" },
    meta: { size: "12px", color: "#8d97a6" },
    label: {
      size: "10.5px",
      weight: 600,
      spacing: "0.08em",
      transform: "uppercase",
      color: "#7d8798",
    },
    body: {
      fontFamily: SYSTEM_SANS,
      size: "14px",
      weight: 400,
      leading: 1.7,
      color: "#dfe6ef",
      linkColor: "#5aa9ff",
    },
  },
  body: { lightSheet: true, sheetBackground: "#ffffff", sheetTextColor: "#202124" },
};

/**
 * 5. Claude — ivory page, centred narrow column, serif subject, muted
 * terracotta. Roomy and low-chrome: hierarchy comes from air and a warm rule,
 * not from elevation.
 */
const claude: MessageTheme = {
  id: "claude",
  labelKey: "messageThemes.claude",
  descriptionKey: "messageThemes.claudeDesc",
  tone: "light",
  paletteMode: "fixed",
  accent: "#d97757",
  divider: "1px solid #e7dfd1",
  preview: { page: "#f6f3ec", card: "#fffdfa", title: "#2b2a26", text: "#8b8577", accent: "#d97757" },
  layout: {
    structure: "stacked",
    contentWidth: "700px",
    gutter: "26px",
    sectionGap: "20px",
    align: "start",
    headerCard: false,
    headerFullBleed: false,
    avatar: true,
    toolbar: "below",
    toolbarIndent: "48px",
  },
  page: { background: "#f6f3ec" },
  header: {
    background: "transparent",
    border: "none",
    cardBackground: "transparent",
    cardBorder: "none",
    cardRadius: "0",
    cardShadow: "none",
    padding: "8px 0 0",
  },
  surface: {
    background: "#fffdfa",
    border: "1px solid #e7dfd1",
    radius: "14px",
    shadow: "0 1px 2px rgba(58, 46, 32, 0.05)",
    padding: "30px 32px",
  },
  avatar: {
    size: "38px",
    radius: "12px",
    background: "#f1e7db",
    color: "#b25f42",
    fontSize: "13px",
  },
  type: {
    fontFamily: SYSTEM_SANS,
    displayFamily: SERIF_DISPLAY,
    title: { size: "22px", weight: 500, spacing: "-0.01em", leading: 1.3, color: "#2b2a26" },
    sender: { size: "13.5px", weight: 600, color: "#2b2a26" },
    meta: { size: "12.5px", color: "#8b8577" },
    label: {
      size: "11px",
      weight: 600,
      spacing: "0.08em",
      transform: "uppercase",
      color: "#9d978a",
    },
    body: {
      fontFamily: SYSTEM_SANS,
      size: "15px",
      weight: 400,
      leading: 1.72,
      color: "#33312b",
      linkColor: "#bc5f3e",
    },
  },
  body: { lightSheet: false, sheetBackground: "transparent", sheetTextColor: "#33312b" },
};

/**
 * 6. WeChat — flat grey page, square white cards, no shadows, the largest body
 * type of the four, green for actions and slate blue for links.
 */
const wechat: MessageTheme = {
  id: "wechat",
  labelKey: "messageThemes.wechat",
  descriptionKey: "messageThemes.wechatDesc",
  tone: "light",
  paletteMode: "fixed",
  accent: "#07c160",
  divider: "1px solid #dedede",
  preview: { page: "#ededed", card: "#ffffff", title: "#191919", text: "#9a9a9a", accent: "#07c160" },
  layout: {
    structure: "stacked",
    contentWidth: "none",
    gutter: "14px",
    sectionGap: "10px",
    align: "start",
    headerCard: false,
    headerFullBleed: true,
    avatar: true,
    toolbar: "inline",
    toolbarIndent: "0",
  },
  page: { background: "#ededed" },
  header: {
    background: "#ededed",
    border: "1px solid #dedede",
    cardBackground: "transparent",
    cardBorder: "none",
    cardRadius: "0",
    cardShadow: "none",
    padding: "10px 14px 10px",
  },
  surface: {
    background: "#ffffff",
    border: "none",
    radius: "4px",
    shadow: "none",
    padding: "16px 16px 18px",
  },
  avatar: {
    size: "40px",
    radius: "6px",
    background: "#e6e6e6",
    color: "#576b95",
    fontSize: "14px",
  },
  type: {
    fontFamily: CJK_SANS,
    displayFamily: CJK_SANS,
    title: { size: "17.5px", weight: 600, spacing: "0", leading: 1.4, color: "#191919" },
    sender: { size: "13px", weight: 600, color: "#576b95" },
    meta: { size: "11.5px", color: "#9a9a9a" },
    label: {
      size: "10.5px",
      weight: 500,
      spacing: "0.06em",
      transform: "uppercase",
      color: "#b2b2b2",
    },
    body: {
      fontFamily: CJK_SANS,
      size: "16.5px",
      weight: 400,
      leading: 1.78,
      color: "#191919",
      linkColor: "#576b95",
    },
  },
  body: { lightSheet: false, sheetBackground: "transparent", sheetTextColor: "#191919" },
};

/**
 * 7. Telegram — one column under Telegram's blue: a full-width white header
 * band, the sender's monogram, and the actions on their own line under the
 * message. Telegram's own chat has a single thread, so the rail that carries
 * Console's metadata has nothing to do here and only narrowed the message.
 */
const telegram: MessageTheme = {
  id: "telegram",
  labelKey: "messageThemes.telegram",
  descriptionKey: "messageThemes.telegramDesc",
  tone: "light",
  paletteMode: "fixed",
  accent: "#3390ec",
  divider: "1px solid #dadce0",
  preview: { page: "#f4f4f5", card: "#ffffff", title: "#212121", text: "#707579", accent: "#3390ec" },
  layout: {
    structure: "stacked",
    contentWidth: "none",
    gutter: "16px",
    sectionGap: "12px",
    align: "start",
    headerCard: false,
    headerFullBleed: true,
    avatar: true,
    toolbar: "below",
    toolbarIndent: "48px",
  },
  page: { background: "#f4f4f5" },
  header: {
    background: "#ffffff",
    border: "1px solid #dadce0",
    cardBackground: "transparent",
    cardBorder: "none",
    cardRadius: "0",
    cardShadow: "none",
    padding: "10px 16px 10px",
  },
  surface: {
    background: "#ffffff",
    border: "none",
    radius: "12px",
    shadow: "0 1px 2px rgba(16, 35, 47, 0.08)",
    padding: "20px 22px",
  },
  avatar: {
    size: "44px",
    radius: "50%",
    background: "#e7f0fd",
    color: "#3390ec",
    fontSize: "16px",
  },
  type: {
    fontFamily: SYSTEM_SANS,
    displayFamily: SYSTEM_SANS,
    title: { size: "16px", weight: 600, spacing: "-0.005em", leading: 1.35, color: "#212121" },
    sender: { size: "13.5px", weight: 600, color: "#3390ec" },
    meta: { size: "12px", color: "#707579" },
    label: {
      size: "10.5px",
      weight: 600,
      spacing: "0.07em",
      transform: "uppercase",
      color: "#9aa1a6",
    },
    body: {
      fontFamily: SYSTEM_SANS,
      size: "14.5px",
      weight: 400,
      leading: 1.6,
      color: "#212121",
      linkColor: "#3390ec",
    },
  },
  body: { lightSheet: false, sheetBackground: "transparent", sheetTextColor: "#212121" },
};

/**
 * 8. iMessage — iOS system grey behind very round white cards, a neutral grey
 * monogram and iOS blue for links.
 */
const imessage: MessageTheme = {
  id: "imessage",
  labelKey: "messageThemes.imessage",
  descriptionKey: "messageThemes.imessageDesc",
  tone: "light",
  paletteMode: "fixed",
  accent: "#007aff",
  divider: "1px solid #d8d8de",
  preview: { page: "#f2f2f7", card: "#ffffff", title: "#000000", text: "#8e8e93", accent: "#007aff" },
  layout: {
    structure: "stacked",
    contentWidth: "none",
    gutter: "18px",
    sectionGap: "14px",
    align: "start",
    headerCard: false,
    headerFullBleed: true,
    avatar: true,
    toolbar: "below",
    toolbarIndent: "54px",
  },
  page: { background: "#f2f2f7" },
  header: {
    background: "#f2f2f7",
    border: "1px solid #d8d8de",
    cardBackground: "transparent",
    cardBorder: "none",
    cardRadius: "0",
    cardShadow: "none",
    padding: "10px 18px 10px",
  },
  surface: {
    background: "#ffffff",
    border: "none",
    radius: "18px",
    shadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    padding: "22px 24px",
  },
  avatar: {
    size: "44px",
    radius: "50%",
    background: "#e4e4ea",
    color: "#6f7076",
    fontSize: "16px",
  },
  type: {
    fontFamily: SYSTEM_SANS,
    displayFamily: SYSTEM_SANS,
    title: { size: "17px", weight: 600, spacing: "-0.01em", leading: 1.35, color: "#000000" },
    sender: { size: "13.5px", weight: 600, color: "#000000" },
    meta: { size: "12px", color: "#8e8e93" },
    label: {
      size: "11px",
      weight: 600,
      spacing: "0.05em",
      transform: "uppercase",
      color: "#a1a1a6",
    },
    body: {
      fontFamily: SYSTEM_SANS,
      size: "15px",
      weight: 400,
      leading: 1.6,
      color: "#1c1c1e",
      linkColor: "#007aff",
    },
  },
  body: { lightSheet: false, sheetBackground: "transparent", sheetTextColor: "#1c1c1e" },
};

export const MESSAGE_THEMES: readonly MessageTheme[] = [
  card,
  mailbox,
  letter,
  consoleTheme,
  claude,
  wechat,
  telegram,
  imessage,
];

export const MESSAGE_THEME_IDS: readonly MessageThemeId[] = MESSAGE_THEMES.map((theme) => theme.id);

export function isMessageThemeId(value: unknown): value is MessageThemeId {
  return typeof value === "string" && MESSAGE_THEME_IDS.includes(value as MessageThemeId);
}

/** Never throws: an unknown or missing id falls back to the default theme. */
export function getMessageTheme(id: string | null | undefined): MessageTheme {
  return (
    MESSAGE_THEMES.find((theme) => theme.id === id) ??
    MESSAGE_THEMES.find((theme) => theme.id === DEFAULT_MESSAGE_THEME) ??
    claude
  );
}

/** Read the persisted choice; anything unrecognised degrades to the default. */
export function readStoredMessageTheme(storage: Pick<Storage, "getItem">): MessageThemeId {
  const stored = storage.getItem(MESSAGE_THEME_STORAGE_KEY);
  return isMessageThemeId(stored) ? stored : DEFAULT_MESSAGE_THEME;
}

export type MessageThemeStyle = CSSProperties & Record<`--msg-${string}`, string>;

/**
 * Flatten a theme into the custom properties `MessageDetail` publishes on its
 * root element. Everything the stylesheet needs to draw a theme comes from
 * here — components never branch on a theme id.
 */
export function messageThemeVariables(theme: MessageTheme): MessageThemeStyle {
  const { layout, header, surface, avatar, type: t } = theme;
  return {
    // page & rhythm
    "--msg-page-background": theme.page.background,
    "--msg-page-padding": layout.gutter,
    "--msg-section-gap": layout.sectionGap,
    "--msg-content-width": layout.contentWidth,

    // header
    "--msg-header-background": header.background,
    "--msg-header-border": header.border,
    "--msg-header-padding": header.padding,
    "--msg-header-card-background": header.cardBackground,
    "--msg-header-card-border": header.cardBorder,
    "--msg-header-card-radius": header.cardRadius,
    "--msg-header-card-shadow": header.cardShadow,
    "--msg-header-align": layout.align,

    // body surface
    "--msg-surface-background": surface.background,
    "--msg-surface-border": surface.border,
    "--msg-surface-radius": surface.radius,
    "--msg-surface-shadow": surface.shadow,
    "--msg-surface-padding": surface.padding,

    // avatar
    "--msg-avatar-size": avatar.size,
    "--msg-avatar-radius": avatar.radius,
    "--msg-avatar-background": avatar.background,
    "--msg-avatar-color": avatar.color,
    "--msg-avatar-font-size": avatar.fontSize,

    // toolbar
    "--msg-toolbar-indent": layout.toolbarIndent,

    // type scale
    "--msg-font-ui": t.fontFamily,
    "--msg-title-font": t.displayFamily,
    "--msg-title-size": t.title.size,
    "--msg-title-weight": String(t.title.weight),
    "--msg-title-spacing": t.title.spacing,
    "--msg-title-leading": String(t.title.leading),
    "--msg-title-color": t.title.color,
    "--msg-sender-size": t.sender.size,
    "--msg-sender-weight": String(t.sender.weight),
    "--msg-sender-color": t.sender.color,
    "--msg-meta-size": t.meta.size,
    "--msg-meta-color": t.meta.color,
    "--msg-label-size": t.label.size,
    "--msg-label-weight": String(t.label.weight),
    "--msg-label-spacing": t.label.spacing,
    "--msg-label-transform": t.label.transform,
    "--msg-label-color": t.label.color,
    "--msg-accent": theme.accent,
    "--msg-divider": theme.divider,

    // message body
    "--msg-body-font": t.body.fontFamily,
    "--msg-body-size": t.body.size,
    "--msg-body-weight": String(t.body.weight),
    "--msg-body-line-height": String(t.body.leading),
    "--msg-body-color": t.body.color,
    "--msg-link-color": t.body.linkColor,
  };
}

/**
 * The declarations the theme applies to the mail content itself.
 *
 * Split out from {@link messageThemeContentCss} so it can be asserted on its
 * own: the dark-mode guard below legitimately re-introduces
 * `display: inline-block`, which would otherwise mask what this rule says.
 */
export function messageThemeBodyRule(theme: MessageTheme): string {
  return theme.body.lightSheet
    ? `display: inline-block;
          max-width: 100%;
          color-scheme: light;
          color: ${theme.body.sheetTextColor};
          background: ${theme.body.sheetBackground};`
    : `display: block;
          color-scheme: ${theme.tone === "dark" ? "dark" : "light"};
          color: ${theme.type.body.color};
          background: transparent;`;
}

/**
 * `ShadowDomEmail` already parks light-authored mail on a white sheet once the
 * app is dark (`:host-context([data-theme="dark"])`). An *adaptive* template
 * would otherwise outrank that rule and leave dark text on its own dark
 * surface, so it restates the fallback: same specificity as the template's body
 * rule, emitted later, so it wins the tie. Fixed-palette templates don't need
 * it — they carry their own readable colours.
 *
 * The fallback rule inside `ShadowDomEmail` is deliberately left untouched.
 */
export const MESSAGE_THEME_DARK_SHEET_CSS = `:host-context([data-theme="dark"]) .pebble-email-content.pebble-email-content {
          display: inline-block;
          max-width: 100%;
          color-scheme: light;
          color: #202124;
          background: #fff;
        }`;

/**
 * The extra CSS handed to {@link ShadowDomEmail} so the sanitized mail inherits
 * the theme's reading typography.
 *
 * Selectors are doubled (`.pebble-email-content.pebble-email-content`) so they
 * outrank the core rules — including the `:host-context([data-theme="dark"])`
 * light-sheet fallback — without touching them.
 */
export function messageThemeContentCss(theme: MessageTheme): string {
  const doubled = ":host([data-pebble-message-theme]) .pebble-email-content.pebble-email-content";
  const guard = theme.paletteMode === "adaptive" ? `\n        ${MESSAGE_THEME_DARK_SHEET_CSS}` : "";
  // A template with a display face of its own (Claude's serif) lends it to the
  // sender's headings. Only headings the sender left unstyled are affected — an
  // inline `font-family` in the mail still wins — and a template whose display
  // face *is* its body face emits nothing at all.
  const headings =
    theme.type.displayFamily === theme.type.body.fontFamily
      ? ""
      : `\n        ${["h1", "h2", "h3", "h4", "h5", "h6"]
          .map((tag) => `${doubled} ${tag}`)
          .join(",\n          ")} {
          font-family: ${theme.type.displayFamily};
        }`;

  return `
        :host([data-pebble-message-theme]) {
          font-family: ${theme.type.body.fontFamily};
          font-size: ${theme.type.body.size};
          font-weight: ${theme.type.body.weight};
          line-height: ${theme.type.body.leading};
          color: ${theme.type.body.color};
        }
        :host([data-pebble-message-theme]) a {
          color: ${theme.type.body.linkColor};
        }${headings}
        ${doubled} {
          ${messageThemeBodyRule(theme)}
        }${guard}
      `;
}

/* -------------------------------------------------------------------------- */
/* Sender monogram                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Short monogram for a sender. Prefers the display name and falls back to the
 * local part of the address; CJK names keep a single character, because two of
 * them are unreadable at avatar size.
 */
export function senderInitials(name: string | null | undefined, address: string): string {
  const source = (name ?? "").trim() || address.split("@")[0]?.trim() || address.trim();
  if (!source) return "?";

  const words = source.split(/[\s._\-+]+/).filter(Boolean);
  if (words.length > 1) {
    const first = Array.from(words[0])[0] ?? "";
    const second = Array.from(words[1])[0] ?? "";
    const combined = `${first}${second}`;
    return combined || "?";
  }

  const chars = Array.from(words[0] ?? "");
  const head = chars[0] ?? "";
  // Wide scripts (CJK) read better as one glyph; Latin wants up to two.
  if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(head)) {
    return head;
  }
  return chars.slice(0, 2).join("").toUpperCase() || "?";
}
