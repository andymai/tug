use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::time::Duration;

use mdm_torrent::{Config, TorrentError, Torrents};
use tokio::sync::OnceCell;

pub const LOOKUP_WAIT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TorrentOptions {
    pub state_dir: PathBuf,
    // Tests: no DHT, no trackers, everything on loopback.
    pub local_only: bool,
    // Peers that every torrent starts with; tests name a seeder on loopback.
    pub peers: Vec<SocketAddr>,
    pub lookup_wait: Duration,
}

impl TorrentOptions {
    pub const fn new(state_dir: PathBuf) -> Self {
        Self {
            state_dir,
            local_only: false,
            peers: Vec::new(),
            lookup_wait: LOOKUP_WAIT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TorrentSource {
    Magnet(String),
    File(Vec<u8>),
}

impl TorrentSource {
    pub fn link(&self) -> Option<String> {
        match self {
            Self::Magnet(text) => match mdm_torrent::Source::magnet(text)? {
                mdm_torrent::Source::Magnet(link) => Some(link),
                mdm_torrent::Source::File(_) => None,
            },
            Self::File(bytes) => mdm_torrent::magnet_link(bytes),
        }
    }
}

// One librqbit session for every torrent, started when the first one needs it.
pub struct Swarm {
    pub options: TorrentOptions,
    session: OnceCell<Torrents>,
}

impl Swarm {
    pub fn new(options: TorrentOptions) -> Self {
        Self {
            options,
            session: OnceCell::new(),
        }
    }

    pub async fn session(&self) -> Result<&Torrents, TorrentError> {
        self.session
            .get_or_try_init(|| {
                let mut config = Config::new(self.options.state_dir.clone());
                if self.options.local_only {
                    config.dht = false;
                    config.offline = true;
                    config.listen_ip = Some(IpAddr::V4(Ipv4Addr::LOCALHOST));
                }
                Torrents::start(config)
            })
            .await
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TorrentView {
    pub files: Vec<TorrentFile>,
    pub peers: Vec<TorrentPeer>,
    pub uploaded: u64,
    pub peers_live: usize,
    pub peers_seen: usize,
}

// `index` is its place in the .torrent's list, which a choice names; padding
// files never show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TorrentFile {
    pub index: usize,
    pub path: PathBuf,
    pub size: u64,
    pub done: u64,
    pub chosen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TorrentPeer {
    pub address: String,
    pub client: Option<String>,
    pub received: u64,
    pub sent: u64,
    // "tcp" or "utp".
    pub transport: Option<String>,
}

pub fn files_of(
    entries: &[mdm_torrent::FileEntry],
    chosen: Option<&[usize]>,
    done: impl Fn(usize) -> u64,
) -> Vec<TorrentFile> {
    entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| !entry.padding)
        .map(|(index, entry)| TorrentFile {
            index,
            path: entry.path.clone(),
            size: entry.size,
            done: done(index).min(entry.size),
            chosen: chosen.is_none_or(|chosen| chosen.contains(&index)),
        })
        .collect()
}

pub fn peer_of(peer: mdm_torrent::Peer) -> TorrentPeer {
    TorrentPeer {
        address: peer.addr,
        client: peer.client,
        received: peer.fetched,
        sent: peer.uploaded,
        transport: peer.kind,
    }
}
