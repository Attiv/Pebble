import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PrivacyTab from "../../../src/features/settings/PrivacyTab";

const mocks = vi.hoisted(() => ({
  listTrustedSenders: vi.fn(),
  removeTrustedSender: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../../src/stores/toast.store", () => ({
  useToastStore: {
    getState: () => ({ addToast: vi.fn() }),
  },
}));

vi.mock("../../../src/lib/api", () => ({
  listTrustedSenders: mocks.listTrustedSenders,
  removeTrustedSender: mocks.removeTrustedSender,
}));

const trusted = (email: string, accountId = "account-1") => ({
  account_id: accountId,
  email,
  trust_type: "all" as const,
  created_at: 1,
});

describe("PrivacyTab", () => {
  beforeEach(() => {
    mocks.listTrustedSenders.mockReset();
    mocks.listTrustedSenders.mockResolvedValue([]);
    mocks.removeTrustedSender.mockReset();
  });

  it("selects relaxed as the default privacy mode when there is no stored preference", () => {
    localStorage.removeItem("pebble-privacy-mode");

    render(<PrivacyTab />);

    expect(screen.getByText("Load external images by default. Trackers are still blocked.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Relaxed" }).getAttribute("style")).toContain(
      "var(--color-accent)",
    );
  });

  it("lists trusted senders from every mailbox, not just the active one", async () => {
    mocks.listTrustedSenders.mockResolvedValue([
      trusted("trusted@example.com", "account-1"),
      trusted("news@example.com", "account-2"),
    ]);

    render(<PrivacyTab />);

    expect(await screen.findByText("trusted@example.com")).toBeTruthy();
    // The second address was trusted while reading another account; dropping the
    // account filter is the whole point of the change.
    expect(screen.getByText("news@example.com")).toBeTruthy();
    expect(mocks.listTrustedSenders).toHaveBeenCalledWith();
  });

  it("removes a sender by address alone", async () => {
    mocks.listTrustedSenders.mockResolvedValue([trusted("trusted@example.com", "account-1")]);
    mocks.removeTrustedSender.mockResolvedValue(undefined);

    render(<PrivacyTab />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mocks.removeTrustedSender).toHaveBeenCalledWith("trusted@example.com"),
    );
    await waitFor(() => expect(screen.queryByText("trusted@example.com")).toBeNull());
  });

  it("says the decision covers every mailbox", async () => {
    mocks.listTrustedSenders.mockResolvedValue([]);

    render(<PrivacyTab />);

    expect(await screen.findByText(/trusted in every mailbox/)).toBeTruthy();
  });
});
