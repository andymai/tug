use std::f64::consts::TAU;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ksni::menu::StandardItem;
use ksni::{Category, Handle, MenuItem, OfflineReason, Status, ToolTip, Tray, TrayMethods};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio::sync::watch;
use tug_core::{Batch, DownloadState, Library};

pub const ID: &str = "io.github.andymai.Tug";
pub const ICON: &str = "io.github.andymai.Tug-symbolic";
pub const STEPS: u8 = 20;
const SYMBOLIC: &str = include_str!("../../../../brand/svg/symbolic-22.svg");
const RING_RADIUS: f64 = 9.5;
const PUBLISH_EVERY: Duration = Duration::from_secs(1);

pub fn progress_icon(step: u8) -> String {
    format!("{ID}-progress-{step:02}")
}

fn mark() -> &'static str {
    let open = r#"<g class="ColorScheme-Text">"#;
    SYMBOLIC
        .split_once(open)
        .and_then(|(_, rest)| rest.split_once("</g>"))
        .map_or("", |(body, _)| body)
}

pub fn ring_svg(step: u8) -> String {
    let step = step.min(STEPS);
    let length = TAU * RING_RADIUS * f64::from(step) / f64::from(STEPS);
    let arc = if step == 0 {
        String::new()
    } else {
        format!(
            r##"<circle cx="11" cy="11" r="{RING_RADIUS}" fill="none" stroke="#E35F1C" stroke-width="2" stroke-linecap="round" stroke-dasharray="{length:.2} 100" transform="rotate(-90 11 11)"/>"##
        )
    };
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="22" height="22"><style id="current-color-scheme">.ColorScheme-Text{{color:#232629;}}</style><circle class="ColorScheme-Text" cx="11" cy="11" r="{RING_RADIUS}" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="2"/>{arc}<g class="ColorScheme-Text" transform="translate(11 11) scale(0.6) translate(-11 -10.5)">{mark}</g></svg>"#,
        mark = mark()
    )
}

pub fn write_icons(dir: &Path) -> io::Result<()> {
    let themed = dir.join("hicolor").join("scalable").join("apps");
    std::fs::create_dir_all(&themed)?;
    for folder in [dir, themed.as_path()] {
        std::fs::write(folder.join(format!("{ICON}.svg")), SYMBOLIC)?;
        for step in 0..=STEPS {
            std::fs::write(
                folder.join(format!("{}.svg", progress_icon(step))),
                ring_svg(step),
            )?;
        }
    }
    Ok(())
}

#[allow(
    clippy::cast_precision_loss,
    reason = "a size shown with three significant figures"
)]
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 999.5 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        return format!("{value:.0} B");
    }
    let digits = if value >= 99.95 {
        0
    } else if value >= 9.995 {
        1
    } else {
        2
    };
    format!("{value:.digits$} {}", UNITS[unit])
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Summary {
    pub downloading: usize,
    pub paused: usize,
    pub received: u64,
    pub total: Option<u64>,
    pub speed: u64,
}

impl Summary {
    pub fn from_batch(batch: &Batch, paused: usize) -> Self {
        let sized: Vec<_> = batch
            .updates
            .iter()
            .filter_map(|u| u.total.map(|t| (u.received, t)))
            .collect();
        Self {
            downloading: batch.updates.len(),
            paused,
            received: sized.iter().map(|(received, _)| received).sum(),
            total: (!sized.is_empty()).then(|| sized.iter().map(|(_, total)| total).sum()),
            speed: batch.updates.iter().map(|u| u.speed).sum(),
        }
    }

    pub fn step(&self) -> Option<u8> {
        let total = self.total.filter(|&t| t > 0 && self.downloading > 0)?;
        let step = (u128::from(self.received.min(total)) * u128::from(STEPS) / u128::from(total))
            .try_into()
            .unwrap_or(STEPS);
        Some(step)
    }

    pub fn percent(&self) -> Option<u64> {
        let total = self.total.filter(|&t| t > 0)?;
        (u128::from(self.received.min(total)) * 100 / u128::from(total))
            .try_into()
            .ok()
    }

    pub fn icon(&self) -> String {
        self.step().map_or_else(|| ICON.into(), progress_icon)
    }

    pub fn description(&self) -> String {
        if self.downloading == 0 {
            return match self.paused {
                0 => "Nothing downloading".into(),
                n => format!("{n} paused"),
            };
        }
        let mut parts = vec![
            format!("{} downloading", self.downloading),
            format!("{}/s", format_bytes(self.speed)),
        ];
        if let Some(percent) = self.percent() {
            parts.push(format!("{percent}%"));
        }
        parts.join(" · ")
    }
}

