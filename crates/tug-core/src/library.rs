use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::SystemTime;

use mdm_engine::limiter::Limiter;
use mdm_engine::naming::part_path;
use mdm_engine::state::state_path;
use url::Url;

use crate::origin::Origin;
use crate::schedule::Schedule;
use crate::settings::{Settings, SettingsError};
use crate::store::{
    Download, DownloadId, DownloadState, Event, EventKind, NewDownload, Place, Store, StoreError,
};
use crate::transfer::{Finished, Phase, Progress, Transfer, TransferOptions};

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Engine(#[from] mdm_engine::Error),
    #[error(transparent)]
    Settings(#[from] SettingsError),
    #[error("there is no download {0}")]
    Unknown(i64),
    #[error("could not delete {}: {source}", path.display())]
    Delete { path: PathBuf, source: io::Error },
    #[error("a panic left the download list unusable")]
    Poisoned,
}

#[derive(Debug, Clone, Default)]
pub struct Tick {
    pub live: Vec<(DownloadId, Progress)>,
    pub settled: Vec<DownloadId>,
    pub changed: Vec<DownloadId>,
    pub error: Option<String>,
}

// What changed outside a tick: the next tick reports it, so every reader of
// the progress stream learns of a download that waits, stops or fails to start.
#[derive(Default)]
struct News {
    settled: Vec<DownloadId>,
    changed: Vec<DownloadId>,
}

struct Running {
    transfer: Transfer,
    file_recorded: bool,
}

pub struct Library {
    store: Mutex<Store>,
    running: tokio::sync::Mutex<HashMap<DownloadId, Running>>,
    settings: Mutex<Settings>,
    limiter: Arc<Limiter>,
    news: Mutex<News>,
    // Downloads that the schedule stops, with the state each settles as when its
    // transfer ends. Pause and resume change it under the run lock in that time.
    stopping: Mutex<HashMap<DownloadId, DownloadState>>,
}

impl Library {
    pub async fn open(store: Store) -> Result<Self, LibraryError> {
        let settings = Settings::load(&store)?;
        let library = Self {
            limiter: Arc::new(Limiter::new(settings.speed_limit_now())),
            settings: Mutex::new(settings),
            store: Mutex::new(store),
            running: tokio::sync::Mutex::default(),
            news: Mutex::default(),
            stopping: Mutex::default(),
        };
        {
            let store = library.store()?;
            let now = SystemTime::now();
            for download in store.list()? {
                if download.state == DownloadState::Downloading {
                    store.set_state(download.id, DownloadState::Queued, None, now)?;
                }
            }
        }
        library.pump().await?;
        Ok(library)
    }

    pub async fn add(&self, url: Url, dir: &Path) -> Result<DownloadId, LibraryError> {
        self.add_from(url, dir, &Origin::default()).await
    }

    pub async fn add_from(
        &self,
        url: Url,
        dir: &Path,
        origin: &Origin,
    ) -> Result<DownloadId, LibraryError> {
        let id = self.insert(url, dir, origin, false)?;
        self.pump().await?;
        Ok(id)
    }

    pub fn add_paused(
        &self,
        url: Url,
        dir: &Path,
        origin: &Origin,
    ) -> Result<DownloadId, LibraryError> {
        self.insert(url, dir, origin, true)
    }

    fn insert(
        &self,
        url: Url,
        dir: &Path,
        origin: &Origin,
        paused: bool,
    ) -> Result<DownloadId, LibraryError> {
        let added = SystemTime::now();
        let store = self.store()?;
        let state = if paused {
            DownloadState::Paused
        } else {
            DownloadState::Queued
        };
        let id = store.insert_as(
            &NewDownload {
                url,
                dir: dir.to_owned(),
                added,
            },
            origin,
            state,
        )?;
        store.add_event(id, &event(EventKind::Added, added, None, None))?;
        drop(store);
        self.changed(id);
        Ok(id)
    }

    pub fn settings(&self) -> Result<Settings, LibraryError> {
        Ok(self
            .settings
            .lock()
            .map_err(|_| LibraryError::Poisoned)?
            .clone())
    }

    pub fn update_settings(&self, settings: Settings) -> Result<(), LibraryError> {
        settings.validate()?;
        settings.save(&*self.store()?)?;
        self.limiter.set(settings.speed_limit_now());
        *self.settings.lock().map_err(|_| LibraryError::Poisoned)? = settings;
        Ok(())
    }

    pub fn get(&self, id: DownloadId) -> Result<Download, LibraryError> {
        self.store()?
            .get(id)?
            .ok_or_else(|| LibraryError::Unknown(id.get()))
    }

    pub fn list(&self) -> Result<Vec<Download>, LibraryError> {
        Ok(self.store()?.list()?)
    }

    pub fn events(&self, id: DownloadId) -> Result<Vec<Event>, LibraryError> {
        self.get(id)?;
        Ok(self.store()?.events(id)?)
    }

    // A waiting download is held under the run lock, so a tick can't start it
    // between the check and the write.
    pub async fn pause(&self, id: DownloadId) -> Result<(), LibraryError> {
        let mut running = self.running.lock().await;
        let download = self.get(id)?;
        let Some(entry) = running.remove(&id) else {
            if download.state == DownloadState::Queued {
                self.hold(&download)?;
            } else if let Some(target) = self.stopping().get_mut(&id) {
                *target = DownloadState::Paused;
            }
            drop(running);
            return Ok(());
        };
        drop(running);
        entry.transfer.stop();
        let settled = self.settle(id, entry.transfer, DownloadState::Paused).await;
        self.changed(id);
        settled?;
        self.pump().await
    }

    pub async fn pause_all(&self) -> Result<(), LibraryError> {
        let mut running = self.running.lock().await;
        let held = self.hold_queue();
        for target in self.stopping().values_mut() {
            *target = DownloadState::Paused;
        }
        let stopped: Vec<(DownloadId, Running)> = running.drain().collect();
        drop(running);
        for (_, entry) in &stopped {
            entry.transfer.stop();
        }
        let mut first = held.err();
        for (id, entry) in stopped {
            if let Err(e) = self.settle(id, entry.transfer, DownloadState::Paused).await {
                first.get_or_insert(e);
            }
            self.changed(id);
        }
        first.map_or(Ok(()), Err)
    }

    pub async fn resume_all(&self) -> Result<Vec<DownloadId>, LibraryError> {
        let mut running = self.running.lock().await;
        let now = SystemTime::now();
        let mut queued = Vec::new();
        let store = self.store()?;
        for download in store.list()? {
            if download.state == DownloadState::Paused {
                store.set_state(download.id, DownloadState::Queued, None, now)?;
                queued.push(download.id);
            }
        }
        drop(store);
        for (id, target) in self.stopping().iter_mut() {
            if *target == DownloadState::Paused {
                *target = DownloadState::Queued;
                queued.push(*id);
            }
        }
        self.news().changed.extend(&queued);
        let filled = self.fill(&mut running);
        drop(running);
        filled.map(|()| queued)
    }

    pub fn place(&self, id: DownloadId, place: Place) -> Result<bool, LibraryError> {
        self.get(id)?;
        Ok(self.store()?.place(id, place)?)
    }

    pub async fn resume(&self, id: DownloadId) -> Result<(), LibraryError> {
        let mut running = self.running.lock().await;
        let download = self.get(id)?;
        if download.state == DownloadState::Done || running.contains_key(&id) {
            return Ok(());
        }
        if let Some(target) = self.stopping().get_mut(&id) {
            *target = DownloadState::Queued;
            return Ok(());
        }
        if download.state != DownloadState::Queued {
            self.store()?
                .set_state(id, DownloadState::Queued, None, SystemTime::now())?;
            self.changed(id);
        }
        let filled = self.fill(&mut running);
        drop(running);
        filled
    }

    pub async fn remove(&self, id: DownloadId, delete_file: bool) -> Result<(), LibraryError> {
        let mut running = self.running.lock().await;
        let download = self.get(id)?;
        let stopped = running.remove(&id);
        // Held first, so a tick can't start a waiting download while its files go.
        if stopped.is_none() && download.state == DownloadState::Queued {
            self.store()?
                .set_state(id, DownloadState::Paused, None, SystemTime::now())?;
        }
        drop(running);
        if let Some(running) = stopped {
            running.transfer.stop();
            let _stopped = running.transfer.finish().await;
        }
        if delete_file {
            delete_files(&download)?;
        }
        self.store()?.remove(id)?;
        self.changed(id);
        self.pump().await
    }

    // Under the same lock as resume, so nothing can start the download between
    // the check and the removal.
    pub async fn remove_if_paused(&self, id: DownloadId) -> Result<bool, LibraryError> {
        let running = self.running.lock().await;
        let download = self.get(id)?;
        if download.state != DownloadState::Paused || running.contains_key(&id) {
            return Ok(false);
        }
        self.store()?.remove(id)?;
        drop(running);
        self.changed(id);
        delete_files(&download)?;
        Ok(true)
    }

    pub async fn tick(&self) -> Result<Tick, LibraryError> {
        let mut live = Vec::new();
        let mut ended = Vec::new();
        let mut running = self.running.lock().await;
        for (&id, entry) in running.iter_mut() {
            let progress = entry.transfer.progress();
            if !entry.file_recorded
                && let Some(file) = &progress.file
            {
                self.store()?.set_file(id, file)?;
                entry.file_recorded = true;
            }
            if matches!(progress.phase, Phase::Done | Phase::Failed | Phase::Stopped) {
                ended.push(id);
            } else {
                live.push((id, progress));
            }
        }
        let finished: Vec<(DownloadId, Running)> = ended
            .iter()
            .filter_map(|id| running.remove(id).map(|r| (*id, r)))
            .collect();
        drop(running);
        let mut settled = Vec::with_capacity(finished.len());
        let mut error = None;
        for (id, entry) in finished {
            if let Err(e) = self.settle(id, entry.transfer, DownloadState::Failed).await {
                error.get_or_insert_with(|| e.to_string());
            }
            settled.push(id);
        }
        let settings = self.settings()?;
        self.limiter.set(settings.speed_limit_now());
        if let Err(e) = self.close_hours(&settings).await {
            error.get_or_insert_with(|| e.to_string());
        }
        // Also picks up a raised limit and a download that a failed start left behind.
        if let Err(e) = self.pump().await {
            error.get_or_insert_with(|| e.to_string());
        }
        let news = std::mem::take(&mut *self.news());
        settled.extend(news.settled);
        let mut changed = news.changed;
        changed.sort_unstable();
        changed.dedup();
        Ok(Tick {
            live,
            settled,
            changed,
            error,
        })
    }

    pub fn record_progress(&self, live: &[(DownloadId, Progress)]) -> Result<(), LibraryError> {
        let store = self.store()?;
        for (id, progress) in live {
            store.set_progress(*id, progress.received, progress.total)?;
        }
        drop(store);
        Ok(())
    }

    async fn pump(&self) -> Result<(), LibraryError> {
        let mut running = self.running.lock().await;
        let filled = self.fill(&mut running);
        drop(running);
        filled
    }

    // Starts waiting downloads in queue order while fewer than the limit run.
    // A download that can't start fails on its own and doesn't hold up the rest.
    fn fill(&self, running: &mut HashMap<DownloadId, Running>) -> Result<(), LibraryError> {
        let settings = self.settings()?;
        let limit = usize::try_from(settings.max_active).unwrap_or(usize::MAX);
        if running.len() >= limit || !within_hours(&settings) {
            return Ok(());
        }
        let waiting = self.store()?.queued()?;
        for id in waiting {
            if running.len() >= limit {
                break;
            }
            if running.contains_key(&id) {
                continue;
            }
            let download = self.get(id)?;
            if let Err(e) = self.launch_into(&download, running) {
                let now = SystemTime::now();
                let reason = e.to_string();
                let store = self.store()?;
                store.set_state(id, DownloadState::Failed, Some(&reason), now)?;
                self.news().settled.push(id);
                store.add_event(
                    id,
                    &event(
                        EventKind::Failed,
                        now,
                        Some(download.received),
                        Some(reason),
                    ),
                )?;
                drop(store);
            }
        }
        Ok(())
    }

    // Outside the schedule's hours, running downloads go back to the queue and
    // keep their place, so they go on when the hours come again.
    async fn close_hours(&self, settings: &Settings) -> Result<(), LibraryError> {
        if within_hours(settings) {
            return Ok(());
        }
        let stopped = self.begin_stop().await;
        self.end_stop(stopped).await
    }

    async fn begin_stop(&self) -> Vec<(DownloadId, Running)> {
        let mut running = self.running.lock().await;
        let stopped: Vec<(DownloadId, Running)> = running.drain().collect();
        self.stopping()
            .extend(stopped.iter().map(|(id, _)| (*id, DownloadState::Queued)));
        drop(running);
        for (_, entry) in &stopped {
            entry.transfer.stop();
        }
        stopped
    }

    async fn end_stop(&self, stopped: Vec<(DownloadId, Running)>) -> Result<(), LibraryError> {
        let mut first = None;
        for (id, entry) in stopped {
            let last = entry.transfer.progress();
            let outcome = entry.transfer.finish().await;
            let running = self.running.lock().await;
            let target = self.stopping().remove(&id).unwrap_or(DownloadState::Queued);
            let recorded = self
                .store()
                .and_then(|store| record(&store, id, &last, outcome, target));
            drop(running);
            if let Err(e) = recorded {
                first.get_or_insert(e);
            }
            self.changed(id);
        }
        first.map_or(Ok(()), Err)
    }

    fn hold(&self, download: &Download) -> Result<(), LibraryError> {
        let now = SystemTime::now();
        let store = self.store()?;
        store.set_state(download.id, DownloadState::Paused, None, now)?;
        store.add_event(
            download.id,
            &event(EventKind::Paused, now, Some(download.received), None),
        )?;
        drop(store);
        self.changed(download.id);
        Ok(())
    }

    fn stopping(&self) -> MutexGuard<'_, HashMap<DownloadId, DownloadState>> {
        self.stopping.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn news(&self) -> MutexGuard<'_, News> {
        self.news.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn changed(&self, id: DownloadId) {
        self.news().changed.push(id);
    }

    fn hold_queue(&self) -> Result<(), LibraryError> {
        let waiting = self.store()?.queued()?;
        for id in waiting {
            self.hold(&self.get(id)?)?;
        }
        Ok(())
    }

    fn launch_into(
        &self,
        download: &Download,
        running: &mut HashMap<DownloadId, Running>,
    ) -> Result<(), LibraryError> {
        let resumable = download
            .file
            .as_deref()
            .filter(|file| state_path(file).exists());
        let options = TransferOptions {
            connections: self.settings()?.connections,
            limiter: Some(Arc::clone(&self.limiter)),
            origin: self.store()?.origin(download.id)?,
        };
        let transfer = match resumable {
            Some(file) => Transfer::resume(file, &options)?,
            None => Transfer::start(download.url.clone(), &download.dir, &options),
        };
        let now = SystemTime::now();
        let started = match resumable {
            Some(_) => event(EventKind::Resumed, now, Some(download.received), None),
            None => event(EventKind::Started, now, None, None),
        };
        {
            let store = self.store()?;
            store.set_state(download.id, DownloadState::Downloading, None, now)?;
            store.add_event(download.id, &started)?;
        }
        running.insert(
            download.id,
            Running {
                transfer,
                file_recorded: resumable.is_some(),
            },
        );
        Ok(())
    }

    async fn settle(
        &self,
        id: DownloadId,
        transfer: Transfer,
        unfinished: DownloadState,
    ) -> Result<(), LibraryError> {
        let last = transfer.progress();
        let outcome = transfer.finish().await;
        record(&*self.store()?, id, &last, outcome, unfinished)
    }

    fn store(&self) -> Result<MutexGuard<'_, Store>, LibraryError> {
        self.store.lock().map_err(|_| LibraryError::Poisoned)
    }
}

