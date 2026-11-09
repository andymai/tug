#![allow(clippy::unwrap_used)]

use std::sync::Arc;
use std::time::{Duration, Instant};

use mdm_labserver::{Config, LabServer};
use tug_core::{DownloadState, Library, ProgressStream, Store, StreamOptions};

#[tokio::test(flavor = "multi_thread")]
async fn the_stream_reports_smoothed_progress_and_the_settled_download() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Arc::new(
        Library::open(Store::open_in_memory().unwrap())
            .await
            .unwrap(),
    );
    let stream = ProgressStream::spawn(
        Arc::clone(&library),
        StreamOptions {
            interval: Duration::from_millis(100),
            persist_every: 1,
        },
    );
    let mut rx = stream.subscribe();

    let url = lab
        .url("/gen/4M/stream.bin?seed=9&rate=512K")
        .parse()
        .unwrap();
    let id = library.add(url, dir.path()).await.unwrap();

    let started = Instant::now();
    let mut batches = 0u64;
    let mut last_seq = 0;
    let mut saw_speed_and_eta = false;
    let mut saw_persisted_progress = false;
    loop {
        tokio::time::timeout(Duration::from_secs(30), rx.changed())
            .await
            .unwrap()
            .unwrap();
        let batch = Arc::clone(&rx.borrow_and_update());
        assert!(batch.seq > last_seq, "sequence went backwards");
        assert_eq!(batch.error, None);
        last_seq = batch.seq;
        batches += 1;

        if let Some(update) = batch.updates.iter().find(|u| u.id == id) {
            saw_speed_and_eta |= update.speed > 0 && update.left.is_some();
            let stored = library.get(id).unwrap();
            saw_persisted_progress |=
                stored.state == DownloadState::Downloading && stored.received > 0;
        }
        if batch.settled.contains(&id) {
            break;
        }
    }

    let elapsed = started.elapsed();
    let ceiling = elapsed.as_millis() / 100 + 2;
    assert!(
        u128::from(batches) <= ceiling,
        "{batches} batches in {elapsed:?}"
    );
    assert!(
        saw_speed_and_eta,
        "no batch carried a speed and a time left"
    );
    assert!(
        saw_persisted_progress,
        "progress never reached the store while running"
    );
    assert_eq!(library.get(id).unwrap().state, DownloadState::Done);
}

#[tokio::test(flavor = "multi_thread")]
async fn intervals_below_the_floor_are_raised_to_it() {
    let library = Arc::new(
        Library::open(Store::open_in_memory().unwrap())
            .await
            .unwrap(),
    );
    let stream = ProgressStream::spawn(
        library,
        StreamOptions {
            interval: Duration::from_millis(1),
            persist_every: 20,
        },
    );
    let mut rx = stream.subscribe();
    let started = Instant::now();
    let mut seen = 0u32;
    while seen < 5 {
        rx.changed().await.unwrap();
        seen += 1;
    }
    assert!(
        started.elapsed() >= Duration::from_millis(380),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_reader_that_looks_late_still_gets_each_settled_download() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Arc::new(
        Library::open(Store::open_in_memory().unwrap())
            .await
            .unwrap(),
    );
    let stream = ProgressStream::spawn(
        Arc::clone(&library),
        StreamOptions {
            interval: Duration::from_millis(100),
            persist_every: 1,
        },
    );
    let mut settled = stream.settled();
    let first = library
        .add(
            lab.url("/gen/64K/a.bin?seed=1").parse().unwrap(),
            dir.path(),
        )
        .await
        .unwrap();
    let second = library
        .add(
            lab.url("/gen/64K/b.bin?seed=2").parse().unwrap(),
            dir.path(),
        )
        .await
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(30);
    while [first, second]
        .iter()
        .any(|&id| library.get(id).unwrap().state != DownloadState::Done)
    {
        assert!(Instant::now() < deadline, "the downloads never finished");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    let mut seen = vec![settled.recv().await.unwrap(), settled.recv().await.unwrap()];
    seen.sort();
    let mut expected = vec![first, second];
    expected.sort();
    assert_eq!(seen, expected);
    assert!(settled.try_recv().is_err());
}
