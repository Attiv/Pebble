//! A deliberately small iCalendar reader, for meeting invitations.
//!
//! Only what an invitation card needs: the `VEVENT` properties that say *when*
//! and *where*, plus the calendar-level method, because a `CANCEL` carrying the
//! same `UID` is how an organiser takes an invitation back. Recurrence rules,
//! attendees and alarms are read as raw strings and not interpreted — a card
//! that claims to know more than it does is worse than one that says "every
//! Tuesday" and means it.
//!
//! RFC 5545 is large; this is the subset Outlook, Google and Apple actually
//! emit, parsed with no dependency so the mail crate keeps its dependency list.

/// A `VEVENT` reduced to what a reader needs to decide whether to add it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CalendarInvite {
    /// `REQUEST`, `CANCEL`, `REPLY` or `PUBLISH`, when the calendar says.
    pub method: Option<String>,
    pub uid: Option<String>,
    pub summary: Option<String>,
    pub location: Option<String>,
    pub description: Option<String>,
    pub organizer_name: Option<String>,
    pub organizer_email: Option<String>,
    pub start: Option<CalendarTime>,
    pub end: Option<CalendarTime>,
    /// `CONFIRMED`, `TENTATIVE` or `CANCELLED`.
    pub status: Option<String>,
    pub sequence: Option<i64>,
    /// The raw `RRULE`, so the card can say "repeats" without pretending to
    /// enumerate the occurrences.
    pub recurrence: Option<String>,
}

impl CalendarInvite {
    /// True when the organiser has taken the meeting back, either by sending a
    /// `CANCEL` or by marking the event itself cancelled.
    pub fn is_cancelled(&self) -> bool {
        self.method.as_deref() == Some("CANCEL") || self.status.as_deref() == Some("CANCELLED")
    }

    /// True when this is an all-day event rather than a timed one.
    pub fn is_all_day(&self) -> bool {
        self.start.as_ref().is_some_and(|start| start.date_only)
    }
}

/// A `DTSTART` / `DTEND` value.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CalendarTime {
    /// Filled only when the value ended in `Z`. A floating or `TZID`-anchored
    /// time means nothing in UTC on its own, so it is left to [`local`] and
    /// [`tzid`] rather than guessed at.
    ///
    /// [`local`]: CalendarTime::local
    /// [`tzid`]: CalendarTime::tzid
    pub utc_epoch: Option<i64>,
    /// The zone the value is written in, when the sender named one.
    pub tzid: Option<String>,
    /// `YYYY-MM-DDTHH:MM:SS`, or `YYYY-MM-DD` for a date-only value.
    pub local: String,
    pub date_only: bool,
}

/// Parse the first `VEVENT` in an iCalendar payload.
///
/// Returns `None` when the payload holds no event at all — a `VTODO` or a bare
/// `VCALENDAR` is not an invitation.
pub fn parse_invite(content: &str) -> Option<CalendarInvite> {
    let lines = unfold(content);

    let mut method = None;
    let mut inside_event = false;
    let mut invite = CalendarInvite::default();
    let mut saw_event = false;

    for line in &lines {
        let Some(property) = Property::parse(line) else {
            continue;
        };

        match (property.name.as_str(), inside_event) {
            ("BEGIN", false) if property.value.eq_ignore_ascii_case("VEVENT") => {
                inside_event = true;
                saw_event = true;
                continue;
            }
            ("END", true) if property.value.eq_ignore_ascii_case("VEVENT") => break,
            ("METHOD", false) => {
                method = Some(property.value.trim().to_ascii_uppercase());
                continue;
            }
            (_, true) => {}
            _ => continue,
        }

        match property.name.as_str() {
            "UID" => invite.uid = Some(unescape(property.value.trim())),
            "SUMMARY" => invite.summary = Some(unescape(property.value.trim())),
            "LOCATION" => invite.location = Some(unescape(property.value.trim())),
            "DESCRIPTION" => invite.description = Some(unescape(property.value.trim())),
            "STATUS" => invite.status = Some(property.value.trim().to_ascii_uppercase()),
            "SEQUENCE" => invite.sequence = property.value.trim().parse::<i64>().ok(),
            "RRULE" => invite.recurrence = Some(property.value.trim().to_string()),
            "DTSTART" => invite.start = parse_time(&property),
            "DTEND" => invite.end = parse_time(&property),
            // `DURATION` replaces `DTEND` in some senders; without it an event
            // still has a start, which is all the card shows.
            "ORGANIZER" => {
                let address = strip_mailto(property.value.trim());
                if !address.is_empty() {
                    invite.organizer_email = Some(address);
                }
                invite.organizer_name = property.param("CN").filter(|name| !name.is_empty());
            }
            _ => {}
        }
    }

    if !saw_event {
        return None;
    }
    invite.method = method;
    Some(invite)
}

