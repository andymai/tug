#![allow(clippy::unwrap_used)]

use std::future::Future;
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tug_ipc::{Client, Endpoint, Entry, Handler, IpcError, Request, Response, Server};

struct Fake;

impl Handler for Fake {
    fn handle(&self, request: Request) -> impl Future<Output = Response> + Send {
        std::future::ready(match request {
            Request::Ping => Response::Pong,
            Request::Show => Response::Shown,
            Request::List => Response::List {
                downloads: vec![Entry {
                    id: 1,
                    name: "fedora.iso".into(),
                    url: "https://example.org/fedora.iso".into(),
                    state: "downloading".into(),
                    received: 10,
                    size: Some(100),
                }],
            },
            Request::Add { urls } => Response::Added {
                added: Vec::new(),
                failed: urls
                    .into_iter()
                    .map(|url| tug_ipc::Failure {
                        url,
                        reason: "not a link".into(),
                    })
                    .collect(),
            },
        })
    }
}

fn endpoint() -> (tempfile::TempDir, Endpoint) {
    let dir = tempfile::tempdir().unwrap();
    let endpoint = Endpoint::at(dir.path().join("app").join("io.github.andymai.Tug"));
    (dir, endpoint)
}

fn mode(path: &std::path::Path) -> u32 {
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[tokio::test]
async fn a_client_with_the_token_gets_answers() {
    let (_dir, endpoint) = endpoint();
    let server = Server::bind(&endpoint).unwrap();
    tokio::spawn(server.serve(Arc::new(Fake)));

    let mut client = Client::connect(&endpoint).await.unwrap();
    assert_eq!(client.send(Request::Ping).await.unwrap(), Response::Pong);
    let Response::List { downloads } = client.send(Request::List).await.unwrap() else {
        panic!("expected a list");
    };
    assert_eq!(downloads[0].name, "fedora.iso");
    let Response::Added { failed, .. } = client
        .send(Request::Add {
            urls: vec!["nope".into()],
        })
        .await
        .unwrap()
    else {
        panic!("expected an add result");
    };
    assert_eq!(failed[0].url, "nope");
}

#[tokio::test]
async fn files_are_private_to_the_user() {
    let (_dir, endpoint) = endpoint();
    let _server = Server::bind(&endpoint).unwrap();
    assert_eq!(mode(endpoint.socket().parent().unwrap()), 0o700);
    assert_eq!(mode(&endpoint.socket()), 0o600);
    assert_eq!(mode(&endpoint.token_path()), 0o600);
    assert_eq!(
        std::fs::read_to_string(endpoint.token_path())
            .unwrap()
            .len(),
        64
    );
}

#[tokio::test]
async fn a_wrong_token_or_a_bad_line_is_refused() {
    let (_dir, endpoint) = endpoint();
    let server = Server::bind(&endpoint).unwrap();
    tokio::spawn(server.serve(Arc::new(Fake)));

    let stream = tokio::net::UnixStream::connect(endpoint.socket())
        .await
        .unwrap();
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    write
        .write_all(b"{\"token\":\"guess\",\"type\":\"list\"}\nnot json\n")
        .await
        .unwrap();
    for _ in 0..2 {
        let reply: Response =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert!(matches!(reply, Response::Refused { .. }), "{reply:?}");
    }
}

#[tokio::test]
async fn a_second_server_finds_the_first_and_a_stale_socket_is_replaced() {
    let (_dir, endpoint) = endpoint();
    let first = Server::bind(&endpoint).unwrap();
    assert!(matches!(
        Server::bind(&endpoint),
        Err(IpcError::AlreadyRunning)
    ));
    let old_token = std::fs::read_to_string(endpoint.token_path()).unwrap();

    drop(first);
    assert!(
        endpoint.socket().exists(),
        "the socket file outlives its server"
    );
    let server = Server::bind(&endpoint).unwrap();
    tokio::spawn(server.serve(Arc::new(Fake)));
    assert_ne!(
        std::fs::read_to_string(endpoint.token_path()).unwrap(),
        old_token
    );
    let mut client = Client::connect(&endpoint).await.unwrap();
    assert_eq!(client.send(Request::Show).await.unwrap(), Response::Shown);
}

#[tokio::test]
async fn a_live_socket_without_the_lock_still_counts_as_running() {
    let (_dir, endpoint) = endpoint();
    std::fs::create_dir_all(endpoint.socket().parent().unwrap()).unwrap();
    let older = tokio::net::UnixListener::bind(endpoint.socket()).unwrap();
    assert!(matches!(
        Server::bind(&endpoint),
        Err(IpcError::AlreadyRunning)
    ));
    drop(older);
    assert!(Server::bind(&endpoint).is_ok());
}

#[tokio::test]
async fn connecting_without_a_server_fails() {
    let (_dir, endpoint) = endpoint();
    assert!(Client::connect(&endpoint).await.is_err());
}

#[tokio::test]
async fn a_losing_server_leaves_the_token_alone() {
    let (_dir, endpoint) = endpoint();
    let server = Server::bind(&endpoint).unwrap();
    tokio::spawn(server.serve(Arc::new(Fake)));
    let token = std::fs::read_to_string(endpoint.token_path()).unwrap();
    assert!(matches!(
        Server::bind(&endpoint),
        Err(IpcError::AlreadyRunning)
    ));
    assert_eq!(
        std::fs::read_to_string(endpoint.token_path()).unwrap(),
        token
    );
    let mut client = Client::connect(&endpoint).await.unwrap();
    assert_eq!(client.send(Request::Ping).await.unwrap(), Response::Pong);
}

#[tokio::test]
async fn each_request_gets_its_own_size_limit() {
    let (_dir, endpoint) = endpoint();
    let server = Server::bind(&endpoint).unwrap();
    tokio::spawn(server.serve(Arc::new(Fake)));

    let mut client = Client::connect(&endpoint).await.unwrap();
    assert_eq!(client.send(Request::Ping).await.unwrap(), Response::Pong);
    let big = "x".repeat(900 << 10);
    for _ in 0..2 {
        let Response::Added { failed, .. } = client
            .send(Request::Add {
                urls: vec![big.clone()],
            })
            .await
            .unwrap()
        else {
            panic!("expected an add result");
        };
        assert_eq!(failed[0].url.len(), big.len());
    }
    assert_eq!(client.send(Request::Ping).await.unwrap(), Response::Pong);

    let stream = tokio::net::UnixStream::connect(endpoint.socket())
        .await
        .unwrap();
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let huge = format!("{{\"token\":\"{}\"}}", "y".repeat((1 << 20) + 100));
    let _sent = write.write_all(huge.as_bytes()).await;
    let reply: Response = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert!(
        matches!(&reply, Response::Refused { reason } if reason.contains("limited")),
        "{reply:?}"
    );
}
