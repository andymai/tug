#![allow(clippy::unwrap_used)]

use std::path::Path;
use std::time::{Duration, Instant};

use mdm_labserver::{Config, LabServer, content};
use tug_core::{
    Download, DownloadId, DownloadState, EventKind, Library, LibraryError, Origin, Store,
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
