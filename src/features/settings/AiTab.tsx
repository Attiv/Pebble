import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getAiConfig, saveAiConfig, testAiConnection } from "../../lib/api";
import type { AiApiMode, AiProviderType } from "../../lib/api";
import { useToastStore } from "@/stores/toast.store";
import { extractErrorMessage } from "../../lib/extractErrorMessage";

const PROVIDER_OPTIONS: { value: AiProviderType; labelKey: string }[] = [
  { value: "openai_compatible", labelKey: "ai.providerOpenAi" },
  { value: "generic", labelKey: "ai.providerGeneric" },
];

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  marginBottom: "4px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: "13px",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  background: "var(--color-bg-secondary)",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: "14px",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 18px",
  fontSize: "13px",
  fontWeight: 500,
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
};

/**
 * Settings for the AI assistant.
 *
 * Mirrors the translate tab's "provider + dynamic fields + save/test" pattern,
 * but reads and writes its own config (`ai_get_config` / `ai_save_config`).
 * Saving here never touches the translation engine, and vice versa.
 */
export default function AiTab() {
  const { t } = useTranslation();
  const [providerType, setProviderType] = useState<AiProviderType>("openai_compatible");
  const [isEnabled, setIsEnabled] = useState(false);

  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<AiApiMode>("completions");

  const [promptParam, setPromptParam] = useState("prompt");
  const [resultPath, setResultPath] = useState("text");

  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState<"success" | "error" | "">("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const cfg = await getAiConfig();
      if (!cfg) return;

      setProviderType(cfg.provider_type as AiProviderType);
      setIsEnabled(cfg.is_enabled);

      const parsed = JSON.parse(cfg.config) as Record<string, unknown>;
      setEndpoint((parsed.endpoint as string) || "");
      setApiKey((parsed.api_key as string) || "");
      setModel((parsed.model as string) || "");
      if (parsed.mode === "completions" || parsed.mode === "responses") {
        setMode(parsed.mode);
      }
      setPromptParam((parsed.prompt_param as string) || "prompt");
      setResultPath((parsed.result_path as string) || "text");
    } catch (err) {
      console.error("Failed to load AI config:", err);
    }
  }

  function buildConfigJson(): string {
    if (providerType === "generic") {
      return JSON.stringify({
        type: "generic",
        endpoint,
        api_key: apiKey || null,
        model: model || null,
        prompt_param: promptParam,
        result_path: resultPath,
      });
    }
    return JSON.stringify({
      type: "openai_compatible",
      endpoint,
      api_key: apiKey,
      model,
      mode,
    });
  }

  async function handleSave() {
    setSaving(true);
    setStatusMsg("");
    try {
      await saveAiConfig(providerType, buildConfigJson(), isEnabled);
      setStatusMsg(t("ai.configSaved"));
      setStatusType("success");
    } catch (err: unknown) {
      const errMsg = extractErrorMessage(err);
      setStatusMsg(t("ai.saveFailed", { error: errMsg }));
      setStatusType("error");
      useToastStore.getState().addToast({
        message: t("ai.saveFailed", { error: errMsg }),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setStatusMsg("");
    try {
      const result = await testAiConnection(buildConfigJson());
      setStatusMsg(t("ai.connectionOk", { result }));
      setStatusType("success");
    } catch (err: unknown) {
      const errMsg = extractErrorMessage(err);
      setStatusMsg(t("ai.testFailed", { error: errMsg }));
      setStatusType("error");
      useToastStore.getState().addToast({
        message: t("ai.testFailed", { error: errMsg }),
        type: "error",
      });
    } finally {
      setTesting(false);
    }
  }

  function renderProviderFields() {
    if (providerType === "generic") {
      return (
        <>
          <div style={fieldGroupStyle}>
            <label htmlFor="ai-generic-endpoint" style={labelStyle}>{t("ai.endpoint")}</label>
            <input
              id="ai-generic-endpoint"
              name="ai_generic_endpoint"
              type="url"
              style={inputStyle}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://api.example.com/generate"
              autoComplete="off"
            />
          </div>
          <div style={fieldGroupStyle}>
            <label htmlFor="ai-generic-api-key" style={labelStyle}>{t("translate.apiKeyOptional")}</label>
            <input
              id="ai-generic-api-key"
              name="ai_generic_api_key"
              style={inputStyle}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div style={fieldGroupStyle}>
            <label htmlFor="ai-generic-model" style={labelStyle}>{t("ai.modelOptional")}</label>
            <input
              id="ai-generic-model"
              name="ai_generic_model"
              style={inputStyle}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="local-model"
              autoComplete="off"
            />
          </div>
          <div style={fieldGroupStyle}>
            <label htmlFor="ai-generic-prompt-param" style={labelStyle}>{t("ai.promptParam")}</label>
            <input
              id="ai-generic-prompt-param"
              name="ai_generic_prompt_param"
              style={inputStyle}
              value={promptParam}
              onChange={(e) => setPromptParam(e.target.value)}
              placeholder="prompt"
              autoComplete="off"
            />
          </div>
          <div style={fieldGroupStyle}>
            <label htmlFor="ai-generic-result-path" style={labelStyle}>{t("ai.resultPath")}</label>
            <input
              id="ai-generic-result-path"
              name="ai_generic_result_path"
              style={inputStyle}
              value={resultPath}
              onChange={(e) => setResultPath(e.target.value)}
              placeholder="data.reply"
              autoComplete="off"
            />
          </div>
        </>
      );
    }

    return (
      <>
        <div style={fieldGroupStyle}>
          <label htmlFor="ai-endpoint" style={labelStyle}>{t("ai.endpoint")}</label>
          <input
            id="ai-endpoint"
            name="ai_endpoint"
            type="url"
            style={inputStyle}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://api.openai.com"
            autoComplete="off"
          />
        </div>
        <div style={fieldGroupStyle}>
          <label htmlFor="ai-api-key" style={labelStyle}>{t("translate.apiKey")}</label>
          <input
            id="ai-api-key"
            name="ai_api_key"
            style={inputStyle}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div style={fieldGroupStyle}>
          <label htmlFor="ai-model" style={labelStyle}>{t("translate.model")}</label>
          <input
            id="ai-model"
            name="ai_model"
            style={inputStyle}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            autoComplete="off"
          />
        </div>
        <div style={fieldGroupStyle}>
          <label htmlFor="ai-mode" style={labelStyle}>{t("translate.mode")}</label>
          <select
            id="ai-mode"
            name="ai_mode"
            style={inputStyle}
            value={mode}
            onChange={(e) => setMode(e.target.value as AiApiMode)}
          >
            <option value="completions">{t("translate.modeCompletions")}</option>
            <option value="responses">{t("translate.modeResponses")}</option>
          </select>
        </div>
      </>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--color-text-primary)", marginTop: 0, marginBottom: "20px" }}>
        {t("ai.engineTitle")}
      </h2>

      <p style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--color-text-secondary)", marginTop: 0, marginBottom: "18px" }}>
        {t("ai.isolationNote")}
      </p>

      <div style={{ ...fieldGroupStyle, display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(e) => setIsEnabled(e.target.checked)}
          id="ai-enabled"
        />
        <label htmlFor="ai-enabled" style={{ fontSize: "13px", color: "var(--color-text-primary)", cursor: "pointer" }}>
          {t("ai.enableAi")}
        </label>
      </div>

      <div style={fieldGroupStyle}>
        <label htmlFor="ai-provider" style={labelStyle}>{t("translate.provider")}</label>
        <select
          id="ai-provider"
          name="ai_provider"
          style={inputStyle}
          value={providerType}
          onChange={(e) => setProviderType(e.target.value as AiProviderType)}
        >
          {PROVIDER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {renderProviderFields()}

      <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
        <button
          style={{ ...buttonStyle, background: "var(--color-accent)", color: "#fff", opacity: saving ? 0.6 : 1 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
        <button
          style={{ ...buttonStyle, background: "var(--color-bg-hover)", color: "var(--color-text-primary)", opacity: testing ? 0.6 : 1 }}
          onClick={handleTest}
          disabled={testing}
        >
          {testing ? t("common.testing") : t("translate.testConnection")}
        </button>
      </div>

      {statusMsg && (
        <div
          role={statusType === "error" ? "alert" : "status"}
          aria-live="polite"
          style={{
            marginTop: "14px",
            padding: "10px 14px",
            borderRadius: "6px",
            fontSize: "13px",
            background: statusType === "success" ? "var(--color-bg-hover)" : "rgba(220, 53, 69, 0.1)",
            color: statusType === "success" ? "var(--color-text-primary)" : "#dc3545",
            border: `1px solid ${statusType === "success" ? "var(--color-border)" : "rgba(220, 53, 69, 0.3)"}`,
          }}
        >
          {statusMsg}
        </div>
      )}
    </div>
  );
}
