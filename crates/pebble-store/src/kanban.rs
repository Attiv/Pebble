use pebble_core::{KanbanCard, KanbanColumn, Result};
use rusqlite::params;

use crate::Store;

fn column_to_str(col: &KanbanColumn) -> &'static str {
    match col {
        KanbanColumn::Todo => "todo",
        KanbanColumn::Waiting => "waiting",
        KanbanColumn::Done => "done",
    }
}

fn str_to_column(s: &str) -> KanbanColumn {
    match s {
        "waiting" => KanbanColumn::Waiting,
        "done" => KanbanColumn::Done,
        _ => KanbanColumn::Todo,
    }
}

fn row_to_kanban_card(row: &rusqlite::Row) -> rusqlite::Result<KanbanCard> {
    Ok(KanbanCard {
        message_id: row.get(0)?,
        column: str_to_column(&row.get::<_, String>(1)?),
        position: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

impl Store {
    pub(crate) fn upsert_kanban_card_with_conn(
        conn: &rusqlite::Connection,
        card: &KanbanCard,
    ) -> Result<()> {
        conn.execute(
            "INSERT INTO kanban_cards (message_id, column_name, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(message_id) DO UPDATE SET
               column_name = excluded.column_name,
               position = excluded.position,
               updated_at = excluded.updated_at",
            params![
                card.message_id,
                column_to_str(&card.column),
                card.position,
                card.created_at,
                card.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn upsert_kanban_card(&self, card: &KanbanCard) -> Result<()> {
        self.with_write(|conn| Self::upsert_kanban_card_with_conn(conn, card))
    }

    /// List kanban cards, optionally narrowed to a single column and/or account.
    ///
    /// `kanban_cards` only stores `message_id`, so the account filter has to go
    /// through `messages`. A subquery keeps the projection unchanged and avoids
    /// an ambiguous `account_id` in the selected columns.
    pub fn list_kanban_cards(
        &self,
        column: Option<&KanbanColumn>,
        account_id: Option<&str>,
    ) -> Result<Vec<KanbanCard>> {
        let mut sql = String::from(
            "SELECT message_id, column_name, position, created_at, updated_at FROM kanban_cards",
        );
        let mut clauses: Vec<String> = Vec::new();
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(col) = column {
            values.push(Box::new(column_to_str(col).to_string()));
            clauses.push(format!("column_name = ?{}", values.len()));
        }
        if let Some(account) = account_id.filter(|id| !id.is_empty()) {
            values.push(Box::new(account.to_string()));
            clauses.push(format!(
                "message_id IN (SELECT id FROM messages WHERE account_id = ?{})",
                values.len()
            ));
        }
        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }
        sql.push_str(" ORDER BY position ASC");

        self.with_read(|conn| {
            let mut stmt = conn.prepare(&sql)?;
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                values.iter().map(|value| value.as_ref()).collect();
            let rows = stmt.query_map(params_ref.as_slice(), row_to_kanban_card)?;
            let mut cards = Vec::new();
            for row in rows {
                cards.push(row?);
            }
            Ok(cards)
        })
    }

    pub fn move_kanban_card(
        &self,
        message_id: &str,
        column: &KanbanColumn,
        position: i32,
    ) -> Result<()> {
        self.with_write(|conn| {
            let now = pebble_core::now_timestamp();
            conn.execute(
                "UPDATE kanban_cards SET column_name = ?1, position = ?2, updated_at = ?3
                 WHERE message_id = ?4",
                params![column_to_str(column), position, now, message_id],
            )?;
            Ok(())
        })
    }

    pub fn delete_kanban_card(&self, message_id: &str) -> Result<()> {
        self.with_write(|conn| {
            conn.execute(
                "DELETE FROM kanban_cards WHERE message_id = ?1",
                params![message_id],
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Store;

    fn setup_store_with_message() -> (Store, String) {
        let store = Store::open_in_memory().unwrap();
        let now = pebble_core::now_timestamp();
        let account = pebble_core::Account {
            account_label: None,
            provider_display_name: None,
            id: pebble_core::new_id(),
            email: "test@example.com".to_string(),
            display_name: "Test".to_string(),
            color: None,
            provider: pebble_core::ProviderType::Imap,
            created_at: now,
            updated_at: now,
        };
        store.insert_account(&account).unwrap();
        let folder = pebble_core::Folder {
            id: pebble_core::new_id(),
            account_id: account.id.clone(),
            remote_id: "INBOX".to_string(),
            name: "Inbox".to_string(),
            folder_type: pebble_core::FolderType::Folder,
            role: Some(pebble_core::FolderRole::Inbox),
            parent_id: None,
            color: None,
            is_system: true,
            sort_order: 0,
        };
        store.insert_folder(&folder).unwrap();
        let msg_id = pebble_core::new_id();
        let msg = pebble_core::Message {
            id: msg_id.clone(),
            account_id: account.id.clone(),
            remote_id: "1".to_string(),
            message_id_header: None,
            in_reply_to: None,
            references_header: None,
            thread_id: None,
            subject: "Test".to_string(),
            snippet: "Test snippet".to_string(),
            from_address: "sender@example.com".to_string(),
            from_name: "Sender".to_string(),
            to_list: vec![],
            cc_list: vec![],
            bcc_list: vec![],
            body_text: "body".to_string(),
            body_html_raw: "<p>body</p>".to_string(),
            has_attachments: false,
            is_read: false,
            is_starred: false,
            is_draft: false,
            date: now,
            remote_version: None,
            is_deleted: false,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        store
            .insert_message(&msg, std::slice::from_ref(&folder.id))
            .unwrap();
        (store, msg_id)
    }

    #[test]
    fn test_kanban_upsert_and_list() {
        let (store, msg_id) = setup_store_with_message();
        let now = pebble_core::now_timestamp();
        let card = KanbanCard {
            message_id: msg_id.clone(),
            column: KanbanColumn::Todo,
            position: 0,
            created_at: now,
            updated_at: now,
        };
        store.upsert_kanban_card(&card).unwrap();

        let all = store.list_kanban_cards(None, None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].message_id, msg_id);
        assert_eq!(all[0].column, KanbanColumn::Todo);

        let todos = store
            .list_kanban_cards(Some(&KanbanColumn::Todo), None)
            .unwrap();
        assert_eq!(todos.len(), 1);

        let waiting = store
            .list_kanban_cards(Some(&KanbanColumn::Waiting), None)
            .unwrap();
        assert_eq!(waiting.len(), 0);

        // Upsert should update
        let card2 = KanbanCard {
            message_id: msg_id.clone(),
            column: KanbanColumn::Done,
            position: 1,
            created_at: now,
            updated_at: now + 1,
        };
        store.upsert_kanban_card(&card2).unwrap();
        let all = store.list_kanban_cards(None, None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].column, KanbanColumn::Done);
    }

    #[test]
    fn test_kanban_move() {
        let (store, msg_id) = setup_store_with_message();
        let now = pebble_core::now_timestamp();
        let card = KanbanCard {
            message_id: msg_id.clone(),
            column: KanbanColumn::Todo,
            position: 0,
            created_at: now,
            updated_at: now,
        };
        store.upsert_kanban_card(&card).unwrap();
        store
            .move_kanban_card(&msg_id, &KanbanColumn::Waiting, 5)
            .unwrap();

        let cards = store
            .list_kanban_cards(Some(&KanbanColumn::Waiting), None)
            .unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].position, 5);
    }

    #[test]
    fn test_kanban_delete() {
        let (store, msg_id) = setup_store_with_message();
        let now = pebble_core::now_timestamp();
        let card = KanbanCard {
            message_id: msg_id.clone(),
            column: KanbanColumn::Todo,
            position: 0,
            created_at: now,
            updated_at: now,
        };
        store.upsert_kanban_card(&card).unwrap();
        store.delete_kanban_card(&msg_id).unwrap();

        let all = store.list_kanban_cards(None, None).unwrap();
        assert_eq!(all.len(), 0);
    }

    /// Insert a second account with one message (no folder needed — the account
    /// filter only consults `messages.account_id`). Returns the new ids.
    fn insert_other_account_message(store: &Store) -> (String, String) {
        let now = pebble_core::now_timestamp();
        let account = pebble_core::Account {
            account_label: None,
            provider_display_name: None,
            id: pebble_core::new_id(),
            email: "other@example.com".to_string(),
            display_name: "Other".to_string(),
            color: None,
            provider: pebble_core::ProviderType::Imap,
            created_at: now,
            updated_at: now,
        };
        store.insert_account(&account).unwrap();

        let msg_id = pebble_core::new_id();
        let msg = pebble_core::Message {
            id: msg_id.clone(),
            account_id: account.id.clone(),
            remote_id: "1".to_string(),
            message_id_header: None,
            in_reply_to: None,
            references_header: None,
            thread_id: None,
            subject: "Test".to_string(),
            snippet: "Test snippet".to_string(),
            from_address: "sender@example.com".to_string(),
            from_name: "Sender".to_string(),
            to_list: vec![],
            cc_list: vec![],
            bcc_list: vec![],
            body_text: "body".to_string(),
            body_html_raw: "<p>body</p>".to_string(),
            has_attachments: false,
            is_read: false,
            is_starred: false,
            is_draft: false,
            date: now,
            remote_version: None,
            is_deleted: false,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        };
        store.insert_message(&msg, &[]).unwrap();

        (account.id, msg_id)
    }

    #[test]
    fn list_kanban_cards_filters_by_account() {
        let (store, first_msg_id) = setup_store_with_message();
        let first_account_id = store.list_accounts().unwrap()[0].id.clone();
        let (other_account_id, other_msg_id) = insert_other_account_message(&store);

        let now = pebble_core::now_timestamp();
        for message_id in [&first_msg_id, &other_msg_id] {
            store
                .upsert_kanban_card(&KanbanCard {
                    message_id: message_id.clone(),
                    column: KanbanColumn::Todo,
                    position: 0,
                    created_at: now,
                    updated_at: now,
                })
                .unwrap();
        }

        // Unscoped is the explicit "all accounts" board and must show both.
        assert_eq!(store.list_kanban_cards(None, None).unwrap().len(), 2);

        let mine = store
            .list_kanban_cards(None, Some(&first_account_id))
            .unwrap();
        assert_eq!(
            mine.len(),
            1,
            "another account's card leaked into the board"
        );
        assert_eq!(mine[0].message_id, first_msg_id);

        let theirs = store
            .list_kanban_cards(None, Some(&other_account_id))
            .unwrap();
        assert_eq!(theirs.len(), 1);
        assert_eq!(theirs[0].message_id, other_msg_id);

        // Column and account filters compose.
        assert_eq!(
            store
                .list_kanban_cards(Some(&KanbanColumn::Todo), Some(&first_account_id))
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            store
                .list_kanban_cards(Some(&KanbanColumn::Waiting), Some(&first_account_id))
                .unwrap()
                .len(),
            0
        );
    }
}