pub struct TugTray<R: Runtime> {
    app: AppHandle<R>,
    icons: PathBuf,
    library: Arc<Library>,
    summary: Summary,
}

impl<R: Runtime> TugTray<R> {
    pub fn new(app: AppHandle<R>, icons: PathBuf, library: Arc<Library>) -> Self {
        Self {
            app,
            icons,
            library,
            summary: Summary::default(),
        }
    }

    fn window(&self) -> Option<WebviewWindow<R>> {
        self.app.get_webview_window("main")
    }

    fn each(&self, from: DownloadState, pause: bool) {
        let library = Arc::clone(&self.library);
        tauri::async_runtime::spawn(async move {
            let Ok(downloads) = library.list() else {
                return;
            };
            for download in downloads.iter().filter(|d| d.state == from) {
                let _changed = if pause {
                    library.pause(download.id).await
                } else {
                    library.resume(download.id).await
                };
            }
        });
    }
}

pub fn show<R: Runtime>(window: &WebviewWindow<R>) {
    if window.show().is_ok() {
        let _focused = window.set_focus();
    }
}

fn toggle<R: Runtime>(window: &WebviewWindow<R>) {
    if window.is_visible().unwrap_or(false) {
        let _hidden = window.hide();
    } else {
        show(window);
    }
}

impl<R: Runtime> Tray for TugTray<R> {
    fn id(&self) -> String {
        ID.into()
    }

    fn title(&self) -> String {
        "Tug".into()
    }

    fn category(&self) -> Category {
        Category::ApplicationStatus
    }

    fn status(&self) -> Status {
        if self.summary.downloading > 0 {
            Status::Active
        } else {
            Status::Passive
        }
    }

    fn icon_name(&self) -> String {
        self.summary.icon()
    }

    fn icon_theme_path(&self) -> String {
        self.icons.to_string_lossy().into_owned()
    }

    fn tool_tip(&self) -> ToolTip {
        ToolTip {
            title: "Tug".into(),
            description: self.summary.description(),
            ..ToolTip::default()
        }
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        if let Some(window) = self.window() {
            toggle(&window);
        }
    }

    fn watcher_online(&self) {
        self.app
            .state::<TrayState<R>>()
            .online
            .store(true, Ordering::SeqCst);
    }

    fn watcher_offline(&self, _reason: OfflineReason) -> bool {
        self.app
            .state::<TrayState<R>>()
            .online
            .store(false, Ordering::SeqCst);
        if let Some(window) = self.window() {
            show(&window);
        }
        true
    }

    fn menu(&self) -> Vec<MenuItem<Self>> {
        vec![
            StandardItem {
                label: "Open Tug".into(),
                activate: Box::new(|tray: &mut Self| {
                    if let Some(window) = tray.window() {
                        show(&window);
                    }
                }),
                ..StandardItem::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "Pause all".into(),
                enabled: self.summary.downloading > 0,
                activate: Box::new(|tray: &mut Self| tray.each(DownloadState::Downloading, true)),
                ..StandardItem::default()
            }
            .into(),
            StandardItem {
                label: "Resume all".into(),
                enabled: self.summary.paused > 0,
                activate: Box::new(|tray: &mut Self| tray.each(DownloadState::Paused, false)),
                ..StandardItem::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "Quit Tug".into(),
                activate: Box::new(|tray: &mut Self| tray.app.exit(0)),
                ..StandardItem::default()
            }
            .into(),
        ]
    }
}

pub struct TrayState<R: Runtime> {
    handle: Mutex<Option<Handle<TugTray<R>>>>,
    online: AtomicBool,
}

impl<R: Runtime> Default for TrayState<R> {
    fn default() -> Self {
        Self {
            handle: Mutex::new(None),
            online: AtomicBool::new(false),
        }
    }
}

impl<R: Runtime> TrayState<R> {
    pub fn shown(&self) -> bool {
        self.online.load(Ordering::SeqCst)
    }

    fn set(&self, handle: Handle<TugTray<R>>) {
        if let Ok(mut slot) = self.handle.lock() {
            *slot = Some(handle);
        }
        self.online.store(true, Ordering::SeqCst);
    }

    fn handle(&self) -> Option<Handle<TugTray<R>>> {
        self.handle.lock().ok().and_then(|slot| slot.clone())
    }
}

fn paused(library: &Library) -> usize {
    library.list().map_or(0, |downloads| {
        downloads
            .iter()
            .filter(|d| d.state == DownloadState::Paused)
            .count()
    })
}

