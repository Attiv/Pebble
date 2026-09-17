//! XOAUTH2 support for manually configured IMAP accounts.
//!
//! Microsoft 365 disables basic authentication on IMAP, so an IMAP account
//! there must authenticate with SASL XOAUTH2 using an OAuth2 access token.
//! Access tokens live for about an hour, which makes a hand-pasted token
//! useless in practice; this module stores the refresh token alongside the
//! account credentials and swaps a fresh access token into the IMAP password
//! before every connection.
//!
//! SMTP is deliberately left alone.  Microsoft's basic-auth retirement did not
//! cover SMTP AUTH, so the same account commonly needs XOAUTH2 on IMAP while
//! still accepting an ordinary password (or app password) on SMTP — and
//! overwriting the SMTP password with an IMAP-scoped token would break sending.

use pebble_core::{HttpProxyConfig, PebbleError};
use pebble_crypto::CryptoService;
use pebble_oauth::{build_http_client, OAuthNetworkConfig};
use pebble_store::Store;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::encrypted_store::{load_account_auth_data, store_account_auth_data};
use crate::state::AppState;

/// Refresh a token this many seconds before it actually expires.
const REFRESH_SKEW_SECS: i64 = 300;

/// Refresh material for an XOAUTH2-authenticated IMAP account, stored under the
/// `xoauth2` key of the account's encrypted auth blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredXOAuth2 {
    /// Directory to authenticate against: a tenant GUID, or `common`.
    pub tenant: String,
    pub client_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    pub refresh_token: String,
    /// Unix seconds at which the current access token expires.
    #[serde(default)]
    pub expires_at: i64,
}

impl StoredXOAuth2 {
    fn token_url(&self) -> String {
        format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            self.tenant
        )
    }

    fn needs_refresh(&self) -> bool {
        self.expires_at - now_secs() < REFRESH_SKEW_SECS
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Say what to change when Entra rejects a refresh.
///
/// The AADSTS code is the only actionable part of the response body, but it
/// names a symptom ("the application is not multi-tenant") rather than the
/// setting that causes it, so map the handful of codes a person can actually
/// fix onto the field they live in.
fn rejection_hint(body: &str) -> Option<&'static str> {
    let code = |c: &str| body.contains(c);
    if code("AADSTS50194") {
        Some(
            "The app registration is single-tenant, so \"common\" cannot be used. Set Tenant ID \
             to the directory (tenant) ID of the organisation that owns the mailbox.",
        )
    } else if code("AADSTS700016") {
        Some(
            "That app registration does not exist in the tenant named by Tenant ID. Check the \
             Tenant ID and the Application (client) ID.",
        )
    } else if code("AADSTS7000215") || code("AADSTS7000218") {
        Some(
            "The token endpoint rejected the client credentials. Check the client secret, or \
             leave it blank if the app is registered as a public client.",
        )
    } else if code("AADSTS70008") || code("AADSTS700082") || code("AADSTS700084") {
        Some("The refresh token has expired or been revoked. Sign in again to get a new one.")
    } else {
        None
    }
}