fn within_hours(settings: &Settings) -> bool {
    settings.schedule.is_none_or(Schedule::is_open_now)
}

fn delete_files(download: &Download) -> Result<(), LibraryError> {
    let Some(file) = &download.file else {
        return Ok(());
    };
    for path in [file.clone(), part_path(file), state_path(file)] {
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => {
                return Err(LibraryError::Delete { path, source: e });
            }
            _ => {}
        }
    }
    Ok(())
}

fn record(
    store: &Store,
    id: DownloadId,
    last: &Progress,
    outcome: Result<Finished, mdm_engine::Error>,
    unfinished: DownloadState,
) -> Result<(), LibraryError> {
    if let Some(file) = &last.file {
        store.set_file(id, file)?;
    }
    let now = SystemTime::now();
    match outcome {
        Ok(done) => {
            store.set_file(id, &done.path)?;
            store.set_progress(id, done.size, Some(done.size))?;
            store.set_state(id, DownloadState::Done, None, now)?;
            store.add_event(id, &event(EventKind::Finished, now, Some(done.size), None))?;
        }
        Err(error) => {
            store.set_progress(id, last.received, last.total)?;
            let reason = (unfinished == DownloadState::Failed).then(|| error.to_string());
            store.set_state(id, unfinished, reason.as_deref(), now)?;
            let kind = match unfinished {
                DownloadState::Failed => EventKind::Failed,
                _ => EventKind::Paused,
            };
            store.add_event(id, &event(kind, now, Some(last.received), reason))?;
        }
    }
    Ok(())
}

