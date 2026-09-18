import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import {
  MESSAGE_THEMES,
  type MessageTheme,
  type MessageThemeId,
} from "@/lib/messageThemes";

interface Props {
  activeTheme: MessageThemeId;
  onSelect: (theme: MessageThemeId) => void;
}

/**
 * The real corner radius at the thumbnail's ~1:5 scale. `0` stays square (a
 * full-bleed template has no card to round) and the rest are clamped to 1–6px
 * so a 3px rule and an 18px pill stay tellable apart at 56×42.
 */
function thumbnailRadius(value: string): number {
  const px = Number.parseFloat(value);
  if (!Number.isFinite(px) || px <= 0) return 1;
  return Math.max(1, Math.min(6, Math.round(px / 2.6)));
}

/**
 * A miniature of the layout a theme produces, drawn from the theme's own data
 * rather than from its id: the page colour, whether the header is a card, a
 * full-bleed strip or an inset rule, whether the subject is centred, how wide
 * the reading column is, how round the surface and the monogram are, whether
 * the card is outlined and whether it is raised.
 *
 * Deriving all of it from `layout` / `surface` / `avatar` means two templates
 * that merely share an arrangement still read as different here — brand skins
 * differ in roundness and material as much as in structure.
 */
export function MessageThemePreview({ theme }: { theme: MessageTheme }) {
  const { preview, layout, surface, avatar } = theme;
  const hairline = `${preview.text}33`;
  const radius = thumbnailRadius(surface.radius);
  const roundAvatar = avatar.radius.includes("%");
  const avatarRadius = roundAvatar ? "50%" : `${thumbnailRadius(avatar.radius)}px`;
  const raised = surface.shadow !== "none";
  const outlined = surface.border !== "none";
  // A card that draws no rule of its own still needs an edge at this size, or
  // the thumbnail reads as an empty page.
  const surfaceEdge = outlined ? `1px solid ${hairline}` : `1px solid ${hairline}66`;

  const frame: CSSProperties = {
    display: "block",
    position: "relative",
    width: "56px",
    height: "42px",
    flexShrink: 0,
    borderRadius: "6px",
    border: "1px solid var(--color-border)",
    background: preview.page,
    overflow: "hidden",
  };

  const bar = (top: number, width: string | number, color: string, height = 3, opacity = 1): CSSProperties => ({
    position: "absolute",
    top,
    width,
    height,
    borderRadius: "2px",
    background: color,
    opacity,
  });

  if (layout.align === "center") {
    // Centred correspondence: monogram, subject, sender and lines all on the
    // middle axis (the Letter template).
    return (
      <span aria-hidden="true" style={frame}>
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "4px",
            transform: "translateX(-50%)",
            width: "9px",
            height: "9px",
            borderRadius: avatarRadius,
            background: preview.accent,
            opacity: 0.55,
          }}
        />
        <span style={{ ...bar(16, "24px", preview.title, 4), left: "16px" }} />
        <span style={{ ...bar(25, "32px", preview.text, 3, 0.45), left: "12px" }} />
        <span style={{ ...bar(30, "26px", preview.text, 3, 0.28), left: "15px" }} />
        <span style={{ ...bar(36, "10px", preview.accent), left: "23px" }} />
      </span>
    );
  }

  if (layout.structure === "columns") {
    return (
      <span aria-hidden="true" style={frame}>
        {/* details rail */}
        <span style={{ position: "absolute", inset: "0 auto 0 0", width: "18px", background: preview.card, borderRight: `1px solid ${hairline}` }} />
        <span style={{ position: "absolute", left: "5px", top: "6px", width: "8px", height: "8px", borderRadius: avatarRadius, background: preview.accent, opacity: 0.65 }} />
        <span style={{ ...bar(18, "9px", preview.text, 2, 0.45), left: "5px" }} />
        <span style={{ ...bar(23, "11px", preview.text, 2, 0.28), left: "5px" }} />
        {/* the message card — roundness comes from the real surface radius */}
        <span
          style={{
            position: "absolute",
            left: "22px",
            right: "3px",
            top: "4px",
            bottom: "4px",
            borderRadius: `${radius}px`,
            background: preview.card,
            border: surfaceEdge,
            boxShadow: raised ? "0 1px 2px rgba(0, 0, 0, 0.12)" : "none",
          }}
        />
        <span style={{ ...bar(9, "17px", preview.title, 3.5), left: "26px" }} />
        <span style={{ ...bar(17, "24px", preview.text, 3, 0.45), left: "26px" }} />
        <span style={{ ...bar(22, "19px", preview.text, 3, 0.28), left: "26px" }} />
        <span style={{ ...bar(30, "11px", preview.accent), left: "26px" }} />
      </span>
    );
  }

  // Stacked: a header strip on top, the reading surface below it. Both are
  // placed by the theme's own flags.
  const card = layout.headerCard;
  const bleed = layout.headerFullBleed;
  const headerTop = bleed ? 0 : 4;
  const headerHeight = card ? 12 : bleed ? 13 : 11;
  const inset = bleed ? 3 : layout.contentWidth !== "none" ? 9 : 5;
  const surfaceTop = headerTop + headerHeight + 3;
  const textLeft = inset + 5;

  return (
    <span aria-hidden="true" style={frame}>
      <span
        style={{
          position: "absolute",
          left: `${inset}px`,
          right: `${inset}px`,
          top: `${headerTop}px`,
          height: `${headerHeight}px`,
          borderRadius: card ? "3px" : bleed ? 0 : "2px",
          background: card ? preview.card : preview.page,
          border: card ? "1px solid var(--color-border)" : "none",
          borderBottom: card ? "1px solid var(--color-border)" : `1px solid ${hairline}`,
          boxShadow: card && raised ? "0 1px 1px rgba(0, 0, 0, 0.12)" : "none",
        }}
      />
      <span style={{ ...bar(headerTop + 4, "20px", preview.title, 4), left: `${inset + 4}px` }} />
      {layout.avatar && (
        <span
          style={{
            position: "absolute",
            right: `${inset + 4}px`,
            top: `${headerTop + 3}px`,
            width: "7px",
            height: "7px",
            borderRadius: avatarRadius,
            background: preview.accent,
            opacity: 0.6,
          }}
        />
      )}
      <span
        style={{
          position: "absolute",
          left: `${inset}px`,
          right: `${inset}px`,
          top: `${surfaceTop}px`,
          bottom: "4px",
          borderRadius: `${radius}px`,
          background: preview.card,
          border: surfaceEdge,
          boxShadow: raised ? "0 1px 2px rgba(0, 0, 0, 0.12)" : "none",
        }}
      />
      <span style={{ ...bar(surfaceTop + 5, "26px", preview.text, 3, 0.45), left: `${textLeft}px` }} />
      <span style={{ ...bar(surfaceTop + 11, "20px", preview.text, 3, 0.28), left: `${textLeft}px` }} />
      <span style={{ ...bar(surfaceTop + 18, "11px", preview.accent), left: `${textLeft}px` }} />
    </span>
  );
}