/// Refresh the account's access token when it is close to expiry and write the
/// new one into the `imap` password field.
///
/// A no-op for accounts without an `xoauth2` block, so callers can invoke it
/// unconditionally before connecting.
pub(crate) async fn ensure_fresh_xoauth2(
    crypto: &CryptoService,
    store: &Store,
    account_id: &str,
    proxy: Option<HttpProxyConfig>,
) -> std::result::Result<(), PebbleError> {
    let Some(decrypted) = load_account_auth_data(crypto, store, account_id)? else {
        return Ok(());
    };
    let mut auth: serde_json::Value = serde_json::from_slice(&decrypted)
        .map_err(|e| PebbleError::Internal(format!("Failed to parse auth data: {e}")))?;

    let Some(raw) = auth.get("xoauth2").cloned() else {
        return Ok(());
    };
    let mut creds: StoredXOAuth2 = serde_json::from_value(raw)
        .map_err(|e| PebbleError::Internal(format!("Failed to parse xoauth2 block: {e}")))?;

    if !creds.needs_refresh() {
        return Ok(());
    }

    let client = build_http_client(&OAuthNetworkConfig { proxy })
        .map_err(|e| PebbleError::OAuth(format!("Failed to build HTTP client: {e}")))?;

    // No `scope` parameter: a refresh_token grant can only return scopes that
    // were already consented to, and asking for more fails with AADSTS65001.
    let mut form = vec![
        ("grant_type", "refresh_token".to_string()),
        ("client_id", creds.client_id.clone()),
        ("refresh_token", creds.refresh_token.clone()),
    ];
    if let Some(secret) = creds.client_secret.as_deref().filter(|s| !s.is_empty()) {
        form.push(("client_secret", secret.to_string()));
    }

    let response = client
        .post(creds.token_url())
        .form(&form)
        .send()
        .await
        .map_err(|e| PebbleError::OAuth(format!("XOAUTH2 refresh request failed: {e}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| PebbleError::OAuth(format!("XOAUTH2 refresh read failed: {e}")))?;
    if !status.is_success() {
        // The AADSTS code in the body is the only actionable part of a failure,
        // but on its own it does not say which field of the form to change.
        let mut message = format!("XOAUTH2 refresh rejected ({status}): {body}");
        if let Some(hint) = rejection_hint(&body) {
            message.push_str("\n\n");
            message.push_str(hint);
        }
        return Err(PebbleError::Auth(message));
    }

    let token: TokenResponse = serde_json::from_str(&body)
        .map_err(|e| PebbleError::OAuth(format!("Malformed token response: {e}")))?;

    creds.expires_at = now_secs() + token.expires_in.unwrap_or(3600);
    // Entra rotates the refresh token on most flows; keep the old one if it does not.
    if let Some(rt) = token.refresh_token {
        creds.refresh_token = rt;
    }

    let Some(imap) = auth.get_mut("imap") else {
        return Err(PebbleError::Internal(
            "Account has no imap section to hold the access token".into(),
        ));
    };
    imap["password"] = serde_json::Value::String(token.access_token);

    auth["xoauth2"] = serde_json::to_value(&creds)
        .map_err(|e| PebbleError::Internal(format!("Failed to serialize xoauth2 block: {e}")))?;

    let bytes = serde_json::to_vec(&auth)
        .map_err(|e| PebbleError::Internal(format!("Failed to serialize auth data: {e}")))?;
    store_account_auth_data(crypto, store, account_id, &bytes)
}

/// Keep what the caller supplied, and fall back to what is already stored when
/// they left the field blank. Without this a form that only corrects one field
/// (say a wrong tenant) would have to be re-filled with a fresh refresh token,
/// which is the one value a person cannot produce from memory.
fn pick(
    supplied: &str,
    stored: Option<&str>,
    field: &str,
) -> std::result::Result<String, PebbleError> {
    let supplied = supplied.trim();
    if !supplied.is_empty() {
        return Ok(supplied.to_string());
    }
    stored
        .map(str::to_string)
        .ok_or_else(|| PebbleError::Validation(format!("{field} is required")))
}

/// Attach XOAUTH2 refresh material to an account created through the normal
/// manual IMAP flow, then immediately fetch an access token into the IMAP
/// password so the credentials are validated up front rather than at the first
/// sync failure.
///
/// Fields left blank keep whatever is stored, so an existing account can have
/// its tenant or client ID corrected without re-pasting an unexpired refresh
/// token.
#[tauri::command]
pub async fn set_xoauth2_refresh(
    state: State<'_, AppState>,
    account_id: String,
    tenant: Option<String>,
    client_id: String,
    client_secret: Option<String>,
    refresh_token: Option<String>,
) -> std::result::Result<(), PebbleError> {
    let decrypted = load_account_auth_data(&state.crypto, &state.store, &account_id)?
        .ok_or_else(|| PebbleError::Validation(format!("No auth data for account {account_id}")))?;
    let mut auth: serde_json::Value = serde_json::from_slice(&decrypted)
        .map_err(|e| PebbleError::Internal(format!("Failed to parse auth data: {e}")))?;

    let stored: Option<StoredXOAuth2> = auth
        .get("xoauth2")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| PebbleError::Internal(format!("Failed to parse xoauth2 block: {e}")))?;
    let old = stored.as_ref();

    let credentials = StoredXOAuth2 {
        // A form that has not been touched sends `common`, which is the right
        // default for a new account and a no-op for one that already stores a
        // tenant GUID.
        tenant: pick(
            tenant.as_deref().unwrap_or_default(),
            old.map(|s| s.tenant.as_str()),
            "Tenant ID",
        )?,
        client_id: pick(
            &client_id,
            old.map(|s| s.client_id.as_str()),
            "Application (client) ID",
        )?,
        client_secret: client_secret
            .filter(|s| !s.trim().is_empty())
            .or_else(|| old.and_then(|s| s.client_secret.clone())),
        refresh_token: pick(
            refresh_token.as_deref().unwrap_or_default(),
            old.map(|s| s.refresh_token.as_str()),
            "Refresh token",
        )?,
        // Zero forces a refresh on the very next call, below.
        expires_at: 0,
    };
    auth["xoauth2"] = serde_json::to_value(&credentials)
        .map_err(|e| PebbleError::Internal(format!("Failed to serialize xoauth2 block: {e}")))?;

    let bytes = serde_json::to_vec(&auth)
        .map_err(|e| PebbleError::Internal(format!("Failed to serialize auth data: {e}")))?;
    store_account_auth_data(&state.crypto, &state.store, &account_id, &bytes)?;

    ensure_fresh_xoauth2(&state.crypto, &state.store, &account_id, None).await
}

/// Report how an account currently authenticates, so the XOAUTH2 wiring can be
/// checked without decrypting the store by hand.
#[derive(Debug, Serialize)]
pub struct XOAuth2Status {
    pub imap_uses_token: bool,
    pub smtp_uses_token: bool,
    pub has_refresh_token: bool,
    pub expires_at: Option<i64>,
    pub expires_in_secs: Option<i64>,
    /// The tenant the next refresh will actually be sent to. Reported because a
    /// wrong one only ever shows up later, as an AADSTS error on a sync.
    pub tenant: Option<String>,
    pub client_id: Option<String>,
    pub has_client_secret: bool,
}

#[tauri::command]
pub async fn get_xoauth2_status(
    state: State<'_, AppState>,
    account_id: String,
) -> std::result::Result<XOAuth2Status, PebbleError> {
    let decrypted = load_account_auth_data(&state.crypto, &state.store, &account_id)?
        .ok_or_else(|| PebbleError::Validation(format!("No auth data for account {account_id}")))?;
    let auth: serde_json::Value = serde_json::from_slice(&decrypted)
        .map_err(|e| PebbleError::Internal(format!("Failed to parse auth data: {e}")))?;

    let is_token = |section: &str| {
        auth.get(section)
            .and_then(|s| s.get("password"))
            .and_then(|p| p.as_str())
            .is_some_and(pebble_mail::imap::looks_like_access_token)
    };
    let xoauth2 = auth.get("xoauth2");
    let expires_at = xoauth2
        .and_then(|x| x.get("expires_at"))
        .and_then(|v| v.as_i64());
    let stored = |key: &str| {
        xoauth2
            .and_then(|x| x.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };

    Ok(XOAuth2Status {
        imap_uses_token: is_token("imap"),
        smtp_uses_token: is_token("smtp"),
        has_refresh_token: stored("refresh_token").is_some(),
        tenant: stored("tenant"),
        client_id: stored("client_id"),
        has_client_secret: stored("client_secret").is_some(),
        expires_at,
        expires_in_secs: expires_at.map(|e| e - now_secs()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_prefers_what_the_form_sent() {
        assert_eq!(pick("new", Some("old"), "Tenant ID").unwrap(), "new");
        assert_eq!(pick("  spaced  ", None, "Tenant ID").unwrap(), "spaced");
    }

    #[test]
    fn pick_falls_back_to_what_is_stored() {
        assert_eq!(pick("", Some("old"), "Tenant ID").unwrap(), "old");
        assert_eq!(pick("   ", Some("old"), "Tenant ID").unwrap(), "old");
    }

    #[test]
    fn pick_reports_the_field_that_is_missing() {
        let err = pick("", None, "Refresh token").unwrap_err();
        assert!(
            err.to_string().contains("Refresh token"),
            "error should name the field, got: {err}"
        );
    }

    #[test]
    fn a_single_tenant_app_points_at_the_tenant_field() {
        let body = r#"{"error":"invalid_request","error_description":"AADSTS50194: Application '467a4c64' is not configured as a multi-tenant application. Usage of the /common endpoint is not supported."}"#;
        let hint = rejection_hint(body).expect("50194 should be explained");
        assert!(hint.contains("Tenant ID"), "got: {hint}");
    }

    #[test]
    fn an_unrelated_error_gets_no_invented_advice() {
        assert!(rejection_hint(
            r#"{"error":"invalid_request","error_description":"AADSTS9002313"}"#
        )
        .is_none());
    }
}
