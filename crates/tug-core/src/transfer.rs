use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use mdm_engine::download::State;
use mdm_engine::limiter::Limiter;
use mdm_engine::{Destination, Download, Options, Request};
use mdm_torrent::{Meta, Source, Stats, TorrentError};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use url::Url;

use crate::inspect::Inspection;
use crate::origin::Origin;
use crate::torrent::Swarm;

pub const USER_AGENT: &str = concat!("Tug/", env!("CARGO_PKG_VERSION"));

const POLL: Duration = Duration::from_millis(200);
const LIST_WAIT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Starting,
    Downloading,
    Finishing,
    Done,
    Failed,
    Stopped,
}

impl From<State> for Phase {
    fn from(state: State) -> Self {
        match state {
            State::Probing => Self::Starting,
            State::Downloading => Self::Downloading,
            State::Verifying | State::Completing => Self::Finishing,
            State::Done => Self::Done,
            State::Failed => Self::Failed,
            State::Cancelled => Self::Stopped,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Progress {
    pub phase: Phase,
    pub received: u64,
    pub total: Option<u64>,
    pub speed: u64,
    pub connections: usize,
    pub file: Option<PathBuf>,
    pub error: Option<String>,
}

impl Progress {
    const fn starting() -> Self {
        Self {
            phase: Phase::Starting,
            received: 0,
            total: None,
            speed: 0,
            connections: 0,
            file: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TransferOptions {
    pub connections: u32,
    // This download's own limit, under the shared one.
    pub speed_limit: Option<u64>,
    pub limiter: Option<Arc<Limiter>>,
    pub origin: Origin,
}

impl TransferOptions {
    pub fn new(connections: u32) -> Self {
        Self {
            connections,
            speed_limit: None,
            limiter: None,
            origin: Origin::default(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TransferError {
    #[error(transparent)]
    Engine(#[from] mdm_engine::Error),
    #[error(transparent)]
    Torrent(#[from] TorrentError),
    #[error("stopped")]
    Stopped,
    #[error("the torrent stopped answering: {0}")]
    Lost(String),
}

#[derive(Debug, Clone)]
pub struct TorrentJob {
    pub magnet: String,
    pub torrent: Option<(String, Vec<u8>)>,
    pub dir: PathBuf,
}

type Learned = Arc<Mutex<Option<(String, Vec<u8>)>>>;

pub struct Transfer {
    work: Work,
}

enum Work {
    Http(Download),
    Torrent(TorrentRun),
}

struct TorrentRun {
    progress: Arc<Mutex<Progress>>,
    learned: Learned,
    stop: watch::Sender<bool>,
    task: JoinHandle<Result<Finished, TransferError>>,
}

impl Transfer {
    pub fn start(url: Url, dir: &Path, options: &TransferOptions) -> Self {
        let request = Request {
            url,
            headers: options.origin.headers(),
            dest: Destination::Dir(dir.to_owned()),
        };
        Self {
            work: Work::Http(Download::start(request, engine_options(options))),
        }
    }

    // Saves exactly at `file`, under the name the person chose.
    pub fn start_as(url: Url, file: &Path, options: &TransferOptions) -> Self {
        let request = Request {
            url,
            headers: options.origin.headers(),
            dest: Destination::File(file.to_owned()),
        };
        Self {
            work: Work::Http(Download::start(request, engine_options(options))),
        }
    }

    pub fn resume(file: &Path, options: &TransferOptions) -> Result<Self, mdm_engine::Error> {
        let state = mdm_engine::state::state_path(file);
        let download = Download::resume(state, options.origin.headers(), engine_options(options))?;
        Ok(Self {
            work: Work::Http(download),
        })
    }

    pub(crate) fn torrent(swarm: Arc<Swarm>, job: TorrentJob, limiter: Arc<Limiter>) -> Self {
        let progress = Arc::new(Mutex::new(Progress::starting()));
        let learned = Arc::new(Mutex::new(None));
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(run_torrent(
            swarm,
            job,
            limiter,
            Arc::clone(&progress),
            Arc::clone(&learned),
            stopped,
        ));
        Self {
            work: Work::Torrent(TorrentRun {
                progress,
                learned,
                stop,
                task,
            }),
        }
    }

    pub fn progress(&self) -> Progress {
        match &self.work {
            Work::Http(download) => {
                let snap = download.snapshot();
                Progress {
                    phase: snap.state.into(),
                    received: snap.downloaded,
                    total: snap.size,
                    speed: snap.connections.iter().map(|c| c.speed).sum(),
                    connections: snap.connections.len(),
                    file: snap.file,
                    error: snap.error,
                }
            }
            Work::Torrent(run) => run
                .progress
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone(),
        }
    }

    pub fn inspect(&self) -> Option<Inspection> {
        match &self.work {
            Work::Http(download) => Some(download.snapshot().into()),
            Work::Torrent(_) => None,
        }
    }

    // A torrent's hash and .torrent file, once, when its run first learns them.
    pub fn take_torrent(&self) -> Option<(String, Vec<u8>)> {
        match &self.work {
            Work::Http(_) => None,
            Work::Torrent(run) => run
                .learned
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take(),
        }
    }

    pub fn set_speed_limit(&self, rate: Option<u64>) {
        if let Work::Http(download) = &self.work {
            download.set_speed_limit(rate);
        }
    }

    pub fn stop(&self) {
        match &self.work {
            Work::Http(download) => download.cancel(),
            Work::Torrent(run) => {
                let _stopping = run.stop.send(true);
            }
        }
    }

    pub async fn finish(self) -> Result<Finished, TransferError> {
        self.end().await.0
    }

    // The outcome, and what a torrent's run learned and no tick saved yet.
    pub async fn end(self) -> (Result<Finished, TransferError>, Option<(String, Vec<u8>)>) {
        match self.work {
            Work::Http(_) => (self.finish_http().await, None),
            Work::Torrent(run) => {
                let outcome = run
                    .task
                    .await
                    .unwrap_or_else(|e| Err(TransferError::Lost(e.to_string())));
                let learned = run
                    .learned
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .take();
                (outcome, learned)
            }
        }
    }

    async fn finish_http(self) -> Result<Finished, TransferError> {
        match self.work {
            Work::Http(download) => download
                .wait()
                .await
                .map(|outcome| Finished {
                    path: outcome.path,
                    size: outcome.size,
                })
                .map_err(TransferError::from),
            Work::Torrent(run) => run
                .task
                .await
                .unwrap_or_else(|e| Err(TransferError::Lost(e.to_string()))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finished {
    pub path: PathBuf,
    pub size: u64,
}

fn engine_options(options: &TransferOptions) -> Options {
    Options {
        max_connections: options.connections,
        user_agent: options.origin.user_agent().unwrap_or(USER_AGENT).to_owned(),
        speed_limit: options.speed_limit,
        global: options.limiter.clone(),
        ..Options::default()
    }
}

async fn run_torrent(
    swarm: Arc<Swarm>,
    job: TorrentJob,
    limiter: Arc<Limiter>,
    progress: Arc<Mutex<Progress>>,
    learned: Learned,
    mut stopped: watch::Receiver<bool>,
) -> Result<Finished, TransferError> {
    let set = |next: Progress| {
        *progress.lock().unwrap_or_else(PoisonError::into_inner) = next;
    };
    let fail = |error: TransferError| {
        let stop = matches!(error, TransferError::Stopped);
        let mut last = progress.lock().unwrap_or_else(PoisonError::into_inner);
        last.phase = if stop { Phase::Stopped } else { Phase::Failed };
        last.error = (!stop).then(|| error.to_string());
        drop(last);
        error
    };
    let result = async {
        let session = swarm.session().await?;
        let meta = tokio::select! {
            meta = list(session, &job, swarm.options.lookup_wait) => meta?,
            () = stop_asked(&mut stopped) => return Err(TransferError::Stopped),
        };
        if job.torrent.is_none() {
            *learned.lock().unwrap_or_else(PoisonError::into_inner) =
                Some((meta.info_hash.clone(), meta.torrent.clone()));
        }
        let folder = meta.folder_in(&job.dir);
        let file = match meta.files.iter().filter(|f| !f.padding).collect::<Vec<_>>()[..] {
            [single] => folder.join(&single.path),
            _ => folder.clone(),
        };
        let hash = meta.info_hash.clone();
        if session.has(&hash) {
            session.resume(&hash).await?;
        } else {
            let mut peers = swarm.options.peers.clone();
            peers.extend(meta.peers.iter().copied());
            session
                .add(&meta.torrent, &folder, None, peers, false)
                .await?;
        }
        loop {
            session.set_download_limit(limiter.get());
            let stats = session.stats(&hash)?;
            set(torrent_progress(&stats, &file));
            match stats.phase {
                mdm_torrent::Phase::Finished => {
                    session.remove(&hash, false).await?;
                    return Ok(Finished {
                        path: file,
                        size: stats.total,
                    });
                }
                mdm_torrent::Phase::Error => {
                    let reason = stats
                        .error
                        .unwrap_or_else(|| "the torrent failed".to_owned());
                    return Err(TransferError::Torrent(TorrentError::Engine(reason)));
                }
                _ => {}
            }
            tokio::select! {
                () = tokio::time::sleep(POLL) => {}
                () = stop_asked(&mut stopped) => {
                    session.pause(&hash).await?;
                    return Err(TransferError::Stopped);
                }
            }
        }
    }
    .await;
    match result {
        Ok(done) => {
            let mut last = progress.lock().unwrap_or_else(PoisonError::into_inner);
            last.phase = Phase::Done;
            last.received = done.size;
            drop(last);
            Ok(done)
        }
        Err(error) => Err(fail(error)),
    }
}

// watch's Ref isn't Send, so it must not live on in the select across an await.
async fn stop_asked(stopped: &mut watch::Receiver<bool>) {
    let _asked = stopped.wait_for(|stop| *stop).await.is_ok();
}

async fn list(
    session: &mdm_torrent::Torrents,
    job: &TorrentJob,
    lookup_wait: Duration,
) -> Result<Meta, TorrentError> {
    match &job.torrent {
        Some((_, bytes)) => {
            session
                .metadata(&Source::File(bytes.clone()), LIST_WAIT, None)
                .await
        }
        None => {
            session
                .metadata(&Source::Magnet(job.magnet.clone()), lookup_wait, None)
                .await
        }
    }
}

fn torrent_progress(stats: &Stats, file: &Path) -> Progress {
    Progress {
        phase: match stats.phase {
            mdm_torrent::Phase::Checking => Phase::Starting,
            mdm_torrent::Phase::Downloading | mdm_torrent::Phase::Paused => Phase::Downloading,
            mdm_torrent::Phase::Finished => Phase::Finishing,
            mdm_torrent::Phase::Error => Phase::Failed,
        },
        received: stats.done,
        total: Some(stats.total),
        speed: bytes_per_second(stats.down_speed),
        connections: stats.peers_live,
        file: Some(file.to_owned()),
        error: stats.error.clone(),
    }
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a speed is finite, at least zero, and far below u64::MAX"
)]
fn bytes_per_second(speed: f64) -> u64 {
    if speed.is_finite() && speed > 0.0 {
        speed.round() as u64
    } else {
        0
    }
}
