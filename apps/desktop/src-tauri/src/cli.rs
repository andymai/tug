use std::io::{self, Write};
use std::os::unix::process::CommandExt;
use std::process::{Command as Process, ExitCode, Stdio};
use std::time::{Duration, Instant};

use tug_ipc::{Client, Endpoint, Entry, Request, Response};

use crate::format::format_bytes;

pub const USAGE: &str = "Usage:
  tug                  Open Tug
  tug add <link>...    Download each link
  tug list [--json]    Show every download
  tug browsers         Connect Tug to each browser
";

const START_TIMEOUT: Duration = Duration::from_secs(20);
const ANSWER_TIMEOUT: Duration = Duration::from_secs(3);
const HAND_OFF_TIMEOUT: Duration = Duration::from_secs(5);
const ADD_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy)]
struct Limits {
    list: Duration,
    add: Duration,
}

const LIMITS: Limits = Limits {
    list: ANSWER_TIMEOUT,
    add: ADD_TIMEOUT,
};

async fn ask(client: &mut Client, request: Request, limit: Duration) -> Result<Response, String> {
    tokio::time::timeout(limit, client.send(request))
        .await
        .map_err(|_| "Tug didn't answer in time".to_owned())?
        .map_err(|e| e.to_string())
}

#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Open,
    Add(Vec<String>),
    List { json: bool },
    Browsers,
    Help,
    Usage(String),
}

pub fn parse(args: &[String]) -> Command {
    match args {
        [] => Command::Open,
        [command, links @ ..] if command == "add" => {
            if links.is_empty() {
                Command::Usage("tug add needs at least one link".into())
            } else {
                Command::Add(links.to_vec())
            }
        }
        [command] if command == "list" => Command::List { json: false },
        [command, flag] if command == "list" && flag == "--json" => Command::List { json: true },
        [command] if command == "browsers" => Command::Browsers,
        [flag] if matches!(flag.as_str(), "-h" | "--help" | "help") => Command::Help,
        [other, ..] => Command::Usage(format!("unknown command {other}")),
    }
}

const fn invisible(c: char) -> bool {
    matches!(
        c,
        '\u{ad}'
            | '\u{61c}'
            | '\u{180e}'
            | '\u{200b}'..='\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{2069}'
            | '\u{feff}'
            | '\u{fff9}'..='\u{fffb}'
    )
}

pub fn printable(text: &str) -> String {
    text.chars()
        .fold(String::with_capacity(text.len()), |mut out, c| {
            if c.is_control() || invisible(c) {
                out.extend(c.escape_unicode());
            } else {
                out.push(c);
            }
            out
        })
}

pub fn line(entry: &Entry) -> String {
    let mut word = entry.state.clone();
    if let Some(first) = word.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    let percent = match entry.size {
        Some(size) if size > 0 && entry.state != "done" => {
            format!(
                "{}%",
                u128::from(entry.received.min(size)) * 100 / u128::from(size)
            )
        }
        _ => String::new(),
    };
    let size = entry.size.map(format_bytes).unwrap_or_default();
    format!(
        "{:<12} {percent:>4} {size:>9}  {}",
        printable(&word),
        printable(&entry.name)
    )
}

async fn connect(endpoint: &Endpoint) -> Option<Client> {
    tokio::time::timeout(ANSWER_TIMEOUT, async {
        let mut client = Client::connect(endpoint).await.ok()?;
        matches!(client.send(Request::Ping).await, Ok(Response::Pong)).then_some(client)
    })
    .await
    .ok()
    .flatten()
}

async fn show(endpoint: &Endpoint) -> bool {
    let Some(mut client) = connect(endpoint).await else {
        return false;
    };
    matches!(
        tokio::time::timeout(ANSWER_TIMEOUT, client.send(Request::Show)).await,
        Ok(Ok(Response::Shown))
    )
}

