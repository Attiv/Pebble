//! Meeting invitations.
//!
//! Read cached or freshly fetched iCalendar payloads and hand the original file
//! to the system calendar when the user chooses Add to Calendar. There is no calendar
//! store here — the reader's calendar owns the meeting, and a copy inside Pebble
//! could only ever disagree with it.

use crate::commands::messages::invitation::read_original_imap_message;
use crate::state::AppState;
use pebble_core::{Attachment, PebbleError};
use pebble_mail::ics::{parse_invite, CalendarInvite, CalendarTime};
use pebble_mail::invitation::calendar_payload;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;
use tracing::{info, warn};

/// A `DTSTART`/`DTEND` as the card needs it.
#[derive(Debug, Serialize)]
pub struct InviteTime {
    /// Seconds since the epoch, only for values the sender anchored to UTC.
    pub utc_epoch: Option<i64>,
    pub tzid: Option<String>,
    /// `YYYY-MM-DDTHH:MM:SS`, or `YYYY-MM-DD` for an all-day event.
    pub local: String,
    pub date_only: bool,
}

/// One invitation, flattened for the reading pane.
#[derive(Debug, Serialize)]
pub struct MeetingInvite {
    /// None when the invitation was fetched without changing the local attachment cache.
    pub attachment_id: Option<String>,
    pub summary: Option<String>,
    pub location: Option<String>,
    pub organizer_name: Option<String>,
    pub organizer_email: Option<String>,
    pub start: Option<InviteTime>,
    pub end: Option<InviteTime>,
    pub all_day: bool,
    pub cancelled: bool,
    /// The organiser repeated the meeting; the card says so rather than
    /// pretending this one occurrence is the whole series.
    pub recurring: bool,
    pub sequence: Option<i64>,
}

impl From<CalendarTime> for InviteTime {
    fn from(time: CalendarTime) -> Self {
        Self {
            utc_epoch: time.utc_epoch,
            tzid: time.tzid,
            local: time.local,
            date_only: time.date_only,
        }
    }
}

impl MeetingInvite {
    fn new(attachment_id: Option<&str>, invite: CalendarInvite) -> Self {
        Self {
            attachment_id: attachment_id.map(str::to_owned),
            cancelled: invite.is_cancelled(),
            all_day: invite.is_all_day(),
            recurring: invite.recurrence.is_some(),
            summary: invite.summary,
            location: invite.location,
            organizer_name: invite.organizer_name,
            organizer_email: invite.organizer_email,
            start: invite.start.map(InviteTime::from),
            end: invite.end.map(InviteTime::from),
            sequence: invite.sequence,
        }
    }
}

/// The message's calendar attachment, if it has one.
fn calendar_attachment(
    state: &AppState,
    message_id: &str,
) -> std::result::Result<Option<Attachment>, PebbleError> {
    let attachments = state.store.list_attachments_by_message(message_id)?;
    Ok(attachments.into_iter().find(is_calendar))
}

fn is_calendar(attachment: &Attachment) -> bool {
    let mime = attachment.mime_type.to_ascii_lowercase();
    mime.starts_with("text/calendar")
        || mime.starts_with("application/ics")
        || attachment.filename.to_ascii_lowercase().ends_with(".ics")
}

async fn load_invitation(
    state: &AppState,
    message_id: &str,
    fetch_if_missing: bool,
) -> Result<Option<(Option<String>, Vec<u8>)>, PebbleError> {
    if let Some(attachment) = calendar_attachment(state, message_id)? {
        if let Some(bytes) = attachment
            .local_path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
        {
            return Ok(Some((Some(attachment.id), bytes)));
        }
        warn!(
            message_id,
            "A calendar attachment has no readable file on disk"
        );
    }
    if !fetch_if_missing {
        return Ok(None);
    }

    let (message, raw) = read_original_imap_message(state, message_id).await?;
    let payload = tokio::task::spawn_blocking(move || {
        calendar_payload(&raw, message.message_id_header.as_deref())
    })
    .await
    .map_err(|error| PebbleError::Internal(format!("Invitation parsing task failed: {error}")))??;
    Ok(payload.map(|text| (None, text.into_bytes())))
}

/// Read the invitation carried by a message.
///
/// `None` covers both "this message is not an invitation" and "the payload
/// could not be read" — the reading pane shows no card in either case, and the
/// mail itself stays readable.
/// `fetch_if_missing` allows an IMAP read for old Outlook-link messages; it never rewrites mail.
#[tauri::command]
pub async fn get_message_meeting_invite(
    state: State<'_, AppState>,
    message_id: String,
    fetch_if_missing: Option<bool>,
) -> std::result::Result<Option<MeetingInvite>, PebbleError> {
    let Some((attachment_id, bytes)) =
        load_invitation(&state, &message_id, fetch_if_missing.unwrap_or(false)).await?
    else {
        return Ok(None);
    };
    let Some(invite) = parse_invite(&String::from_utf8_lossy(&bytes)) else {
        warn!(message_id, "A calendar attachment holds no VEVENT");
        return Ok(None);
    };
    Ok(Some(MeetingInvite::new(attachment_id.as_deref(), invite)))
}

/// Hand the invitation to the system calendar.
///
/// Stage private original bytes, so the calendar never receives a profile-owned attachment path.
#[tauri::command]
pub async fn add_message_meeting_invite_to_calendar(
    state: State<'_, AppState>,
    message_id: String,
) -> std::result::Result<(), PebbleError> {
    let (_, bytes) = load_invitation(&state, &message_id, true)
        .await?
        .ok_or_else(|| {
            PebbleError::Validation(format!("Message {message_id} carries no invitation"))
        })?;
    let target = stage_invitation(&bytes)?;

    open_with_system(&target)
        .map_err(|e| PebbleError::Internal(format!("Could not open the calendar: {e}")))?;

    info!(
        message_id,
        "Handed a meeting invitation to the system calendar"
    );
    Ok(())
}

fn stage_invitation(bytes: &[u8]) -> Result<PathBuf, PebbleError> {
    let invite = parse_invite(&String::from_utf8_lossy(bytes))
        .ok_or_else(|| PebbleError::Validation("No readable calendar event found".into()))?;
    if invite.is_cancelled() {
        return Err(PebbleError::Validation(
            "This invitation has been cancelled; reopen the message for current details".into(),
        ));
    }
    let target = std::env::temp_dir().join(format!("pebble-invite-{}.ics", pebble_core::new_id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&target).map_err(|error| {
        PebbleError::Internal(format!("Could not stage the invitation: {error}"))
    })?;
    if let Err(error) = file.write_all(bytes) {
        drop(file);
        let _ = std::fs::remove_file(&target);
        return Err(PebbleError::Internal(format!(
            "Could not write the invitation: {error}"
        )));
    }
    Ok(target)
}

fn open_with_system(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(path);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(path);
        command
    };

    let status = command.status()?;
    if !status.success() {
        return Err(std::io::Error::other(format!(
            "the opener exited with {status}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stages_the_original_invitation_privately_without_guessing_event_fields() {
        let bytes = b"BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:original@example.com\r\nDTSTART;TZID=Singapore Standard Time:20261104T100000\r\nSUMMARY:Review\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let path = stage_invitation(bytes).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::remove_file(path).unwrap();
        let cancelled = String::from_utf8_lossy(bytes).replace("METHOD:REQUEST", "METHOD:CANCEL");
        assert!(stage_invitation(cancelled.as_bytes()).is_err());
        assert!(stage_invitation(b"not a calendar event").is_err());
    }
}
