use std::net::IpAddr;
use std::time::{Duration, SystemTime};

use mdm_engine::download::{ConnStatus, Snapshot};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inspection {
    pub segments: Vec<Segment>,
    pub connections: Vec<Connection>,
    pub server: Option<Server>,
    pub log: Vec<LogLine>,
}

// `[start, cursor)` is on disk and `[cursor, end)` is left; the segments cover the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Segment {
    pub start: u64,
    pub cursor: u64,
    pub end: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Connection {
    // From 1, as the log names it.
    pub number: u32,
    pub received: u64,
    pub speed: u64,
    pub status: ConnectionStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionStatus {
    Connecting,
    Receiving,
    Retrying(String),
    Finished,
    Failed(String),
    // The host allows `cap` connections, so this one closed and the others take its work.
    Retired { host: String, cap: u32 },
}

// With a proxy, `ip` and `rtt` are the proxy's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Server {
    pub ip: Option<IpAddr>,
    pub rtt: Option<Duration>,
    pub proxied: bool,
    pub cdn: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogLine {
    pub seq: u64,
    pub at: SystemTime,
    pub text: String,
}

impl From<Snapshot> for Inspection {
    fn from(snap: Snapshot) -> Self {
        let mut segments: Vec<Segment> = snap
            .segments
            .iter()
            .map(|s| Segment {
                start: s.start,
                cursor: s.cursor,
                end: s.end,
            })
            .collect();
        segments.sort_unstable_by_key(|s| s.start);
        Self {
            segments,
            connections: snap
                .connections
                .into_iter()
                .map(|c| Connection {
                    number: c.id.saturating_add(1),
                    received: c.downloaded,
                    speed: c.speed,
                    status: c.status.into(),
                })
                .collect(),
            server: snap.server.map(|s| Server {
                ip: s.ip,
                rtt: s.rtt,
                proxied: s.proxied,
                cdn: s.cdn.map(str::to_owned),
            }),
            log: snap
                .events
                .into_iter()
                .map(|e| LogLine {
                    seq: e.seq,
                    at: e.at,
                    text: e.text,
                })
                .collect(),
        }
    }
}

impl From<ConnStatus> for ConnectionStatus {
    fn from(status: ConnStatus) -> Self {
        match status {
            ConnStatus::Connecting => Self::Connecting,
            ConnStatus::Receiving => Self::Receiving,
            ConnStatus::Retrying(e) => Self::Retrying(e.to_string()),
            ConnStatus::Finished => Self::Finished,
            ConnStatus::Failed(e) => Self::Failed(e.to_string()),
            ConnStatus::Retired { host, cap } => Self::Retired { host, cap },
        }
    }
}
