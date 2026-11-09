#![allow(clippy::unwrap_used)]

use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

use mdm_torrent::{Config, Phase, Torrents};
use tug_core::{
    DownloadId, DownloadState, EventKind, Library, LibraryError, NewDownload, Schedule, Settings,
    Store, TorrentOptions, TorrentSource,
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

    std::fs::write(got.join("set").join("notes.txt"), b"mine").unwrap();
    library.remove(id, true).await.unwrap();
    assert!(!got.join("set").join("a.bin").exists());
    assert!(!got.join("set").join("b.bin").exists());
    assert!(
        got.join("set").join("notes.txt").exists(),
        "only the torrent's own files go"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_finished_torrent_takes_its_empty_folder_along() {
    let tmp = tempfile::tempdir().unwrap();
    let seeder = seeder(
        tmp.path(),
        vec![("a.bin", bytes(40_000, 251)), ("b.bin", bytes(30_000, 13))],
    )
    .await;
    let library = leecher(tmp.path(), Some(&seeder)).await;
    let got = tmp.path().join("got");
    let id = library
        .add_torrent(TorrentSource::File(seeder.torrent.clone()), &got)
        .await
        .unwrap();
    tick_until(&library, id, DownloadState::Done).await;
    library.remove(id, true).await.unwrap();
    assert!(!got.join("set").exists(), "its own folder goes once empty");
    assert!(got.exists(), "the download folder stays");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_tug_without_torrents_keeps_a_torrent_it_cant_delete() {
    let tmp = tempfile::tempdir().unwrap();
    let seeder = seeder(tmp.path(), vec![("kept.bin", bytes(50_000, 3))]).await;
    let db = tmp.path().join("tug.db");
    let got = tmp.path().join("got");
    let id = {
        let library = Library::open_with(
            Store::open(&db).unwrap(),
            Some(TorrentOptions {
                local_only: true,
                peers: seeder.torrents.listen_addr().into_iter().collect(),
                ..TorrentOptions::new(tmp.path().join("leecher"))
            }),
        )
        .await
        .unwrap();
        let id = library
            .add_torrent(TorrentSource::File(seeder.torrent.clone()), &got)
            .await
            .unwrap();
        tick_until(&library, id, DownloadState::Done).await;
        id
    };

    let plain = Library::open(Store::open(&db).unwrap()).await.unwrap();
    assert!(matches!(
        plain.remove(id, true).await,
        Err(LibraryError::NoTorrents)
    ));
    assert_eq!(plain.get(id).unwrap().state, DownloadState::Done);
    assert!(got.join("kept.bin").exists());
    plain.remove(id, false).await.unwrap();
    assert!(got.join("kept.bin").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_all_waits_while_a_torrent_and_its_files_go() {
    let tmp = tempfile::tempdir().unwrap();
    let seeder = seeder(tmp.path(), vec![("a.bin", bytes(200_000, 251))]).await;
    let library = leecher(tmp.path(), Some(&seeder)).await;
    let id = library
        .add_torrent_paused(
            TorrentSource::File(seeder.torrent.clone()),
            &tmp.path().join("got"),
        )
        .await
        .unwrap();

    let (removed, resumed) = tokio::join!(library.remove(id, true), library.resume_all());
    removed.unwrap();
    assert_eq!(resumed.unwrap(), Vec::<DownloadId>::new());
    let live = library.tick().await.unwrap().live;
    assert!(live.is_empty(), "a removed torrent runs: {live:?}");
    assert!(library.list().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_delete_leaves_a_waiting_torrent_as_it_was() {
    let tmp = tempfile::tempdir().unwrap();
    let db = tmp.path().join("tug.db");
    {
        let library = Library::open(Store::open(&db).unwrap()).await.unwrap();
        let (_, minute) = tug_core::local_now();
        let later = |by: u16| (minute + by) % tug_core::MINUTES_PER_DAY;
        library
            .update_settings(Settings {
                schedule: Some(Schedule {
                    days: Schedule::EVERY_DAY,
                    start: later(120),
                    stop: later(180),
                }),
                ..library.settings().unwrap()
            })
            .unwrap();
    }
    let id = Store::open(&db)
        .unwrap()
        .insert(&NewDownload {
            url: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"
                .parse()
                .unwrap(),
            dir: tmp.path().to_owned(),
            added: SystemTime::now(),
        })
        .unwrap();

    let plain = Library::open(Store::open(&db).unwrap()).await.unwrap();
    assert_eq!(plain.get(id).unwrap().state, DownloadState::Queued);
    assert!(matches!(
        plain.remove(id, true).await,
        Err(LibraryError::NoTorrents)
    ));
    assert_eq!(plain.get(id).unwrap().state, DownloadState::Queued);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_same_torrent_waits_in_the_list_once() {
    let tmp = tempfile::tempdir().unwrap();
    let seeder = seeder(tmp.path(), vec![("one.bin", bytes(64_000, 7))]).await;
    let library = leecher(tmp.path(), None).await;
    let first = library
        .add_torrent(TorrentSource::File(seeder.torrent.clone()), tmp.path())
        .await
        .unwrap();
    let magnet = TorrentSource::File(seeder.torrent.clone()).link().unwrap();
    let hash = magnet
        .split("btih:")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap()
        .to_owned();
    for again in [
        TorrentSource::File(seeder.torrent.clone()),
        TorrentSource::Magnet(magnet.clone()),
        TorrentSource::Magnet(format!("magnet:?xt=urn:btih:{}", base32(&hash))),
    ] {
        assert!(
            matches!(
                library.add_torrent(again, tmp.path()).await,
                Err(LibraryError::DuplicateTorrent(_))
            ),
            "{hash}"
        );
    }

    tokio::time::sleep(Duration::from_millis(500)).await;
    library.tick().await.unwrap();
    assert_eq!(
        library.get(first).unwrap().state,
        DownloadState::Downloading,
        "a .torrent file waits for peers; it never asks the swarm for its file list"
    );
}

fn base32(hex: &str) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&hex[at..at + 2], 16).unwrap())
        .collect();
    let mut bits = 0u64;
    let mut held = 0;
    let mut out = String::new();
    for byte in bytes {
        bits = (bits << 8) | u64::from(byte);
        held += 8;
        while held >= 5 {
            held -= 5;
            out.push(char::from(
                ALPHABET[usize::try_from((bits >> held) & 31).unwrap()],
            ));
        }
    }
    out
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
