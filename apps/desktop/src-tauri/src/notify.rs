use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::broadcast;
use tug_core::{Download, DownloadId, DownloadState, Library};
use url::Url;
use zbus::zvariant::Value;

use crate::{bridge, tray};

pub const FOCUS_EVENT: &str = "focus-download";
const REMEMBERED: usize = 64;

#[zbus::proxy(
    interface = "org.freedesktop.Notifications",
    default_service = "org.freedesktop.Notifications",
    default_path = "/org/freedesktop/Notifications"
)]
trait Notifications {
    #[allow(
        clippy::too_many_arguments,
        reason = "the D-Bus method has eight arguments"
    )]
    fn notify(
        &self,
        app_name: &str,
        replaces_id: u32,
        app_icon: &str,
        summary: &str,
        body: &str,
        actions: &[&str],
        hints: HashMap<&str, Value<'_>>,
        expire_timeout: i32,
    ) -> zbus::Result<u32>;

    #[zbus(signal)]
    fn action_invoked(&self, id: u32, action_key: String) -> zbus::Result<()>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub summary: &'static str,
    pub body: String,
    pub actions: Vec<(&'static str, &'static str)>,
    pub category: &'static str,
    pub file: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Act {
    Show,
    Open,
    Folder,
}

// Notification servers may read the body as markup.
fn escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn notice(download: &Download) -> Option<Notice> {
    let name = escaped(&download.name());
    match download.state {
        DownloadState::Done => Some(Notice {
            summary: "Download finished",
            body: name,
            actions: vec![
                ("default", "Show in Tug"),
                ("open", "Open"),
                ("folder", "Show in folder"),
            ],
            category: "transfer.complete",
            file: download
                .file
                .as_deref()
                .and_then(|file| Url::from_file_path(file).ok())
                .map(String::from),
        }),
        DownloadState::Failed => Some(Notice {
            summary: "Download failed",
            body: match &download.error {
                Some(reason) => format!("{name}: {}", escaped(reason)),
                None => name,
            },
            actions: vec![("default", "Show in Tug")],
            category: "transfer.error",
            file: None,
        }),
        _ => None,
    }
}

pub fn act(key: &str) -> Option<Act> {
    match key {
        "default" => Some(Act::Show),
        "open" => Some(Act::Open),
        "folder" => Some(Act::Folder),
        _ => None,
    }
}

async fn send(proxy: &NotificationsProxy<'_>, notice: &Notice) -> zbus::Result<u32> {
    let actions: Vec<&str> = notice
        .actions
        .iter()
        .flat_map(|&pair| <[&str; 2]>::from(pair))
        .collect();
    let mut hints: HashMap<&str, Value<'_>> = HashMap::new();
    hints.insert("desktop-entry", Value::from(tug_ipc::APP_ID));
    hints.insert("category", Value::from(notice.category));
    if let Some(file) = &notice.file {
        hints.insert("x-kde-urls", Value::from(vec![file.as_str()]));
    }
    proxy
        .notify(
            "Tug",
            0,
            tug_ipc::APP_ID,
            notice.summary,
            &notice.body,
            &actions,
            hints,
            -1,
        )
        .await
}

async fn answer<R: Runtime>(app: &AppHandle<R>, download: &Download, act: Act) {
    let result = match act {
        Act::Show => {
            if let Some(window) = app.get_webview_window("main") {
                tray::show(&window);
            }
            let _sent = app.emit(FOCUS_EVENT, download.id.get());
            Ok(())
        }
        Act::Open => bridge::open_download(app, download).await,
        Act::Folder => bridge::reveal_download(app, download).await,
    };
    if let Err(e) = result {
        let _sent = app.emit(tray::NOTICE_EVENT, e.message);
    }
}

type Shown = Arc<Mutex<VecDeque<(u32, DownloadId)>>>;

fn remember(shown: &Shown, notification: u32, id: DownloadId) {
    if let Ok(mut shown) = shown.lock() {
        if shown.len() == REMEMBERED {
            shown.pop_front();
        }
        shown.push_back((notification, id));
    }
}

fn recall(shown: &Shown, notification: u32) -> Option<DownloadId> {
    let shown = shown.lock().ok()?;
    shown
        .iter()
        .find(|&&(n, _)| n == notification)
        .map(|&(_, id)| id)
}