const fn event(
    kind: EventKind,
    at: SystemTime,
    bytes: Option<u64>,
    detail: Option<String>,
) -> Event {
    Event {
        kind,
        at,
        bytes,
        detail,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::time::{Duration, Instant};

    use mdm_labserver::{Config, LabServer};

    use super::*;

    #[tokio::test(flavor = "multi_thread")]
    async fn a_download_still_settles_when_its_history_cannot_be_written() {
        let lab = LabServer::start(Config::default()).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(Store::open_in_memory().unwrap())
            .await
            .unwrap();
        let url = lab.url("/gen/256K/a.bin?seed=5").parse().unwrap();
        let id = library.add(url, dir.path()).await.unwrap();
        library.store().unwrap().break_events();

        let deadline = Instant::now() + Duration::from_secs(20);
        let tick = loop {
            let tick = library.tick().await.unwrap();
            if !tick.settled.is_empty() {
                break tick;
            }
            assert!(Instant::now() < deadline, "the download never settled");
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        assert_eq!(tick.settled, [id]);
        assert!(tick.error.is_some_and(|e| e.contains("events")));
        assert_eq!(library.get(id).unwrap().state, DownloadState::Done);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_start_that_fails_still_settles_when_its_history_cannot_be_written() {
        let lab = LabServer::start(Config::default()).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(Store::open_in_memory().unwrap())
            .await
            .unwrap();
        let url = lab.url("/gen/4M/b.bin?seed=7&rate=1M").parse().unwrap();
        let id = library.add(url, dir.path()).await.unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        let file = loop {
            let tick = library.tick().await.unwrap();
            let file = library.get(id).unwrap().file;
            if let Some(file) = file.filter(|f| state_path(f).exists())
                && tick.live.iter().any(|(_, p)| p.received > 0)
            {
                break file;
            }
            assert!(Instant::now() < deadline, "the download never started");
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        library.pause(id).await.unwrap();
        std::fs::write(state_path(&file), "not a state file").unwrap();
        library.tick().await.unwrap();
        library.store().unwrap().break_events();

        assert!(
            library.resume(id).await.is_err(),
            "the Failed event can't be saved"
        );
        assert_eq!(library.get(id).unwrap().state, DownloadState::Failed);
        assert_eq!(library.tick().await.unwrap().settled, [id]);
    }

    async fn running(lab: &LabServer, dir: &Path, library: &Library, seed: u32) -> DownloadId {
        let url = lab
            .url(&format!("/gen/4M/{seed}.bin?seed={seed}&rate=1M"))
            .parse()
            .unwrap();
        let id = library.add(url, dir).await.unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        while !library
            .tick()
            .await
            .unwrap()
            .live
            .iter()
            .any(|(live, p)| *live == id && p.received > 0)
        {
            assert!(Instant::now() < deadline, "the download never started");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        id
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_pause_or_resume_while_the_hours_stop_a_download_decides_how_it_settles() {
        let lab = LabServer::start(Config::default()).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(Store::open_in_memory().unwrap())
            .await
            .unwrap();
        let state = |id| library.get(id).unwrap().state;

        let id = running(&lab, dir.path(), &library, 1).await;
        let stopping = library.begin_stop().await;
        library.pause(id).await.unwrap();
        library.end_stop(stopping).await.unwrap();
        assert_eq!(state(id), DownloadState::Paused, "a pause holds");

        library.resume(id).await.unwrap();
        let stopping = library.begin_stop().await;
        library.pause(id).await.unwrap();
        library.resume(id).await.unwrap();
        library.end_stop(stopping).await.unwrap();
        assert_eq!(state(id), DownloadState::Queued, "a later resume wins");

        library.resume(id).await.unwrap();
        let stopping = library.begin_stop().await;
        library.pause_all().await.unwrap();
        library.end_stop(stopping).await.unwrap();
        assert_eq!(state(id), DownloadState::Paused, "pause all reaches it");

        library.resume(id).await.unwrap();
        let stopping = library.begin_stop().await;
        library.pause(id).await.unwrap();
        assert!(library.resume_all().await.unwrap().contains(&id));
        library.end_stop(stopping).await.unwrap();
        assert_eq!(state(id), DownloadState::Queued, "resume all reaches it");
    }
}
