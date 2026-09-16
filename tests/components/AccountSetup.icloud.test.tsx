import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountSetup from "../../src/components/AccountSetup";

vi.mock("../../src/lib/i18n", () => ({
  default: {
    t: (_key: string, fallback?: string) => fallback ?? _key,
  },
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../src/lib/api", () => ({
  addAccount: vi.fn(),
  completeOAuthFlow: vi.fn(),
  setXOAuth2Refresh: vi.fn(),
  startSync: vi.fn(),
  testImapConnection: vi.fn(),
  testPop3Connection: vi.fn(),
}));

function renderSetup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountSetup onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

function inputValue(id: string): string {
  const element = document.getElementById(id) as HTMLInputElement | null;
  return element?.value ?? "";
}

describe("AccountSetup iCloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("labels the quick-setup button as iCloud rather than a capitalised key", () => {
    renderSetup();

    expect(screen.getByRole("button", { name: "iCloud" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Icloud" })).toBeNull();
  });

  it("fills Apple's IMAP and SMTP endpoints from Apple's published settings", () => {
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: "iCloud" }));

    expect(inputValue("setup-imap-host")).toBe("imap.mail.me.com");
    expect(inputValue("setup-imap-port")).toBe("993");
    expect(inputValue("setup-smtp-host")).toBe("smtp.mail.me.com");
    expect(inputValue("setup-smtp-port")).toBe("587");

    // Incoming is implicit TLS, outgoing is STARTTLS.
    expect((document.getElementById("setup-imap-security") as HTMLSelectElement).value).toBe("tls");
    expect((document.getElementById("setup-smtp-security") as HTMLSelectElement).value).toBe(
      "starttls",
    );
  });

  it("warns about the app-specific password only for Apple hosts", () => {
    renderSetup();

    expect(screen.queryByTestId("icloud-password-hint")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "iCloud" }));
    expect(screen.getByTestId("icloud-password-hint")).toBeTruthy();

    // Switching to a provider that accepts a normal password must drop the hint.
    fireEvent.click(screen.getByRole("button", { name: "Gmail" }));
    expect(screen.queryByTestId("icloud-password-hint")).toBeNull();
  });

  it("also recognises iCloud custom-domain hosts via mail.me.com", () => {
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: "iCloud" }));
    const host = document.getElementById("setup-imap-host") as HTMLInputElement;

    // iCloud+ custom domains still resolve through Apple's mail.me.com servers.
    fireEvent.change(host, { target: { value: "imap.mail.me.com" } });
    expect(screen.getByTestId("icloud-password-hint")).toBeTruthy();

    fireEvent.change(host, { target: { value: "imap.fastmail.com" } });
    expect(screen.queryByTestId("icloud-password-hint")).toBeNull();
  });
});
