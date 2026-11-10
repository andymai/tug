use std::collections::{HashMap, VecDeque};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::SystemTime;

use mdm_engine::limiter::Limiter;
use mdm_engine::naming::part_path;
use mdm_engine::state::state_path;
use url::Url;

use crate::inspect::Inspection;
use crate::origin::{Origin, OriginError};
use crate::schedule::Schedule;
use crate::settings::{Settings, SettingsError, check_own};
use crate::store::{
    Download, DownloadId, DownloadState, Event, EventKind, NewDownload, Place, Store, StoreError,
};
use crate::torrent::{Swarm, TorrentOptions, TorrentSource, TorrentView};

const LIST_WAIT: std::time::Duration = std::time::Duration::from_secs(30);
use crate::transfer::{
    Finished, Phase, Progress, TorrentJob, Transfer, TransferError, TransferOptions,
};

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
    #[error("this is not a magnet link or a .torrent file")]
    NotATorrent,
    #[error("this Tug has no folder for torrents")]
    NoTorrents,
    #[error("{0} is in the list already")]
    DuplicateTorrent(String),
    #[error(transparent)]
    Torrent(#[from] mdm_torrent::TorrentError),
    #[error("{0:?} can't be a file name")]
    BadName(String),
    #[error("Tug renames a download before it starts or after it finishes")]
    CantRename,
    #[error("{0} is in that folder already")]
    NameTaken(String),
    #[error("could not rename {}: {source}", path.display())]
    Rename { path: PathBuf, source: io::Error },
    #[error("a finished download or a torrent sends no headers")]
    NoHeaders,
    #[error(transparent)]
    Origin(#[from] OriginError),
    #[error("Tug knows this torrent's files once its peers send them")]
    NoFileList,
    #[error("choose at least one of the torrent's files")]
    BadFiles,
    #[error("a finished torrent's files are there already")]
    TorrentDone,
    #[error(
        "Tug can change the files while the torrent runs or waits, not while it starts or ends"
    )]
    TorrentBusy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cookies<'a> {
    Keep,
    Clear,
    Set(&'a str),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AddOptions {
    pub paused: bool,
    // First in the queue rather than last.
    pub first: bool,
    pub connections: Option<u32>,
    pub speed_limit: Option<u64>,
    // The file's name, in place of the one the server gives.
    pub name: Option<String>,
}

pub fn check_name(name: &str) -> Result<&str, LibraryError> {
    let name = name.trim();
    let plain = !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name.contains(['/', '\0']);
    if plain {
        Ok(name)
    } else {
        Err(LibraryError::BadName(name.to_owned()))
    }
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

struct Ended {
    last: Progress,
    outcome: Result<Finished, TransferError>,
    learned: Option<(String, Vec<u8>)>,
}

// A download out of the run whose row hasn't settled yet. Dropped before it settles
// (its task cancelled), it leaves `stopping`, so the download isn't busy for good.
struct Settling<'a> {
    library: &'a Library,
    id: DownloadId,
    settled: bool,
}

impl Drop for Settling<'_> {
    fn drop(&mut self) {
        if !self.settled {
            self.library.stopping().remove(&self.id);
            self.library.settled.notify_waiters();
        }
    }
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
    // Downloads whose transfer is ending while their row still says downloading,
    // with the state each settles as. Pause and resume change it under the run lock
    // in that time, and the other calls treat these downloads as busy.
    stopping: Mutex<HashMap<DownloadId, DownloadState>>,
    // Wakes a call that waits for a download to settle.
    settled: tokio::sync::Notify,
    swarm: Option<Arc<Swarm>>,
    // The last inspection of each transfer that ended in this session, newest last.
    ended: Mutex<VecDeque<(DownloadId, Inspection)>>,
    #[cfg(feature = "test-points")]
    points: crate::points::Points,
}

const KEPT_INSPECTIONS: usize = 64;

impl Library {
    pub async fn open(store: Store) -> Result<Self, LibraryError> {
        Self::open_with(store, None).await
    }

    // Holds every task that gets to the named point until the hold is released or dropped.
    #[cfg(feature = "test-points")]
    pub fn hold_at(&self, name: &'static str) -> crate::points::Hold {
        self.points.arm(name)
    }

