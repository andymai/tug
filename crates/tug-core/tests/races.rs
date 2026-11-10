#![allow(clippy::unwrap_used)]

// Each test holds a task at a fail point (Library::hold_at), so that a second call
// lands, on every run, in the gap that a race would hit: here, a download whose
// transfer ends while its row still says downloading.

use std::path::Path;
use std::time::{Duration, Instant};

use mdm_labserver::{Config, LabServer, content};
use tug_core::{DownloadId, DownloadState, Library, LibraryError, Store};

const WAIT: Duration = Duration::from_secs(20);

async fn open() -> Library {
    Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap()
}

fn state_of(library: &Library, id: DownloadId) -> DownloadState {
    library.get(id).unwrap().state
}

async fn tick_until(library: &Library, done: impl Fn(&Library) -> bool) {
    let deadline = Instant::now() + WAIT;
    loop {
        library.tick().await.unwrap();
        if done(library) {
            return;
        }
        assert!(Instant::now() < deadline, "timed out: {:?}", library.list());
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn received_some(library: &Library, id: DownloadId) {
    let deadline = Instant::now() + WAIT;
    loop {
        let live = library.tick().await.unwrap().live;
        if live.iter().any(|(i, p)| *i == id && p.received > 256 << 10) {
            return;
        }
        assert!(Instant::now() < deadline, "never started");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn assert_intact(path: &Path, seed: u64, len: usize) {
    let mut want = vec![0; len];
    content::fill(seed, 0, &mut want);
    assert!(
        std::fs::read(path).unwrap() == want,
        "content of {}",
        path.display()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_resume_while_a_pause_settles_starts_the_download_again() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = open().await;
    let url = lab.url("/gen/4M/talk.mp4?seed=11&rate=1M").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    received_some(&library, id).await;

    let settle = library.hold_at("settle");
    let (paused, ()) = tokio::join!(library.pause(id), async {
        settle.reached().await;
        library.resume(id).await.unwrap();
        settle.release();
    });
    paused.unwrap();
    assert_eq!(
        state_of(&library, id),
        DownloadState::Downloading,
        "the later resume holds"
    );

    tick_until(&library, |l| state_of(l, id) == DownloadState::Done).await;
    assert_intact(&library.get(id).unwrap().file.unwrap(), 11, 4 << 20);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_resume_while_pause_all_settles_queues_the_download_again() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = open().await;
    let url = lab.url("/gen/4M/talk.mp4?seed=12&rate=1M").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    received_some(&library, id).await;

    let settle = library.hold_at("settle");
    let (paused, ()) = tokio::join!(library.pause_all(), async {
        settle.reached().await;
        library.resume(id).await.unwrap();
        settle.release();
    });
    paused.unwrap();
    assert_eq!(
        state_of(&library, id),
        DownloadState::Queued,
        "the later resume holds"
    );

    tick_until(&library, |l| state_of(l, id) == DownloadState::Done).await;
    assert_intact(&library.get(id).unwrap().file.unwrap(), 12, 4 << 20);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_resume_while_a_failed_download_settles_tries_it_again() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = open().await;
    let url = lab.url("/files/missing.bin").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();

    let settle = library.hold_at("settle");
    let ticks = async {
        let deadline = Instant::now() + WAIT;
        while !library.tick().await.unwrap().settled.contains(&id) {
            assert!(Instant::now() < deadline, "never settled");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    tokio::join!(ticks, async {
        settle.reached().await;
        library.resume(id).await.unwrap();
        settle.release();
    });
    let download = library.get(id).unwrap();
    assert_ne!(
        download.state,
        DownloadState::Failed,
        "the later resume holds"
    );
    assert_eq!(download.error, None);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_rename_while_a_download_settles_is_refused() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = open().await;
    let url = lab.url("/gen/4M/talk.mp4?seed=13&rate=1M").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();

    let settle = library.hold_at("settle");
    let (paused, renamed) = tokio::join!(library.pause(id), async {
        settle.reached().await;
        let renamed = library.rename(id, "other.mp4").await;
        settle.release();
        renamed
    });
    paused.unwrap();
    assert!(
        matches!(renamed, Err(LibraryError::CantRename)),
        "{renamed:?}"
    );
    assert_eq!(library.get(id).unwrap().name(), "talk.mp4");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_remove_while_a_pause_settles_waits_for_it_and_leaves_no_files() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = open().await;
    let url = lab.url("/gen/4M/talk.mp4?seed=14&rate=1M").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    received_some(&library, id).await;

    let settle = library.hold_at("settle");
    let waits = library.hold_at("remove waits");
    let (paused, removed, waited) = tokio::join!(
        library.pause(id),
        async {
            settle.reached().await;
            library.remove(id, true).await
        },
        async {
            let waited = tokio::time::timeout(Duration::from_secs(5), waits.reached()).await;
            waits.release();
            settle.release();
            waited.is_ok()
        },
    );
    assert!(waited, "the removal went on while the download settled");
    paused.unwrap();
    removed.unwrap();
    assert!(matches!(library.get(id), Err(LibraryError::Unknown(_))));
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        0,
        "files left behind"
    );
}
