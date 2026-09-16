import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivacyBanner from "../../src/components/PrivacyBanner";
import type { RenderedHtml } from "../../src/lib/ipc-types";

// `privacy.blocked` and `privacy.loadImages` are called without a fallback, so
// the stub needs a small dictionary rather than just echoing the second argument.
const { COPY } = vi.hoisted(() => ({
  COPY: {
    "privacy.loadImages": "Load images",
    "privacy.trustImages": "Trust images",
    "privacy.trustAll": "Trust sender",
  } as Record<string, string>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, optionsOrFallback?: unknown) =>
      COPY[key] ?? (typeof optionsOrFallback === "string" ? optionsOrFallback : key),
  }),
}));

function rendered(overrides: Partial<RenderedHtml> = {}): RenderedHtml {
  return { html: "<p>Body</p>", trackers_blocked: [], images_blocked: 0, ...overrides };
}

describe("privacy banner", () => {
  afterEach(cleanup);

  it("stays hidden when nothing was blocked", () => {
    const { container } = render(
      <PrivacyBanner rendered={rendered()} onLoadImages={vi.fn()} onTrustSender={vi.fn()} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("keeps the images-only actions hidden when only trackers were blocked", () => {
    render(
      <PrivacyBanner
        rendered={rendered({
          trackers_blocked: [{ domain: "tracker.example.com", tracker_type: "pixel" }],
        })}
        onLoadImages={vi.fn()}
        onTrustSender={vi.fn()}
      />,
    );

    expect(screen.getByText("privacy.blocked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load images" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Trust images" })).toBeNull();
    expect(screen.getByRole("button", { name: "Trust sender" })).toBeTruthy();
  });

  it("sends full trust for the trust-sender action", () => {
    const onTrustSender = vi.fn();
    render(
      <PrivacyBanner
        rendered={rendered({
          trackers_blocked: [{ domain: "tracker.example.com", tracker_type: "pixel" }],
        })}
        onLoadImages={vi.fn()}
        onTrustSender={onTrustSender}
      />,
    );

    const full = screen.getByRole("button", { name: "Trust sender" });
    expect(full.getAttribute("title")).toMatch(/stop stripping trackers/);

    fireEvent.click(full);
    expect(onTrustSender).toHaveBeenCalledWith("all");
  });

  it("sends images-only trust for the trust-images action", () => {
    const onTrustSender = vi.fn();
    const onLoadImages = vi.fn();
    render(
      <PrivacyBanner
        rendered={rendered({ images_blocked: 3 })}
        onLoadImages={onLoadImages}
        onTrustSender={onTrustSender}
      />,
    );

    const images = screen.getByRole("button", { name: "Trust images" });
    expect(images.getAttribute("title")).toMatch(/Trackers stay blocked/);

    fireEvent.click(images);
    expect(onTrustSender).toHaveBeenCalledWith("images");

    fireEvent.click(screen.getByRole("button", { name: "Load images" }));
    expect(onLoadImages).toHaveBeenCalledTimes(1);
  });
});
