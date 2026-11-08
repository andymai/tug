use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::SystemTime;

use mdm_engine::limiter::Limiter;
use mdm_engine::naming::part_path;
use mdm_engine::state::state_path;
use url::Url;

use crate::settings::{Settings, SettingsError};
use crate::store::{Download, DownloadId, DownloadState, NewDownload, Store, StoreError};
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
}

impl Library {
    pub async fn open(store: Store) -> Result<Self, LibraryError> {
        let settings = Settings::load(&store)?;
        let library = Self {
            limiter: Arc::new(Limiter::new(settings.speed_limit)),
            settings: Mutex::new(settings),
            store: Mutex::new(store),
            running: tokio::sync::Mutex::default(),
        };
        let interrupted: Vec<Download> = library
            .store()?
            .list()?
            .into_iter()
            .filter(|d| matches!(d.state, DownloadState::Queued | DownloadState::Downloading))
            .collect();
        for download in &interrupted {
            library.launch(download).await?;
        }
        Ok(library)
    }

    pub async fn add(&self, url: Url, dir: &Path) -> Result<DownloadId, LibraryError> {
        let id = self.store()?.insert(&NewDownload {
            url,
            dir: dir.to_owned(),
            added: SystemTime::now(),
        })?;
        let download = self.get(id)?;
        self.launch(&download).await?;
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
        self.limiter.set(settings.speed_limit);
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

    pub async fn pause(&self, id: DownloadId) -> Result<(), LibraryError> {
        self.get(id)?;
        let Some(running) = self.running.lock().await.remove(&id) else {
            return Ok(());
        };
        running.transfer.stop();
        self.settle(id, running.transfer, DownloadState::Paused)
            .await
    }

    pub async fn resume(&self, id: DownloadId) -> Result<(), LibraryError> {
        let download = self.get(id)?;
        if download.state == DownloadState::Done || self.running.lock().await.contains_key(&id) {
            return Ok(());
        }
        self.launch(&download).await
    }

    pub async fn remove(&self, id: DownloadId, delete_file: bool) -> Result<(), LibraryError> {
        let download = self.get(id)?;
        let stopped = self.running.lock().await.remove(&id);
        if let Some(running) = stopped {
            running.transfer.stop();
            let _stopped = running.transfer.finish().await;
        }
        if delete_file && let Some(file) = &download.file {
            for path in [file.clone(), part_path(file), state_path(file)] {
                match std::fs::remove_file(&path) {
                    Err(e) if e.kind() != io::ErrorKind::NotFound => {
                        return Err(LibraryError::Delete { path, source: e });
                    }
                    _ => {}
                }
            }
        }
        self.store()?.remove(id)?;
        Ok(())
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
        for (id, entry) in finished {
            self.settle(id, entry.transfer, DownloadState::Failed)
                .await?;
            settled.push(id);
        }
        Ok(Tick { live, settled })
    }

    pub fn record_progress(&self, live: &[(DownloadId, Progress)]) -> Result<(), LibraryError> {
        let store = self.store()?;
        for (id, progress) in live {
            store.set_progress(*id, progress.received, progress.total)?;
        }
        drop(store);
        Ok(())
    }

    async fn launch(&self, download: &Download) -> Result<(), LibraryError> {
        let resumable = download
            .file
            .as_deref()
            .filter(|file| state_path(file).exists());
        let options = TransferOptions {
            connections: self.settings()?.connections,
            limiter: Some(Arc::clone(&self.limiter)),
        };
        let transfer = match resumable {
            Some(file) => Transfer::resume(file, &options)?,
            None => Transfer::start(download.url.clone(), &download.dir, &options),
        };
        self.store()?.set_state(
            download.id,
            DownloadState::Downloading,
            None,
            SystemTime::now(),
        )?;
        self.running.lock().await.insert(
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
        }
        Err(error) => {
            store.set_progress(id, last.received, last.total)?;
            let reason = (unfinished == DownloadState::Failed).then(|| error.to_string());
            store.set_state(id, unfinished, reason.as_deref(), now)?;
        }
    }
    Ok(())
}
