import { describe, expect, it } from "vitest";
import {
  DEFAULT_MESSAGE_THEME,
  MESSAGE_THEMES,
  MESSAGE_THEME_DARK_SHEET_CSS,
  MESSAGE_THEME_IDS,
  getMessageTheme,
  isMessageThemeId,
  messageThemeBodyRule,
  messageThemeContentCss,
  messageThemePreviewPalette,
  messageThemeVariables,
  readStoredMessageTheme,
  senderInitials,
  type MessageTheme,
} from "@/lib/messageThemes";

function textFields(theme: MessageTheme): [string, string][] {
  return [
    ["id", theme.id],
    ["labelKey", theme.labelKey],
    ["descriptionKey", theme.descriptionKey],
    ["tone", theme.tone],
    ["paletteMode", theme.paletteMode],
    ["accent", theme.accent],
    ["divider", theme.divider],
    ["preview.page", theme.preview.page],
    ["preview.card", theme.preview.card],
    ["preview.title", theme.preview.title],
    ["preview.text", theme.preview.text],
    ["preview.accent", theme.preview.accent],
    ["layout.structure", theme.layout.structure],
    ["layout.contentWidth", theme.layout.contentWidth],
    ["layout.gutter", theme.layout.gutter],
    ["layout.sectionGap", theme.layout.sectionGap],
    ["layout.align", theme.layout.align],
    ["layout.toolbar", theme.layout.toolbar],
    ["layout.toolbarIndent", theme.layout.toolbarIndent],
    ["page.background", theme.page.background],
    ["header.background", theme.header.background],
    ["header.border", theme.header.border],
    ["header.cardBackground", theme.header.cardBackground],
    ["header.cardBorder", theme.header.cardBorder],
    ["header.cardRadius", theme.header.cardRadius],
    ["header.cardShadow", theme.header.cardShadow],
    ["header.padding", theme.header.padding],
    ["surface.background", theme.surface.background],
    ["surface.border", theme.surface.border],
    ["surface.radius", theme.surface.radius],
    ["surface.shadow", theme.surface.shadow],
    ["surface.padding", theme.surface.padding],
    ["avatar.size", theme.avatar.size],
    ["avatar.radius", theme.avatar.radius],
    ["avatar.background", theme.avatar.background],
    ["avatar.color", theme.avatar.color],
    ["avatar.fontSize", theme.avatar.fontSize],
    ["type.fontFamily", theme.type.fontFamily],
    ["type.displayFamily", theme.type.displayFamily],
    ["type.title.size", theme.type.title.size],
    ["type.title.spacing", theme.type.title.spacing],
    ["type.title.color", theme.type.title.color],
    ["type.sender.size", theme.type.sender.size],
    ["type.sender.color", theme.type.sender.color],
    ["type.meta.size", theme.type.meta.size],
    ["type.meta.color", theme.type.meta.color],
    ["type.label.size", theme.type.label.size],
    ["type.label.spacing", theme.type.label.spacing],
    ["type.label.transform", theme.type.label.transform],
    ["type.label.color", theme.type.label.color],
    ["type.body.fontFamily", theme.type.body.fontFamily],
    ["type.body.size", theme.type.body.size],
    ["type.body.color", theme.type.body.color],
    ["type.body.linkColor", theme.type.body.linkColor],
    ["body.sheetBackground", theme.body.sheetBackground],
    ["body.sheetTextColor", theme.body.sheetTextColor],
  ];
}

/**
 * Everything a template changes about *how* the screen is drawn — arrangement,
 * surface material and monogram shape — as opposed to which colours it uses.
 * Deliberately colour-free: `surface.border` is reduced to present/absent and
 * `surface.shadow` to raised/flat, so two templates can only collide here by
 * actually drawing the same way.
 */
function shapeSignature(theme: MessageTheme): string {
  const { structure, align, headerCard, toolbar, headerFullBleed, contentWidth, avatar } = theme.layout;
  return [
    structure,
    align,
    headerCard,
    toolbar,
    headerFullBleed,
    contentWidth,
    avatar,
    theme.surface.radius,
    theme.surface.border === "none" ? "flush" : "outlined",
    theme.surface.shadow === "none" ? "flat" : "raised",
    theme.avatar.radius,
  ].join("|");
}

/** Just the arrangement: what the `data-msg-*` grid switches actually change. */
function arrangementSignature(theme: MessageTheme): string {
  const { structure, align, headerCard, toolbar, headerFullBleed } = theme.layout;
  return [structure, align, headerCard, toolbar, headerFullBleed].join("|");
}

