import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import XOAuth2Panel from "../../../src/features/settings/XOAuth2Panel";
import { getXOAuth2Status, setXOAuth2Refresh, triggerSync } from "../../../src/lib/api";
import type { XOAuth2Status } from "../../../src/lib/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Mirrors just enough of i18next for the assertions below: the fallback
    // string is the template, and {{name}} placeholders are filled in.
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!options) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(options[name] ?? ""),
      );
    },
  }),
}));
vi.mock("../../../src/lib/api", () => ({
  getXOAuth2Status: vi.fn(),
  setXOAuth2Refresh: vi.fn(),
  triggerSync: vi.fn(),
}));

const ACCOUNT = "68b9936e-fa45-4896-bd51-edbe23f328d1";
const TENANT = "07cc41f3-1927-4a12-9fdf-a195b807a052";
const CLIENT_ID = "467a4c64-4066-4d4e-bc0f-0363fad7d56f";

function status(overrides: Partial<XOAuth2Status> = {}): XOAuth2Status {
  return {
    imap_uses_token: true,
    smtp_uses_token: false,
    has_refresh_token: true,
    expires_at: null,
    expires_in_secs: null,
    tenant: TENANT,
    client_id: CLIENT_ID,
    has_client_secret: false,
    ...overrides,
  };
}

const tenantField = () => screen.getByLabelText("Tenant ID") as HTMLInputElement;
const tokenField = () => screen.getByLabelText(/Refresh token/) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "Save & verify token" });

describe("XOAuth2 panel", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(setXOAuth2Refresh).mockResolvedValue(undefined);
    vi.mocked(triggerSync).mockResolvedValue(undefined);
  });

  it("prefills the stored tenant instead of offering to save common over it", async () => {
    vi.mocked(getXOAuth2Status).mockResolvedValue(status());
    render(<XOAuth2Panel accountId={ACCOUNT} />);
    await waitFor(() => expect(tenantField().value).toBe(TENANT));
  });

  it("reports which tenant the next refresh will use", async () => {
    vi.mocked(getXOAuth2Status).mockResolvedValue(status());
    render(<XOAuth2Panel accountId={ACCOUNT} />);
    await screen.findByText(`Tenant: ${TENANT}`);
  });

  it("corrects a wrong tenant without demanding the refresh token again", async () => {
    vi.mocked(getXOAuth2Status).mockResolvedValue(status({ tenant: "common" }));
    render(<XOAuth2Panel accountId={ACCOUNT} />);
    await waitFor(() => expect(tenantField().value).toBe("common"));

    fireEvent.change(tenantField(), { target: { value: TENANT } });
    expect(tokenField().value).toBe("");
    fireEvent.click(saveButton());

    await waitFor(() => expect(setXOAuth2Refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setXOAuth2Refresh).mock.calls[0][0]).toEqual({
      accountId: ACCOUNT,
      tenant: TENANT,
      clientId: CLIENT_ID,
      clientSecret: undefined,
      // Left blank on purpose: the stored token is reused.
      refreshToken: undefined,
    });
  });

  it("still asks for a token when the account has none to fall back on", async () => {
    vi.mocked(getXOAuth2Status).mockResolvedValue(
      status({ has_refresh_token: false, tenant: "common" }),
    );
    render(<XOAuth2Panel accountId={ACCOUNT} />);
    await waitFor(() => expect(tenantField().value).toBe("common"));

    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(tokenField(), { target: { value: " 1.AXoA-token " } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton());

    await waitFor(() => expect(setXOAuth2Refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(setXOAuth2Refresh).mock.calls[0][0].refreshToken).toBe("1.AXoA-token");
  });

  it("keeps the tenant in the form after a save so a retry is not undone", async () => {
    vi.mocked(getXOAuth2Status).mockResolvedValue(status());
    render(<XOAuth2Panel accountId={ACCOUNT} />);
    await waitFor(() => expect(tenantField().value).toBe(TENANT));

    fireEvent.change(tokenField(), { target: { value: "1.AXoA-token" } });
    fireEvent.click(saveButton());

    await screen.findByText("Token verified. IMAP will use it from the next sync onwards.");
    expect(tenantField().value).toBe(TENANT);
    expect(tokenField().value).toBe("");
  });

  it("asks for a sync once the token is verified", async () => {
    vi.mocked(getXOAuth2Status).mockResolvedValue(status());
    render(<XOAuth2Panel accountId={ACCOUNT} />);
    await waitFor(() => expect(tenantField().value).toBe(TENANT));

    fireEvent.change(tokenField(), { target: { value: "1.AXoA-token" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(triggerSync).toHaveBeenCalledWith(ACCOUNT, "manual"));
  });

  it("does not ask for a sync when the token was refused", async () => {
    vi.mocked(getXOAuth2Status).mockResolvedValue(status());
    vi.mocked(setXOAuth2Refresh).mockRejectedValue(
      new Error("XOAUTH2 refresh rejected (400 Bad Request): AADSTS50194"),
    );
    render(<XOAuth2Panel accountId={ACCOUNT} />);
    await waitFor(() => expect(tenantField().value).toBe(TENANT));

    fireEvent.change(tokenField(), { target: { value: "1.AXoA-token" } });
    fireEvent.click(saveButton());

    await screen.findByRole("alert");
    expect(triggerSync).not.toHaveBeenCalled();
  });
});
