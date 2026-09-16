import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  getAiConfig: vi.fn(),
  saveAiConfig: vi.fn(),
  testAiConnection: vi.fn(),
  listAiModels: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@/stores/toast.store", () => {
  const useToastStore = (selector: (state: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast });
  return {
    useToastStore: Object.assign(useToastStore, {
      getState: () => ({ addToast: mocks.addToast }),
    }),
  };
});

vi.mock("../../../src/lib/api", () => ({
  getAiConfig: mocks.getAiConfig,
  saveAiConfig: mocks.saveAiConfig,
  testAiConnection: mocks.testAiConnection,
  listAiModels: mocks.listAiModels,
}));

import AiTab from "../../../src/features/settings/AiTab";

const STORED_CONFIG = JSON.stringify({
  type: "openai_compatible",
  endpoint: "https://api.example.com/v1",
  api_key: "secret",
  model: "gpt-4o",
  mode: "completions",
});

function renderTab() {
  return render(<AiTab />);
}

/**
 * The model control. Queried through its label rather than by role, because the
 * tab also has a provider and a mode dropdown and the label follows the control
 * that is actually active.
 */
function modelField(): HTMLSelectElement {
  return screen.getByLabelText("translate.model") as HTMLSelectElement;
}

function modelOptionValues(): string[] {
  return Array.from(modelField().querySelectorAll("option")).map((option) => option.value);
}

describe("AiTab model field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAiConfig.mockResolvedValue({
      id: "active",
      provider_type: "openai_compatible",
      config: STORED_CONFIG,
      is_enabled: true,
      created_at: 1,
      updated_at: 1,
    });
    mocks.saveAiConfig.mockResolvedValue(undefined);
    mocks.listAiModels.mockResolvedValue(["gpt-4o", "brand-new-model"]);
  });

  it("loads the saved model into the picker", async () => {
    renderTab();

    // `gpt-4o` is a preset, so the field stays a dropdown rather than flipping
    // into manual-entry mode.
    await waitFor(() => expect(modelField().value).toBe("gpt-4o"));
    expect(modelField().tagName).toBe("SELECT");
  });

  it("asks the AI command for models using the endpoint on screen, not the saved one", async () => {
    renderTab();
    await waitFor(() => expect(mocks.getAiConfig).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("ai.endpoint"), {
      target: { value: "https://api.other.example.com/v1" },
    });
    fireEvent.click(screen.getByTestId("ai-model-fetch"));

    await waitFor(() => expect(mocks.listAiModels).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(mocks.listAiModels.mock.calls[0][0] as string);
    expect(sent.endpoint).toBe("https://api.other.example.com/v1");
    expect(sent.type).toBe("openai_compatible");
  });

  it("saves the model chosen from the fetched list", async () => {
    renderTab();
    await waitFor(() => expect(mocks.getAiConfig).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("ai-model-fetch"));
    await waitFor(() => expect(modelOptionValues()).toContain("brand-new-model"));

    fireEvent.change(modelField(), { target: { value: "brand-new-model" } });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => expect(mocks.saveAiConfig).toHaveBeenCalledTimes(1));
    const [providerType, configJson] = mocks.saveAiConfig.mock.calls[0];
    expect(providerType).toBe("openai_compatible");
    expect(JSON.parse(configJson).model).toBe("brand-new-model");
  });

  it("keeps the generic provider on manual entry", async () => {
    mocks.getAiConfig.mockResolvedValue({
      id: "active",
      provider_type: "generic",
      config: JSON.stringify({
        type: "generic",
        endpoint: "https://api.example.com/generate",
        api_key: null,
        model: "local-model",
        prompt_param: "prompt",
        result_path: "text",
      }),
      is_enabled: true,
      created_at: 1,
      updated_at: 1,
    });
    renderTab();

    // No model list endpoint exists for a single-URL provider, so the field is
    // a plain input and the fetch button is not offered.
    await waitFor(() => expect(screen.getByLabelText("ai.modelOptional").tagName).toBe("INPUT"));
    expect(screen.queryByTestId("ai-generic-model-fetch")).toBeNull();
  });
});
