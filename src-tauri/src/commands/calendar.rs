//! Meeting invitations.
//!
//! An invitation is a message with an iCalendar payload attached, and this
//! module is the whole of Pebble's calendar support: read the event out of that
//! payload so the reader can see what is being proposed, and hand the file to
//! the system calendar when they accept it. There is deliberately no calendar
//! store here — the reader's calendar owns the meeting, and a copy inside Pebble
//! could only ever disagree with it.

use crate::state::AppState;
use pebble_core::{Attachment, PebbleError};
use pebble_mail::ics::{parse_invite, CalendarInvite, CalendarTime};
use serde::Serialize;
use std::path::Path;
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
    pub attachment_id: String,
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
    fn new(attachment_id: &str, invite: CalendarInvite) -> Self {
        Self {
            attachment_id: attachment_id.to_string(),
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

fn read_invite(attachment: &Attachment) -> Option<String> {
    let path = attachment.local_path.as_ref()?;
    let bytes = std::fs::read(path).ok()?;
    // iCalendar is UTF-8 by definition; a sender that got the encoding wrong is
    // still worth showing rather than dropping the invitation.
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Read the invitation carried by a message.
///
/// `None` covers both "this message is not an invitation" and "the payload
/// could not be read" — the reading pane shows no card in either case, and the
/// mail itself stays readable.
#[tauri::command]
pub async fn get_message_meeting_invite(
    state: State<'_, AppState>,
    message_id: String,
) -> std::result::Result<Option<MeetingInvite>, PebbleError> {
    let Some(attachment) = calendar_attachment(&state, &message_id)? else {
        return Ok(None);
    };
    let Some(text) = read_invite(&attachment) else {
        warn!(
            message_id,
            "A calendar attachment has no readable file on disk"
        );
        return Ok(None);
    };
    let Some(invite) = parse_invite(&text) else {
        warn!(message_id, "A calendar attachment holds no VEVENT");
        return Ok(None);
    };
    Ok(Some(MeetingInvite::new(&attachment.id, invite)))
}

/// Hand the invitation to the system calendar.
///
/// The file is copied out of the profile first: opening the stored copy would
/// put a path owned by Pebble in front of another application, and a cleanup
/// pass could remove it underneath the calendar while it reads.
#[tauri::command]
pub async fn add_message_meeting_invite_to_calendar(
    state: State<'_, AppState>,
    message_id: String,
) -> std::result::Result<(), PebbleError> {
    let attachment = calendar_attachment(&state, &message_id)?.ok_or_else(|| {
        PebbleError::Validation(format!("Message {message_id} carries no invitation"))
    })?;
    let source = attachment
        .local_path
        .as_ref()
        .ok_or_else(|| PebbleError::Internal("Invitation file is not available".to_string()))?;

    let target = std::env::temp_dir().join(format!("pebble-invite-{}.ics", attachment.id));
    std::fs::copy(source, &target)
        .map_err(|e| PebbleError::Internal(format!("Could not stage the invitation: {e}")))?;

    open_with_system(&target)
        .map_err(|e| PebbleError::Internal(format!("Could not open the calendar: {e}")))?;

    info!(
        message_id,
        "Handed a meeting invitation to the system calendar"
    );
    Ok(())
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
