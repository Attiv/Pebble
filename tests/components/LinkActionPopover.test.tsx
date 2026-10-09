import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LinkActionPopover from "../../src/components/LinkActionPopover";

// The popover reaches `@/lib/i18n` through the shared link helper, so the mock
// has to carry the plugin registration as well as the hook.
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const writeText = vi.fn();

function renderPopover(href: string, onOpen = vi.fn(), onClose = vi.fn()) {
  render(
    <LinkActionPopover
      href={href}
      position={{ x: 10, y: 10 }}
      onOpen={onOpen}
      onClose={onClose}
    />,
  );
  return { onOpen, onClose };
}

describe("LinkActionPopover", () => {
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("shows the address and copies it", async () => {
    renderPopover("https://pebble.byebug.cn/docs?page=2");

    expect(screen.getByTestId("link-action-address").textContent)
      .toBe("https://pebble.byebug.cn/docs?page=2");

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://pebble.byebug.cn/docs?page=2");
    });
    expect(await screen.findByRole("menuitem", { name: "Link copied" })).toBeTruthy();
  });

  it("follows the link through the caller", () => {
    const { onOpen, onClose } = renderPopover("mailto:someone@example.com");

    fireEvent.click(screen.getByRole("menuitem", { name: "Open link" }));

    expect(onOpen).toHaveBeenCalledWith("mailto:someone@example.com");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers only the address for an href the app cannot follow", () => {
    renderPopover("#section-2");

    expect(screen.queryByRole("menuitem", { name: "Open link" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeTruthy();
  });

  /// A refused clipboard must not leave the reader thinking the address is on
  /// their clipboard — the address stays on screen so they can still take it.
  it("keeps the address visible and reports when the copy is refused", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    renderPopover("https://example.com/");
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByRole("menuitem", { name: "Link copied" })).toBeNull();
    expect(screen.getByTestId("link-action-address").textContent).toBe("https://example.com/");

    warn.mockRestore();
  });

  it("closes through the caller", () => {
    const { onClose } = renderPopover("https://example.com/");

    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });
});
