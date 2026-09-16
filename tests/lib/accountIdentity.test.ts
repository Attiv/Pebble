import { describe, expect, it } from "vitest";
import { accountBadges, accountLabel, accountOptionLabel, accountShortLabel, senderIdentityLabel } from "../../src/lib/accountIdentity";
import type { Account } from "../../src/lib/ipc-types";

const account: Account = { id: "a", email: "sender@example.com", display_name: "张三", account_label: "内部备用", provider: "imap", created_at: 1, updated_at: 1 };

function makeAccount(overrides: Partial<Account> & { id: string }): Account {
  return { email: "user@example.com", display_name: "", provider: "imap", created_at: 1, updated_at: 1, ...overrides };
}

describe("account identity presentation", () => {
  it("keeps local labels out of the sender identity and preserves the address", () => {
    expect(accountLabel(account)).toBe("内部备用");
    expect(accountOptionLabel(account)).toBe("内部备用 · sender@example.com");
    expect(senderIdentityLabel(account)).toBe("张三 <sender@example.com>");
    expect(accountOptionLabel({ ...account, account_label: "   " })).toBe(account.email);
  });
  it("uses only the provider name for Outlook, including when it is unknown", () => {
    expect(senderIdentityLabel({ ...account, provider: "outlook" })).toBe(account.email);
    expect(senderIdentityLabel({ ...account, provider: "outlook", provider_display_name: "Microsoft name" })).toBe("Microsoft name <sender@example.com>");
  });
});

describe("account short labels", () => {
  it("prefers the label the user chose for the mailbox", () => {
    const work = makeAccount({ id: "w", email: "work@example.com", account_label: "  Client work  " });
    // Two accounts share the local part on purpose: a chosen label settles the
    // ambiguity, so the full address is not needed.
    const personal = makeAccount({ id: "p", email: "work@personal.example", account_label: "Personal" });

    expect(accountShortLabel(work, [work, personal])).toBe("Client work");
  });

  it("falls back to the local part so a row stays narrow", () => {
    const work = makeAccount({ id: "w", email: "work@example.com", account_label: null });

    expect(accountShortLabel(work, [work])).toBe("work");
  });

  it("falls back to the full address when two mailboxes share a local part", () => {
    const personal = makeAccount({ id: "p", email: "work@personal.example", account_label: null });
    const corporate = makeAccount({ id: "c", email: "work@corporate.example", account_label: null });

    expect(accountShortLabel(personal, [personal, corporate])).toBe("work@personal.example");
    expect(accountShortLabel(corporate, [personal, corporate])).toBe("work@corporate.example");
  });

  it("survives a mailbox that carries no address", () => {
    const broken = makeAccount({ id: "b", email: "   ", account_label: null });

    expect(accountShortLabel(broken, [broken])).toBe("");
  });
});

describe("account badges", () => {
  it("gives every mailbox a distinct colour, a short label and its full identity", () => {
    const work = makeAccount({ id: "w", email: "work@example.com", account_label: "Work" });
    const personal = makeAccount({ id: "p", email: "me@gmail.com", account_label: null });

    const badges = accountBadges([work, personal]);

    expect(badges.get("w")).toEqual({ color: expect.any(String), label: "Work", title: "Work · work@example.com" });
    expect(badges.get("p")).toEqual({ color: expect.any(String), label: "me", title: "me@gmail.com" });
    expect(badges.get("w")!.color).not.toBe(badges.get("p")!.color);
  });

  it("honours a colour the user picked for the mailbox", () => {
    const work = makeAccount({ id: "w", email: "work@example.com", color: "#EC4899" });

    expect(accountBadges([work]).get("w")!.color).toBe("#ec4899");
  });

  it("skips accounts that cannot be looked up by id", () => {
    const noId = makeAccount({ id: "", email: "ghost@example.com" });

    expect(accountBadges([noId]).size).toBe(0);
  });
});
