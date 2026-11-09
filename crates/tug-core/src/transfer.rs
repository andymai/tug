use std::path::{Path, PathBuf};
use std::sync::Arc;

use mdm_engine::download::State;
use mdm_engine::limiter::Limiter;
use mdm_engine::{Destination, Download, Error, Options, Request};
use url::Url;

use crate::origin::Origin;

pub const USER_AGENT: &str = concat!("Tug/", env!("CARGO_PKG_VERSION"));

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

#[derive(Debug, Clone)]
pub struct TransferOptions {
    pub connections: u32,
    pub limiter: Option<Arc<Limiter>>,
    pub origin: Origin,
}

impl TransferOptions {
    pub fn new(connections: u32) -> Self {
        Self {
            connections,
            limiter: None,
            origin: Origin::default(),
        }
    }
}

pub struct Transfer {
    download: Download,
}

impl Transfer {
    pub fn start(url: Url, dir: &Path, options: &TransferOptions) -> Self {
        let request = Request {
            url,
            headers: options.origin.headers(),
            dest: Destination::Dir(dir.to_owned()),
        };
        Self {
            download: Download::start(request, engine_options(options)),
        }
    }

    pub fn resume(file: &Path, options: &TransferOptions) -> Result<Self, Error> {
        let state = mdm_engine::state::state_path(file);
        let download = Download::resume(state, options.origin.headers(), engine_options(options))?;
        Ok(Self { download })
    }

    pub fn progress(&self) -> Progress {
        let snap = self.download.snapshot();
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

    pub fn stop(&self) {
        self.download.cancel();
    }

    pub async fn finish(self) -> Result<Finished, Error> {
        self.download.wait().await.map(|outcome| Finished {
            path: outcome.path,
            size: outcome.size,
        })
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
        global: options.limiter.clone(),
        ..Options::default()
    }
}
