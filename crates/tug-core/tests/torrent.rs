#![allow(clippy::unwrap_used)]

use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;
use std::time::{Duration, Instant};

use mdm_torrent::{Config, Phase, Torrents};
use tug_core::{
    DownloadId, DownloadState, EventKind, Library, LibraryError, Settings, Store, TorrentOptions,
    TorrentSource,
};

fn bytes(len: u32, step: u32) -> Vec<u8> {
    (0..len).map(|i| u8::try_from(i % step).unwrap()).collect()
}

async fn make_torrent(dir: &Path) -> Vec<u8> {
    let spawner = librqbit::spawn_utils::BlockingSpawner::new(1);
    let made = librqbit::create_torrent(
        dir,
        librqbit::CreateTorrentOptions {
            name: Some("set"),
            trackers: Vec::new(),
            piece_length: Some(16 * 1024),
        },
        &spawner,
    )
    .await
    .unwrap();
    made.as_bytes().unwrap().to_vec()
}

struct Seeder {
    torrents: Torrents,
    torrent: Vec<u8>,
    files: Vec<(&'static str, Vec<u8>)>,
}

// A local session that already has the set's files and shares them on loopback.
async fn seeder(root: &Path, files: Vec<(&'static str, Vec<u8>)>) -> Seeder {
    let src = root.join("seed").join("set");
    std::fs::create_dir_all(&src).unwrap();
    for (name, data) in &files {
        std::fs::write(src.join(name), data).unwrap();
    }
    let torrent = make_torrent(&src).await;
    let torrents = Torrents::start(Config {
        dht: false,
        offline: true,
        listen_ip: Some(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        ..Config::new(root.join("seeder"))
    })
    .await
    .unwrap();
    let hash = torrents
        .add(&torrent, &src, None, Vec::new(), false)
        .await
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    while torrents.stats(&hash).unwrap().phase != Phase::Finished {
        assert!(
            Instant::now() < deadline,
            "the seeder never checked its files"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Seeder {
        torrents,
        torrent,
        files,
    }
}

async fn leecher(root: &Path, seeder: Option<&Seeder>) -> Library {
    let peers = seeder
        .and_then(|s| s.torrents.listen_addr())
        .into_iter()
        .collect();
    Library::open_with(
        Store::open_in_memory().unwrap(),
        Some(TorrentOptions {
            local_only: true,
            peers,
            lookup_wait: Duration::from_secs(1),
            ..TorrentOptions::new(root.join("leecher"))
        }),
    )
    .await
    .unwrap()
}

async fn tick_until(library: &Library, id: DownloadId, state: DownloadState) {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        library.tick().await.unwrap();
        let now = library.get(id).unwrap();
        if now.state == state {
            return;
        }
        assert!(Instant::now() < deadline, "never {state:?}: {now:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_torrent_file_downloads_its_files_from_a_seeder() {
    let tmp = tempfile::tempdir().unwrap();
    let seeder = seeder(
        tmp.path(),
        vec![
            ("a.bin", bytes(300_000, 251)),
            ("b.bin", bytes(120_000, 13)),
        ],
    )
    .await;
    let library = leecher(tmp.path(), Some(&seeder)).await;
    let got = tmp.path().join("got");

    let id = library
        .add_torrent(TorrentSource::File(seeder.torrent.clone()), &got)
        .await
        .unwrap();
    assert!(library.get(id).unwrap().is_torrent());
    tick_until(&library, id, DownloadState::Done).await;

    let done = library.get(id).unwrap();
    assert_eq!(done.file.as_deref(), Some(got.join("set").as_path()));
    assert_eq!(done.name(), "set");
    assert_eq!((done.received, done.size), (420_000, Some(420_000)));
    for (name, data) in &seeder.files {
        assert!(
            std::fs::read(got.join("set").join(name)).unwrap() == *data,
            "{name}"
        );
    }
    assert_eq!(
        kinds(&library, id),
        [EventKind::Added, EventKind::Started, EventKind::Finished]
    );

    library.remove(id, true).await.unwrap();
    assert!(
        !got.join("set").exists(),
        "a finished torrent's folder goes when asked"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_torrent_pauses_and_resumes_to_intact_files() {
    let tmp = tempfile::tempdir().unwrap();
    let seeder = seeder(tmp.path(), vec![("big.bin", bytes(3 << 20, 241))]).await;
    let library = leecher(tmp.path(), Some(&seeder)).await;
    library
        .update_settings(Settings {
            speed_limit: Some(512 << 10),
            ..library.settings().unwrap()
        })
        .unwrap();
    let got = tmp.path().join("got");
    let id = library
        .add_torrent(TorrentSource::File(seeder.torrent.clone()), &got)
        .await
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(30);
    while !library
        .tick()
        .await
        .unwrap()
        .live
        .iter()
        .any(|(live, p)| *live == id && p.received > 0)
    {
        assert!(Instant::now() < deadline, "no bytes came");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    library.pause(id).await.unwrap();
    let paused = library.get(id).unwrap();
    assert_eq!(paused.state, DownloadState::Paused);
    assert!(paused.received > 0 && paused.received < 3 << 20);

    library
        .update_settings(Settings {
            speed_limit: None,
            ..library.settings().unwrap()
        })
        .unwrap();
    library.resume(id).await.unwrap();
    tick_until(&library, id, DownloadState::Done).await;
    let file = library.get(id).unwrap().file.unwrap();
    assert_eq!(file, got.join("big.bin"), "a single file goes straight in");
    assert_eq!(std::fs::read(&file).unwrap(), seeder.files[0].1);
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
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_magnet_link_that_finds_no_peer_fails_with_the_reason() {
    let tmp = tempfile::tempdir().unwrap();
    let library = leecher(tmp.path(), None).await;
    let id = library
        .add_torrent(
            TorrentSource::Magnet(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Lost".into(),
            ),
            tmp.path(),
        )
        .await
        .unwrap();
    assert_eq!(library.get(id).unwrap().name(), "Lost");
    tick_until(&library, id, DownloadState::Failed).await;
    let failed = library.get(id).unwrap();
    assert!(
        failed.error.as_deref().is_some_and(|e| !e.is_empty()),
        "{failed:?}"
    );
    let events = library.events(id).unwrap();
    assert_eq!(
        events.last().map(|e| (e.kind, e.detail.clone())),
        Some((EventKind::Failed, failed.error))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_a_torrent_with_a_folder_for_torrents_is_added() {
    let tmp = tempfile::tempdir().unwrap();
    let plain = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();
    assert!(matches!(
        plain
            .add_torrent(
                TorrentSource::Magnet("magnet:?xt=urn:btih:00".into()),
                tmp.path()
            )
            .await,
        Err(LibraryError::NoTorrents)
    ));
    let library = leecher(tmp.path(), None).await;
    for source in [
        TorrentSource::Magnet("https://example.org/a.iso".into()),
        TorrentSource::File(b"not a torrent".to_vec()),
    ] {
        assert!(matches!(
            library.add_torrent(source, tmp.path()).await,
            Err(LibraryError::NotATorrent)
        ));
    }
    assert!(library.list().unwrap().is_empty());
}
