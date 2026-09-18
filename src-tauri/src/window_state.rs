//! Remembering where the window was left.
//!
//! Every launch used to place the main window at the size and position written
//! in `tauri.conf.json` — 1200×800, centred — so anyone who works with a second
//! display moved it back into place by hand at every start. The geometry is now
//! written beside the rest of the profile once the window has held still for a
//! moment, and applied again before the window is first shown.
//!
//! Restoring it blindly would not be safe. A position only means something
//! relative to a display that was attached at the time, and this machine's
//! external monitor drops out on its own; a rectangle that no longer overlaps
//! any attached display is therefore discarded, which leaves the centred
//! default in place — a window nobody can reach is worse than a window in the
//! wrong corner.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, Runtime, Window};

/// Written inside the profile directory, beside the database and the logs.
pub const WINDOW_STATE_FILENAME: &str = "window-state.json";

/// How long the window has to hold still before the geometry is written. A drag
/// emits an event per frame, so without this the file would be rewritten
/// hundreds of times and could be caught mid-drag.
const SETTLE: Duration = Duration::from_millis(500);

/// How much of the window has to land on a display for a saved position to be
/// worth restoring: enough across and enough down to take hold of the titlebar
/// and pull the rest back into view.
const MIN_VISIBLE_WIDTH: i64 = 160;
const MIN_VISIBLE_HEIGHT: i64 = 40;

/// A rectangle, as `(x, y, width, height)`. Physical pixels throughout: the
/// same space `outer_position`, `inner_size` and the monitors all report in, so
/// nothing here has to think about scale factors.
type Rect = (i64, i64, i64, i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowGeometry {
    /// Outer top-left corner — where the titlebar sits.
    pub x: i32,
    pub y: i32,
    /// Inner (content) size. The same pair Tauri reports and accepts, so a
    /// value that came out of `inner_size` goes back into `set_size` unchanged.
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default)]
    pub fullscreen: bool,
}

impl WindowGeometry {
    /// The window's geometry as it stands, or `None` while the platform will
    /// not say — a window that has not been shown yet has no position to read.
    fn read<R: Runtime>(window: &Window<R>) -> Option<Self> {
        let position = window.outer_position().ok()?;
        let size = window.inner_size().ok()?;
        Some(Self {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized: window.is_maximized().unwrap_or(false),
            fullscreen: window.is_fullscreen().unwrap_or(false),
        })
    }

    fn rect(&self) -> Rect {
        (
            i64::from(self.x),
            i64::from(self.y),
            i64::from(self.width),
            i64::from(self.height),
        )
    }
}

/// The part of `window` this display still shows, per axis. Negative when the
/// two do not meet at all.
fn overlap(window: Rect, display: Rect) -> (i64, i64) {
    let width = (window.0 + window.2).min(display.0 + display.2) - window.0.max(display.0);
    let height = (window.1 + window.3).min(display.1 + display.3) - window.1.max(display.1);
    (width.max(0), height.max(0))
}

/// Whether some of the window is still on this display *and* that part is big
/// enough to grab. A window two pixels inside the edge technically overlaps the
/// display and is still lost to a person, so the floor is a slice of titlebar
/// rather than zero.
fn grabbable_on(window: Rect, display: Rect) -> bool {
    let (width, height) = overlap(window, display);
    // A window smaller than the floor only has to be wholly on screen.
    width >= MIN_VISIBLE_WIDTH.min(window.2) && height >= MIN_VISIBLE_HEIGHT.min(window.3)
}

/// The geometry to apply, or `None` when the saved one cannot be trusted —
/// either it does not describe a window, or no attached display still shows
/// enough of it to drag back.
fn restore_rect(saved: &WindowGeometry, displays: &[Rect]) -> Option<(i32, i32, u32, u32)> {
    if saved.width == 0 || saved.height == 0 {
        return None;
    }
    let window = saved.rect();
    if !displays
        .iter()
        .any(|&display| grabbable_on(window, display))
    {
        return None;
    }
    Some((saved.x, saved.y, saved.width, saved.height))
}

fn state_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(WINDOW_STATE_FILENAME)
}