    pub async fn open_with(
        store: Store,
        torrents: Option<TorrentOptions>,
    ) -> Result<Self, LibraryError> {
        let settings = Settings::load(&store)?;
        let library = Self {
            limiter: Arc::new(Limiter::new(settings.speed_limit_now())),
            settings: Mutex::new(settings),
            store: Mutex::new(store),
            running: tokio::sync::Mutex::default(),
            news: Mutex::default(),
            stopping: Mutex::default(),
            settled: tokio::sync::Notify::new(),
            swarm: torrents.map(|options| Arc::new(Swarm::new(options))),
            ended: Mutex::default(),
            #[cfg(feature = "test-points")]
            points: crate::points::Points::default(),
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
        self.add_with(url, dir, origin, AddOptions::default()).await
    }

    pub async fn add_with(
        &self,
        url: Url,
        dir: &Path,
        origin: &Origin,
        options: AddOptions,
    ) -> Result<DownloadId, LibraryError> {
        let id = self.insert(url, dir, origin, &options)?;
        if !options.paused {
            self.pump().await?;
        }
        Ok(id)
    }

    // Before the download starts, Tug saves it under the name; after it finishes,
    // Tug renames the file. In between, the engine's state file holds the path.
    pub async fn rename(&self, id: DownloadId, name: &str) -> Result<(), LibraryError> {
        let name = check_name(name)?;
        let running = self.lock_settled(id).await;
        let download = self.get(id)?;
        if download.is_torrent() {
            return Err(LibraryError::CantRename);
        }
        match (&download.file, download.state) {
            (Some(file), DownloadState::Done) => {
                let to = file.with_file_name(name);
                if to != *file {
                    rename_new(file, &to).map_err(|e| match e.kind() {
                        io::ErrorKind::AlreadyExists => LibraryError::NameTaken(name.to_owned()),
                        _ => LibraryError::Rename {
                            path: file.clone(),
                            source: e,
                        },
                    })?;
                    // The file moved; it goes back if its new place can't be saved.
                    if let Err(e) = self.store().and_then(|store| Ok(store.set_file(id, &to)?)) {
                        let _back = rename_new(&to, file);
                        return Err(e);
                    }
                }
            }
            (None, _) if !running.contains_key(&id) => self.store()?.set_name(id, name)?,
            _ => return Err(LibraryError::CantRename),
        }
        drop(running);
        self.changed(id);
        Ok(())
    }

    pub fn origin(&self, id: DownloadId) -> Result<Origin, LibraryError> {
        self.get(id)?;
        Ok(self.store()?.origin(id)?)
    }

    // A running download keeps the headers it started with until its next start.
    // Under one store lock from the check to the write: a download that finishes
    // in between would get its cookies back, and a second edit could undo them.
    pub fn set_origin(
        &self,
        id: DownloadId,
        referrer: Option<&str>,
        cookies: Cookies<'_>,
        user_agent: Option<&str>,
    ) -> Result<Origin, LibraryError> {
        let store = self.store()?;
        let download = store.get(id)?.ok_or(LibraryError::Unknown(id.get()))?;
        if download.state == DownloadState::Done || download.is_torrent() {
            return Err(LibraryError::NoHeaders);
        }
        let current = store.origin(id)?;
        let cookies = match cookies {
            Cookies::Keep => current.cookies(),
            Cookies::Clear => None,
            Cookies::Set(value) => Some(value),
        };
        let origin = Origin::new(referrer, cookies, user_agent)?;
        store.set_origin(id, &origin)?;
        drop(store);
        self.changed(id);
        Ok(origin)
    }

    // From the session while it holds the torrent (running or paused), else from
    // the .torrent Tug keeps; a magnet link has nothing until its peers answer.
    pub async fn torrent_view(&self, id: DownloadId) -> Result<Option<TorrentView>, LibraryError> {
        let download = self.get(id)?;
        let (Some(swarm), true) = (&self.swarm, download.is_torrent()) else {
            return Ok(None);
        };
        let Some((hash, bytes)) = self.store()?.torrent(id)? else {
            return Ok(None);
        };
        let chosen = self.store()?.torrent_files(id)?;
        let session = swarm.session().await?;
        if let Some((entries, only, _)) = session.files(&hash) {
            let stats = session.stats(&hash).ok();
            let done = |index: usize| {
                stats
                    .as_ref()
                    .and_then(|s| s.file_done.get(index).copied())
                    .unwrap_or(0)
            };
            return Ok(Some(TorrentView {
                files: crate::torrent::files_of(&entries, only.as_deref(), done),
                peers: session
                    .peers(&hash)
                    .into_iter()
                    .map(crate::torrent::peer_of)
                    .collect(),
                uploaded: stats.as_ref().map_or(0, |s| s.uploaded),
                peers_live: stats.as_ref().map_or(0, |s| s.peers_live),
                peers_seen: stats.as_ref().map_or(0, |s| s.peers_seen),
            }));
        }
        let meta = session
            .metadata(&mdm_torrent::Source::File(bytes), LIST_WAIT, None)
            .await?;
        let finished = download.state == DownloadState::Done;
        let sizes: Vec<u64> = meta.files.iter().map(|f| f.size).collect();
        let done = |index: usize| {
            if finished {
                sizes.get(index).copied().unwrap_or(0)
            } else {
                0
            }
        };
        Ok(Some(TorrentView {
            files: crate::torrent::files_of(&meta.files, chosen.as_deref(), done),
            peers: Vec::new(),
            uploaded: 0,
            peers_live: 0,
            peers_seen: 0,
        }))
    }

    // Live while the session holds it, and for its next start.
    pub async fn choose_files(&self, id: DownloadId, files: &[usize]) -> Result<(), LibraryError> {
        let running = self.running.lock().await;
        let download = self.get(id)?;
        if !download.is_torrent() {
            return Err(LibraryError::NotATorrent);
        }
        if download.state == DownloadState::Done {
            return Err(LibraryError::TorrentDone);
        }
        let swarm = self.swarm.as_ref().ok_or(LibraryError::NoTorrents)?;
        let (hash, bytes) = self.store()?.torrent(id)?.ok_or(LibraryError::NoFileList)?;
        let session = swarm.session().await?;
        let changes = swarm.changes.lock().await;
        // A running transfer outside the session is still adding the torrent, with
        // the choice it began with, or has finished it; a stopping one is settling.
        // A new choice would be lost.
        let settling = self.stopping().contains_key(&id);
        if settling || (running.contains_key(&id) && !session.has(&hash)) {
            return Err(LibraryError::TorrentBusy);
        }
        let entries = match session.files(&hash) {
            Some((entries, _, _)) => entries,
            None => {
                session
                    .metadata(&mdm_torrent::Source::File(bytes), LIST_WAIT, None)
                    .await?
                    .files
            }
        };
        let mut chosen: Vec<usize> = files.to_vec();
        chosen.sort_unstable();
        chosen.dedup();
        let real = |index: &usize| entries.get(*index).is_some_and(|e| !e.padding);
        if chosen.is_empty() || !chosen.iter().all(real) {
            return Err(LibraryError::BadFiles);
        }
        let all = entries.iter().filter(|e| !e.padding).count() == chosen.len();
        // The session takes it first, so a refusal there leaves the saved choice
        // as it was. The list and the window show the chosen files' size at once.
        let (received, total) = if session.has(&hash) {
            session
                .choose(&hash, &chosen.iter().copied().collect())
                .await?;
            let stats = session.stats(&hash)?;
            (stats.done, stats.total)
        } else {
            let total = chosen
                .iter()
                .filter_map(|i| entries.get(*i))
                .map(|e| e.size)
                .sum();
            (download.received.min(total), total)
        };
        let store = self.store()?;
        store.set_torrent_files(id, (!all).then_some(chosen.as_slice()))?;
        store.set_progress(id, received, Some(total))?;
        drop(store);
        drop(changes);
        drop(running);
        self.changed(id);
        Ok(())
    }

    // The connections take effect at the next start; the speed limit at once.
    pub async fn set_options(
        &self,
        id: DownloadId,
        connections: Option<u32>,
        speed_limit: Option<u64>,
    ) -> Result<(), LibraryError> {
        check_own(connections, speed_limit)?;
        let running = self.running.lock().await;
        self.get(id)?;
        self.store()?.set_options(id, connections, speed_limit)?;
        if let Some(entry) = running.get(&id) {
            entry.transfer.set_speed_limit(speed_limit);
        }
        drop(running);
        self.changed(id);
        Ok(())
    }

    pub async fn add_torrent(
        &self,
        source: TorrentSource,
        dir: &Path,
    ) -> Result<DownloadId, LibraryError> {
        let id = self.insert_torrent(source, dir, false).await?;
        self.pump().await?;
        Ok(id)
    }

    pub async fn add_torrent_paused(
        &self,
        source: TorrentSource,
        dir: &Path,
    ) -> Result<DownloadId, LibraryError> {
        self.insert_torrent(source, dir, true).await
    }

    async fn insert_torrent(
        &self,
        source: TorrentSource,
        dir: &Path,
        paused: bool,
    ) -> Result<DownloadId, LibraryError> {
        if self.swarm.is_none() {
            return Err(LibraryError::NoTorrents);
        }
        let link = source.link().ok_or(LibraryError::NotATorrent)?;
        let url = Url::parse(&link).map_err(|_| LibraryError::NotATorrent)?;
        let hash = crate::store::info_hash(&link).ok_or(LibraryError::NotATorrent)?;
        // Under the run lock, so no tick can launch the row before its .torrent is there.
        let running = self.running.lock().await;
        if let Some(twin) = self.unfinished_torrent(&hash)? {
            return Err(LibraryError::DuplicateTorrent(twin.name()));
        }
        let options = AddOptions {
            paused,
            ..AddOptions::default()
        };
        let id = self.insert(url, dir, &Origin::default(), &options)?;
        if let TorrentSource::File(bytes) = &source {
            self.store()?.set_torrent(id, &hash, bytes)?;
        }
        drop(running);
        Ok(id)
    }

    // librqbit's session holds one entry for each hash, so two downloads can't share one.
    fn unfinished_torrent(&self, hash: &str) -> Result<Option<Download>, LibraryError> {
        let store = self.store()?;
        let mut torrents = Vec::new();
        for download in store.list()? {
            if download.is_torrent() && download.state != DownloadState::Done {
                let known = store
                    .torrent(download.id)?
                    .map(|(stored, _)| stored)
                    .or_else(|| crate::store::info_hash(download.url.as_str()));
                torrents.push((download, known));
            }
        }
        drop(store);
        Ok(torrents
            .into_iter()
            .find(|(_, known)| known.as_deref() == Some(hash))
            .map(|(download, _)| download))
    }

    pub fn add_paused(
        &self,
        url: Url,
        dir: &Path,
        origin: &Origin,
    ) -> Result<DownloadId, LibraryError> {
        let options = AddOptions {
            paused: true,
            ..AddOptions::default()
        };
        self.insert(url, dir, origin, &options)
    }

    // All under the store's lock, so no tick starts the download before its
    // options and its place are there.
    fn insert(
        &self,
        url: Url,
        dir: &Path,
        origin: &Origin,
        options: &AddOptions,
    ) -> Result<DownloadId, LibraryError> {
        check_own(options.connections, options.speed_limit)?;
        let name = options.name.as_deref().map(check_name).transpose()?;
        let added = SystemTime::now();
        let store = self.store()?;
        let id = store.insert_as(
            &NewDownload {
                url,
                dir: dir.to_owned(),
                added,
            },
            origin,
            DownloadState::Queued,
        )?;
        if options.connections.is_some() || options.speed_limit.is_some() {
            store.set_options(id, options.connections, options.speed_limit)?;
        }
        if let Some(name) = name {
            store.set_name(id, name)?;
        }
        if options.first {
            store.place(id, Place::First)?;
        }
        if options.paused {
            store.set_state(id, DownloadState::Paused, None, added)?;
        }
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

    pub fn search(&self, query: &str) -> Result<Vec<DownloadId>, LibraryError> {
        Ok(self.store()?.search(query)?)
    }

    pub fn events(&self, id: DownloadId) -> Result<Vec<Event>, LibraryError> {
        self.get(id)?;
        Ok(self.store()?.events(id)?)
    }

    // A running HTTP download's, else the last one its transfer had in this session.
    pub async fn inspect(&self, id: DownloadId) -> Result<Option<Inspection>, LibraryError> {
        self.get(id)?;
        let running = self.running.lock().await;
        if let Some(entry) = running.get(&id) {
            return Ok(entry.transfer.inspect());
        }
        drop(running);
        Ok(self
            .ended()
            .iter()
            .find(|(other, _)| *other == id)
            .map(|(_, seen)| seen.clone()))
    }

    // A waiting download is held under the run lock, so a tick can't start it
    // between the check and the write.
    pub async fn pause(&self, id: DownloadId) -> Result<(), LibraryError> {
        let mut running = self.running.lock().await;
        let download = self.get(id)?;
        let Some((entry, settling)) = self.take(&mut running, id, DownloadState::Paused) else {
            if download.state == DownloadState::Queued {
                self.hold(&download)?;
            } else {
                self.retarget(id, DownloadState::Paused);
            }
            drop(running);
            return Ok(());
        };
        drop(running);
        entry.transfer.stop();
        let settled = self.settle(settling, entry.transfer).await;
        self.changed(id);
        settled?;
        self.pump().await
    }

    pub async fn pause_all(&self) -> Result<(), LibraryError> {
        let mut running = self.running.lock().await;
        let held = self.hold_queue();
        for target in self.stopping().values_mut() {
            if *target != DownloadState::Failed {
                *target = DownloadState::Paused;
            }
        }
        let stopped: Vec<(Running, Settling<'_>)> = running
            .drain()
            .map(|(id, entry)| (entry, self.settling(id, DownloadState::Paused)))
            .collect();
        drop(running);
        for (entry, _) in &stopped {
            entry.transfer.stop();
        }
        let mut first = held.err();
        for (entry, settling) in stopped {
            let id = settling.id;
            if let Err(e) = self.settle(settling, entry.transfer).await {
                first.get_or_insert(e);
            }
            self.changed(id);
        }
        // A resume while the transfers ended queued its download again.
        let pumped = self.pump().await;
        first.map_or(pumped, Err)
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
        if self.retarget(id, DownloadState::Queued) {
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

    // Under the run lock to the end, so no tick, resume or Resume all can start
    // the download while its files go.
    pub async fn remove(&self, id: DownloadId, delete_file: bool) -> Result<(), LibraryError> {
        let mut running = self.lock_settled(id).await;
        let download = self.get(id)?;
        // Without its session Tug can't tell a torrent's files, so it keeps the
        // download, unchanged, rather than say they went.
        if delete_file && download.is_torrent() && self.swarm.is_none() {
            return Err(LibraryError::NoTorrents);
        }
        // Settled as paused, so a removal that fails below leaves a true state,
        // and the file that the run learned is known to the delete.
        if let Some((entry, settling)) = self.take(&mut running, id, DownloadState::Paused) {
            entry.transfer.stop();
            let ended = self.end(id, entry.transfer).await;
            let settled = self.record_end(settling, ended);
            self.changed(id);
            settled?;
        }
        let download = self.get(id)?;
        if download.is_torrent() {
            let torrent = self.store()?.torrent(id)?;
            self.forget_torrent(&download, torrent, delete_file).await?;
        } else if delete_file {
            delete_files(&download)?;
        }
        self.store()?.remove(id)?;
        drop(running);
        self.keep_inspection(id, None);
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
        self.keep_inspection(id, None);
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
            self.keep_learned(id, entry.transfer.take_torrent())?;
            if !entry.file_recorded
                && let Some(file) = &progress.file
            {
                self.store()?.set_file(id, file)?;
                entry.file_recorded = true;
                self.changed(id);
            }
            if matches!(progress.phase, Phase::Done | Phase::Failed | Phase::Stopped) {
                ended.push(id);
            } else {
                live.push((id, progress));
            }
        }
        let finished: Vec<(Running, Settling<'_>)> = ended
            .iter()
            .filter_map(|&id| self.take(&mut running, id, DownloadState::Failed))
            .collect();
        drop(running);
        let mut settled = Vec::with_capacity(finished.len());
        let mut error = None;
        for (entry, settling) in finished {
            let id = settling.id;
            if let Err(e) = self.settle(settling, entry.transfer).await {
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

    async fn begin_stop(&self) -> Vec<(Running, Settling<'_>)> {
        let mut running = self.running.lock().await;
        let stopped: Vec<(Running, Settling<'_>)> = running
            .drain()
            .map(|(id, entry)| (entry, self.settling(id, DownloadState::Queued)))
            .collect();
        drop(running);
        for (entry, _) in &stopped {
            entry.transfer.stop();
        }
        stopped
    }

    async fn end_stop(&self, stopped: Vec<(Running, Settling<'_>)>) -> Result<(), LibraryError> {
        let mut first = None;
        for (entry, settling) in stopped {
            let id = settling.id;
            if let Err(e) = self.settle(settling, entry.transfer).await {
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
        if download.is_torrent() {
            return self.launch_torrent(download, running);
        }
        let resumable = download
            .file
            .as_deref()
            .filter(|file| state_path(file).exists());
        let options = TransferOptions {
            connections: download.connections.unwrap_or(self.settings()?.connections),
            speed_limit: download.speed_limit,
            limiter: Some(Arc::clone(&self.limiter)),
            origin: self.store()?.origin(download.id)?,
        };
        let transfer = match (resumable, &download.own_name) {
            (Some(file), _) => Transfer::resume(file, &options)?,
            (None, Some(name)) => {
                Transfer::start_as(download.url.clone(), &download.dir.join(name), &options)
            }
            (None, None) => Transfer::start(download.url.clone(), &download.dir, &options),
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

    fn launch_torrent(
        &self,
        download: &Download,
        running: &mut HashMap<DownloadId, Running>,
    ) -> Result<(), LibraryError> {
        let swarm = self.swarm.as_ref().ok_or(LibraryError::NoTorrents)?;
        let torrent = self.store()?.torrent(download.id)?;
        let now = SystemTime::now();
        let started = if download.received > 0 {
            event(EventKind::Resumed, now, Some(download.received), None)
        } else {
            event(EventKind::Started, now, None, None)
        };
        let transfer = Transfer::torrent(
            Arc::clone(swarm),
            TorrentJob {
                magnet: download.url.to_string(),
                torrent,
                dir: download.dir.clone(),
                files: self.store()?.torrent_files(download.id)?,
            },
            Arc::clone(&self.limiter),
        );
        {
            let store = self.store()?;
            store.set_state(download.id, DownloadState::Downloading, None, now)?;
            store.add_event(download.id, &started)?;
        }
        running.insert(
            download.id,
            Running {
                transfer,
                file_recorded: false,
            },
        );
        Ok(())
    }

    // A torrent leaves librqbit's session with its download; one that finished
    // has left it already, so its files go from here.
    async fn forget_torrent(
        &self,
        download: &Download,
        torrent: Option<(String, Vec<u8>)>,
        delete_file: bool,
    ) -> Result<(), LibraryError> {
        let (Some(swarm), Some((hash, bytes))) = (&self.swarm, torrent) else {
            return Ok(());
        };
        let session = swarm.session().await?;
        if session.has(&hash) {
            session.remove(&hash, delete_file).await?;
            return Ok(());
        }
        if !delete_file {
            return Ok(());
        }
        // Only the torrent's own files go, and then the folders they leave empty:
        // the person may keep other files beside them.
        let meta = session
            .metadata(&mdm_torrent::Source::File(bytes), LIST_WAIT, None)
            .await?;
        // mdm-torrent refuses unsafe names before it lists them; deleting stays
        // inside the download folder whatever a list says.
        let folder = meta.folder_in(&download.dir);
        if !folder.starts_with(&download.dir) {
            return Ok(());
        }
        let plain = |path: &Path| {
            path.components()
                .all(|part| matches!(part, std::path::Component::Normal(_)))
        };
        let mut folders = Vec::new();
        for file in meta.files.iter().filter(|f| !f.padding && plain(&f.path)) {
            let path = folder.join(&file.path);
            match std::fs::remove_file(&path) {
                Err(e) if e.kind() != io::ErrorKind::NotFound => {
                    return Err(LibraryError::Delete { path, source: e });
                }
                _ => {}
            }
            folders.extend(
                path.ancestors()
                    .skip(1)
                    .take_while(|dir| dir.starts_with(&folder) && *dir != download.dir)
                    .map(Path::to_path_buf),
            );
        }
        folders.sort_by_key(|dir| std::cmp::Reverse(dir.components().count()));
        folders.dedup();
        for dir in folders {
            let _kept_when_not_empty = std::fs::remove_dir(dir);
        }
        Ok(())
    }

    fn keep_learned(
        &self,
        id: DownloadId,
        learned: Option<(String, Vec<u8>)>,
    ) -> Result<(), LibraryError> {
        if let Some((hash, torrent)) = learned {
            self.store()?.set_torrent(id, &hash, &torrent)?;
        }
        Ok(())
    }

    // Under the run lock: the download settles as `target`, unless a pause or resume
    // changes that before its transfer ends.
    fn settling(&self, id: DownloadId, target: DownloadState) -> Settling<'_> {
        self.stopping().insert(id, target);
        Settling {
            library: self,
            id,
            settled: false,
        }
    }

    fn take(
        &self,
        running: &mut HashMap<DownloadId, Running>,
        id: DownloadId,
        target: DownloadState,
    ) -> Option<(Running, Settling<'_>)> {
        let entry = running.remove(&id)?;
        Some((entry, self.settling(id, target)))
    }

    // A stop's target follows a later pause or resume, but a transfer that failed on
    // its own keeps that outcome and its reason. False when the download isn't stopping.
    fn retarget(&self, id: DownloadId, to: DownloadState) -> bool {
        let mut stopping = self.stopping();
        let Some(target) = stopping.get_mut(&id) else {
            return false;
        };
        if *target != DownloadState::Failed {
            *target = to;
        }
        drop(stopping);
        true
    }

    async fn settle(&self, settling: Settling<'_>, transfer: Transfer) -> Result<(), LibraryError> {
        let ended = self.end(settling.id, transfer).await;
        let running = self.running.lock().await;
        let recorded = self.record_end(settling, ended);
        drop(running);
        recorded
    }

    // Can take a while, and the row still says downloading in that time.
    async fn end(&self, id: DownloadId, transfer: Transfer) -> Ended {
        point!(self, "settle");
        let last = transfer.progress();
        self.keep_inspection(id, transfer.inspect());
        let (outcome, learned) = transfer.end().await;
        Ended {
            last,
            outcome,
            learned,
        }
    }

    // Under the run lock, so a pause or resume can't change the state in between.
    fn record_end(&self, mut settling: Settling<'_>, ended: Ended) -> Result<(), LibraryError> {
        settling.settled = true;
        let id = settling.id;
        let learned = self.keep_learned(id, ended.learned);
        let target = self.stopping().remove(&id).unwrap_or(DownloadState::Paused);
        let recorded = self
            .store()
            .and_then(|store| record(&store, id, &ended.last, ended.outcome, target));
        self.settled.notify_waiters();
        learned.and(recorded)
    }

    // The run lock, once the download isn't settling: a call that changes its row
    // or its files waits for the end of its transfer.
    async fn lock_settled(
        &self,
        id: DownloadId,
    ) -> tokio::sync::MutexGuard<'_, HashMap<DownloadId, Running>> {
        loop {
            let running = self.running.lock().await;
            if !self.stopping().contains_key(&id) {
                return running;
            }
            let settled = self.settled.notified();
            drop(running);
            point!(self, "waits");
            settled.await;
        }
    }

    fn ended(&self) -> MutexGuard<'_, VecDeque<(DownloadId, Inspection)>> {
        self.ended.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn keep_inspection(&self, id: DownloadId, seen: Option<Inspection>) {
        let mut ended = self.ended();
        ended.retain(|(other, _)| *other != id);
        if let Some(seen) = seen {
            if ended.len() >= KEPT_INSPECTIONS {
                ended.pop_front();
            }
            ended.push_back((id, seen));
        }
    }

    fn store(&self) -> Result<MutexGuard<'_, Store>, LibraryError> {
        self.store.lock().map_err(|_| LibraryError::Poisoned)
    }
}

// Never over a file that is there already.
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    use rustix::fs::{CWD, RenameFlags, renameat_with};
    renameat_with(CWD, from, CWD, to, RenameFlags::NOREPLACE).map_err(io::Error::from)
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
    outcome: Result<Finished, TransferError>,
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

    #[tokio::test(flavor = "multi_thread")]
    async fn the_tick_that_records_a_file_name_reports_the_change() {
        let lab = LabServer::start(Config::default()).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(Store::open_in_memory().unwrap())
            .await
            .unwrap();
        let id = running(&lab, dir.path(), &library, 5).await;
        library
            .running
            .lock()
            .await
            .get_mut(&id)
            .unwrap()
            .file_recorded = false;
        assert_eq!(library.tick().await.unwrap().changed, [id]);
        assert!(library.tick().await.unwrap().changed.is_empty());
    }
}
