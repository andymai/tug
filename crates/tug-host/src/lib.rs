use std::io::{self, Read, Write};
use std::os::unix::process::CommandExt;
use std::process::{Command as Process, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{Value, json};
use tug_ipc::{Client, Endpoint, Request, Response};

pub const MAX_MESSAGE: u32 = 4 << 20;
pub const MAX_REPLY: usize = 1 << 20;
const ANSWER_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

pub fn read_message(input: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut length = [0_u8; 4];
    match input.read_exact(&mut length) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let length = u32::from_ne_bytes(length);
    if length > MAX_MESSAGE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("a message of {length} bytes is over the {MAX_MESSAGE}-byte limit"),
        ));
    }
    let mut body = vec![0_u8; usize::try_from(length).unwrap_or(usize::MAX)];
    input.read_exact(&mut body)?;
    Ok(Some(body))
}

pub fn write_message(output: &mut impl Write, body: &[u8]) -> io::Result<()> {
    let length = u32::try_from(body.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "a reply over 4 GiB"))?;
    output.write_all(&length.to_ne_bytes())?;
    output.write_all(body)?;
    output.flush()
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    Ping,
    Show,
    Add { urls: Vec<String> },
    List,
}

#[derive(Debug, Deserialize)]
struct Message {
    #[serde(default)]
    id: Value,
    #[serde(flatten)]
    command: Command,
}

pub trait Launcher: Send + Sync {
    fn launch(&self) -> io::Result<()>;
}

pub struct SystemLauncher;

impl Launcher for SystemLauncher {
    fn launch(&self) -> io::Result<()> {
        let quiet = |program: &str, args: &[&str]| {
            Process::new(program)
                .args(args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .process_group(0)
                .spawn()
                .map(drop)
        };
        match quiet("tug", &[]) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                quiet("flatpak", &["run", tug_ipc::APP_ID])
            }
            result => result,
        }
    }
}

pub struct Host<L> {
    endpoint: Endpoint,
    launcher: L,
    start_timeout: Duration,
}

fn reply(id: Value, result: Result<Value, String>) -> Vec<u8> {
    let message = match result {
        Ok(Value::Object(mut fields)) => {
            fields.insert("id".into(), id);
            fields.insert("ok".into(), Value::Bool(true));
            Value::Object(fields)
        }
        Ok(other) => json!({ "id": id, "ok": true, "value": other }),
        Err(error) => json!({ "id": id, "ok": false, "error": error }),
    };
    serde_json::to_vec(&message).unwrap_or_default()
}

impl<L: Launcher> Host<L> {
    pub const fn new(endpoint: Endpoint, launcher: L, start_timeout: Duration) -> Self {
        Self {
            endpoint,
            launcher,
            start_timeout,
        }
    }

    async fn connect(&self) -> Option<Client> {
        tokio::time::timeout(CONNECT_TIMEOUT, async {
            let mut client = Client::connect(&self.endpoint).await.ok()?;
            matches!(client.send(Request::Ping).await, Ok(Response::Pong)).then_some(client)
        })
        .await
        .ok()
        .flatten()
    }

    async fn running_or_started(&self) -> Result<Client, String> {
        if let Some(client) = self.connect().await {
            return Ok(client);
        }
        self.launcher
            .launch()
            .map_err(|e| format!("couldn't start Tug: {e}"))?;
        let deadline = Instant::now() + self.start_timeout;
        while Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Some(client) = self.connect().await {
                return Ok(client);
            }
        }
        Err("Tug didn't start in time".into())
    }

    async fn ask(client: &mut Client, request: Request) -> Result<Response, String> {
        tokio::time::timeout(ANSWER_TIMEOUT, client.send(request))
            .await
            .map_err(|_| "Tug didn't answer in time".to_owned())?
            .map_err(|e| e.to_string())
    }

    async fn result(&self, command: Command) -> Result<Value, String> {
        if matches!(command, Command::Ping) {
            return Ok(json!({ "type": "pong", "running": self.connect().await.is_some() }));
        }
        let mut client = match command {
            Command::List => self.connect().await.ok_or("Tug isn't running")?,
            _ => self.running_or_started().await?,
        };
        let request = match command {
            Command::Ping => Request::Ping,
            Command::Show => Request::Show,
            Command::Add { urls } => Request::Add { urls },
            Command::List => Request::List,
        };
        match Self::ask(&mut client, request).await? {
            Response::Shown => Ok(json!({ "type": "shown" })),
            Response::Added { added, failed } => {
                Ok(json!({ "type": "added", "added": added, "failed": failed }))
            }
            Response::List { downloads } => Ok(json!({ "type": "list", "downloads": downloads })),
            Response::Refused { reason } => Err(reason),
            Response::Pong => Ok(json!({ "type": "pong", "running": true })),
        }
    }

    pub async fn answer(&self, body: &[u8]) -> Vec<u8> {
        let message = match serde_json::from_slice::<Message>(body) {
            Ok(message) => message,
            Err(e) => {
                let id = serde_json::from_slice::<Value>(body)
                    .ok()
                    .and_then(|v| v.get("id").cloned())
                    .unwrap_or(Value::Null);
                return reply(id, Err(format!("Tug can't read this message: {e}")));
            }
        };
        let id = message.id.clone();
        let bytes = reply(message.id, self.result(message.command).await);
        if bytes.len() > MAX_REPLY {
            return reply(id, Err(format!("the answer is over {MAX_REPLY} bytes")));
        }
        bytes
    }

    pub fn run(
        &self,
        runtime: &tokio::runtime::Runtime,
        input: &mut impl Read,
        output: &mut impl Write,
    ) -> io::Result<()> {
        while let Some(body) = read_message(input)? {
            let answer = runtime.block_on(self.answer(&body));
            write_message(output, &answer)?;
        }
        Ok(())
    }
}
