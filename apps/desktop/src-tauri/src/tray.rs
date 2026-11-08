use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use ksni::menu::StandardItem;
use ksni::{Category, Handle, MenuItem, OfflineReason, ToolTip, Tray, TrayMethods};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

pub const ID: &str = "io.github.andymai.Tug";
pub const ICON: &str = "io.github.andymai.Tug-symbolic";
const SYMBOLIC: &str = include_str!("../../../../brand/svg/symbolic-22.svg");

pub fn write_icons(dir: &Path) -> io::Result<()> {
    let themed = dir.join("hicolor").join("scalable").join("apps");
    std::fs::create_dir_all(&themed)?;
    for folder in [dir, themed.as_path()] {
        std::fs::write(folder.join(format!("{ICON}.svg")), SYMBOLIC)?;
    }
    Ok(())
}

pub struct TugTray<R: Runtime> {
    app: AppHandle<R>,
    icons: PathBuf,
}

impl<R: Runtime> TugTray<R> {
    pub const fn new(app: AppHandle<R>, icons: PathBuf) -> Self {
        Self { app, icons }
    }

    fn window(&self) -> Option<WebviewWindow<R>> {
        self.app.get_webview_window("main")
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

    fn icon_name(&self) -> String {
        ICON.into()
    }

    fn icon_theme_path(&self) -> String {
        self.icons.to_string_lossy().into_owned()
    }

    fn tool_tip(&self) -> ToolTip {
        ToolTip {
            title: "Tug".into(),
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
}

pub fn spawn<R: Runtime>(app: &AppHandle<R>, icons: PathBuf) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if write_icons(&icons).is_err() {
            return;
        }
        if let Ok(handle) = TugTray::new(app.clone(), icons).spawn().await {
            app.state::<TrayState<R>>().set(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn the_symbolic_icon_lands_flat_and_in_a_hicolor_tree() {
        let dir = tempfile::tempdir().unwrap();
        write_icons(dir.path()).unwrap();
        for file in [
            dir.path().join(format!("{ICON}.svg")),
            dir.path()
                .join("hicolor/scalable/apps")
                .join(format!("{ICON}.svg")),
        ] {
            let svg = std::fs::read_to_string(&file).unwrap();
            assert!(
                svg.contains("ColorScheme-Text"),
                "{} lost the class Plasma recolors",
                file.display()
            );
            assert!(svg.contains(r#"viewBox="0 0 22 22""#));
        }
    }
}
