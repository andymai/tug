#![allow(clippy::unwrap_used)]

use std::path::Path;
use std::time::{Duration, Instant};

use mdm_labserver::{Config, LabServer, content};
use tug_core::{Phase, Transfer, USER_AGENT};

fn expected(seed: u64, len: usize) -> Vec<u8> {
    let mut buf = vec![0; len];
    content::fill(seed, 0, &mut buf);
    buf
}

fn assert_intact(path: &Path, seed: u64, len: usize) {
    let got = std::fs::read(path).unwrap();
    assert_eq!(got.len(), len, "size of {}", path.display());
    assert!(got == expected(seed, len), "content of {}", path.display());
}

async fn wait_until(transfer: &Transfer, done: impl Fn(&tug_core::Progress) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while !done(&transfer.progress()) {
        assert!(
            Instant::now() < deadline,
            "timed out at {:?}",
            transfer.progress()
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn downloads_over_several_connections_as_tug() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let url = lab
        .url("/gen/8M/fedora.iso?seed=7&rate=2M")
        .parse()
        .unwrap();

    let transfer = Transfer::start(url, dir.path(), 8);
    wait_until(&transfer, |p| {
        p.phase == Phase::Downloading && p.connections > 1
    })
    .await;
    let path = transfer.finish().await.unwrap();

    assert_intact(&path, 7, 8 << 20);
    let log = lab.log();
    let peers: std::collections::HashSet<_> = log.iter().map(|e| e.peer).collect();
    assert!(peers.len() > 1, "one connection only: {peers:?}");
    assert!(
        log.iter()
            .all(|e| e.user_agent.as_deref() == Some(USER_AGENT)),
        "user agents: {:?}",
        log.iter().map(|e| e.user_agent.clone()).collect::<Vec<_>>()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_download_resumes_to_an_intact_file() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let url = lab.url("/gen/6M/talk.mp4?seed=11&rate=1M").parse().unwrap();

    let first = Transfer::start(url, dir.path(), 4);
    wait_until(&first, |p| p.received > 1 << 20).await;
    let file = first
        .progress()
        .file
        .expect("the final path is known once data arrives");
    first.stop();
    assert!(
        first.finish().await.is_err(),
        "a stopped download has no file yet"
    );
    assert!(
        !file.exists(),
        "nothing at the final path before it completes"
    );

    let second = Transfer::resume(&file, 4).unwrap();
    let path = second.finish().await.unwrap();

    assert_eq!(path, file);
    assert_intact(&path, 11, 6 << 20);
}

#[tokio::test(flavor = "multi_thread")]
async fn dropped_connections_are_retried_to_an_intact_file() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let url = lab
        .url("/gen/4M/shard.bin?seed=23&drop_after=300000&drop_every=2")
        .parse()
        .unwrap();

    let path = Transfer::start(url, dir.path(), 6).finish().await.unwrap();

    assert_intact(&path, 23, 4 << 20);
    assert!(
        lab.log()
            .iter()
            .any(|e| e.drop_at.is_some() || e.outcome.contains("drop")),
        "the server never dropped a connection"
    );
}
