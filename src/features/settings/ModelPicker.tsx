import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { useToastStore } from "@/stores/toast.store";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
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

/** Sentinel for the "type it myself" entry in the dropdown. */
const CUSTOM = "__custom__";

/**
 * Well-known OpenAI-compatible model names, offered so a common endpoint needs
 * no typing at all.
 *
 * Deliberately short: model names age fast and this list cannot know what a
 * given endpoint serves. It is a starting point, not a catalogue — the fetch
 * button next to the label is the authoritative list.
 */
const PRESET_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "deepseek-chat",
  "deepseek-reasoner",
  "qwen-plus",
  "qwen-turbo",
  "glm-4-flash",
  "glm-4-plus",
  "moonshot-v1-8k",
  "llama3.2",
  "qwen2.5",
];

/**
 * Fetched lists, per endpoint.
 *
 * The settings tabs unmount when you switch away from them, and re-fetching on
 * every visit would spend a request to learn something that has not changed.
 */
const fetchedCache = new Map<string, string[]>();

interface Props {
  /** Base id for the controls; the label points at whichever one is active. */
  id: string;
  /** Form field name, matching the field the picker replaced. */
  name: string;
  label: string;
  /** Current model name. Empty means nothing has been chosen yet. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Pulls the model list from the service the surrounding form describes. Kept
   * as a callback so the picker stays free of IPC and can be driven in tests.
   */
  fetchModels: () => Promise<string[]>;
  /** Endpoint the list belongs to; also the key its result is cached under. */
  cacheKey?: string;
  placeholder?: string;
}

/**
 * The model field: pick from a list, or type a name the list does not know.
 *
 * A dropdown alone cannot work here, because the set of models is a property of
 * whatever endpoint the user typed — no built-in list can be complete — while a
 * bare text field asks people to recall exact identifiers. So the field does
 * both: the dropdown carries the presets plus whatever the endpoint reported,
 * and "custom" reveals the text input. A saved name the list has never heard of
 * opens straight into the text input rather than silently blanking the select.
 */
export default function ModelPicker({
  id,
  name,
  label,
  value,
  onChange,
  fetchModels,
  cacheKey,
  placeholder,
}: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [fetched, setFetched] = useState<string[]>(() =>
    cacheKey ? fetchedCache.get(cacheKey) ?? [] : [],
  );
  const [fetching, setFetching] = useState(false);
  // Only needed to hold the "custom" choice while the input is still empty.
  const [explicitCustom, setExplicitCustom] = useState(false);

  // A different endpoint serves a different set, so its list must not linger.
  useEffect(() => {
    setFetched(cacheKey ? fetchedCache.get(cacheKey) ?? [] : []);
  }, [cacheKey]);

  const fetchedOnly = useMemo(
    () => fetched.filter((model) => !PRESET_MODELS.includes(model)),
    [fetched],
  );

  const known = useMemo(
    () => [...PRESET_MODELS, ...fetchedOnly],
    [fetchedOnly],
  );

  const isCustom = explicitCustom || (value !== "" && !known.includes(value));
  const customInputId = `${id}-custom`;

  async function handleFetch() {
    setFetching(true);
    try {
      const models = await fetchModels();
      setFetched(models);
      if (cacheKey) fetchedCache.set(cacheKey, models);
      if (models.length === 0) {
        addToast({
          message: t(
            "settings.modelFetchEmpty",
            "The service returned no models. Type the model name instead.",
          ),
          type: "error",
        });
      } else {
        addToast({
          message: t("settings.modelFetchSuccess", "Found {{count}} models", {
            count: models.length,
          }),
          type: "success",
        });
      }
    } catch (err: unknown) {
      addToast({
        message: t("settings.modelFetchFailed", "Could not list models: {{error}}", {
          error: extractErrorMessage(err),
        }),
        type: "error",
      });
    } finally {
      setFetching(false);
    }
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "4px",
        }}
      >
        <label htmlFor={isCustom ? customInputId : id} style={labelStyle}>
          {label}
        </label>
        <button
          type="button"
          onClick={handleFetch}
          disabled={fetching}
          data-testid={`${id}-fetch`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 8px",
            fontSize: "11.5px",
            fontWeight: 500,
            border: "1px solid var(--color-border)",
            borderRadius: "5px",
            background: "transparent",
            color: "var(--color-text-secondary)",
            cursor: fetching ? "default" : "pointer",
            opacity: fetching ? 0.6 : 1,
          }}
        >
          <RefreshCw size={11} className={fetching ? "spinner" : undefined} />
          {t("settings.modelFetch", "Fetch models")}
        </button>
      </div>

      <select
        id={id}
        name={name}
        style={inputStyle}
        value={isCustom ? CUSTOM : value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CUSTOM) {
            setExplicitCustom(true);
            return;
          }
          setExplicitCustom(false);
          onChange(next);
        }}
      >
        {value === "" && !isCustom && (
          <option value="" disabled>
            {placeholder ?? t("settings.modelUnset", "No model chosen")}
          </option>
        )}
        <optgroup label={t("settings.modelPresetGroup", "Common models")}>
          {PRESET_MODELS.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </optgroup>
        {fetchedOnly.length > 0 && (
          <optgroup label={t("settings.modelFetchedGroup", "Reported by the service")}>
            {fetchedOnly.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </optgroup>
        )}
        <option value={CUSTOM}>{t("settings.modelCustom", "Custom…")}</option>
      </select>

      {isCustom && (
        <input
          id={customInputId}
          name={`${name}_custom`}
          style={{ ...inputStyle, marginTop: "6px" }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
      )}
    </div>
  );
}