describe("message theme registry", () => {
  it("ships a pickable set of templates with unique ids", () => {
    expect(MESSAGE_THEMES.length).toBeGreaterThanOrEqual(4);
    expect(MESSAGE_THEMES.length).toBeLessThanOrEqual(8);
    expect(new Set(MESSAGE_THEME_IDS).size).toBe(MESSAGE_THEMES.length);
    expect(MESSAGE_THEME_IDS[0]).toBe(DEFAULT_MESSAGE_THEME);
  });

  it("lists the neutral arrangements first, then the brand skins", () => {
    expect(MESSAGE_THEME_IDS).toEqual([
      "card",
      "mailbox",
      "letter",
      "console",
      "claude",
      "wechat",
      "telegram",
      "imessage",
    ]);
  });

  it("gives every template a complete set of decisions", () => {
    const incomplete: string[] = [];
    for (const theme of MESSAGE_THEMES) {
      for (const [field, value] of textFields(theme)) {
        if (typeof value !== "string" || value.trim() === "") {
          incomplete.push(`${theme.id}.${field}`);
        }
      }
    }
    expect(incomplete).toEqual([]);

    for (const theme of MESSAGE_THEMES) {
      expect(["light", "dark"]).toContain(theme.tone);
      expect(["adaptive", "fixed"]).toContain(theme.paletteMode);
      expect(["stacked", "columns"]).toContain(theme.layout.structure);
      expect(["start", "center"]).toContain(theme.layout.align);
      expect(["inline", "below", "sidebar"]).toContain(theme.layout.toolbar);
      expect(theme.type.title.weight).toBeGreaterThan(0);
      expect(theme.type.sender.weight).toBeGreaterThan(0);
      expect(theme.type.label.weight).toBeGreaterThan(0);
      expect(theme.type.body.weight).toBeGreaterThan(0);
      expect(theme.type.title.leading).toBeGreaterThan(1);
      expect(theme.type.body.leading).toBeGreaterThan(1);
    }
  });

  it("makes every template different by shape or material, never by colour alone", () => {
    const signatures = new Set(MESSAGE_THEMES.map(shapeSignature));
    expect(signatures.size).toBe(MESSAGE_THEMES.length);

    // Neither `page.background` nor `accent` is part of the signature, so a
    // recolour of an existing template cannot pass this.
    for (const theme of MESSAGE_THEMES) {
      expect(shapeSignature(theme)).not.toContain(theme.accent);
      expect(shapeSignature(theme)).not.toContain(theme.page.background);
    }
  });

  it("reuses arrangements on purpose, but keeps most of them distinct", () => {
    // A brand skin may share an arrangement with a neutral template — WeChat is
    // Mailbox in different clothes. `shapeSignature` above is what stops that
    // from becoming a pure recolour.
    const arrangements = new Set(MESSAGE_THEMES.map(arrangementSignature));
    expect(arrangements.size).toBeGreaterThanOrEqual(6);

    // Both arrangements, and all three toolbar placements, are in use.
    expect(new Set(MESSAGE_THEMES.map((t) => t.layout.structure))).toEqual(
      new Set(["stacked", "columns"]),
    );
    expect(new Set(MESSAGE_THEMES.map((t) => t.layout.toolbar))).toEqual(
      new Set(["inline", "below", "sidebar"]),
    );
    // …and so is centred correspondence, which exactly one template uses.
    expect(MESSAGE_THEMES.filter((t) => t.layout.align === "center")).toHaveLength(1);
  });

  it("gives every fixed template its own accent, and defers to the app accent when adaptive", () => {
    const fixed = MESSAGE_THEMES.filter((t) => t.paletteMode === "fixed");
    expect(new Set(fixed.map((t) => t.accent)).size).toBe(fixed.length);

    for (const theme of MESSAGE_THEMES) {
      if (theme.paletteMode !== "adaptive") continue;
      // An adaptive template must not hard-code an accent, or it would ignore
      // whichever accent colour the app is actually using.
      expect(theme.accent).toBe("var(--color-accent)");
    }

    // WeChat acts in green but links in slate blue — the reason `accent` and
    // `linkColor` are two fields rather than one.
    const wechat = getMessageTheme("wechat");
    expect(wechat.accent).not.toBe(wechat.type.body.linkColor);
  });

  it("never leaves mail on the app's dark surface without a way out", () => {
    for (const theme of MESSAGE_THEMES) {
      if (theme.paletteMode === "fixed") continue;
      // An adaptive template paints with the app's tokens, so in a dark app its
      // card is dark: it must either carry a sheet of its own or take the
      // dark-app guard asserted in the content-css suite below.
      const guarded = messageThemeContentCss(theme).includes(":host-context");
      if (!theme.body.lightSheet) expect(guarded).toBe(true);
    }
  });

  it("falls back to the default template for an unknown id", () => {
    expect(getMessageTheme("nope").id).toBe(DEFAULT_MESSAGE_THEME);
    expect(getMessageTheme(null).id).toBe(DEFAULT_MESSAGE_THEME);
    expect(getMessageTheme(undefined).id).toBe(DEFAULT_MESSAGE_THEME);
    expect(getMessageTheme("telegram").id).toBe("telegram");
  });

  it("validates stored ids instead of trusting them", () => {
    expect(isMessageThemeId("telegram")).toBe(true);
    expect(isMessageThemeId("letter")).toBe(true);
    expect(isMessageThemeId("Telegram")).toBe(false);
    expect(isMessageThemeId("photocopy")).toBe(false);
    expect(isMessageThemeId("")).toBe(false);
    expect(isMessageThemeId(null)).toBe(false);
  });

  it("reads the persisted choice and degrades on garbage", () => {
    const store = (value: string | null) => ({ getItem: () => value });
    expect(readStoredMessageTheme(store("wechat"))).toBe("wechat");
    expect(readStoredMessageTheme(store("console"))).toBe("console");
    expect(readStoredMessageTheme(store("bogus"))).toBe(DEFAULT_MESSAGE_THEME);
    expect(readStoredMessageTheme(store(null))).toBe(DEFAULT_MESSAGE_THEME);
  });
});

