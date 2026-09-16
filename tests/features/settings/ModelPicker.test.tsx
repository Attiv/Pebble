import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  fetchModels: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Interpolates, so a test can assert the wording the user actually sees.
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values[name] ?? ""),
      );
    },
  }),
}));

vi.mock("@/stores/toast.store", () => ({
  useToastStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

import ModelPicker from "../../../src/features/settings/ModelPicker";

/** Each test gets its own endpoint, because successful lists are cached by it. */
let endpointCounter = 0;

function renderPicker(props: Partial<ComponentProps<typeof ModelPicker>> = {}) {
  const onChange = props.onChange ?? vi.fn();
  endpointCounter += 1;
  const view = render(
    <ModelPicker
      id="model"
      name="model"
      label="Model"
      value=""
      onChange={onChange}
      fetchModels={mocks.fetchModels}
      cacheKey={`https://endpoint-${endpointCounter}.test`}
      {...props}
    />,
  );
  return { ...view, onChange };
}

/** The `select` itself, regardless of which control the label currently points at. */
function select() {
  return screen.getByRole("combobox") as HTMLSelectElement;
}

function optionValues(): string[] {
  return Array.from(select().querySelectorAll("option")).map((option) => option.value);
}

function optionGroupLabels(): (string | null)[] {
  return Array.from(select().querySelectorAll("optgroup")).map((group) =>
    group.getAttribute("label"),
  );
}

describe("ModelPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers the presets so a common model needs no typing", () => {
    renderPicker();

    expect(optionValues()).toContain("gpt-4o");
    expect(optionValues()).toContain("deepseek-chat");
    // Nothing chosen yet, so the field says so rather than looking broken.
    expect(screen.getByText("No model chosen")).toBeTruthy();
  });

  it("reports the model chosen from the dropdown", () => {
    const { onChange } = renderPicker();

    fireEvent.change(select(), { target: { value: "deepseek-chat" } });

    expect(onChange).toHaveBeenCalledWith("deepseek-chat");
  });

  it("opens the text input for a saved model the list has never heard of", () => {
    // A config written before this picker existed, or a self-hosted name.
    renderPicker({ value: "my-self-hosted-model" });

    const input = screen.getByLabelText("Model") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("my-self-hosted-model");
    // The select keeps its place in the row, still listing the known names.
    expect(optionValues()).toContain("gpt-4o");
  });

  it("hands the field to the text input when custom is chosen, even if a model is set", () => {
    const { onChange } = renderPicker({ value: "gpt-4o" });

    fireEvent.change(select(), { target: { value: "__custom__" } });

    const input = screen.getByLabelText("Model") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("gpt-4o");

    fireEvent.change(input, { target: { value: "gpt-5-preview" } });
    expect(onChange).toHaveBeenCalledWith("gpt-5-preview");
  });

  it("takes the model name typed into the input while custom is active", () => {
    const { onChange } = renderPicker({ value: "" });

    fireEvent.change(select(), { target: { value: "__custom__" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "llama3.2:70b" } });

    expect(onChange).toHaveBeenCalledWith("llama3.2:70b");
  });

  it("lists what the service reported, without repeating a preset", async () => {
    mocks.fetchModels.mockResolvedValueOnce(["gpt-4o", "brand-new-model"]);
    renderPicker();

    fireEvent.click(screen.getByTestId("model-fetch"));

    await waitFor(() => expect(optionValues()).toContain("brand-new-model"));
    // `gpt-4o` is already a preset; offering it twice would look like two models.
    expect(optionValues().filter((value) => value === "gpt-4o")).toHaveLength(1);
    expect(optionGroupLabels()).toContain("Reported by the service");
    expect(mocks.addToast).toHaveBeenCalledWith({
      message: "Found 2 models",
      type: "success",
    });
  });

  it("remembers a fetched list for the same endpoint across a remount", async () => {
    mocks.fetchModels.mockResolvedValueOnce(["remembered-model"]);
    const cacheKey = "https://cache-shared.test";
    const first = renderPicker({ cacheKey });
    fireEvent.click(screen.getByTestId("model-fetch"));
    await waitFor(() => expect(optionValues()).toContain("remembered-model"));
    first.unmount();

    // Switching settings tabs unmounts the field; the list must survive it.
    renderPicker({ cacheKey });

    expect(optionValues()).toContain("remembered-model");
    expect(mocks.fetchModels).toHaveBeenCalledTimes(1);
  });

  it("says so when the service reports nothing, rather than showing an empty list", async () => {
    mocks.fetchModels.mockResolvedValueOnce([]);
    renderPicker();

    fireEvent.click(screen.getByTestId("model-fetch"));

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith({
        message: "The service returned no models. Type the model name instead.",
        type: "error",
      }),
    );
  });

  it("reports a failed fetch instead of pretending it worked", async () => {
    mocks.fetchModels.mockRejectedValueOnce(new Error("401 Unauthorized"));
    renderPicker();

    fireEvent.click(screen.getByTestId("model-fetch"));

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith({
        message: "Could not list models: 401 Unauthorized",
        type: "error",
      }),
    );
    // A failed attempt must leave the button usable for a retry.
    await waitFor(() =>
      expect(screen.getByTestId("model-fetch").getAttribute("disabled")).toBeNull(),
    );
  });

  it("blocks a second fetch while the first is in flight", async () => {
    let release!: (models: string[]) => void;
    mocks.fetchModels.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        release = resolve;
      }),
    );
    renderPicker();

    const button = screen.getByTestId("model-fetch") as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute("disabled")).not.toBeNull());
    expect(button.querySelector(".spinner")).toBeTruthy();
    fireEvent.click(button);
    expect(mocks.fetchModels).toHaveBeenCalledTimes(1);

    release(["slow-model"]);
    await waitFor(() => expect(optionValues()).toContain("slow-model"));
  });
});
