#![allow(clippy::unwrap_used)]

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use mdm_labserver::{Config, LabServer};
use tug_core::{
    Appearance, DownloadId, DownloadState, Library, LibraryError, Schedule, Settings,
    SettingsError, SlowHours, Store,
};

async fn finish(library: &Library, id: DownloadId) -> Duration {
    let started = Instant::now();
    while library.get(id).unwrap().state != DownloadState::Done {
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "{:?}",
            library.get(id)
        );
        library.tick().await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    started.elapsed()
}

#[tokio::test(flavor = "multi_thread")]
async fn settings_survive_a_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("tug.db");
    let chosen = Settings {
        download_dir: dir.path().join("downloads"),
        connections: 12,
        speed_limit: Some(3 << 20),
        appearance: Appearance::System,
        excluded_sites: vec!["example.org".into()],
        confirm_captures: true,
        max_active: 3,
        schedule: None,
        slow_hours: None,
        saved_views: Vec::new(),
        columns: Vec::new(),
        sort: None,
        widths: BTreeMap::new(),
    };
    Library::open(Store::open(&db).unwrap())
        .await
        .unwrap()
        .update_settings(chosen.clone())
        .unwrap();

    let reopened = Library::open(Store::open(&db).unwrap()).await.unwrap();
    assert_eq!(reopened.settings().unwrap(), chosen);
}

#[tokio::test(flavor = "multi_thread")]
async fn invalid_settings_are_refused_and_not_saved() {
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();
    let before = library.settings().unwrap();
    let result = library.update_settings(Settings {
        connections: 0,
        ..before.clone()
    });
    assert!(matches!(
        result,
        Err(LibraryError::Settings(SettingsError::Connections(0)))
    ));
    assert_eq!(library.settings().unwrap(), before);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_global_speed_limit_holds_downloads_back() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();
    library
        .update_settings(Settings {
            download_dir: dir.path().to_owned(),
            connections: 4,
            speed_limit: Some(1 << 20),
            appearance: Appearance::System,
            excluded_sites: Vec::new(),
            confirm_captures: true,
            max_active: 3,
            schedule: None,
            slow_hours: None,
            saved_views: Vec::new(),
            columns: Vec::new(),
            sort: None,
            widths: BTreeMap::new(),
        })
        .unwrap();

    let url = lab.url("/gen/3M/limited.bin?seed=2").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    let took = finish(&library, id).await;
    assert!(
        took >= Duration::from_millis(1500),
        "3 MB at 1 MB/s took {took:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn lifting_the_limit_speeds_up_a_running_download() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();
    let limited = Settings {
        download_dir: PathBuf::from(dir.path()),
        connections: 4,
        speed_limit: Some(256 << 10),
        appearance: Appearance::System,
        excluded_sites: Vec::new(),
        confirm_captures: true,
        max_active: 3,
        schedule: None,
        slow_hours: None,
        saved_views: Vec::new(),
        columns: Vec::new(),
        sort: None,
        widths: BTreeMap::new(),
    };
    library.update_settings(limited.clone()).unwrap();

    let url = lab.url("/gen/4M/lifted.bin?seed=4").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    library
        .update_settings(Settings {
            speed_limit: None,
            ..limited
        })
        .unwrap();

    let took = finish(&library, id).await;
    assert!(
        took < Duration::from_secs(8),
        "4 MB at 256 KB/s would take 16 s; took {took:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_slow_hours_hold_downloads_back_while_they_last() {
    let lab = LabServer::start(Config::default()).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let library = Library::open(Store::open_in_memory().unwrap())
        .await
        .unwrap();
    let (_, minute) = tug_core::local_now();
    let around = |by: i32| {
        u16::try_from((i32::from(minute) + by).rem_euclid(i32::from(tug_core::MINUTES_PER_DAY)))
            .unwrap()
    };
    library
        .update_settings(Settings {
            slow_hours: Some(SlowHours {
                limit: 1 << 20,
                hours: Schedule {
                    days: Schedule::EVERY_DAY,
                    start: around(-60),
                    stop: around(60),
                },
            }),
            ..library.settings().unwrap()
        })
        .unwrap();

    let url = lab.url("/gen/3M/slow.bin?seed=6").parse().unwrap();
    let id = library.add(url, dir.path()).await.unwrap();
    let took = finish(&library, id).await;
    assert!(
        took >= Duration::from_millis(1500),
        "3 MB at 1 MB/s took {took:?}"
    );
}