describe("message theme preview palette", () => {
  it("leaves a fixed template's own palette alone", () => {
    for (const theme of MESSAGE_THEMES) {
      if (theme.paletteMode !== "fixed") continue;
      expect(messageThemePreviewPalette(theme)).toEqual(theme.preview);
    }
  });

  it("draws an adaptive thumbnail from the tokens the template renders with", () => {
    for (const theme of MESSAGE_THEMES) {
      if (theme.paletteMode !== "adaptive") continue;
      const palette = messageThemePreviewPalette(theme);

      expect(palette.page).toBe(theme.page.background);
      expect(palette.title).toBe(theme.type.title.color);
      expect(palette.text).toBe(theme.type.meta.color);
      expect(palette.accent).toBe(theme.accent);
      // A hex here is the bug this exists to prevent: the thumbnail would keep
      // advertising a light pane while the app is dark.
      for (const value of Object.values(palette)) {
        expect(value).toContain("var(--color-");
      }
    }
  });

  it("lifts the thumbnail off the page even when the template draws no card", () => {
    // Mailbox paints no surface of its own, so the preview would otherwise be a
    // rectangle of the page colour with nothing in it.
    const mailbox = getMessageTheme("mailbox");
    expect(mailbox.surface.background).toBe("transparent");
    expect(messageThemePreviewPalette(mailbox).card).toBe(mailbox.page.background);
  });
});

describe("message theme variables", () => {
  it("publishes the same variable set for every template", () => {
    const [first, ...rest] = MESSAGE_THEMES;
    const expected = Object.keys(messageThemeVariables(first)).sort();
    expect(expected.length).toBeGreaterThan(30);
    for (const theme of rest) {
      expect(Object.keys(messageThemeVariables(theme)).sort()).toEqual(expected);
    }
  });

  it("routes layout, page, header, accent and body values into their variables", () => {
    for (const theme of MESSAGE_THEMES) {
      const vars = messageThemeVariables(theme);

      expect(vars["--msg-page-background"]).toBe(theme.page.background);
      expect(vars["--msg-page-padding"]).toBe(theme.layout.gutter);
      expect(vars["--msg-section-gap"]).toBe(theme.layout.sectionGap);
      expect(vars["--msg-content-width"]).toBe(theme.layout.contentWidth);
      expect(vars["--msg-header-align"]).toBe(theme.layout.align);
      expect(vars["--msg-toolbar-indent"]).toBe(theme.layout.toolbarIndent);
      expect(vars["--msg-header-background"]).toBe(theme.header.background);
      expect(vars["--msg-header-card-background"]).toBe(theme.header.cardBackground);
      expect(vars["--msg-title-size"]).toBe(theme.type.title.size);
      expect(vars["--msg-avatar-size"]).toBe(theme.avatar.size);
      expect(vars["--msg-body-color"]).toBe(theme.type.body.color);
      expect(vars["--msg-accent"]).toBe(theme.accent);
      expect(vars["--msg-divider"]).toBe(theme.divider);
    }
  });

  it("publishes the divider as a whole border, because the stylesheet uses it as one", () => {
    for (const theme of MESSAGE_THEMES) {
      // `.message-detail-aside` / `.attachment-list` read this straight into a
      // `border-*` shorthand, so a colour-only value would drop the rule.
      expect(theme.divider).toMatch(/^(none|\d+px\s+(solid|dashed|dotted)\b.*)$/);
    }
  });

  it("lets the pane fill its container when a template asks for no width", () => {
    expect(messageThemeVariables(getMessageTheme("mailbox"))["--msg-content-width"]).toBe("none");
    // …and centres a column when it does ask for one.
    expect(messageThemeVariables(getMessageTheme("letter"))["--msg-content-width"]).toBe("640px");
  });
});

