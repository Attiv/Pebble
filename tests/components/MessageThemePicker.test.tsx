import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MessageThemePicker from "@/components/MessageThemePicker";
import { MESSAGE_THEMES } from "@/lib/messageThemes";

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
