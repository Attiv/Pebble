//! Unread-count badge on the application icon (macOS Dock, Linux launcher,
//! Windows taskbar overlay).
//!
//! The count is derived from the local database instead of from the React
//! layer, so it stays correct while the window is hidden in the tray and while
//! no webview is running. Every mutation that can change the number of unread
//! messages ends with [`request_refresh`], which coalesces bursts — a sync that
//! stores 200 messages costs one recount, not 200.
//!
//! The scope of "unread mail" lives in `pebble_store` (see
//! `UNREAD_MAIL_PREDICATE` in `messages.rs`): unread, not deleted, and not
//! filed exclusively under drafts, trash or spam. The per-account "mark all as
//! read" command uses the same scope, so the number shown here is exactly the
//! number that action clears.

use crate::state::AppState;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};
use tracing::warn;

/// Above this the badge shows `99+`: both the Dock and the Unity launcher
/// truncate wide numeric labels.
const MAX_DISPLAYED_COUNT: u32 = 99;

/// Quiet period before recounting, so a sync that stores a thousand messages
/// still costs a single query.
const REFRESH_DEBOUNCE: Duration = Duration::from_millis(250);

/// Side length of the Windows taskbar overlay icon.
const OVERLAY_SIZE: u32 = 32;

/// Text rendered inside the badge, or `None` when the badge must be removed.
pub fn badge_label(count: u32) -> Option<String> {
    match count {
        0 => None,
        count if count > MAX_DISPLAYED_COUNT => Some(format!("{MAX_DISPLAYED_COUNT}+")),
        count => Some(count.to_string()),
    }
}

/// Badge bookkeeping shared through Tauri state.
pub struct UnreadBadgeState {
    /// Last count pushed to the OS, so repeated refreshes become no-ops.
    applied: AtomicU32,
    /// Set while a refresh is queued or running, so callers coalesce into it.
    pending: AtomicBool,
}

impl UnreadBadgeState {
    pub fn new() -> Self {
        Self {
            applied: AtomicU32::new(0),
            pending: AtomicBool::new(false),
        }
    }
}

impl Default for UnreadBadgeState {
    fn default() -> Self {
        Self::new()
    }
}

/// Queue an unread-count refresh.
///
/// Safe to call from any command, worker or watcher: calls that arrive while a
/// refresh is already queued are folded into it, and calls that arrive while
/// one is running schedule exactly one follow-up.
pub fn request_refresh<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<UnreadBadgeState>() else {
        return;
    };
    if state.pending.swap(true, Ordering::SeqCst) {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(REFRESH_DEBOUNCE).await;
            if let Some(state) = app.try_state::<UnreadBadgeState>() {
                state.pending.store(false, Ordering::SeqCst);
            }
            refresh_now(&app).await;

            let queued_again = app
                .try_state::<UnreadBadgeState>()
                .is_some_and(|state| state.pending.load(Ordering::SeqCst));
            if !queued_again {
                break;
            }
        }
    });
}

/// Recount unread mail across every account and apply it to the app icon.
///
/// Returns the applied count, or `None` when the app is not fully initialised
/// yet (called before `AppState` is managed).
pub async fn refresh_now<R: Runtime>(app: &AppHandle<R>) -> Option<u32> {
    let store = app.try_state::<AppState>()?.store.clone();
    let counts = tokio::task::spawn_blocking(move || store.get_unread_counts_by_account())
        .await
        .ok()?
        .ok()?;
    let total: u32 = counts.iter().map(|(_, count)| count).sum();
    apply_badge(app, total);
    Some(total)
}

fn apply_badge<R: Runtime>(app: &AppHandle<R>, count: u32) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(state) = app.try_state::<UnreadBadgeState>() else {
        return;
    };
    if state.applied.swap(count, Ordering::SeqCst) == count {
        return;
    }

    // macOS draws the Dock badge from a free-form label, which is what lets
    // `99+` render; the other desktops (Linux launchers, mobile) take a plain
    // number.
    #[cfg(target_os = "macos")]
    let result = window.set_badge_label(badge_label(count));

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = window.set_badge_count((count > 0).then(|| i64::from(count)));

    // Windows has no numeric badge API, so the counter is painted into a
    // taskbar overlay icon instead.
    #[cfg(target_os = "windows")]
    let result = {
        use tauri::image::Image;
        let icon = badge_label(count).map(|label| {
            let (rgba, width, height) = badge_overlay_rgba(&label);
            Image::new_owned(rgba, width, height)
        });
        window.set_overlay_icon(icon)
    };

    if let Err(error) = result {
        warn!("Failed to update the unread badge: {error}");
    }
}

/// Bitmap rows of one character in a 3x5 cell, top row first, bit 2 = leftmost
/// column. Used to paint the Windows overlay icon without pulling in a font.
#[allow(dead_code)]
fn glyph_rows(character: char) -> Option<[u8; 5]> {
    Some(match character {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b001, 0b001, 0b001],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '+' => [0b000, 0b010, 0b111, 0b010, 0b000],
        _ => return None,
    })
}