/// Unfold continuation lines: a line that starts with a space or a tab belongs
/// to the line above it. Senders wrap long `SUMMARY`s mid-word, so this runs
/// before anything else looks at the payload.
fn unfold(content: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in content.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(rest) = line.strip_prefix(' ').or_else(|| line.strip_prefix('\t')) {
            if let Some(last) = lines.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        lines.push(line.to_string());
    }
    lines
}

/// One `NAME;PARAM=VALUE:content` line.
struct Property<'a> {
    name: String,
    params: Vec<(String, String)>,
    value: &'a str,
}

impl<'a> Property<'a> {
    fn parse(line: &'a str) -> Option<Self> {
        // The value starts at the first colon that is not inside a quoted
        // parameter — a `CN="Board: EMEA"` must not be split there.
        let mut quoted = false;
        let mut split_at = None;
        for (index, character) in line.char_indices() {
            match character {
                '"' => quoted = !quoted,
                ':' if !quoted => {
                    split_at = Some(index);
                    break;
                }
                _ => {}
            }
        }
        let split_at = split_at?;
        let (head, value) = line.split_at(split_at);
        let value = &value[1..];

        let mut segments = split_unquoted(head, ';');
        let name = segments.next()?.trim().to_ascii_uppercase();
        if name.is_empty() {
            return None;
        }
        // Property names may carry a group prefix (`ITEM1.SUMMARY`).
        let name = name.rsplit('.').next().unwrap_or(&name).to_string();

        let mut params = Vec::new();
        for segment in segments {
            if let Some((key, raw)) = segment.split_once('=') {
                let key = key.trim().to_ascii_uppercase();
                let raw = raw.trim();
                let value = raw.strip_prefix('"').and_then(|v| v.strip_suffix('"'));
                params.push((key, value.unwrap_or(raw).to_string()));
            }
        }

        Some(Self {
            name,
            params,
            value,
        })
    }

    fn param(&self, name: &str) -> Option<String> {
        self.params
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| unescape(value))
    }
}

/// Split on `separator`, ignoring separators inside double quotes.
fn split_unquoted(input: &str, separator: char) -> impl Iterator<Item = &str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut quoted = false;
    for (index, character) in input.char_indices() {
        match character {
            '"' => quoted = !quoted,
            c if c == separator && !quoted => {
                parts.push(&input[start..index]);
                start = index + c.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(&input[start..]);
    parts.into_iter()
}

/// Undo the escaping iCalendar applies to text values: `\,`, `\;`, `\n`, `\\`.
fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            out.push(character);
            continue;
        }
        match characters.next() {
            Some('n') | Some('N') => out.push('\n'),
            Some(other) => out.push(other),
            None => break,
        }
    }
    out
}

