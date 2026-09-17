import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getXOAuth2Status, setXOAuth2Refresh, triggerSync } from "@/lib/api";
import type { XOAuth2Status } from "@/lib/api";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { inputStyle, labelStyle } from "@/styles/form";

/** Microsoft's multi-tenant endpoint, correct for personal and most work accounts. */
export const DEFAULT_TENANT = "common";

export interface XOAuth2FormValues {
  tenant: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export const emptyXOAuth2Form: XOAuth2FormValues = {
  tenant: DEFAULT_TENANT,
  clientId: "",
  clientSecret: "",
  refreshToken: "",
};

export function isXOAuth2FormComplete(v: XOAuth2FormValues): boolean {
  return !!v.tenant.trim() && !!v.clientId.trim() && !!v.refreshToken.trim();
}

const hintStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--color-text-secondary)",
  marginTop: "3px",
  lineHeight: 1.5,
};

/**
 * The four fields needed to refresh an OAuth2 access token. Controlled, so it
 * can be reused both when adding an account (values submitted afterwards) and
 * when editing one (saved immediately).
 *
 * `hasStoredRefreshToken` only relaxes the hint: it tells the person that an
 * empty field keeps the token the account already has, which is what makes
 * correcting one of the other fields possible at all.
 */
export function XOAuth2Fields({ value, onChange, idPrefix, hasStoredRefreshToken = false }: {
  value: XOAuth2FormValues;
  onChange: (next: XOAuth2FormValues) => void;
  idPrefix: string;
  hasStoredRefreshToken?: boolean;
}) {
  const { t } = useTranslation();
  const set = (key: keyof XOAuth2FormValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: e.target.value });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div>
        <label htmlFor={`${idPrefix}-tenant`} style={labelStyle}>
          {t("xoauth2.tenant", "Tenant ID")}
        </label>
        <input
          id={`${idPrefix}-tenant`}
          style={inputStyle}
          type="text"
          value={value.tenant}
          onChange={set("tenant")}
          placeholder={DEFAULT_TENANT}
          spellCheck={false}
        />
        <div style={hintStyle}>
          {t("xoauth2.tenantHint", "Your organisation's directory ID, or \"common\" for personal accounts.")}
        </div>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-client-id`} style={labelStyle}>
          {t("xoauth2.clientId", "Application (client) ID")}
        </label>
        <input
          id={`${idPrefix}-client-id`}
          style={inputStyle}
          type="text"
          value={value.clientId}
          onChange={set("clientId")}
          placeholder="00000000-0000-0000-0000-000000000000"
          spellCheck={false}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-refresh-token`} style={labelStyle}>
          {hasStoredRefreshToken
            ? t("xoauth2.refreshTokenStored", "Refresh token (leave blank to keep the stored one)")
            : t("xoauth2.refreshToken", "Refresh token")}
        </label>
        <input
          id={`${idPrefix}-refresh-token`}
          style={inputStyle}
          type="password"
          autoComplete="off"
          value={value.refreshToken}
          onChange={set("refreshToken")}
          spellCheck={false}
        />
        <div style={hintStyle}>
          {t(
            "xoauth2.refreshTokenHint",
            "Pebble exchanges this for a fresh access token before every connection, so you never have to paste one again.",
          )}
        </div>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-client-secret`} style={labelStyle}>
          {t("xoauth2.clientSecret", "Client secret (optional)")}
        </label>
        <input
          id={`${idPrefix}-client-secret`}
          style={inputStyle}
          type="password"
          autoComplete="off"
          value={value.clientSecret}
          onChange={set("clientSecret")}
          spellCheck={false}
        />
        <div style={hintStyle}>
          {t("xoauth2.clientSecretHint", "Only needed if the app is registered as a confidential client.")}
        </div>
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: XOAuth2Status }) {
  const { t } = useTranslation();
  const good = status.imap_uses_token && status.has_refresh_token;
  const minutes =
    status.expires_in_secs === null ? null : Math.round(status.expires_in_secs / 60);

  return (
    <div
      role="status"
      style={{
        padding: "8px 10px",
        borderRadius: "6px",
        fontSize: "12px",
        lineHeight: 1.6,
        backgroundColor: good ? "rgba(34,197,94,0.1)" : "rgba(148,163,184,0.12)",
        border: `1px solid ${good ? "rgba(34,197,94,0.3)" : "rgba(148,163,184,0.25)"}`,
        color: good ? "#22c55e" : "var(--color-text-secondary)",
      }}
    >
      <div>
        {status.imap_uses_token
          ? t("xoauth2.statusImapToken", "IMAP: signing in with an OAuth2 token")
          : t("xoauth2.statusImapPassword", "IMAP: signing in with a password")}
      </div>
      <div>
        {status.smtp_uses_token
          ? t("xoauth2.statusSmtpToken", "SMTP: signing in with an OAuth2 token")
          : t("xoauth2.statusSmtpPassword", "SMTP: signing in with a password")}
      </div>
      {status.tenant && (
        <div>
          {t("xoauth2.statusTenant", "Tenant: {{tenant}}", { tenant: status.tenant })}
        </div>
      )}
      {minutes !== null && status.has_refresh_token && (
        <div>
          {minutes > 0
            ? t("xoauth2.statusExpiresIn", "Token renews in about {{minutes}} min", { minutes })
            : t("xoauth2.statusRenewsNextSync", "Token renews on the next sync")}
        </div>
      )}
    </div>
  );
}

/**
 * Whether the form holds enough to run a token exchange. A refresh token of its
 * own is only required when the account does not already store one, which is
 * what lets a wrong tenant be corrected on its own.
 */
export function canSubmitXOAuth2Form(
  v: XOAuth2FormValues,
  hasStoredRefreshToken: boolean,
): boolean {
  return (
    !!v.tenant.trim() &&
    !!v.clientId.trim() &&
    (hasStoredRefreshToken || !!v.refreshToken.trim())
  );
}

/**
 * Attach or replace OAuth2 refresh material on an existing account. Saving runs
 * a real token exchange, so a success message means IMAP will connect.
 */
export default function XOAuth2Panel({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<XOAuth2FormValues>(emptyXOAuth2Form);
  const [status, setStatus] = useState<XOAuth2Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getXOAuth2Status(accountId)
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        // Show what is actually stored. Prefilling `common` over a stored tenant
        // GUID would silently undo it on the next save, which is how a working
        // account ends up back on the rejected endpoint.
        setForm((prev) => ({
          ...prev,
          tenant: s.tenant ?? prev.tenant,
          clientId: s.client_id ?? prev.clientId,
        }));
      })
      .catch(() => {
        /* Status is advisory; a failure here should not block the form. */
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const hasStoredRefreshToken = status?.has_refresh_token ?? false;
  const canSave = canSubmitXOAuth2Form(form, hasStoredRefreshToken);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await setXOAuth2Refresh({
        accountId,
        tenant: form.tenant.trim(),
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim() || undefined,
        // Left blank, this keeps the token already on the account.
        refreshToken: form.refreshToken.trim() || undefined,
      });
      setSaved(true);
      setForm((prev) => ({ ...prev, refreshToken: "", clientSecret: "" }));
      setStatus(await getXOAuth2Status(accountId));
      // A verified token only helps once something connects with it. The sync
      // worker for a mailbox that has been failing is long finished, so ask for
      // a sync rather than leaving the account idle until the next launch.
      triggerSync(accountId, "manual").catch(() => {
        /* The token is stored either way; the next sync will use it. */
      });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
        {t(
          "xoauth2.description",
          "Sign in to IMAP with an OAuth2 token instead of a password. Required by Microsoft 365, which has disabled basic authentication on IMAP. Your SMTP password is left untouched.",
        )}
      </div>

      {status && <StatusLine status={status} />}

      <XOAuth2Fields
        value={form}
        onChange={setForm}
        idPrefix={`xoauth2-${accountId}`}
        hasStoredRefreshToken={hasStoredRefreshToken}
      />

      <div>
        <button
          type="button"
          disabled={busy || !canSave}
          onClick={() => void save()}
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-bg)",
            color: "var(--color-text-primary)",
            fontSize: "13px",
            cursor: busy || !canSave ? "not-allowed" : "pointer",
            opacity: busy || !canSave ? 0.6 : 1,
          }}
        >
          {busy
            ? t("xoauth2.saving", "Verifying…")
            : t("xoauth2.save", "Save & verify token")}
        </button>
      </div>

      {saved && (
        <div role="status" style={{ fontSize: "12px", color: "#22c55e" }}>
          {t("xoauth2.saved", "Token verified. IMAP will use it from the next sync onwards.")}
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 10px",
            borderRadius: "6px",
            backgroundColor: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "#ef4444",
            fontSize: "12px",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