#[allow(dead_code)]
fn paint_glyph(
    rgba: &mut [u8],
    size: u32,
    rows: [u8; 5],
    origin_x: i32,
    origin_y: i32,
    scale: i32,
) {
    for (row, bits) in rows.iter().enumerate() {
        for column in 0..3i32 {
            if bits & (1 << (2 - column)) == 0 {
                continue;
            }
            for dy in 0..scale {
                for dx in 0..scale {
                    let x = origin_x + column * scale + dx;
                    let y = origin_y + row as i32 * scale + dy;
                    if x < 0 || y < 0 || x >= size as i32 || y >= size as i32 {
                        continue;
                    }
                    let offset = ((y as u32 * size + x as u32) * 4) as usize;
                    rgba[offset..offset + 4].copy_from_slice(&[255, 255, 255, 255]);
                }
            }
        }
    }
}

/// Rasterise the Windows taskbar overlay badge: a red disc with a white ring
/// (so it stays visible on dark taskbars) and the unread label in white.
///
/// Kept platform-independent so it can be unit-tested everywhere, even though
/// only the Windows branch of [`apply_badge`] consumes the pixels.
#[allow(dead_code)]
pub fn badge_overlay_rgba(label: &str) -> (Vec<u8>, u32, u32) {
    let size = OVERLAY_SIZE;
    let mut rgba = vec![0u8; (size * size * 4) as usize];

    let center = size as f32 / 2.0;
    let radius = center - 1.0;
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 + 0.5 - center;
            let dy = y as f32 + 0.5 - center;
            let distance = (dx * dx + dy * dy).sqrt();
            let offset = ((y * size + x) * 4) as usize;
            if distance <= radius {
                rgba[offset..offset + 4].copy_from_slice(&[0xEF, 0x44, 0x44, 255]);
            } else if distance <= radius + 1.5 {
                rgba[offset..offset + 4].copy_from_slice(&[255, 255, 255, 255]);
            }
        }
    }

    let characters: Vec<char> = label.chars().filter(|c| glyph_rows(*c).is_some()).collect();
    if characters.is_empty() {
        return (rgba, size, size);
    }

    // 2x keeps `99+` inside the disc; a single character can afford 3x.
    let scale = if characters.len() > 1 { 2 } else { 3 };
    let glyph_width = 3 * scale;
    let gap = scale;
    let total_width = characters.len() as i32 * glyph_width + (characters.len() as i32 - 1) * gap;
    let origin_x = (size as i32 - total_width) / 2;
    let origin_y = (size as i32 - 5 * scale) / 2;

    for (index, character) in characters.iter().enumerate() {
        if let Some(rows) = glyph_rows(*character) {
            paint_glyph(
                &mut rgba,
                size,
                rows,
                origin_x + index as i32 * (glyph_width + gap),
                origin_y,
                scale,
            );
        }
    }

    (rgba, size, size)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(rgba: &[u8], size: u32, x: u32, y: u32) -> [u8; 4] {
        let offset = ((y * size + x) * 4) as usize;
        [
            rgba[offset],
            rgba[offset + 1],
            rgba[offset + 2],
            rgba[offset + 3],
        ]
    }

    #[test]
    fn badge_label_hides_zero_and_caps_large_counts() {
        assert_eq!(badge_label(0), None);
        assert_eq!(badge_label(1).as_deref(), Some("1"));
        assert_eq!(badge_label(99).as_deref(), Some("99"));
        assert_eq!(badge_label(100).as_deref(), Some("99+"));
        assert_eq!(badge_label(u32::MAX).as_deref(), Some("99+"));
    }

    #[test]
    fn overlay_icon_is_a_red_disc_with_a_white_label_and_transparent_corners() {
        let (rgba, width, height) = badge_overlay_rgba("8");

        assert_eq!(width, OVERLAY_SIZE);
        assert_eq!(height, OVERLAY_SIZE);
        assert_eq!(pixel(&rgba, width, 0, 0), [0, 0, 0, 0]);
        assert_eq!(pixel(&rgba, width, 16, 2), [0xEF, 0x44, 0x44, 255]);
        // Middle column of the `8` glyph is filled, so the centre is white.
        assert_eq!(pixel(&rgba, width, 16, 16), [255, 255, 255, 255]);
    }

    #[test]
    fn overlay_icon_renders_multi_character_overflow_labels() {
        let (rgba, width, height) = badge_overlay_rgba("99+");

        assert_eq!(width, OVERLAY_SIZE);
        assert_eq!(height, OVERLAY_SIZE);
        // A `+` glyph sits at the middle row, right of the two digits.
        assert_eq!(pixel(&rgba, width, 16, 16), [255, 255, 255, 255]);
        assert_eq!(pixel(&rgba, width, 0, 0), [0, 0, 0, 0]);
    }

    #[test]
    fn overlay_icon_ignores_unknown_characters() {
        let (rgba, width, height) = badge_overlay_rgba("ab");

        assert_eq!(width, OVERLAY_SIZE);
        assert_eq!(height, OVERLAY_SIZE);
        // Nothing painted beyond the disc ring.
        assert_eq!(pixel(&rgba, width, 16, 16), [0xEF, 0x44, 0x44, 255]);
    }
}