fn follow<R: Runtime>(
    app: AppHandle<R>,
    library: Arc<Library>,
    mut batches: watch::Receiver<Arc<Batch>>,
) {
    tauri::async_runtime::spawn(async move {
        let mut published: Option<(Summary, Instant)> = None;
        while batches.changed().await.is_ok() {
            let batch = Arc::clone(&batches.borrow_and_update());
            let now = Instant::now();
            let due = !batch.settled.is_empty()
                || published
                    .as_ref()
                    .is_none_or(|(_, at)| now.duration_since(*at) >= PUBLISH_EVERY);
            if !due {
                continue;
            }
            let summary = Summary::from_batch(&batch, paused(&library));
            if published.as_ref().is_some_and(|(last, _)| *last == summary) {
                continue;
            }
            let Some(handle) = app.state::<TrayState<R>>().handle() else {
                continue;
            };
            let next = summary.clone();
            handle.update(move |tray| tray.summary = next).await;
            published = Some((summary, now));
        }
    });
}

pub fn spawn<R: Runtime>(
    app: &AppHandle<R>,
    icons: PathBuf,
    library: Arc<Library>,
    batches: watch::Receiver<Arc<Batch>>,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if write_icons(&icons).is_err() {
            return;
        }
        let tray = TugTray::new(app.clone(), icons, Arc::clone(&library));
        if let Ok(handle) = tray.spawn().await {
            app.state::<TrayState<R>>().set(handle);
            follow(app, library, batches);
        }
    });
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use tug_core::{DownloadId, Phase, Update};

    use super::*;

    const MB: u64 = 1 << 20;

    fn update(received: u64, total: Option<u64>, speed: u64) -> Update {
        Update {
            id: DownloadId::from(1),
            phase: Phase::Downloading,
            received,
            total,
            speed,
            left: None,
            connections: 8,
        }
    }

    fn batch(updates: Vec<Update>) -> Batch {
        Batch {
            updates,
            ..Batch::default()
        }
    }

    #[test]
    fn every_icon_lands_flat_and_in_a_hicolor_tree() {
        let dir = tempfile::tempdir().unwrap();
        write_icons(dir.path()).unwrap();
        for folder in [
            dir.path().to_owned(),
            dir.path().join("hicolor/scalable/apps"),
        ] {
            for name in [ICON.to_owned(), progress_icon(0), progress_icon(STEPS)] {
                let svg = std::fs::read_to_string(folder.join(format!("{name}.svg"))).unwrap();
                assert!(
                    svg.contains("ColorScheme-Text"),
                    "{name} lost the class Plasma recolors"
                );
                assert!(svg.contains(r#"viewBox="0 0 22 22""#));
            }
        }
    }

    #[test]
    fn the_ring_grows_with_the_step_around_the_mark() {
        assert!(!ring_svg(0).contains("stroke-dasharray"));
        assert!(ring_svg(10).contains(r#"stroke-dasharray="29.85 100""#));
        assert!(ring_svg(STEPS).contains(r#"stroke-dasharray="59.69 100""#));
        assert!(
            ring_svg(10).contains(r#"<rect x="10" y="4""#),
            "the mark is missing"
        );
        assert_eq!(ring_svg(STEPS + 5), ring_svg(STEPS));
    }

    #[test]
    fn sizes_read_as_the_window_shows_them() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(412 * MB), "412 MB");
        assert_eq!(format_bytes(18 * MB + 400 * 1024), "18.4 MB");
        assert_eq!(format_bytes(4 * 1024 * MB + 205 * MB), "4.20 GB");
    }

    #[test]
    fn a_summary_tells_the_icon_the_status_and_the_tooltip() {
        let idle = Summary::from_batch(&batch(vec![]), 0);
        assert_eq!(
            (idle.icon(), idle.description()),
            (ICON.to_owned(), "Nothing downloading".to_owned())
        );
        assert_eq!(
            Summary::from_batch(&batch(vec![]), 2).description(),
            "2 paused"
        );

        let running = Summary::from_batch(
            &batch(vec![
                update(25 * MB, Some(100 * MB), 10 * MB),
                update(25 * MB, Some(100 * MB), 8 * MB + 410 * 1024),
            ]),
            1,
        );
        assert_eq!(running.step(), Some(5));
        assert_eq!(running.icon(), progress_icon(5));
        assert_eq!(running.description(), "2 downloading · 18.4 MB/s · 25%");

        let no_size = Summary::from_batch(&batch(vec![update(3 * MB, None, MB)]), 0);
        assert_eq!(no_size.icon(), ICON);
        assert_eq!(no_size.description(), "1 downloading · 1.00 MB/s");
    }
}
