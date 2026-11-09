#![allow(clippy::unwrap_used)]

use std::future::Future;
use std::io::{self, Cursor};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tug_host::{Host, Launcher, MAX_MESSAGE, SystemLauncher, read_message, write_message};
use tug_ipc::{Endpoint, Entry, Failure, Handler, Origin, Request, Response, Server};

struct Fake {
    list_size: usize,
}

impl Handler for Fake {
    fn handle(&self, request: Request) -> impl Future<Output = Response> + Send {
        let entry = |name: String| Entry {
            id: 1,
            name,
            url: "https://example.org/a.iso".into(),
            state: "downloading".into(),
            received: 1,
            size: Some(2),
        };
        std::future::ready(match request {
            Request::Ping => Response::Pong,
            Request::Show => Response::Shown,
            Request::List => Response::List {
                downloads: vec![entry("x".repeat(self.list_size))],
            },
            Request::Add { urls, .. } => Response::Added {
                added: vec![entry("a.iso".into())],
                failed: urls
                    .into_iter()
                    .skip(1)
                    .map(|url| Failure {
                        url,
                        reason: "not a link".into(),
                    })
                    .collect(),
            },
        })
    }
}

#[derive(Default)]
struct Remembers(std::sync::Mutex<Vec<Request>>);

impl Handler for Remembers {
    fn handle(&self, request: Request) -> impl Future<Output = Response> + Send {
        let response = match request {
            Request::Ping => Response::Pong,
            _ => Response::Added {
                added: Vec::new(),
                failed: Vec::new(),
            },
        };
        self.0.lock().unwrap().push(request);
        std::future::ready(response)
    }
}

struct StartsTug(Endpoint);

impl Launcher for StartsTug {
    fn launch(&self) -> io::Result<()> {
        let endpoint = self.0.clone();
        tokio::spawn(async move {
            Server::bind(&endpoint)
                .await
                .unwrap()
                .serve(Arc::new(Fake { list_size: 5 }))
                .await;
        });
        Ok(())
    }
}

struct CantStart;

impl Launcher for CantStart {
    fn launch(&self) -> io::Result<()> {
        Err(io::Error::new(io::ErrorKind::NotFound, "no tug here"))
    }
}

fn endpoint() -> (tempfile::TempDir, Endpoint) {
    let dir = tempfile::tempdir().unwrap();
    let endpoint = Endpoint::at(dir.path().join("app").join("io.github.andymai.Tug"));
    (dir, endpoint)
}

async fn running(endpoint: &Endpoint, list_size: usize) {
    let server = Server::bind(endpoint).await.unwrap();
    tokio::spawn(server.serve(Arc::new(Fake { list_size })));
}

async fn ask<L: Launcher>(host: &Host<L>, message: Value) -> Value {
    serde_json::from_slice(&host.answer(&serde_json::to_vec(&message).unwrap()).await).unwrap()
}

#[test]
fn frames_carry_a_native_endian_length() {
    let mut buffer = Vec::new();
    write_message(&mut buffer, b"{\"type\":\"ping\"}").unwrap();
    assert_eq!(&buffer[..4], &15_u32.to_ne_bytes());
    let mut input = Cursor::new(buffer);
    assert_eq!(
        read_message(&mut input).unwrap().unwrap(),
        b"{\"type\":\"ping\"}"
    );
    assert!(read_message(&mut input).unwrap().is_none());

    let mut oversized = Cursor::new((MAX_MESSAGE + 1).to_ne_bytes().to_vec());
    assert_eq!(
        read_message(&mut oversized).unwrap_err().kind(),
        io::ErrorKind::InvalidData
    );
}

#[tokio::test]
async fn an_add_carries_the_browser_origin_to_tug() {
    let (_dir, endpoint) = endpoint();
    let tug = Arc::new(Remembers::default());
    let server = Server::bind(&endpoint).await.unwrap();
    tokio::spawn(server.serve(Arc::clone(&tug)));
    let host = Host::new(endpoint, CantStart, Duration::from_secs(1));

    let reply = ask(
        &host,
        json!({
            "id": 1,
            "type": "add",
            "urls": ["https://example.org/a.iso"],
            "referrer": "https://example.org/files",
            "cookies": "session=abc",
            "user_agent": "Mozilla/5.0",
        }),
    )
    .await;
    assert_eq!(reply["ok"], true);
    assert_eq!(
        tug.0.lock().unwrap().last(),
        Some(&Request::Add {
            urls: vec!["https://example.org/a.iso".into()],
            origin: Origin {
                referrer: Some("https://example.org/files".into()),
                cookies: Some("session=abc".into()),
                user_agent: Some("Mozilla/5.0".into()),
            },
        })
    );
}

#[tokio::test]
async fn messages_reach_a_running_tug_and_keep_their_id() {
    let (_dir, endpoint) = endpoint();
    running(&endpoint, 5).await;
    let host = Host::new(endpoint, CantStart, Duration::from_secs(1));

    assert_eq!(
        ask(&host, json!({"id": 7, "type": "ping"})).await,
        json!({"id": 7, "ok": true, "type": "pong", "running": true})
    );
    let added = ask(
        &host,
        json!({"id": "a", "type": "add", "urls": ["https://example.org/a.iso", "nope"]}),
    )
    .await;
    assert_eq!(added["ok"], true);
    assert_eq!(added["id"], "a");
    assert_eq!(added["added"][0]["name"], "a.iso");
    assert_eq!(added["failed"][0]["url"], "nope");
    assert_eq!(
        ask(&host, json!({"type": "list"})).await["downloads"][0]["state"],
        "downloading"
    );
    assert_eq!(
        ask(&host, json!({"id": 2, "type": "show"})).await["type"],
        "shown"
    );
}

