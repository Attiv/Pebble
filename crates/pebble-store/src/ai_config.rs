use crate::Store;
use pebble_core::{AiConfig, PebbleError, Result};
use rusqlite::params;

impl Store {
    pub(crate) fn save_ai_config_with_conn(
        conn: &rusqlite::Connection,
        config: &AiConfig,
    ) -> Result<()> {
        conn.execute(
            "INSERT INTO ai_config (id, provider_type, config, is_enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                 provider_type = excluded.provider_type,
                 config = excluded.config,
                 is_enabled = excluded.is_enabled,
                 updated_at = excluded.updated_at",
            params![
                config.id,
                config.provider_type,
                config.config,
                config.is_enabled as i32,
                config.created_at,
                config.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn save_ai_config(&self, config: &AiConfig) -> Result<()> {
        self.with_write(|conn| Self::save_ai_config_with_conn(conn, config))
    }

    pub fn get_ai_config(&self) -> Result<Option<AiConfig>> {
        self.with_read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, provider_type, config, is_enabled, created_at, updated_at FROM ai_config WHERE id = 'active'"
            )?;
            let mut rows = stmt.query_map([], |row| {
                Ok(AiConfig {
                    id: row.get(0)?,
                    provider_type: row.get(1)?,
                    config: row.get(2)?,
                    is_enabled: row.get::<_, i32>(3)? != 0,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?;
            match rows.next() {
                Some(Ok(config)) => Ok(Some(config)),
                Some(Err(e)) => Err(PebbleError::Storage(e.to_string())),
                None => Ok(None),
            }
        })
    }

    pub fn compare_exchange_ai_config_blob(
        &self,
        expected: &str,
        replacement: &str,
    ) -> Result<bool> {
        self.with_write(|conn| {
            let rows_affected = conn.execute(
                "UPDATE ai_config
                 SET config = ?1, updated_at = ?2
                 WHERE id = 'active' AND config = ?3",
                params![replacement, pebble_core::now_timestamp(), expected],
            )?;
            Ok(rows_affected == 1)
        })
    }

    pub fn delete_ai_config(&self) -> Result<()> {
        self.with_write(|conn| {
            conn.execute("DELETE FROM ai_config WHERE id = 'active'", [])?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pebble_core::now_timestamp;

    fn config(provider_type: &str, blob: &str) -> AiConfig {
        let now = now_timestamp();
        AiConfig {
            id: "active".to_string(),
            provider_type: provider_type.to_string(),
            config: blob.to_string(),
            is_enabled: true,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn ai_config_round_trips() {
        let store = Store::open_in_memory().unwrap();
        store
            .save_ai_config(&config("openai_compatible", r#"{"model":"m"}"#))
            .unwrap();

        let loaded = store.get_ai_config().unwrap().unwrap();
        assert_eq!(loaded.provider_type, "openai_compatible");
        assert!(loaded.is_enabled);
    }

    #[test]
    fn ai_config_upserts_and_deletes() {
        let store = Store::open_in_memory().unwrap();
        store
            .save_ai_config(&config("openai_compatible", "{}"))
            .unwrap();
        store
            .save_ai_config(&config("generic", r#"{"result_path":"x"}"#))
            .unwrap();
        assert_eq!(
            store.get_ai_config().unwrap().unwrap().provider_type,
            "generic"
        );

        store.delete_ai_config().unwrap();
        assert!(store.get_ai_config().unwrap().is_none());
    }

    /// The whole point of a separate table: configuring one module must never
    /// leak into the other.
    #[test]
    fn ai_config_and_translate_config_are_fully_independent() {
        let store = Store::open_in_memory().unwrap();
        let now = now_timestamp();
        store
            .save_translate_config(&pebble_core::TranslateConfig {
                id: "active".to_string(),
                provider_type: "deepl".to_string(),
                config: "translate-blob".to_string(),
                is_enabled: true,
                created_at: now,
                updated_at: now,
            })
            .unwrap();
        store.save_ai_config(&config("generic", "ai-blob")).unwrap();

        assert_eq!(
            store.get_translate_config().unwrap().unwrap().config,
            "translate-blob"
        );
        assert_eq!(store.get_ai_config().unwrap().unwrap().config, "ai-blob");

        store.delete_ai_config().unwrap();
        assert!(
            store.get_translate_config().unwrap().is_some(),
            "deleting the AI config must not touch the translate config"
        );

        store.delete_translate_config().unwrap();
        assert!(store.get_ai_config().unwrap().is_none());
    }

    #[test]
    fn compare_exchange_ai_config_does_not_overwrite_a_newer_value() {
        let store = Store::open_in_memory().unwrap();
        store.save_ai_config(&config("generic", "legacy")).unwrap();

        assert!(store
            .compare_exchange_ai_config_blob("legacy", "migrated")
            .unwrap());
        assert!(!store
            .compare_exchange_ai_config_blob("legacy", "stale")
            .unwrap());
        assert_eq!(store.get_ai_config().unwrap().unwrap().config, "migrated");
    }

    #[test]
    fn ai_config_rejects_unknown_provider_types() {
        let store = Store::open_in_memory().unwrap();
        assert!(store.save_ai_config(&config("anthropic", "{}")).is_err());
    }
}
