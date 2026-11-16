use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::watch;
use tug_core::Batch;
use zbus::Variant;

use crate::tray::Summary;

const INTERFACE: &str = "com.canonical.Unity.LauncherEntry";
const PATH: &str = "/io/github/andymai/Tug/LauncherEntry";
const APP_URI: &str = "application://io.github.andymai.Tug.desktop";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry {
    pub percent: Option<u8>,
    pub count: usize,
}

pub fn entry(summary: &Summary) -> Entry {
    Entry {
        percent: (summary.downloading > 0)
            .then(|| summary.percent())
            .flatten()
            .map(|percent| u8::try_from(percent.min(100)).unwrap_or(100)),
        count: summary.downloading,
    }
}

pub fn properties(entry: Entry) -> HashMap<&'static str, Variant<'static>> {
    HashMap::from([
        (
            "progress",
            Variant::from(f64::from(entry.percent.unwrap_or(0)) / 100.0),
        ),
        ("progress-visible", Variant::from(entry.percent.is_some())),
        (
            "count",
            Variant::from(i64::try_from(entry.count).unwrap_or(i64::MAX)),
        ),
        ("count-visible", Variant::from(entry.count > 0)),
    ])
}

pub fn spawn(mut batches: watch::Receiver<Arc<Batch>>) {
    tauri::async_runtime::spawn(async move {
        let Ok(connection) = zbus::Connection::session().await else {
            return;
        };
        let mut published: Option<Entry> = None;
        while batches.changed().await.is_ok() {
            let batch = Arc::clone(&batches.borrow_and_update());
            let next = entry(&Summary::from_batch(&batch, 0));
            if published == Some(next) {
                continue;
            }
            let sent = connection
                .emit_signal(
                    None::<&str>,
                    PATH,
                    INTERFACE,
                    "Update",
                    &(APP_URI, properties(next)),
                )
                .await;
            if sent.is_ok() {
                published = Some(next);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(downloading: usize, received: u64, total: Option<u64>) -> Summary {
        Summary {
            downloading,
            paused: 0,
            received,
            total,
            speed: 0,
        }
    }

    #[test]
    fn running_downloads_show_their_share_done_and_their_count() {
        assert_eq!(
            entry(&summary(2, 1 << 20, Some(4 << 20))),
            Entry {
                percent: Some(25),
                count: 2
            }
        );
        let props = properties(entry(&summary(2, 1 << 20, Some(4 << 20))));
        assert_eq!(props["progress"], Variant::from(0.25));
        assert_eq!(props["progress-visible"], Variant::from(true));
        assert_eq!(props["count"], Variant::from(2_i64));
        assert_eq!(props["count-visible"], Variant::from(true));
    }

    #[test]
    fn unknown_sizes_show_only_the_count_and_idle_shows_nothing() {
        assert_eq!(
            entry(&summary(1, 5, None)),
            Entry {
                percent: None,
                count: 1
            }
        );
        let idle = properties(entry(&summary(0, 9, Some(10))));
        assert_eq!(idle["progress-visible"], Variant::from(false));
        assert_eq!(idle["count-visible"], Variant::from(false));
    }
}
