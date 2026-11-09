use std::fmt::Write as _;
use std::fs::{DirBuilder, OpenOptions, Permissions};
use std::future::Future;
use std::io::{self, Read, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

pub const APP_ID: &str = "io.github.andymai.Tug";
// A debug build gets its own folder, so a development run never hands off to an
// installed Tug, nor an installed Tug's CLI to a development run.
const DIR: &str = if cfg!(debug_assertions) {
    "io.github.andymai.Tug.Devel"
} else {
    APP_ID
};
const SOCKET: &str = "tug.sock";
const TOKEN: &str = "token";
const MAX_REQUEST: u64 = 1 << 20;

#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error("XDG_RUNTIME_DIR is not set")]
    NoRuntimeDir,
    #[error("Tug is already running")]
    AlreadyRunning,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("Tug closed the connection without an answer")]
    NoAnswer,
    #[error("Tug refused the request: {0}")]
    Refused(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    dir: PathBuf,
}

impl Endpoint {
    pub fn from_env() -> Result<Self, IpcError> {
        let runtime = std::env::var_os("XDG_RUNTIME_DIR").ok_or(IpcError::NoRuntimeDir)?;
        Ok(Self::at(PathBuf::from(runtime).join("app").join(DIR)))
    }

    pub const fn at(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn socket(&self) -> PathBuf {
        self.dir.join(SOCKET)
    }

    pub fn token_path(&self) -> PathBuf {
        self.dir.join(TOKEN)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    Ping,
    Show,
    Add { urls: Vec<String> },
    List,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub state: String,
    pub received: u64,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Failure {
    pub url: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
    Pong,
    Shown,
    Added {
        added: Vec<Entry>,
        failed: Vec<Failure>,
    },
    List {
        downloads: Vec<Entry>,
    },
    Refused {
        reason: String,
    },
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    token: String,
    #[serde(flatten)]
    request: Request,
}

pub trait Handler: Send + Sync + 'static {
    fn handle(&self, request: Request) -> impl Future<Output = Response> + Send;
}

fn new_token() -> io::Result<String> {
    let mut bytes = [0_u8; 32];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            let _written = write!(hex, "{byte:02x}");
            hex
        }))
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0, |diff, (x, y)| diff | (x ^ y))
            == 0
}

pub struct Server {
    listener: UnixListener,
    token: Arc<str>,
}

impl Server {
    pub fn bind(endpoint: &Endpoint) -> Result<Self, IpcError> {
        DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&endpoint.dir)?;
        std::fs::set_permissions(&endpoint.dir, Permissions::from_mode(0o700))?;
        let socket = endpoint.socket();
        if socket.exists() {
            if std::os::unix::net::UnixStream::connect(&socket).is_ok() {
                return Err(IpcError::AlreadyRunning);
            }
            std::fs::remove_file(&socket)?;
        }
        let token = new_token()?;
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(endpoint.token_path())?;
        file.write_all(token.as_bytes())?;
        let listener = UnixListener::bind(&socket)?;
        std::fs::set_permissions(&socket, Permissions::from_mode(0o600))?;
        Ok(Self {
            listener,
            token: token.into(),
        })
    }

    pub async fn serve<H: Handler>(self, handler: Arc<H>) {
        while let Ok((stream, _)) = self.listener.accept().await {
            let token = Arc::clone(&self.token);
            let handler = Arc::clone(&handler);
            tokio::spawn(async move {
                let _closed = answer(stream, &token, handler.as_ref()).await;
            });
        }
    }
}

async fn answer<H: Handler>(stream: UnixStream, token: &str, handler: &H) -> Result<(), IpcError> {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read.take(MAX_REQUEST)).lines();
    while let Some(line) = lines.next_line().await? {
        let response = match serde_json::from_str::<Envelope>(&line) {
            Ok(envelope) if same(&envelope.token, token) => handler.handle(envelope.request).await,
            Ok(_) => Response::Refused {
                reason: "wrong token".into(),
            },
            Err(e) => Response::Refused {
                reason: e.to_string(),
            },
        };
        let mut reply = serde_json::to_vec(&response)?;
        reply.push(b'\n');
        write.write_all(&reply).await?;
    }
    Ok(())
}

pub struct Client {
    lines: tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>,
    write: tokio::net::unix::OwnedWriteHalf,
    token: String,
}

impl Client {
    pub async fn connect(endpoint: &Endpoint) -> Result<Self, IpcError> {
        let token = std::fs::read_to_string(endpoint.token_path())?
            .trim()
            .to_owned();
        let (read, write) = UnixStream::connect(endpoint.socket()).await?.into_split();
        Ok(Self {
            lines: BufReader::new(read).lines(),
            write,
            token,
        })
    }

    pub async fn send(&mut self, request: Request) -> Result<Response, IpcError> {
        let mut line = serde_json::to_vec(&Envelope {
            token: self.token.clone(),
            request,
        })?;
        line.push(b'\n');
        self.write.write_all(&line).await?;
        let reply = self.lines.next_line().await?.ok_or(IpcError::NoAnswer)?;
        match serde_json::from_str(&reply)? {
            Response::Refused { reason } => Err(IpcError::Refused(reason)),
            response => Ok(response),
        }
    }
}
