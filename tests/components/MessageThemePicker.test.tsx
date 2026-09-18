import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MessageThemePicker from "@/components/MessageThemePicker";
import { MESSAGE_THEMES } from "@/lib/messageThemes";
import { useUIStore } from "@/stores/ui.store";

/** Every thumbnail's inline style, keyed by template id. */
function thumbnails(): Map<string, string> {
  return new Map(
    MESSAGE_THEMES.map((theme) => {
      const option = document.querySelector(`[data-message-theme-option="${theme.id}"]`);
      const thumbnail = option?.querySelector('[aria-hidden="true"]');
      return [theme.id, thumbnail?.getAttribute("style") ?? ""] as const;
    }),
  );
}

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe("MessageThemePicker", () => {
  beforeEach(() => {
    useUIStore.setState({ theme: "light" });
  });

  it("offers every registered template", () => {
    render(<MessageThemePicker activeTheme="claude" onSelect={vi.fn()} />);

    expect(screen.getAllByRole("radio")).toHaveLength(MESSAGE_THEMES.length);
    for (const theme of MESSAGE_THEMES) {
      expect(document.querySelector(`[data-message-theme-option="${theme.id}"]`)).not.toBeNull();
    }
  });

  it("draws a thumbnail for every template", () => {
    render(<MessageThemePicker activeTheme="claude" onSelect={vi.fn()} />);

    for (const theme of MESSAGE_THEMES) {
      const option = document.querySelector(`[data-message-theme-option="${theme.id}"]`);
      expect(option?.textContent).toContain(theme.id);
      const thumbnail = option?.querySelector('[aria-hidden="true"]');
      expect(thumbnail).not.toBeNull();
      // Each thumbnail paints its own page colour.
      expect(thumbnail?.getAttribute("style")).toContain("background");
    }
  });

  it("draws four visibly different thumbnails, not one shape recoloured", () => {
    render(<MessageThemePicker activeTheme="claude" onSelect={vi.fn()} />);

    const rendered = MESSAGE_THEMES.map((theme) => {
      const option = document.querySelector(`[data-message-theme-option="${theme.id}"]`);
      const thumbnail = option?.querySelector('[aria-hidden="true"]');
      return thumbnail?.getAttribute("style") ?? "";
    });

    expect(new Set(rendered).size).toBe(MESSAGE_THEMES.length);
  });

  it("paints an adaptive thumbnail with the app's tokens, not the light snapshot", () => {
    render(<MessageThemePicker activeTheme="card" onSelect={vi.fn()} />);

    for (const theme of MESSAGE_THEMES) {
      const option = document.querySelector(`[data-message-theme-option="${theme.id}"]`);
      const css = option?.querySelector('[aria-hidden="true"]')?.getAttribute("style") ?? "";

      if (theme.paletteMode === "adaptive") {
        // Card and Mailbox are the two panes the app theme repaints, so their
        // thumbnails have to be drawn with the same tokens — painted from the
        // light snapshot they advertise a light pane in a dark app.
        expect(css).toMatch(/background:\s*var\(--color-/);
        expect(css).not.toContain(theme.preview.page);
        // A token cannot take an alpha suffix; `var(--color-border)66` is not a
        // colour, so the declaration would be dropped and the edge along with it.
        expect(css).not.toMatch(/var\(--color-[a-z-]+\)[0-9a-f]{2}/);
      } else {
        // A fixed template carries a literal colour, which jsdom reports as rgb().
        expect(css).toMatch(/background:\s*rgb\(/);
        expect(css).not.toMatch(/background:\s*var\(--color-/);
      }
    }
  });

  it("repaints only the templates that carry a night palette once the app is dark", () => {
    const day = render(<MessageThemePicker activeTheme="card" onSelect={vi.fn()} />);
    const byDay = thumbnails();
    day.unmount();

    useUIStore.setState({ theme: "dark" });
    render(<MessageThemePicker activeTheme="card" onSelect={vi.fn()} />);
    const byNight = thumbnails();

    for (const theme of MESSAGE_THEMES) {
      const moved = byNight.get(theme.id) !== byDay.get(theme.id);
      // The thumbnail promises the pane the template will really paint, so it
      // moves exactly when the template does: a night palette means a new
      // thumbnail, and an adaptive or already-dark template means the same one.
      expect(moved, theme.id).toBe(Boolean(theme.dark));
    }
  });

  it("draws a brand thumbnail on the night page, not the day one", () => {
    useUIStore.setState({ theme: "dark" });
    render(<MessageThemePicker activeTheme="wechat" onSelect={vi.fn()} />);

    const night = MESSAGE_THEMES.find((theme) => theme.id === "wechat")?.dark;
    expect(night).toBeDefined();

    // Read through the CSSOM on both sides: whatever jsdom does to a literal
    // colour it does to the probe the same way, so this cannot drift apart from
    // the rendering by a formatting detail.
    const probe = document.createElement("div");
    probe.style.background = night?.preview.page ?? "";
    const painted = probe.style.background;

    const thumbnail = document.querySelector<HTMLElement>(
      '[data-message-theme-option="wechat"] [aria-hidden="true"]',
    );
    expect(painted).toMatch(/^rgb\(/);
    expect(thumbnail?.style.background).toBe(painted);
  });

  it("marks exactly the active template as checked", () => {
    render(<MessageThemePicker activeTheme="telegram" onSelect={vi.fn()} />);

    const checked = screen
      .getAllByRole("radio")
      .filter((option) => option.getAttribute("aria-checked") === "true");

    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute("data-message-theme-option")).toBe("telegram");
  });

  it("reports the chosen template and stays open for comparison", () => {
    const onSelect = vi.fn();
    render(<MessageThemePicker activeTheme="claude" onSelect={onSelect} />);

    fireEvent.click(document.querySelector('[data-message-theme-option="wechat"]')!);

    expect(onSelect).toHaveBeenCalledWith("wechat");
    expect(screen.getAllByRole("radio")).toHaveLength(MESSAGE_THEMES.length);
  });
});