/// Reads the remembered geometry. A missing or unreadable file is not an error:
/// the centred default is a perfectly good answer, and a settings file should
/// never be able to stop the app from opening.
fn load(path: &Path) -> Option<WindowGeometry> {
    let raw = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str::<WindowGeometry>(&raw) {
        Ok(geometry) => Some(geometry),
        Err(e) => {
            tracing::warn!("Ignoring the window geometry in {}: {e}", path.display());
            None
        }
    }
}

/// Writes it through a temporary file, so a crash mid-write cannot leave half a
/// geometry behind for the next launch to read.
fn store(path: &Path, geometry: &WindowGeometry) -> std::io::Result<()> {
    let json = serde_json::to_string(geometry)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, json)?;
    std::fs::rename(&temporary, path)
}

/// The geometry that has not reached the disk yet, and the channel that will
/// eventually write it.
struct Pending {
    latest: Option<WindowGeometry>,
    sender: Sender<WindowGeometry>,
}

/// App state: the window's memory of itself.
pub struct WindowState {
    path: PathBuf,
    pending: Mutex<Pending>,
}

/// A lock that survives a poisoned mutex. The geometry is a convenience, and
/// the release profile is `panic = "abort"`, so panicking on a lock someone
/// else poisoned would take the whole process down over a window position.
fn lock(pending: &Mutex<Pending>) -> MutexGuard<'_, Pending> {
    pending
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl WindowState {
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Notes where the window is now, and schedules the write.
    pub(crate) fn record<R: Runtime>(&self, window: &Window<R>) {
        let Some(geometry) = WindowGeometry::read(window) else {
            return;
        };
        let mut pending = lock(&self.pending);
        pending.latest = Some(geometry);
        // The receiver is only gone if the writer thread could not start, in
        // which case there is nothing to report and nothing to do about it.
        let _ = pending.sender.send(geometry);
    }

    /// Writes whatever is still pending. Called as the app quits, because the
    /// settle delay does not outlive the process.
    pub fn flush(&self) {
        let pending = lock(&self.pending);
        let Some(geometry) = pending.latest else {
            return;
        };
        if let Err(e) = store(&self.path, &geometry) {
            tracing::warn!("Failed to save the window geometry: {e}");
        }
    }
}

/// Starts remembering. The writer thread lives for as long as the app does.
pub fn watch(app_data_dir: &Path) -> WindowState {
    let path = state_path(app_data_dir);
    let (sender, receiver) = mpsc::channel::<WindowGeometry>();
    let writer_path = path.clone();
    let writer = std::thread::Builder::new()
        .name("window-geometry".into())
        .spawn(move || {
            while let Ok(mut latest) = receiver.recv() {
                // Hold on to the newest geometry until the window stops moving,
                // so a drag costs one write rather than one per frame.
                loop {
                    match receiver.recv_timeout(SETTLE) {
                        Ok(next) => latest = next,
                        Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
                    }
                }
                if let Err(e) = store(&writer_path, &latest) {
                    tracing::warn!("Failed to save the window geometry: {e}");
                }
            }
        });
    if let Err(e) = writer {
        // Losing the writer only means the geometry is not remembered; it does
        // not affect the window, so it is not worth failing startup over.
        tracing::warn!("Could not start the window geometry writer: {e}");
    }

    WindowState {
        path,
        pending: Mutex::new(Pending {
            latest: None,
            sender,
        }),
    }
}

