#![allow(clippy::unwrap_used)]

use std::path::Path;
use std::time::{Duration, Instant};

use mdm_labserver::{Config, LabServer, content};
use tug_core::{Download, DownloadId, DownloadState, Library, LibraryError, Store};

const CONNECTIONS: u32 = 4;

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

fn state_of(library: &Library, id: DownloadId) -> DownloadState {
    library.get(id).unwrap().state
}

async fn received_at_least(library: &Library, id: DownloadId, bytes: u64) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let live = library.tick().await.unwrap();
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
    let library = Library::open(Store::open_in_memory().unwrap(), CONNECTIONS)
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
}

#[tokio::test(flavor = "multi_thread")]
async fn a_paused_download_resumes_to_an_intact_file() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap(), CONNECTIONS)
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
}

#[tokio::test(flavor = "multi_thread")]
async fn downloads_running_at_shutdown_resume_when_the_library_opens() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("tug.db");
    let downloads = dir.path().join("downloads");
    std::fs::create_dir(&downloads).unwrap();

    let id = {
        let library = Library::open(Store::open(&db).unwrap(), CONNECTIONS)
            .await
            .unwrap();
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

    let library = Library::open(Store::open(&db).unwrap(), CONNECTIONS)
        .await
        .unwrap();
    assert_eq!(state_of(&library, id), DownloadState::Downloading);
    tick_until(&library, |l| state_of(l, id) == DownloadState::Done).await;
    assert_intact(&library.get(id).unwrap().file.unwrap(), 17, 6 << 20);
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_with_delete_clears_the_partial_files() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap(), CONNECTIONS)
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
    let library = Library::open(Store::open_in_memory().unwrap(), CONNECTIONS)
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
}

#[tokio::test(flavor = "multi_thread")]
async fn actions_on_a_removed_download_report_it_unknown() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap(), CONNECTIONS)
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
}
