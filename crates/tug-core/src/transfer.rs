use std::path::{Path, PathBuf};

use http::HeaderMap;
use mdm_engine::download::State;
use mdm_engine::{Destination, Download, Error, Options, Request};
use url::Url;

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

pub struct Transfer {
    download: Download,
}

impl Transfer {
    pub fn start(url: Url, dir: &Path, connections: u32) -> Self {
        let request = Request {
            url,
            headers: HeaderMap::new(),
            dest: Destination::Dir(dir.to_owned()),
        };
        Self {
            download: Download::start(request, options(connections)),
        }
    }

    pub fn resume(file: &Path, connections: u32) -> Result<Self, Error> {
        let state = mdm_engine::state::state_path(file);
        let download = Download::resume(state, HeaderMap::new(), options(connections))?;
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

fn options(connections: u32) -> Options {
    Options {
        max_connections: connections,
        user_agent: USER_AGENT.to_owned(),
        ..Options::default()
    }
}
