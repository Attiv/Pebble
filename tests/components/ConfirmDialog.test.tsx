import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "../../src/components/ConfirmDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe("ConfirmDialog", () => {
  it("keeps long diagnostic text keyboard-scrollable and focuses Close while copying is disabled", () => {
    render(
      <ConfirmDialog
        title="Checking invitation"
        message="Reading MIME content"
        scrollable
        confirmDisabled
        confirmLabel="Copy"
        cancelLabel="Close"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const message = screen.getByText("Reading MIME content");
    expect(message.tabIndex).toBe(0);
    expect(message.style.overflowY).toBe("auto");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(message);
  });

  it("keeps focus inside the dialog and restores the previous focus on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <ConfirmDialog
        title="Delete rule"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const confirmButton = screen.getByRole("button", { name: "Confirm" });

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(confirmButton);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancelButton);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmButton);

    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("uses the themed dialog surface instead of a plain white panel", () => {
    render(
      <ConfirmDialog
        title="Discard draft?"
        message="You have unsaved changes."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;

    expect(panel.style.backgroundColor).toBe("var(--color-sidebar-bg)");
    expect(panel.style.color).toBe("var(--color-text-primary)");
    expect(panel.style.border).toBe("1px solid var(--color-border)");
  });

  it("does not cancel when clicking outside the dialog panel", () => {
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        title="Discard draft?"
        message="You have unsaved changes."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps actions inert and focus contained while a destructive action is busy", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Discard draft?"
        message="Cleaning up the saved draft."
        confirmLabel="Discard"
        busyConfirmLabel="Discarding..."
        destructive
        busy
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const confirmButton = screen.getByRole("button", { name: "Discarding..." });
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(cancelButton.getAttribute("aria-disabled")).toBe("true");
    expect(confirmButton.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(cancelButton);
    fireEvent.click(confirmButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(confirmButton);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancelButton);
  });
});