pub fn hand_off(wait: bool) -> bool {
    let Ok(endpoint) = Endpoint::from_env() else {
        return false;
    };
    tauri::async_runtime::block_on(async {
        let deadline = Instant::now()
            + if wait {
                HAND_OFF_TIMEOUT
            } else {
                Duration::ZERO
            };
        loop {
            if show(&endpoint).await {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    })
}

async fn running_or_started(endpoint: &Endpoint) -> Result<Client, String> {
    if let Some(client) = connect(endpoint).await {
        return Ok(client);
    }
    let exe = std::env::current_exe().map_err(|e| format!("couldn't find Tug: {e}"))?;
    Process::new(exe)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("couldn't start Tug: {e}"))?;
    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(200)).await;
        if let Some(client) = connect(endpoint).await {
            return Ok(client);
        }
    }
    Err("Tug didn't start in time".into())
}

async fn add(endpoint: &Endpoint, urls: Vec<String>, limits: Limits) -> Result<bool, String> {
    let mut client = running_or_started(endpoint).await?;
    let request = Request::Add {
        urls,
        origin: tug_ipc::Origin::default(),
    };
    match ask(&mut client, request, limits.add).await? {
        Response::Added { added, failed } => {
            let mut out = io::stdout().lock();
            for entry in &added {
                let _written = writeln!(out, "Added {}", printable(&entry.name));
            }
            let mut err = io::stderr().lock();
            for failure in &failed {
                let _written = writeln!(
                    err,
                    "Couldn't add {}: {}",
                    printable(&failure.url),
                    printable(&failure.reason)
                );
            }
            Ok(failed.is_empty())
        }
        _ => Err("Tug gave an answer this tug doesn't know".into()),
    }
}

async fn list(endpoint: &Endpoint, json: bool, limits: Limits) -> Result<bool, String> {
    let mut client = connect(endpoint).await.ok_or("Tug isn't running")?;
    match ask(&mut client, Request::List, limits.list).await? {
        Response::List { downloads } => {
            let mut out = io::stdout().lock();
            if json {
                serde_json::to_writer(&mut out, &downloads).map_err(|e| e.to_string())?;
                let _written = writeln!(out);
            } else if downloads.is_empty() {
                let _written = writeln!(out, "No downloads");
            } else {
                for entry in &downloads {
                    let _written = writeln!(out, "{}", line(entry));
                }
            }
            Ok(true)
        }
        _ => Err("Tug gave an answer this tug doesn't know".into()),
    }
}

fn browsers() -> Result<bool, String> {
    let reports = crate::browsers::register_everywhere()?;
    let mut out = io::stdout().lock();
    if reports.is_empty() {
        let _written = writeln!(out, "No supported browser found.");
    }
    for report in &reports {
        let _written = writeln!(out, "{:<25} {}", report.browser, report.status);
    }
    Ok(!reports
        .iter()
        .any(|report| matches!(report.status, crate::browsers::Status::Failed(_))))
}

