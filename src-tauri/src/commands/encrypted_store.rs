use crate::state::AppState;
use pebble_core::Result;
use pebble_crypto::CryptoService;
use pebble_store::Store;
use std::sync::Arc;
use tokio::sync::OwnedMutexGuard;

pub(crate) const ACCOUNT_AUTH_DATA_PURPOSE: &str = "accounts.auth_data";
pub(crate) const SECURE_USER_DATA_PURPOSE: &str = "secure_user_data.value";
pub(crate) const TRANSLATE_CONFIG_PURPOSE: &str = "translate_config.config";
pub(crate) const ACTIVE_TRANSLATE_CONFIG_ID: &str = "active";

pub(crate) async fn lock_secure_user_data_key(state: &AppState, key: &str) -> OwnedMutexGuard<()> {
    let key_lock = {
        let mut locks = state.secure_user_data_locks.lock().await;
        Arc::clone(
            locks
                .entry(key.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
        )
    };
    key_lock.lock_owned().await
}

pub(crate) fn encrypt_account_auth_data(
    crypto: &CryptoService,
    account_id: &str,
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    crypto.encrypt_for(ACCOUNT_AUTH_DATA_PURPOSE, account_id, plaintext)
}

pub(crate) fn decrypt_account_auth_data(
    crypto: &CryptoService,
    store: &Store,
    account_id: &str,
    encrypted: &[u8],
) -> Result<Vec<u8>> {
    let needs_migration = CryptoService::ciphertext_needs_migration(encrypted);
    let plaintext = crypto.decrypt_for(ACCOUNT_AUTH_DATA_PURPOSE, account_id, encrypted)?;
    if needs_migration {
        let replacement = encrypt_account_auth_data(crypto, account_id, &plaintext)?;
        store.compare_exchange_auth_data(account_id, encrypted, &replacement)?;
    }
    Ok(plaintext)
}

pub(crate) fn load_account_auth_data(
    crypto: &CryptoService,
    store: &Store,
    account_id: &str,
) -> Result<Option<Vec<u8>>> {
    let Some(encrypted) = store.get_auth_data(account_id)? else {
        return Ok(None);
    };
    decrypt_account_auth_data(crypto, store, account_id, &encrypted).map(Some)
}

pub(crate) fn store_account_auth_data(
    crypto: &CryptoService,
    store: &Store,
    account_id: &str,
    plaintext: &[u8],
) -> Result<()> {
    let encrypted = encrypt_account_auth_data(crypto, account_id, plaintext)?;
    store.set_auth_data(account_id, &encrypted)
}

pub(crate) fn encrypt_secure_user_data(
    crypto: &CryptoService,
    key: &str,
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    crypto.encrypt_for(SECURE_USER_DATA_PURPOSE, key, plaintext)
}

pub(crate) fn decrypt_secure_user_data(
    crypto: &CryptoService,
    store: &Store,
    key: &str,
    encrypted: &[u8],
) -> Result<Vec<u8>> {
    let needs_migration = CryptoService::ciphertext_needs_migration(encrypted);
    let plaintext = crypto.decrypt_for(SECURE_USER_DATA_PURPOSE, key, encrypted)?;
    if needs_migration {
        let replacement = encrypt_secure_user_data(crypto, key, &plaintext)?;
        store.compare_exchange_secure_user_data(key, encrypted, &replacement)?;
    }
    Ok(plaintext)
}

pub(crate) fn load_secure_user_data(
    crypto: &CryptoService,
    store: &Store,
    key: &str,
) -> Result<Option<Vec<u8>>> {
    let Some(encrypted) = store.get_secure_user_data(key)? else {
        return Ok(None);
    };
    decrypt_secure_user_data(crypto, store, key, &encrypted).map(Some)
}

pub(crate) fn store_secure_user_data(
    crypto: &CryptoService,
    store: &Store,
    key: &str,
    plaintext: &[u8],
) -> Result<()> {
    let encrypted = encrypt_secure_user_data(crypto, key, plaintext)?;
    store.set_secure_user_data(key, &encrypted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pebble_core::{now_timestamp, Account, ProviderType};

    fn insert_account(store: &Store, id: &str) {
        store
            .insert_account(&Account {
                account_label: None,
                provider_display_name: None,
                id: id.to_string(),
                email: format!("{id}@example.com"),
                display_name: id.to_string(),
                color: None,
                provider: ProviderType::Imap,
                created_at: now_timestamp(),
                updated_at: now_timestamp(),
            })
            .unwrap();
    }

    #[test]
    fn loading_legacy_account_auth_data_lazily_migrates_it_to_v1() {
        let crypto = CryptoService::from_key([9_u8; 32]);
        let store = Store::open_in_memory().unwrap();
        insert_account(&store, "account-1");
        let legacy = crypto.encrypt(b"legacy auth data").unwrap();
        store.set_auth_data("account-1", &legacy).unwrap();

        assert_eq!(
            load_account_auth_data(&crypto, &store, "account-1")
                .unwrap()
                .unwrap(),
            b"legacy auth data"
        );

        let migrated = store.get_auth_data("account-1").unwrap().unwrap();
        assert!(!CryptoService::ciphertext_needs_migration(&migrated));
        assert_eq!(
            crypto
                .decrypt_for(ACCOUNT_AUTH_DATA_PURPOSE, "account-1", &migrated)
                .unwrap(),
            b"legacy auth data"
        );
    }

    #[test]
    fn account_auth_data_cannot_be_moved_between_records() {
        let crypto = CryptoService::from_key([9_u8; 32]);
        let store = Store::open_in_memory().unwrap();
        insert_account(&store, "account-1");
        insert_account(&store, "account-2");
        let encrypted =
            encrypt_account_auth_data(&crypto, "account-1", b"account one secret").unwrap();
        store.set_auth_data("account-2", &encrypted).unwrap();

        assert!(load_account_auth_data(&crypto, &store, "account-2").is_err());
    }

    #[test]
    fn loading_legacy_secure_user_data_lazily_migrates_it_to_v1() {
        let crypto = CryptoService::from_key([9_u8; 32]);
        let store = Store::open_in_memory().unwrap();
        let legacy = crypto.encrypt(b"legacy user data").unwrap();
        store.set_secure_user_data("templates", &legacy).unwrap();

        assert_eq!(
            load_secure_user_data(&crypto, &store, "templates")
                .unwrap()
                .unwrap(),
            b"legacy user data"
        );

        let migrated = store.get_secure_user_data("templates").unwrap().unwrap();
        assert!(!CryptoService::ciphertext_needs_migration(&migrated));
        assert_eq!(
            crypto
                .decrypt_for(SECURE_USER_DATA_PURPOSE, "templates", &migrated)
                .unwrap(),
            b"legacy user data"
        );
    }
}
