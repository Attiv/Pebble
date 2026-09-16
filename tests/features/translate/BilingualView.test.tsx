import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BilingualView from "../../../src/features/translate/BilingualView";

describe("BilingualView", () => {
  it("renders the translation as the paragraph and the source underneath it", () => {
    render(
      <BilingualView
        segments={[
          { source: "The report is attached.", target: "报告已随附。" },
          { source: "Please review it.", target: "请查阅。" },
        ]}
      />,
    );

    expect(screen.getByText("报告已随附。")).toBeTruthy();
    expect(screen.getByText("The report is attached.")).toBeTruthy();
    expect(screen.getByText("请查阅。")).toBeTruthy();
    expect(screen.getByText("Please review it.")).toBeTruthy();
  });

  /// A translator that correctly leaves a proper noun alone must not make the
  /// reader read it twice.
  it("leaves out paragraphs the engine returned unchanged", () => {
    render(
      <BilingualView
        segments={[
          { source: "Pebble 2.0 is out.", target: "Pebble 2.0 已发布。" },
          { source: "Pebble 2.0", target: "Pebble 2.0" },
        ]}
      />,
    );

    expect(screen.getByText("Pebble 2.0 已发布。")).toBeTruthy();
    expect(screen.queryByText("Pebble 2.0")).toBeNull();
  });

  it("still shows the translation when nothing could be paired", () => {
    render(<BilingualView segments={[{ source: "Same text", target: "Same text" }]} />);

    expect(screen.getByText("Same text")).toBeTruthy();
  });
});