#[tokio::test]
async fn a_message_tug_cannot_read_gets_a_reason() {
    let (_dir, endpoint) = endpoint();
    let host = Host::new(endpoint, CantStart, Duration::from_secs(1));
    let unknown = ask(&host, json!({"id": 3, "type": "delete"})).await;
    assert_eq!(
        (unknown["id"].clone(), unknown["ok"].clone()),
        (json!(3), json!(false))
    );
    assert!(
        unknown["error"]
            .as_str()
            .unwrap()
            .starts_with("Tug can't read this message")
    );
    let garbage: Value = serde_json::from_slice(&host.answer(b"not json").await).unwrap();
    assert_eq!(garbage["ok"], false);
}

#[tokio::test]
async fn without_tug_a_ping_says_so_a_list_fails_and_an_add_starts_it() {
    let (_dir, endpoint) = endpoint();
    let host = Host::new(
        endpoint.clone(),
        StartsTug(endpoint),
        Duration::from_secs(5),
    );
    assert_eq!(ask(&host, json!({"type": "ping"})).await["running"], false);
    assert_eq!(
        ask(&host, json!({"type": "list"})).await["error"],
        "Tug isn't running"
    );
    let added = ask(
        &host,
        json!({"type": "add", "urls": ["https://example.org/a.iso"]}),
    )
    .await;
    assert_eq!(added["ok"], true, "{added}");
    assert_eq!(ask(&host, json!({"type": "ping"})).await["running"], true);
}

#[tokio::test]
async fn a_failed_start_is_reported() {
    let (_dir, endpoint) = endpoint();
    let host = Host::new(endpoint, CantStart, Duration::from_secs(1));
    let added = ask(
        &host,
        json!({"type": "add", "urls": ["https://example.org/a.iso"]}),
    )
    .await;
    assert_eq!(added["ok"], false);
    assert!(
        added["error"]
            .as_str()
            .unwrap()
            .starts_with("couldn't start Tug")
    );
}

#[tokio::test]
async fn an_answer_over_a_megabyte_becomes_an_error() {
    let (_dir, endpoint) = endpoint();
    running(&endpoint, 2 << 20).await;
    let host = Host::new(endpoint, CantStart, Duration::from_secs(1));
    let list = ask(&host, json!({"id": 9, "type": "list"})).await;
    assert_eq!(
        (list["id"].clone(), list["ok"].clone()),
        (json!(9), json!(false))
    );
}

#[tokio::test]
async fn a_reply_stays_under_a_megabyte_even_for_an_oversized_id() {
    let (_dir, endpoint) = endpoint();
    let host = Host::new(endpoint, CantStart, Duration::from_secs(1));
    let huge = "i".repeat(2 << 20);
    for message in [
        json!({"id": huge, "type": "ping"}),
        json!({"id": huge, "type": "nope"}),
    ] {
        let bytes = host.answer(&serde_json::to_vec(&message).unwrap()).await;
        assert!(bytes.len() <= tug_host::MAX_REPLY, "{} bytes", bytes.len());
        let reply: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            (reply["id"].clone(), reply["ok"].clone()),
            (Value::Null, json!(false))
        );
    }
}

#[test]
fn run_answers_each_framed_message_in_order() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let (_dir, endpoint) = endpoint();
    runtime.block_on(running(&endpoint, 5));
    let host = Host::new(endpoint, CantStart, Duration::from_secs(1));

    let mut input = Vec::new();
    write_message(&mut input, br#"{"id":1,"type":"ping"}"#).unwrap();
    write_message(&mut input, br#"{"id":2,"type":"list"}"#).unwrap();
    let mut output = Vec::new();
    host.run(&runtime, &mut Cursor::new(input), &mut output)
        .unwrap();

    let mut replies = Cursor::new(output);
    let first: Value =
        serde_json::from_slice(&read_message(&mut replies).unwrap().unwrap()).unwrap();
    let second: Value =
        serde_json::from_slice(&read_message(&mut replies).unwrap().unwrap()).unwrap();
    assert_eq!(
        (first["id"].clone(), second["id"].clone()),
        (json!(1), json!(2))
    );
    assert!(read_message(&mut replies).unwrap().is_none());
}

#[test]
fn a_launched_tug_is_reaped_after_it_exits() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("pid");
    let launcher = SystemLauncher::new(vec![
        vec!["tug-host-test-missing".into()],
        vec![
            "sh".into(),
            "-c".into(),
            "echo $$ > \"$0.new\" && mv \"$0.new\" \"$0\"".into(),
            pid_file.display().to_string(),
        ],
    ]);
    launcher.launch().unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    let pid = loop {
        if let Ok(pid) = std::fs::read_to_string(&pid_file) {
            break pid.trim().to_owned();
        }
        assert!(Instant::now() < deadline, "the child never ran");
        std::thread::sleep(Duration::from_millis(20));
    };
    let entry = std::path::Path::new("/proc").join(pid);
    while entry.exists() {
        assert!(Instant::now() < deadline, "the child stays a zombie");
        std::thread::sleep(Duration::from_millis(20));
    }
}
