use std::collections::BTreeSet;

use mail_parser::{Message, MessageParser, MessagePart, MimeHeaders, PartType};
use pebble_core::{PebbleError, Result};
use serde::Serialize;

const MAX_EVENTS: usize = 10;
const MAX_FIELD_CHARS: usize = 512;

#[derive(Debug, Default, Serialize)]
pub struct InvitationEventTiming {
    // Preserve the whole property, including TZID/VALUE parameters; do not guess a timezone.
    pub start: Option<String>,
    pub end: Option<String>,
    pub duration: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct InvitationDiagnostic {
    pub mime_types: Vec<String>,
    pub calendar_parts: usize,
    pub methods: Vec<String>,
    pub events: Vec<InvitationEventTiming>,
    pub has_outlook_link: bool,
    pub has_tnef: bool,
    pub incomplete: bool,
}

fn parse_original_message<'a>(
    raw: &'a [u8],
    expected_message_id: Option<&str>,
) -> Result<Message<'a>> {
    let message = MessageParser::default()
        .parse(raw)
        .ok_or_else(|| PebbleError::Validation("Could not parse the original message".into()))?;
    if let Some(expected) = expected_message_id {
        if message.message_id()
            != Some(
                expected
                    .trim()
                    .trim_start_matches('<')
                    .trim_end_matches('>'),
            )
        {
            return Err(PebbleError::Validation(
                "Message identity changed; sync this mailbox and retry".into(),
            ));
        }
    }
    Ok(message)
}

fn is_calendar_part(part: &MessagePart<'_>) -> bool {
    let mime_type = part
        .content_type()
        .map(|ct| format!("{}/{}", ct.ctype(), ct.subtype().unwrap_or("")))
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        mime_type.as_str(),
        "text/calendar" | "application/ics" | "application/icalendar"
    ) || part
        .attachment_name()
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".ics"))
}

/// Read the original iCalendar payload, preserving UID, attendees and timezone definitions.
pub fn calendar_payload(raw: &[u8], expected_message_id: Option<&str>) -> Result<Option<String>> {
    let message = parse_original_message(raw, expected_message_id)?;
    for part in &message.parts {
        if !is_calendar_part(part) || matches!(part.body, PartType::Message(_)) {
            continue;
        }
        if part.is_encoding_problem {
            return Err(PebbleError::Validation(
                "Calendar payload could not be decoded".into(),
            ));
        }
        return part
            .text_contents()
            .map(|text| Some(text.to_owned()))
            .ok_or_else(|| {
                PebbleError::Validation("Calendar payload is not readable text".into())
            });
    }
    Ok(None)
}

/// Inspect decoded MIME parts locally, without returning mail bodies, addresses or meeting links.
pub fn inspect_meeting_invitation(
    raw: &[u8],
    expected_message_id: Option<&str>,
) -> Result<InvitationDiagnostic> {
    let message = parse_original_message(raw, expected_message_id)?;

    let mut report = InvitationDiagnostic::default();
    let mut mime_types = BTreeSet::new();
    for part in &message.parts {
        let mime_type = part
            .content_type()
            .map(|ct| format!("{}/{}", ct.ctype(), ct.subtype().unwrap_or("")))
            .unwrap_or_else(|| "text/plain".into())
            .to_ascii_lowercase();
        let mime_label = bounded_field(&mime_type, &mut report.incomplete);
        if mime_types.len() < 32 || mime_types.contains(&mime_label) {
            mime_types.insert(mime_label);
        } else {
            report.incomplete = true;
        }
        report.incomplete |= part.is_encoding_problem || matches!(part.body, PartType::Message(_));
        report.has_tnef |= matches!(
            mime_type.as_str(),
            "application/ms-tnef" | "application/vnd.ms-tnef"
        ) || part
            .attachment_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("winmail.dat"));

        if let Some(text) = part
            .text_contents()
            .filter(|_| matches!(part.body, PartType::Text(_) | PartType::Html(_)))
        {
            let lower = text.to_ascii_lowercase();
            report.has_outlook_link |= lower.contains("outlook.office365.com/owa/")
                || lower.contains("outlook.office.com/owa/");
        }

        if is_calendar_part(part) {
            report.calendar_parts += 1;
            if let Some(text) = part.text_contents() {
                inspect_calendar(text, &mut report);
            } else {
                report.incomplete = true;
            }
        }
    }
    report.mime_types = mime_types.into_iter().collect();
    report.incomplete |= report.has_tnef;
    Ok(report)
}

fn bounded_field(value: &str, incomplete: &mut bool) -> String {
    let field: String = value.chars().take(MAX_FIELD_CHARS).collect();
    *incomplete |= field.len() < value.len();
    field
}