describe("message theme content css", () => {
  it("outranks the core shadow rules without rewriting them", () => {
    const css = messageThemeContentCss(getMessageTheme("letter"));
    expect(css).toContain(".pebble-email-content.pebble-email-content");
    expect(css).toContain(":host([data-pebble-message-theme])");
  });

  it("hands a dark template a light sheet so mail stays readable", () => {
    const consoleTheme = getMessageTheme("console");
    expect(consoleTheme.body.lightSheet).toBe(true);
    const css = messageThemeContentCss(consoleTheme);
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("#ffffff");
    expect(css).toContain("display: inline-block");
  });

  it("keeps the body seamless with its own card", () => {
    for (const theme of MESSAGE_THEMES) {
      if (theme.body.lightSheet) continue;
      const rule = messageThemeBodyRule(theme);
      expect(rule).not.toContain("display: inline-block");
      expect(rule).toContain("background: transparent");
      expect(rule).toContain(`color: ${theme.type.body.color}`);
      expect(messageThemeContentCss(theme)).toContain(rule);
    }
  });

  it("only the templates that ask for a light sheet get one", () => {
    for (const theme of MESSAGE_THEMES) {
      const rule = messageThemeBodyRule(theme);
      expect(rule.includes("display: inline-block")).toBe(theme.body.lightSheet);
      if (!theme.body.lightSheet) continue;
      expect(rule).toContain(theme.body.sheetBackground);
      expect(rule).toContain(theme.body.sheetTextColor);
    }
  });

  it("hands mail back to the app's light sheet when an adaptive template meets a dark app", () => {
    for (const theme of MESSAGE_THEMES) {
      const css = messageThemeContentCss(theme);
      if (theme.paletteMode !== "adaptive") {
        // Fixed palettes already own their colours in either app theme.
        expect(css).not.toContain(":host-context");
        continue;
      }
      expect(css).toContain(MESSAGE_THEME_DARK_SHEET_CSS);
      // Emitted after the template's own body rule so it wins the specificity tie.
      expect(css.indexOf(MESSAGE_THEME_DARK_SHEET_CSS)).toBeGreaterThan(
        css.indexOf(messageThemeBodyRule(theme)),
      );
    }
  });

  it("lends the display face to the sender's headings only when the theme has one", () => {
    for (const theme of MESSAGE_THEMES) {
      const css = messageThemeContentCss(theme);
      const hasOwnFace = theme.type.displayFamily !== theme.type.body.fontFamily;
      expect(css.includes(" h1")).toBe(hasOwnFace);
      if (hasOwnFace) expect(css).toContain(`font-family: ${theme.type.displayFamily}`);
    }
    // Only Claude sets a display face its body copy does not already use —
    // Letter's body is serif too, so its headings have nothing to switch to.
    const own = MESSAGE_THEMES.filter((t) => t.type.displayFamily !== t.type.body.fontFamily);
    expect(own.map((t) => t.id)).toEqual(["claude"]);
  });

  it("never leaks the template id into the injected css", () => {
    for (const theme of MESSAGE_THEMES) {
      expect(messageThemeContentCss(theme)).not.toContain(`[data-message-theme="${theme.id}"]`);
    }
  });
});

describe("sender monogram", () => {
  it("takes the initials of a display name", () => {
    expect(senderInitials("Ada Lovelace", "ada@example.com")).toBe("AL");
  });

  it("keeps a single character for CJK names", () => {
    expect(senderInitials("陈明轩", "chen@example.com")).toBe("陈");
  });

  it("falls back to the local part when there is no name", () => {
    expect(senderInitials(null, "billing@example.com")).toBe("BI");
    expect(senderInitials("   ", "billing@example.com")).toBe("BI");
    expect(senderInitials("", "")).toBe("?");
  });
});
