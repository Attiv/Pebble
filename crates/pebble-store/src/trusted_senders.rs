use pebble_core::{Result, TrustType, TrustedSender};
use rusqlite::{params, OptionalExtension};

use crate::Store;

fn trust_type_to_str(t: &TrustType) -> &'static str {
    match t {
        TrustType::Images => "images",
        TrustType::All => "all",
    }
}

fn str_to_trust_type(s: &str) -> TrustType {
    match s {
        "all" => TrustType::All,
        _ => TrustType::Images,
    }
}

fn row_to_trusted_sender(row: &rusqlite::Row) -> rusqlite::Result<TrustedSender> {
    Ok(TrustedSender {
        account_id: row.get(0)?,
        email: row.get(1)?,
        trust_type: str_to_trust_type(&row.get::<_, String>(2)?),
        created_at: row.get(3)?,
    })
}

/// Trust is a property of the **sender**, not of the mailbox the mail arrived
/// in.
///
/// It used to be keyed on `(account_id, email)`, which meant the same address
/// had to be trusted once per mailbox — the reader trusted a sender while
/// reading one account and was asked again the next time that sender wrote to
/// another. What a tracking pixel costs does not depend on which of the
/// reader's addresses received it, so the row still records the account that
/// granted the trust (it is what the schema requires), but nothing reads it
/// back to decide.
impl Store {
    pub fn trust_sender(&self, sender: &TrustedSender) -> Result<()> {
        self.with_write(|conn| {
            // One row per sender: an address trusted in a second mailbox is the
            // same decision repeated, not a second, narrower policy.
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "DELETE FROM trusted_senders WHERE email = ?1",
                params![sender.email],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO trusted_senders (account_id, email, trust_type, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    sender.account_id,
                    sender.email,
                    trust_type_to_str(&sender.trust_type),
                    sender.created_at,
                ],
            )?;
            tx.commit()?;
            Ok(())
        })
    }

    pub fn is_trusted_sender(&self, email: &str) -> Result<Option<TrustType>> {
        self.with_read(|conn| {
            // Rows left over from the per-mailbox days can hold more than one
            // level for the same address; the strongest wins, because that is
            // what the reader last asked for.
            let result = conn
                .query_row(
                    "SELECT trust_type FROM trusted_senders WHERE email = ?1
                     ORDER BY CASE trust_type WHEN 'all' THEN 0 ELSE 1 END
                     LIMIT 1",
                    params![email],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            Ok(result.map(|s| str_to_trust_type(&s)))
        })
    }

    pub fn list_trusted_senders(&self) -> Result<Vec<TrustedSender>> {
        self.with_read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT account_id, email, trust_type, created_at
                     FROM trusted_senders
                     ORDER BY email",
            )?;
            let rows = stmt.query_map([], row_to_trusted_sender)?;
            let mut senders = Vec::new();
            for row in rows {
                senders.push(row?);
            }
            Ok(senders)
        })
    }

    pub fn remove_trusted_sender(&self, email: &str) -> Result<()> {
        self.with_write(|conn| {
            conn.execute(
                "DELETE FROM trusted_senders WHERE email = ?1",
                params![email],
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Store;

    fn insert_account(store: &Store, id: &str, email: &str) {
        let now = pebble_core::now_timestamp();
        store
            .insert_account(&pebble_core::Account {
                account_label: None,
                provider_display_name: None,
                id: id.to_string(),
                email: email.to_string(),
                display_name: "Me".to_string(),
                color: None,
                provider: pebble_core::ProviderType::Imap,
                created_at: now,
                updated_at: now,
            })
            .unwrap();
    }

    fn trust(store: &Store, account_id: &str, email: &str, trust_type: TrustType) {
        store
            .trust_sender(&TrustedSender {
                account_id: account_id.to_string(),
                email: email.to_string(),
                trust_type,
                created_at: pebble_core::now_timestamp(),
            })
            .unwrap();
    }

    #[test]
    fn test_trust_sender_crud() {
        let store = Store::open_in_memory().unwrap();
        insert_account(&store, "account-1", "me@example.com");

        trust(
            &store,
            "account-1",
            "trusted@example.com",
            TrustType::Images,
        );

        assert_eq!(
            store.is_trusted_sender("trusted@example.com").unwrap(),
            Some(TrustType::Images)
        );
        assert_eq!(
            store.is_trusted_sender("unknown@example.com").unwrap(),
            None
        );

        let senders = store.list_trusted_senders().unwrap();
        assert_eq!(senders.len(), 1);
        assert_eq!(senders[0].email, "trusted@example.com");

        // Upgrading replaces the row rather than adding a second level.
        trust(&store, "account-1", "trusted@example.com", TrustType::All);
        assert_eq!(
            store.is_trusted_sender("trusted@example.com").unwrap(),
            Some(TrustType::All)
        );
        assert_eq!(store.list_trusted_senders().unwrap().len(), 1);

        store.remove_trusted_sender("trusted@example.com").unwrap();
        assert!(store.list_trusted_senders().unwrap().is_empty());
    }

    #[test]
    fn trusting_a_sender_in_one_mailbox_covers_the_others() {
        let store = Store::open_in_memory().unwrap();
        insert_account(&store, "work", "me@work.example.com");
        insert_account(&store, "home", "me@home.example.com");

        // Trusted while reading work mail...
        trust(&store, "work", "news@example.com", TrustType::All);

        // ...and the same sender writing to the personal mailbox is trusted too.
        assert_eq!(
            store.is_trusted_sender("news@example.com").unwrap(),
            Some(TrustType::All)
        );
    }

    #[test]
    fn removing_a_sender_removes_it_for_every_mailbox() {
        let store = Store::open_in_memory().unwrap();
        insert_account(&store, "work", "me@work.example.com");
        insert_account(&store, "home", "me@home.example.com");

        trust(&store, "work", "news@example.com", TrustType::All);
        store.remove_trusted_sender("news@example.com").unwrap();

        // There is no per-mailbox row left to keep the answer alive elsewhere.
        assert_eq!(store.is_trusted_sender("news@example.com").unwrap(), None);
        assert!(store.list_trusted_senders().unwrap().is_empty());
    }
}