fn inspect_calendar(text: &str, report: &mut InvitationDiagnostic) {
    // shortcut: extracts raw timings only; use a full iCalendar parser before calendar import or RSVP.
    let mut lines = text.lines().peekable();
    let mut in_calendar = false;
    let mut saw_calendar_begin = false;
    let mut saw_calendar_end = false;
    let mut event = None;
    let mut nested_depth = 0usize;
    while let Some(raw_line) = lines.next() {
        let mut line = raw_line.to_owned();
        while let Some(continuation) = lines.peek().and_then(|line| line.strip_prefix([' ', '\t']))
        {
            line.push_str(continuation);
            lines.next();
        }
        let Some((property, value)) = line.split_once(':') else {
            continue;
        };
        let name = property.split(';').next().unwrap_or("");
        if name.eq_ignore_ascii_case("BEGIN") {
            if value.eq_ignore_ascii_case("VCALENDAR") {
                in_calendar = true;
                saw_calendar_begin = true;
            } else if in_calendar && event.is_none() && value.eq_ignore_ascii_case("VEVENT") {
                event = Some(InvitationEventTiming::default());
            } else if event.is_some() {
                nested_depth += 1;
            }
        } else if name.eq_ignore_ascii_case("END") {
            if nested_depth > 0 {
                nested_depth -= 1;
            } else if value.eq_ignore_ascii_case("VEVENT") {
                if let Some(event) = event.take() {
                    if report.events.len() < MAX_EVENTS {
                        report.events.push(event);
                    } else {
                        report.incomplete = true;
                    }
                }
            } else if value.eq_ignore_ascii_case("VCALENDAR") {
                saw_calendar_end = true;
                in_calendar = false;
            }
        } else if in_calendar && nested_depth == 0 {
            if let Some(event) = event.as_mut() {
                let field = if name.eq_ignore_ascii_case("DTSTART") {
                    &mut event.start
                } else if name.eq_ignore_ascii_case("DTEND") {
                    &mut event.end
                } else if name.eq_ignore_ascii_case("DURATION") {
                    &mut event.duration
                } else {
                    continue;
                };
                *field = Some(bounded_field(&line, &mut report.incomplete));
            } else if name.eq_ignore_ascii_case("METHOD") {
                if report.methods.len() < 10 {
                    report
                        .methods
                        .push(bounded_field(value, &mut report.incomplete));
                } else {
                    report.incomplete = true;
                }
            }
        }
    }
    report.incomplete |= !saw_calendar_begin || !saw_calendar_end || event.is_some() || in_calendar;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_payload_preserves_the_original_event_and_checks_mail_identity() {
        let ics = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VTIMEZONE\r\nTZID:Singapore Standard Time\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:meeting-123@example.com\r\nSUMMARY:Review\r\nDTSTART;TZID=Singapore Standard Time:20261104T100000\r\nDTEND;TZID=Singapore Standard Time:20261104T110000\r\nATTENDEE:mailto:attendee@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let raw = format!("Message-ID: <mail-123@example.com>\r\nContent-Type: text/calendar; charset=utf-8\r\n\r\n{ics}");
        let payload = calendar_payload(raw.as_bytes(), Some("<mail-123@example.com>"))
            .unwrap()
            .unwrap();
        assert_eq!(payload, ics);
        let invite = crate::ics::parse_invite(&payload).unwrap();
        assert_eq!(invite.start.unwrap().local, "2026-11-04T10:00:00");
        assert!(calendar_payload(raw.as_bytes(), Some("<other@example.com>")).is_err());
        assert!(calendar_payload(b"Content-Type: text/html\r\n\r\n<a href=\"https://outlook.office365.com/owa/\">Open Outlook</a>", None).unwrap().is_none());
    }

    fn calendar(body: &str) -> InvitationDiagnostic {
        let raw = format!("From: private@example.com\r\nSubject: Private agenda\r\nContent-Type: text/calendar; charset=utf-8\r\n\r\n{body}");
        inspect_meeting_invitation(raw.as_bytes(), None).unwrap()
    }

    #[test]
    fn finds_inline_calendar_parts_outside_normal_attachments() {
        let raw = b"MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=test\r\n\r\n--test\r\nContent-Type: text/plain\r\n\r\nPlease join.\r\n--test\r\nContent-Type: text/calendar; method=REQUEST\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nBEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nDTSTART;TZID=3DAsia/Shanghai:20261103T140000\r\nDTEND;TZID=3DAsia/Shanghai:20261103T150000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n--test--\r\n";
        let result = inspect_meeting_invitation(raw, None).unwrap();
        assert_eq!(result.calendar_parts, 1);
        assert!(result.mime_types.contains(&"text/calendar".into()));
        assert_eq!(result.methods, ["REQUEST"]);
        assert_eq!(
            result.events[0].start.as_deref(),
            Some("DTSTART;TZID=Asia/Shanghai:20261103T140000")
        );
        assert_eq!(
            result.events[0].end.as_deref(),
            Some("DTEND;TZID=Asia/Shanghai:20261103T150000")
        );
        assert!(!result.incomplete);
    }

    #[test]
    fn decodes_base64_ics_even_with_generic_attachment_mime_type() {
        let raw = b"Content-Type: application/octet-stream; name=invite.ics\r\nContent-Disposition: attachment; filename=invite.ics\r\nContent-Transfer-Encoding: base64\r\n\r\nQkVHSU46VkNBTEVOREFSDQpCRUdJTjpWRVZFTlQNCkRUU1RBUlQ6MjAyNjExMDNUMDYwMDAwWg0KRU5EOlZFVkVOVA0KRU5EOlZDQUxFTkRBUg0K";
        let result = inspect_meeting_invitation(raw, None).unwrap();
        assert_eq!(result.calendar_parts, 1);
        assert_eq!(
            result.events[0].start.as_deref(),
            Some("DTSTART:20261103T060000Z")
        );
        assert!(!result.incomplete);
    }

    #[test]
    fn preserves_folded_parameters_all_day_and_duration_without_guessing() {
        let result = calendar("BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:\n 20261103\nDURATION:P1D\nBEGIN:VALARM\nDTSTART:19990101T000000Z\nEND:VALARM\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261104T090000\nEND:VEVENT\nEND:VCALENDAR");
        assert_eq!(result.events.len(), 2);
        assert_eq!(
            result.events[0].start.as_deref(),
            Some("DTSTART;VALUE=DATE:20261103")
        );
        assert_eq!(result.events[0].duration.as_deref(), Some("DURATION:P1D"));
        assert!(result.events[0].end.is_none());
        assert_eq!(
            result.events[1].start.as_deref(),
            Some("DTSTART:20261104T090000")
        );
        assert_eq!(result.methods, ["CANCEL"]);
    }

    #[test]
    fn distinguishes_outlook_link_from_calendar_data_and_does_not_leak_body() {
        let raw = b"Message-ID: <expected@example.com>\r\nDate: Fri, 30 Oct 2026 21:05:00 +0800\r\nSubject: Private agenda\r\nContent-Type: text/html\r\n\r\n<a href=\"https://outlook.office365.com/owa/company/?itemid=secret\">Open Outlook</a><p>Meeting passcode: private-passcode</p>";
        let result = inspect_meeting_invitation(raw, Some("<expected@example.com>")).unwrap();
        assert!(result.has_outlook_link);
        assert_eq!(result.calendar_parts, 0);
        assert!(result.events.is_empty());
        let json = serde_json::to_string(&result).unwrap();
        for private in [
            "secret",
            "private-passcode",
            "Private agenda",
            "expected@example.com",
            "2026",
        ] {
            assert!(!json.contains(private));
        }
        assert!(inspect_meeting_invitation(raw, Some("<wrong@example.com>")).is_err());
    }

    #[test]
    fn warns_on_tnef_nested_messages_and_invalid_calendar_content() {
        let result =
            inspect_meeting_invitation(b"Content-Type: application/ms-tnef\r\n\r\nopaque", None)
                .unwrap();
        assert!(result.has_tnef && result.incomplete);
        assert_eq!(result.calendar_parts, 0);
        let result = inspect_meeting_invitation(b"Content-Type: message/rfc822\r\n\r\nFrom: nested@example.com\r\nContent-Type: text/calendar\r\n\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR", None).unwrap();
        assert!(result.incomplete);
        assert_eq!(result.calendar_parts, 0);
        assert!(calendar("not an iCalendar document").incomplete);
        assert!(calendar("END:VCALENDAR").incomplete);
        assert!(calendar("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261103T060000Z").incomplete);
    }

    #[test]
    fn bounds_diagnostic_output_and_marks_truncation() {
        let events = "BEGIN:VEVENT\nDTSTART:20261103T060000Z\nEND:VEVENT\n".repeat(11);
        let result = calendar(&format!("BEGIN:VCALENDAR\n{events}END:VCALENDAR"));
        assert_eq!(result.events.len(), MAX_EVENTS);
        assert!(result.incomplete);
        let result = calendar(&format!(
            "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:{}\nEND:VEVENT\nEND:VCALENDAR",
            "x".repeat(1000)
        ));
        assert_eq!(
            result.events[0].start.as_ref().unwrap().chars().count(),
            MAX_FIELD_CHARS
        );
        assert!(result.incomplete);
    }
}
