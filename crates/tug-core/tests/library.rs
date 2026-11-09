#![allow(clippy::unwrap_used)]

use std::path::Path;
use std::time::{Duration, Instant};

use mdm_labserver::{Config, LabServer, content};
use tug_core::{
    ConnectionStatus, Download, DownloadId, DownloadState, EventKind, Library, LibraryError,
    MINUTES_PER_DAY, Origin, Place, Schedule, Settings, Store,
};

fn assert_intact(path: &Path, seed: u64, len: usize) {
    let mut want = vec![0; len];
    content::fill(seed, 0, &mut want);
    let got = std::fs::read(path).unwrap();
    assert_eq!(got.len(), len, "size of {}", path.display());
    assert!(got == want, "content of {}", path.display());
}

async fn tick_until(library: &Library, done: impl Fn(&Library) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        library.tick().await.unwrap();
        if done(library) {
            return;
        }
        assert!(Instant::now() < deadline, "timed out: {:?}", library.list());
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn kinds(library: &Library, id: DownloadId) -> Vec<EventKind> {
    library
        .events(id)
        .unwrap()
        .into_iter()
        .map(|e| e.kind)
        .collect()
}

fn state_of(library: &Library, id: DownloadId) -> DownloadState {
    library.get(id).unwrap().state
}

async fn received_at_least(library: &Library, id: DownloadId, bytes: u64) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let live = library.tick().await.unwrap().live;
        if live.iter().any(|(i, p)| *i == id && p.received >= bytes) {
            return;
        }
        assert!(Instant::now() < deadline, "never reached {bytes} bytes");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn adds_and_completes_a_download() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();

    let url = lab.url("/gen/3M/fedora.iso?seed=3").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    tick_until(&library, |l| state_of(l, id) == DownloadState::Done).await;

    let done: Download = library.get(id).unwrap();
    let file = done.file.clone().unwrap();
    assert_eq!(file, dir.path().join("fedora.iso"));
    assert_intact(&file, 3, 3 << 20);
    assert_eq!((done.received, done.size), (3 << 20, Some(3 << 20)));
    assert!(done.finished.is_some() && done.error.is_none());

    let events = library.events(id).unwrap();
    assert_eq!(
        kinds(&library, id),
        [EventKind::Added, EventKind::Started, EventKind::Finished]
    );
    assert_eq!(events[2].bytes, Some(3 << 20));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_paused_download_resumes_to_an_intact_file() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();

    let url = lab.url("/gen/6M/talk.mp4?seed=11&rate=1M").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    received_at_least(&library, id, 1 << 20).await;
    library.pause(id).await.unwrap();

    let paused = library.get(id).unwrap();
    assert_eq!(paused.state, DownloadState::Paused);
    assert!(paused.received > 0 && paused.error.is_none());
    assert!(
        !paused.file.clone().unwrap().exists(),
        "no final file while paused"
    );

    library.resume(id).await.unwrap();
    tick_until(&library, |l| state_of(l, id) == DownloadState::Done).await;
    assert_intact(&library.get(id).unwrap().file.unwrap(), 11, 6 << 20);

    assert_eq!(
        kinds(&library, id),
        [
            EventKind::Added,
            EventKind::Started,
            EventKind::Paused,
            EventKind::Resumed,
            EventKind::Finished
        ]
    );
    let events = library.events(id).unwrap();
    assert_eq!(events[2].bytes, Some(paused.received));
    assert_eq!(events[3].bytes, Some(paused.received));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_download_shows_its_segments_connections_server_and_log_and_keeps_them_when_paused() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();

    let url = lab
        .url("/gen/8M/fedora.iso?seed=5&rate=2M")
        .parse()
        .unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    received_at_least(&library, id, 1 << 20).await;

    let seen = library.inspect(id).await.unwrap().unwrap();
    let segments = &seen.segments;
    assert_eq!(segments.first().map(|s| s.start), Some(0), "{segments:?}");
    assert_eq!(
        segments.last().map(|s| s.end),
        Some(8 << 20),
        "{segments:?}"
    );
    assert!(
        segments.windows(2).all(|w| w[0].end == w[1].start),
        "{segments:?}"
    );
    let on_disk: u64 = segments.iter().map(|s| s.cursor - s.start).sum();
    assert!(on_disk > 0, "{segments:?}");
    assert!(
        seen.connections
            .iter()
            .any(|c| c.status == ConnectionStatus::Receiving && c.received > 0),
        "{:?}",
        seen.connections
    );
    let server = seen.server.unwrap();
    assert!(server.ip.is_some_and(|ip| ip.is_loopback()), "{server:?}");
    assert!(!server.proxied && server.cdn.is_none(), "{server:?}");
    assert!(!seen.log.is_empty());
    assert!(seen.log.windows(2).all(|w| w[0].seq < w[1].seq));

    library.pause(id).await.unwrap();
    let kept = library.inspect(id).await.unwrap().unwrap();
    assert_eq!(kept.segments.last().map(|s| s.end), Some(8 << 20));
    assert!(kept.log.len() >= seen.log.len(), "{:?}", kept.log);

    library.remove(id, true).await.unwrap();
    assert!(matches!(
        library.inspect(id).await,
        Err(LibraryError::Unknown(_))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn downloads_running_at_shutdown_resume_when_the_library_opens() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("tug.db");
    let downloads = dir.path().join("downloads");
    std::fs::create_dir(&downloads).unwrap();

    let id = {
        let library = Library::open(Store::open(&db).unwrap()).await.unwrap();
        let url = lab
            .url("/gen/6M/backup.tar?seed=17&rate=1M")
            .parse()
            .unwrap();
        let id = library.add(url, &downloads).await.unwrap();
        received_at_least(&library, id, 1 << 20).await;
        library.pause(id).await.unwrap();
        id
    };
    Store::open(&db)
        .unwrap()
        .set_state(
            id,
            DownloadState::Downloading,
            None,
            std::time::SystemTime::now(),
        )
        .unwrap();

    let library = Library::open(Store::open(&db).unwrap()).await.unwrap();
    assert_eq!(state_of(&library, id), DownloadState::Downloading);
    tick_until(&library, |l| state_of(l, id) == DownloadState::Done).await;
    assert_intact(&library.get(id).unwrap().file.unwrap(), 17, 6 << 20);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_browser_origin_survives_a_restart_and_is_forgotten_when_done() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("tug.db");
    let downloads = dir.path().join("downloads");
    std::fs::create_dir(&downloads).unwrap();
    let origin = Origin::new(None, Some("token=xyz"), Some("Mozilla/5.0 Firefox/150.0")).unwrap();

    let id = {
        let library = Library::open(Store::open(&db).unwrap()).await.unwrap();
        let url = lab
            .url("/gen/4M/private.zip?seed=31&rate=1M")
            .parse()
            .unwrap();
        let id = library.add_from(url, &downloads, &origin).await.unwrap();
        received_at_least(&library, id, 1 << 20).await;
        library.pause(id).await.unwrap();
        id
    };
    assert_eq!(Store::open(&db).unwrap().origin(id).unwrap(), origin);
    let before = lab.log().len();

    let library = Library::open(Store::open(&db).unwrap()).await.unwrap();
    library.resume(id).await.unwrap();
    tick_until(&library, |l| state_of(l, id) == DownloadState::Done).await;
    assert_intact(&library.get(id).unwrap().file.unwrap(), 31, 4 << 20);

    let log = lab.log();
    assert!(log.len() > before);
    assert!(
        log[before..]
            .iter()
            .all(|e| e.cookie.as_deref() == Some("token=xyz")
                && e.user_agent.as_deref() == Some("Mozilla/5.0 Firefox/150.0")),
        "{:?}",
        &log[before..]
    );
    assert_eq!(
        Store::open(&db).unwrap().origin(id).unwrap(),
        Origin::default()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_paused_add_waits_for_resume_then_downloads_with_its_origin() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();
    let origin = Origin::new(None, Some("session=wait"), None).unwrap();

    let url = lab.url("/gen/2M/held.bin?seed=37").parse().unwrap();
    let id = library.add_paused(url, dir.path(), &origin).unwrap();
    assert_eq!(state_of(&library, id), DownloadState::Paused);
    assert_eq!(kinds(&library, id), vec![EventKind::Added]);
    library.tick().await.unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(lab.log().is_empty(), "a paused add sent {:?}", lab.log());

    library.resume(id).await.unwrap();
    tick_until(&library, |l| state_of(l, id) == DownloadState::Done).await;
    assert_intact(&library.get(id).unwrap().file.unwrap(), 37, 2 << 20);
    assert!(
        lab.log()
            .iter()
            .all(|e| e.cookie.as_deref() == Some("session=wait"))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn only_a_paused_download_goes_when_removed_if_paused() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();
    let origin = Origin::default();
    let waiting = library
        .add_paused(
            lab.url("/gen/1M/w.bin?seed=41").parse().unwrap(),
            dir.path(),
            &origin,
        )
        .unwrap();
    let running = library
        .add_paused(
            lab.url("/gen/8M/r.bin?seed=43&rate=1M").parse().unwrap(),
            dir.path(),
            &origin,
        )
        .unwrap();
    library.resume(running).await.unwrap();

    assert!(!library.remove_if_paused(running).await.unwrap());
    assert_eq!(state_of(&library, running), DownloadState::Downloading);
    assert!(library.remove_if_paused(waiting).await.unwrap());
    assert!(matches!(
        library.get(waiting),
        Err(LibraryError::Unknown(_))
    ));
    assert!(matches!(
        library.resume(waiting).await,
        Err(LibraryError::Unknown(_))
    ));
}

async fn limited(max_active: u32) -> Library {
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();
    library
        .update_settings(Settings {
            max_active,
            ..library.settings().unwrap()
        })
        .unwrap();
    library
}

// Hours that hold the present local minute, or that start two hours from now.
fn hours(open: bool) -> Schedule {
    let now = jiff::Zoned::now();
    let minute = i32::from(now.hour()) * 60 + i32::from(now.minute());
    let shift =
        |by: i32| u16::try_from((minute + by).rem_euclid(i32::from(MINUTES_PER_DAY))).unwrap();
    let (start, stop) = if open { (-60, 60) } else { (120, 180) };
    Schedule {
        days: Schedule::EVERY_DAY,
        start: shift(start),
        stop: shift(stop),
    }
}

fn schedule(library: &Library, schedule: Schedule) {
    library
        .update_settings(Settings {
            schedule: Some(schedule),
            ..library.settings().unwrap()
        })
        .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn downloads_wait_for_the_scheduled_hours_and_go_back_to_the_queue_after_them() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = limited(3).await;
    schedule(&library, hours(false));
    let url = lab
        .url("/gen/4M/night.bin?seed=91&rate=1M")
        .parse()
        .unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    library.tick().await.unwrap();
    assert_eq!(state_of(&library, id), DownloadState::Queued);
    assert!(lab.log().is_empty(), "it sent {:?}", lab.log());

    schedule(&library, hours(true));
    library.tick().await.unwrap();
    assert_eq!(state_of(&library, id), DownloadState::Downloading);
    received_at_least(&library, id, 256 << 10).await;

    schedule(&library, hours(false));
    let tick = library.tick().await.unwrap();
    assert_eq!(state_of(&library, id), DownloadState::Queued);
    assert_eq!(tick.changed, vec![id]);
    assert_eq!(
        kinds(&library, id),
        [EventKind::Added, EventKind::Started, EventKind::Paused]
    );
    assert!(library.get(id).unwrap().received >= 256 << 10);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_queue_starts_downloads_in_order_up_to_the_limit() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = limited(1).await;
    let link = |name: &str, seed: u32| {
        lab.url(&format!("/gen/2M/{name}?seed={seed}&rate=4M"))
            .parse()
            .unwrap()
    };
    let a = library.add(link("a.bin", 51), dir.path()).await.unwrap();
    let b = library.add(link("b.bin", 52), dir.path()).await.unwrap();
    let c = library.add(link("c.bin", 53), dir.path()).await.unwrap();
    assert_eq!(
        [a, b, c].map(|id| state_of(&library, id)),
        [
            DownloadState::Downloading,
            DownloadState::Queued,
            DownloadState::Queued
        ]
    );

    assert!(library.place(c, Place::First).unwrap());
    library.pause(a).await.unwrap();
    assert_eq!(state_of(&library, c), DownloadState::Downloading);
    assert_eq!(state_of(&library, b), DownloadState::Queued);

    library.resume(a).await.unwrap();
    assert_eq!(
        state_of(&library, a),
        DownloadState::Queued,
        "the limit holds"
    );
    tick_until(&library, |l| state_of(l, c) == DownloadState::Done).await;
    tick_until(&library, |l| state_of(l, a) != DownloadState::Queued).await;
    assert_eq!(
        state_of(&library, b),
        DownloadState::Queued,
        "a keeps its place ahead of b"
    );
    tick_until(&library, |l| {
        [a, b]
            .iter()
            .all(|&id| state_of(l, id) == DownloadState::Done)
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_next_tick_reports_what_changed_outside_a_tick() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = limited(1).await;
    let link = |name: &str| {
        lab.url(&format!("/gen/4M/{name}?seed=81&rate=1M"))
            .parse()
            .unwrap()
    };
    let a = library.add(link("a.bin"), dir.path()).await.unwrap();
    let b = library.add(link("b.bin"), dir.path()).await.unwrap();
    assert_eq!(library.tick().await.unwrap().changed, vec![a, b]);
    let deadline = Instant::now() + Duration::from_secs(20);
    while library.get(a).unwrap().file.is_none() {
        assert!(Instant::now() < deadline, "a never got its file name");
        library.tick().await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(library.tick().await.unwrap().changed.is_empty());

    library.pause_all().await.unwrap();
    assert_eq!(library.tick().await.unwrap().changed, vec![a, b]);
    library.resume_all().await.unwrap();
    let tick = library.tick().await.unwrap();
    assert_eq!(tick.changed, vec![a, b]);
    assert_eq!(state_of(&library, b), DownloadState::Queued);
    assert!(tick.settled.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_download_that_cannot_start_settles_as_failed_on_the_next_tick() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = limited(1).await;
    let url = lab
        .url("/gen/4M/broken.bin?seed=83&rate=1M")
        .parse()
        .unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    received_at_least(&library, id, 256 << 10).await;
    library.pause(id).await.unwrap();
    let file = library.get(id).unwrap().file.unwrap();
    std::fs::write(mdm_engine::state::state_path(&file), "not a state file").unwrap();
    library.tick().await.unwrap();

    library.resume(id).await.unwrap();
    let failed = library.get(id).unwrap();
    assert_eq!(failed.state, DownloadState::Failed);
    assert!(failed.error.is_some_and(|e| !e.is_empty()));
    assert_eq!(library.tick().await.unwrap().settled, vec![id]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_raised_limit_starts_the_waiting_on_the_next_tick_and_a_paused_wait_leaves_the_queue() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = limited(1).await;
    let link = |name: &str| {
        lab.url(&format!("/gen/4M/{name}?seed=61&rate=1M"))
            .parse()
            .unwrap()
    };
    let a = library.add(link("a.bin"), dir.path()).await.unwrap();
    let b = library.add(link("b.bin"), dir.path()).await.unwrap();
    let c = library.add(link("c.bin"), dir.path()).await.unwrap();

    library.pause(c).await.unwrap();
    assert_eq!(state_of(&library, c), DownloadState::Paused);
    assert_eq!(
        kinds(&library, c),
        vec![EventKind::Added, EventKind::Paused]
    );

    library
        .update_settings(Settings {
            max_active: 3,
            ..library.settings().unwrap()
        })
        .unwrap();
    library.tick().await.unwrap();
    assert_eq!(
        [a, b, c].map(|id| state_of(&library, id)),
        [
            DownloadState::Downloading,
            DownloadState::Downloading,
            DownloadState::Paused
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn pause_all_holds_the_queue_too_and_resume_all_refills_it_in_order() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = limited(1).await;
    let link = |name: &str| {
        lab.url(&format!("/gen/4M/{name}?seed=71&rate=1M"))
            .parse()
            .unwrap()
    };
    let a = library.add(link("a.bin"), dir.path()).await.unwrap();
    let b = library.add(link("b.bin"), dir.path()).await.unwrap();
    let c = library.add(link("c.bin"), dir.path()).await.unwrap();
    received_at_least(&library, a, 256 << 10).await;

    library.pause_all().await.unwrap();
    library.tick().await.unwrap();
    assert_eq!(
        [a, b, c].map(|id| state_of(&library, id)),
        [DownloadState::Paused; 3],
        "nothing took the freed place"
    );
    assert_eq!(
        kinds(&library, b),
        vec![EventKind::Added, EventKind::Paused]
    );

    let mut queued = library.resume_all().await.unwrap();
    queued.sort();
    assert_eq!(queued, vec![a, b, c]);
    assert_eq!(
        [a, b, c].map(|id| state_of(&library, id)),
        [
            DownloadState::Downloading,
            DownloadState::Queued,
            DownloadState::Queued
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_with_delete_clears_the_partial_files() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();

    let url = lab
        .url("/gen/6M/dataset.bin?seed=5&rate=1M")
        .parse()
        .unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    received_at_least(&library, id, 1 << 20).await;
    library.pause(id).await.unwrap();
    assert!(
        std::fs::read_dir(dir.path()).unwrap().count() > 0,
        "the paused download left its part and state files"
    );

    library.remove(id, true).await.unwrap();
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        0,
        "files left behind"
    );
    assert!(matches!(library.get(id), Err(LibraryError::Unknown(_))));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_missing_file_fails_with_the_reason() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();

    let url = lab.url("/files/missing.bin").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    tick_until(&library, |l| state_of(l, id) == DownloadState::Failed).await;

    let failed = library.get(id).unwrap();
    assert!(
        failed.error.is_some_and(|e| !e.is_empty()),
        "no reason recorded"
    );
    assert!(failed.finished.is_none());

    let events = library.events(id).unwrap();
    assert_eq!(
        kinds(&library, id),
        [EventKind::Added, EventKind::Started, EventKind::Failed]
    );
    assert_eq!(events[2].detail, library.get(id).unwrap().error);
}

#[tokio::test(flavor = "multi_thread")]
async fn actions_on_a_removed_download_report_it_unknown() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();

    let url = lab.url("/gen/1M/a.bin?seed=1").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    library.remove(id, true).await.unwrap();

    assert!(matches!(
        library.pause(id).await,
        Err(LibraryError::Unknown(_))
    ));
    assert!(matches!(
        library.resume(id).await,
        Err(LibraryError::Unknown(_))
    ));
    assert!(matches!(
        library.remove(id, false).await,
        Err(LibraryError::Unknown(_))
    ));
    assert!(matches!(library.events(id), Err(LibraryError::Unknown(_))));
}
