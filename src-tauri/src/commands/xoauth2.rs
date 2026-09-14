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
        // The AADSTS code in the body is the only actionable part of a failure.
        return Err(PebbleError::Auth(format!(
            "XOAUTH2 refresh rejected ({status}): {body}"
        )));
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

/// Attach XOAUTH2 refresh material to an account created through the normal
/// manual IMAP flow, then immediately fetch an access token into the IMAP
/// password so the credentials are validated up front rather than at the first
/// sync failure.
#[tauri::command]
pub async fn set_xoauth2_refresh(
    state: State<'_, AppState>,
    account_id: String,
    tenant: String,
    client_id: String,
    client_secret: Option<String>,
    refresh_token: String,
) -> std::result::Result<(), PebbleError> {
    let decrypted = load_account_auth_data(&state.crypto, &state.store, &account_id)?
        .ok_or_else(|| PebbleError::Validation(format!("No auth data for account {account_id}")))?;
    let mut auth: serde_json::Value = serde_json::from_slice(&decrypted)
        .map_err(|e| PebbleError::Internal(format!("Failed to parse auth data: {e}")))?;

    let creds = StoredXOAuth2 {
        tenant,
        client_id,
        client_secret,
        refresh_token,
        // Zero forces a refresh on the very next call, below.
        expires_at: 0,
    };
    auth["xoauth2"] = serde_json::to_value(&creds)
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
    let expires_at = auth
        .get("xoauth2")
        .and_then(|x| x.get("expires_at"))
        .and_then(|v| v.as_i64());

    Ok(XOAuth2Status {
        imap_uses_token: is_token("imap"),
        smtp_uses_token: is_token("smtp"),
        has_refresh_token: auth
            .get("xoauth2")
            .and_then(|x| x.get("refresh_token"))
            .is_some(),
        expires_at,
        expires_in_secs: expires_at.map(|e| e - now_secs()),
    })
}