/// Puts the window back where it was, if that place is still available.
///
/// Called before the window is first shown, so the restore is what a person
/// sees rather than a jump between two positions.
pub fn restore<R: Runtime>(window: &Window<R>, path: &Path) {
    let Some(saved) = load(path) else {
        return;
    };

    let displays: Vec<Rect> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            (
                i64::from(position.x),
                i64::from(position.y),
                i64::from(size.width),
                i64::from(size.height),
            )
        })
        .collect();

    let Some((x, y, width, height)) = restore_rect(&saved, &displays) else {
        tracing::warn!(
            "The remembered window place ({}×{} at {}, {}) is not on any of the {} attached display(s); \
             leaving the window where the configuration puts it",
            saved.width,
            saved.height,
            saved.x,
            saved.y,
            displays.len()
        );
        return;
    };

    // Both are restored before the rectangle, which is the shape the window
    // goes back to when it leaves fullscreen or is un-maximized.
    if saved.fullscreen {
        let _ = window.set_fullscreen(true);
    }
    if saved.maximized {
        let _ = window.maximize();
    }
    let _ = window.set_size(PhysicalSize::new(width, height));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    tracing::info!("Restored the window to {width}×{height} at {x}, {y}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry(x: i32, y: i32, width: u32, height: u32) -> WindowGeometry {
        WindowGeometry {
            x,
            y,
            width,
            height,
            maximized: false,
            fullscreen: false,
        }
    }

    /// A 1920×1080 laptop display at the origin plus a 2560×1440 one to its
    /// right — the arrangement this machine actually has.
    fn both_displays() -> Vec<Rect> {
        vec![(0, 0, 1920, 1080), (1920, 0, 2560, 1440)]
    }

    #[test]
    fn restores_a_window_that_is_still_where_it_was_left() {
        assert_eq!(
            restore_rect(&geometry(100, 60, 1200, 800), &both_displays()),
            Some((100, 60, 1200, 800))
        );
        // Including on the second display, where the coordinates are negative
        // for anything left of it.
        assert_eq!(
            restore_rect(&geometry(2200, 140, 1400, 900), &both_displays()),
            Some((2200, 140, 1400, 900))
        );
    }

    #[test]
    fn discards_a_window_left_on_a_display_that_has_gone_away() {
        // Unplugging the external monitor is the common case here: the place is
        // remembered, the display it refers to is not.
        let laptop_only = vec![(0, 0, 1920, 1080)];
        assert_eq!(
            restore_rect(&geometry(2200, 140, 1400, 900), &laptop_only),
            None
        );
    }

    #[test]
    fn keeps_a_window_that_hangs_off_the_edge_but_can_still_be_grabbed() {
        // Mostly off the right edge; the corner and a usable slice of titlebar
        // are still on screen, so this is a place a person can drag back.
        let laptop_only = vec![(0, 0, 1920, 1080)];
        assert_eq!(
            restore_rect(&geometry(1700, 40, 1200, 800), &laptop_only),
            Some((1700, 40, 1200, 800))
        );
    }

    #[test]
    fn discards_a_window_that_only_peeks_into_a_display() {
        let laptop_only = vec![(0, 0, 1920, 1080)];
        // 20px of the top edge: visible to the window server, not to a hand.
        assert_eq!(
            restore_rect(&geometry(200, 1060, 1200, 800), &laptop_only),
            None
        );
        // Entirely below every display.
        assert_eq!(
            restore_rect(&geometry(200, 1080, 1200, 800), &laptop_only),
            None
        );
    }

    #[test]
    fn discards_a_geometry_that_does_not_describe_a_window() {
        assert_eq!(
            restore_rect(&geometry(0, 0, 0, 800), &both_displays()),
            None
        );
        assert_eq!(
            restore_rect(&geometry(0, 0, 1200, 0), &both_displays()),
            None
        );
        // No displays to check against at all is not a reason to guess.
        assert_eq!(restore_rect(&geometry(0, 0, 1200, 800), &[]), None);
    }

    #[test]
    fn remembers_the_geometry_across_a_write_and_a_read() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = state_path(dir.path());
        let saved = WindowGeometry {
            x: -1200,
            y: 300,
            width: 900,
            height: 700,
            maximized: true,
            fullscreen: false,
        };

        store(&path, &saved).expect("a geometry this small should write");
        assert_eq!(load(&path), Some(saved));
        // The temporary file is gone, not left beside the real one.
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn refuses_to_read_a_file_it_cannot_understand() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = state_path(dir.path());

        assert_eq!(load(&path), None, "nothing written yet");

        std::fs::write(&path, "{ not json").expect("write");
        assert_eq!(load(&path), None, "half a file is no better than none");

        // A file from a version that had not heard of the flags yet still
        // restores; the missing fields are the defaults, not an error.
        std::fs::write(&path, r#"{"x":10,"y":20,"width":800,"height":600}"#).expect("write");
        assert_eq!(load(&path), Some(geometry(10, 20, 800, 600)));
    }
}