pub fn spawn<R: Runtime>(
    app: &AppHandle<R>,
    library: Arc<Library>,
    mut settled: broadcast::Receiver<DownloadId>,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(connection) = zbus::Connection::session().await else {
            return;
        };
        let Ok(proxy) = NotificationsProxy::new(&connection).await else {
            return;
        };
        let shown: Shown = Arc::default();
        if let Ok(mut invoked) = proxy.receive_action_invoked().await {
            let app = app.clone();
            let library = Arc::clone(&library);
            let shown = Arc::clone(&shown);
            tauri::async_runtime::spawn(async move {
                while let Some(signal) = invoked.next().await {
                    let Ok(args) = signal.args() else { continue };
                    let Some(id) = recall(&shown, args.id) else {
                        continue;
                    };
                    if let (Some(act), Ok(download)) = (act(&args.action_key), library.get(id)) {
                        answer(&app, &download, act).await;
                    }
                }
            });
        }
        loop {
            let id = match settled.recv().await {
                Ok(id) => id,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            };
            let Some(notice) = library.get(id).ok().as_ref().and_then(notice) else {
                continue;
            };
            let proxy = proxy.clone();
            let shown = Arc::clone(&shown);
            tauri::async_runtime::spawn(async move {
                if let Ok(notification) = send(&proxy, &notice).await {
                    remember(&shown, notification, id);
                }
            });
        }
    });
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::path::PathBuf;
    use std::time::SystemTime;

    use super::*;

    fn download(state: DownloadState, file: Option<&str>, error: Option<&str>) -> Download {
        Download {
            id: DownloadId::from(7),
            url: Url::parse("https://example.org/fedora.iso").unwrap(),
            dir: PathBuf::from("/home/u/Downloads"),
            file: file.map(PathBuf::from),
            state,
            size: Some(4 << 20),
            received: 4 << 20,
            error: error.map(str::to_owned),
            added: SystemTime::UNIX_EPOCH,
            finished: None,
            position: 1,
            connections: None,
            speed_limit: None,
            own_name: None,
        }
    }

    #[test]
    fn a_finished_download_offers_open_and_its_folder_with_a_preview() {
        let done = notice(&download(
            DownloadState::Done,
            Some("/home/u/Downloads/Q&A <final>.pdf"),
            None,
        ))
        .unwrap();
        assert_eq!(done.summary, "Download finished");
        assert_eq!(done.body, "Q&amp;A &lt;final&gt;.pdf");
        assert_eq!(
            done.actions,
            vec![
                ("default", "Show in Tug"),
                ("open", "Open"),
                ("folder", "Show in folder")
            ]
        );
        assert_eq!(done.category, "transfer.complete");
        assert_eq!(
            done.file.as_deref(),
            Some("file:///home/u/Downloads/Q&A%20%3Cfinal%3E.pdf")
        );
    }

    #[test]
    fn a_failed_download_says_why_and_only_offers_tug() {
        let failed = notice(&download(
            DownloadState::Failed,
            None,
            Some("the server said 404 <Not Found>"),
        ))
        .unwrap();
        assert_eq!(failed.summary, "Download failed");
        assert_eq!(
            failed.body,
            "fedora.iso: the server said 404 &lt;Not Found&gt;"
        );
        assert_eq!(failed.actions, vec![("default", "Show in Tug")]);
        assert_eq!(failed.file, None);
    }

    #[test]
    fn a_pause_or_a_queue_says_nothing() {
        for state in [
            DownloadState::Paused,
            DownloadState::Queued,
            DownloadState::Downloading,
        ] {
            assert_eq!(notice(&download(state, None, None)), None);
        }
    }

    #[test]
    fn actions_map_to_what_tug_does_and_old_notifications_are_forgotten() {
        assert_eq!(act("default"), Some(Act::Show));
        assert_eq!(act("open"), Some(Act::Open));
        assert_eq!(act("folder"), Some(Act::Folder));
        assert_eq!(act("dismiss"), None);

        let shown: Shown = Arc::default();
        for n in 0..=u32::try_from(REMEMBERED).unwrap() {
            remember(&shown, n, DownloadId::from(i64::from(n)));
        }
        assert_eq!(recall(&shown, 0), None);
        assert_eq!(recall(&shown, 1), Some(DownloadId::from(1)));
    }
}