fn strip_mailto(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("mailto:") {
        trimmed[7..].to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_time(property: &Property<'_>) -> Option<CalendarTime> {
    let raw = property.value.trim();
    let tzid = property.param("TZID").filter(|zone| !zone.is_empty());

    // Date only: `20261028`.
    if raw.len() == 8 && raw.chars().all(|c| c.is_ascii_digit()) {
        let year = field(raw, 0, 4)?;
        let month = field(raw, 4, 2)?;
        let day = field(raw, 6, 2)?;
        return Some(CalendarTime {
            utc_epoch: None,
            tzid,
            local: format!("{year:04}-{month:02}-{day:02}"),
            date_only: true,
        });
    }

    // `20261028T140000` or `20261028T140000Z`.
    let (body, utc) = match raw.strip_suffix(['Z', 'z']) {
        Some(body) => (body, true),
        None => (raw, false),
    };
    let (date, time) = body.split_once('T').or_else(|| body.split_once('t'))?;
    if date.len() != 8 || time.len() < 6 {
        return None;
    }
    let year = field(date, 0, 4)?;
    let month = field(date, 4, 2)?;
    let day = field(date, 6, 2)?;
    let hour = field(time, 0, 2)?;
    let minute = field(time, 2, 2)?;
    let second = field(time, 4, 2)?;

    let utc_epoch = utc
        .then(|| days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second);

    Some(CalendarTime {
        utc_epoch,
        tzid,
        local: format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}"),
        date_only: false,
    })
}

/// Read a fixed-width numeric field, rejecting anything that is not a number.
fn field(input: &str, offset: usize, width: usize) -> Option<i64> {
    input.get(offset..offset + width)?.parse::<i64>().ok()
}

/// Days since 1970-01-01 for a proleptic Gregorian date.
///
/// Howard Hinnant's `days_from_civil`, which avoids pulling in a date library
/// for the one calculation this module needs.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let shifted_month = (month + 9) % 12;
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUTLOOK_INVITE: &str = "BEGIN:VCALENDAR\r\n\
        METHOD:REQUEST\r\n\
        PRODID:Microsoft Exchange Server 2010\r\n\
        VERSION:2.0\r\n\
        BEGIN:VTIMEZONE\r\n\
        TZID:China Standard Time\r\n\
        END:VTIMEZONE\r\n\
        BEGIN:VEVENT\r\n\
        ORGANIZER;CN=Wang Lei:mailto:lk_wang@simplifiedtec.com\r\n\
        ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:vitta@example.com\r\n\
        UID:040000008200E00074C5B7101A82E00800000000\r\n\
        SUMMARY:Quarterly review\\, EMEA\r\n\
        DTSTART;TZID=China Standard Time:20261102T140000\r\n\
        DTEND;TZID=China Standard Time:20261102T153000\r\n\
        LOCATION:Room 3B\\; 3rd floor\r\n\
        SEQUENCE:0\r\n\
        STATUS:CONFIRMED\r\n\
        END:VEVENT\r\n\
        END:VCALENDAR\r\n";

    #[test]
    fn reads_the_fields_an_invitation_card_shows() {
        let invite = parse_invite(OUTLOOK_INVITE).expect("an invite");

        assert_eq!(invite.method.as_deref(), Some("REQUEST"));
        assert_eq!(invite.summary.as_deref(), Some("Quarterly review, EMEA"));
        assert_eq!(invite.location.as_deref(), Some("Room 3B; 3rd floor"));
        assert_eq!(invite.organizer_name.as_deref(), Some("Wang Lei"));
        assert_eq!(
            invite.organizer_email.as_deref(),
            Some("lk_wang@simplifiedtec.com")
        );
        assert_eq!(invite.status.as_deref(), Some("CONFIRMED"));
        assert!(!invite.is_cancelled());

        let start = invite.start.expect("a start");
        assert_eq!(start.local, "2026-11-02T14:00:00");
        assert_eq!(start.tzid.as_deref(), Some("China Standard Time"));
        // A TZID-anchored value says nothing about UTC on its own, so no epoch
        // is invented for it.
        assert_eq!(start.utc_epoch, None);
        assert_eq!(invite.end.expect("an end").local, "2026-11-02T15:30:00");
    }

    #[test]
    fn joins_folded_lines_before_reading_them() {
        let folded = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n\
            SUMMARY:Design review for the new composer\r\n  and the reply pane\r\n\
            DTSTART:20261102T140000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        let invite = parse_invite(folded).expect("an invite");
        assert_eq!(
            invite.summary.as_deref(),
            Some("Design review for the new composer and the reply pane")
        );
    }

    #[test]
    fn converts_a_utc_start_to_an_epoch() {
        let invite = parse_invite(
            "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261028T060000Z\n\
             DTEND:20261028T070000Z\nEND:VEVENT\nEND:VCALENDAR\n",
        )
        .expect("an invite");

        // 2026-10-28T06:00:00Z
        assert_eq!(invite.start.and_then(|s| s.utc_epoch), Some(1_793_167_200));
    }

    #[test]
    fn treats_a_date_only_start_as_an_all_day_event() {
        let invite = parse_invite(
            "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Company holiday\n\
             DTSTART;VALUE=DATE:20261225\nEND:VEVENT\nEND:VCALENDAR\n",
        )
        .expect("an invite");

        assert!(invite.is_all_day());
        let start = invite.start.expect("a start");
        assert_eq!(start.local, "2026-12-25");
        assert_eq!(start.utc_epoch, None);
    }

    #[test]
    fn recognises_a_cancelled_invitation() {
        let invite = parse_invite(
            "BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\n\
             SUMMARY:Quarterly review\nDTSTART:20261102T140000Z\n\
             END:VEVENT\nEND:VCALENDAR\n",
        )
        .expect("an invite");

        assert!(invite.is_cancelled());
    }

    #[test]
    fn keeps_a_colon_inside_a_quoted_parameter() {
        let invite = parse_invite(
            "BEGIN:VCALENDAR\nBEGIN:VEVENT\n\
             ORGANIZER;CN=\"Board: EMEA\":mailto:board@example.com\n\
             SUMMARY:Sync\nEND:VEVENT\nEND:VCALENDAR\n",
        )
        .expect("an invite");

        assert_eq!(invite.organizer_name.as_deref(), Some("Board: EMEA"));
        assert_eq!(invite.organizer_email.as_deref(), Some("board@example.com"));
    }

    #[test]
    fn ignores_a_calendar_without_an_event() {
        assert!(parse_invite("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n").is_none());
        assert!(parse_invite("not a calendar at all").is_none());
    }
}
