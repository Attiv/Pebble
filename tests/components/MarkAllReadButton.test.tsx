import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
  invalidateUnreadViews: vi.fn(),
  markAccountAllRead: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values[name] ?? ""),
      );
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("@/lib/api", () => ({
  markAccountAllRead: mocks.markAccountAllRead,
}));

vi.mock("@/hooks/queries", () => ({
  invalidateUnreadViews: mocks.invalidateUnreadViews,
}));

vi.mock("@/stores/toast.store", () => ({
  useToastStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

import MarkAllReadButton from "../../src/components/MarkAllReadButton";

const ACCOUNT_ID = "account-1";
const ACCOUNT_LABEL = "Work <work@example.com>";

function renderButton(props: Partial<ComponentProps<typeof MarkAllReadButton>> = {}) {
  return render(
    <MarkAllReadButton
      accountId={ACCOUNT_ID}
      accountLabel={ACCOUNT_LABEL}
      unread={3}
      {...props}
    />,
  );
}

function getButton() {
  return screen.getByTestId(`mark-all-read-${ACCOUNT_ID}`);
}

describe("MarkAllReadButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is disabled and inert when the mailbox has no unread mail", () => {
    renderButton({ unread: 0 });

    const button = getButton();
    expect(button.getAttribute("disabled")).not.toBeNull();

    fireEvent.click(button);
    expect(mocks.markAccountAllRead).not.toHaveBeenCalled();
  });

  it("clears the whole mailbox and refreshes every read-state view", async () => {
    mocks.markAccountAllRead.mockResolvedValueOnce(5);
    renderButton();

    fireEvent.click(getButton());

    await waitFor(() => expect(mocks.markAccountAllRead).toHaveBeenCalledWith(ACCOUNT_ID));
    expect(mocks.invalidateUnreadViews).toHaveBeenCalledWith(mocks.queryClient);
    expect(mocks.addToast).toHaveBeenCalledWith({
      message: `Marked 5 messages as read in ${ACCOUNT_LABEL}`,
      type: "success",
    });
  });

  it("reports a failure without refreshing the read-state views", async () => {
    mocks.markAccountAllRead.mockRejectedValueOnce(new Error("provider offline"));
    renderButton();

    fireEvent.click(getButton());

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith({
        message: "Failed to mark messages as read",
        type: "error",
      }),
    );
    expect(mocks.invalidateUnreadViews).not.toHaveBeenCalled();
  });

  it("stays disabled and shows progress while the backend writes to the provider", async () => {
    let resolveWrite!: (count: number) => void;
    mocks.markAccountAllRead.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    renderButton({ variant: "labelled" });

    const button = getButton();
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute("disabled")).not.toBeNull());
    expect(button.querySelector(".spinner")).toBeTruthy();
    expect(screen.getByText("Marking as read...")).toBeTruthy();

    await act(async () => {
      resolveWrite(4);
    });

    await waitFor(() => expect(screen.getByText("Mark all as read")).toBeTruthy());
    expect(button.getAttribute("disabled")).toBeNull();
  });

  it("renders no visible label in the icon variant", () => {
    renderButton({ variant: "icon" });

    expect(screen.queryByText("Mark all as read")).toBeNull();
    expect(getButton()).toBeTruthy();
  });
});