/**
 * The switcher that lives in the message-detail header. Selecting a theme
 * leaves the popover open on purpose so the reader can compare templates
 * against the mail they are actually reading.
 */
export default function MessageThemePicker({ activeTheme, onSelect }: Props) {
  const { t } = useTranslation();

  return (
    <div
      role="dialog"
      aria-label={t("messageThemes.title", "Message theme")}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: "4px",
        width: "296px",
        maxHeight: "min(70vh, 420px)",
        overflowY: "auto",
        backgroundColor: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        padding: "4px",
        zIndex: 100,
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: "4px",
        }}
      >
        {t("messageThemes.title", "Message theme")}
      </div>
      <div role="radiogroup" aria-label={t("messageThemes.title", "Message theme")}>
        {MESSAGE_THEMES.map((theme) => (
          <MessageThemeOption
            key={theme.id}
            theme={theme}
            selected={theme.id === activeTheme}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

/** One row: preview, name, description, and a tick when active. */
export function MessageThemeOption({
  theme,
  selected,
  onSelect,
}: {
  theme: MessageTheme;
  selected: boolean;
  onSelect: (theme: MessageThemeId) => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-message-theme-option={theme.id}
      onClick={() => onSelect(theme.id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        textAlign: "left",
        padding: "7px 8px",
        borderRadius: "6px",
        border: selected ? "1px solid var(--color-accent)" : "1px solid transparent",
        background: selected ? "var(--color-bg-hover)" : "none",
        cursor: "pointer",
        color: "var(--color-text-primary)",
      }}
    >
      <MessageThemePreview theme={theme} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: "13px", fontWeight: 600 }}>
          {t(theme.labelKey, theme.id)}
        </span>
        <span
          style={{
            display: "block",
            marginTop: "2px",
            fontSize: "11.5px",
            lineHeight: 1.4,
            color: "var(--color-text-secondary)",
          }}
        >
          {t(theme.descriptionKey, "")}
        </span>
      </span>
      {selected && (
        <Check size={14} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
      )}
    </button>
  );
}