pub fn run(command: Command) -> ExitCode {
    let result = match command {
        Command::Open => Ok(true),
        Command::Help => {
            let _written = io::stdout().lock().write_all(USAGE.as_bytes());
            Ok(true)
        }
        Command::Usage(problem) => {
            let _written = write!(io::stderr().lock(), "{problem}\n\n{USAGE}");
            return ExitCode::from(2);
        }
        Command::Add(urls) => Endpoint::from_env()
            .map_err(|e| e.to_string())
            .and_then(|endpoint| tauri::async_runtime::block_on(add(&endpoint, urls, LIMITS))),
        Command::List { json } => Endpoint::from_env()
            .map_err(|e| e.to_string())
            .and_then(|endpoint| tauri::async_runtime::block_on(list(&endpoint, json, LIMITS))),
        Command::Browsers => browsers(),
    };
    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(message) => {
            let _written = writeln!(io::stderr().lock(), "{}", printable(&message));
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::sync::Arc;

    use tug_ipc::{Handler, Server};

    use super::*;

    struct Stalls;

    impl Handler for Stalls {
        async fn handle(&self, request: Request) -> Response {
            if matches!(request, Request::Ping) {
                Response::Pong
            } else {
                std::future::pending().await
            }
        }
    }

    #[tokio::test]
    async fn a_tug_that_stops_answering_times_out_add_and_list() {
        let dir = tempfile::tempdir().unwrap();
        let endpoint = Endpoint::at(dir.path().join("tug"));
        let server = Server::bind(&endpoint).await.unwrap();
        tokio::spawn(server.serve(Arc::new(Stalls)));
        assert!(
            connect(&endpoint).await.is_some(),
            "the stalling Tug must answer the ping"
        );

        let limits = Limits {
            list: Duration::from_millis(200),
            add: Duration::from_millis(200),
        };
        let started = Instant::now();
        assert_eq!(
            add(&endpoint, vec!["https://example.org/a.iso".into()], limits).await,
            Err("Tug didn't answer in time".into())
        );
        assert_eq!(
            list(&endpoint, false, limits).await,
            Err("Tug didn't answer in time".into())
        );
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|&s| s.to_owned()).collect()
    }

    #[test]
    fn commands_parse_from_the_arguments() {
        assert_eq!(parse(&[]), Command::Open);
        assert_eq!(
            parse(&args(&[
                "add",
                "https://a.example/x",
                "https://b.example/y"
            ])),
            Command::Add(args(&["https://a.example/x", "https://b.example/y"]))
        );
        assert_eq!(parse(&args(&["list"])), Command::List { json: false });
        assert_eq!(
            parse(&args(&["list", "--json"])),
            Command::List { json: true }
        );
        assert_eq!(parse(&args(&["browsers"])), Command::Browsers);
        assert!(matches!(
            parse(&args(&["browsers", "chrome"])),
            Command::Usage(_)
        ));
        assert_eq!(parse(&args(&["--help"])), Command::Help);
        assert!(matches!(parse(&args(&["add"])), Command::Usage(_)));
        assert!(matches!(parse(&args(&["remove", "1"])), Command::Usage(_)));
        assert!(matches!(
            parse(&args(&["list", "--yaml"])),
            Command::Usage(_)
        ));
    }

    #[test]
    fn control_characters_print_as_escapes() {
        assert_eq!(printable("fedora.iso"), "fedora.iso");
        assert_eq!(printable("a\u{1b}[2Jb"), "a\\u{1b}[2Jb");
        assert_eq!(printable("line\nbreak\u{7}"), "line\\u{a}break\\u{7}");
        assert_eq!(printable("café"), "café");
        assert_eq!(
            printable("invoice\u{202e}fdp.exe"),
            "invoice\\u{202e}fdp.exe"
        );
        assert_eq!(printable("a\u{2066}b\u{2069}"), "a\\u{2066}b\\u{2069}");
        assert_eq!(
            printable("zero\u{200b}width\u{feff}"),
            "zero\\u{200b}width\\u{feff}"
        );
        let entry = Entry {
            id: 1,
            name: "evil\u{1b}]0;title\u{7}.iso".into(),
            url: String::new(),
            state: "queued".into(),
            received: 0,
            size: None,
        };
        assert!(!line(&entry).chars().any(char::is_control));
    }

    #[test]
    fn a_list_line_shows_the_state_progress_size_and_name() {
        let entry = Entry {
            id: 1,
            name: "fedora.iso".into(),
            url: "https://example.org/fedora.iso".into(),
            state: "downloading".into(),
            received: 71,
            size: Some(100),
        };
        assert_eq!(line(&entry), "Downloading   71%     100 B  fedora.iso");
        let done = Entry {
            state: "done".into(),
            received: 100,
            ..entry.clone()
        };
        assert_eq!(
            line(&done),
            format!("Done{}100 B  fedora.iso", " ".repeat(18))
        );
        let unknown = Entry {
            size: None,
            ..entry
        };
        assert_eq!(
            line(&unknown),
            format!("Downloading{}fedora.iso", " ".repeat(18))
        );
    }
}
