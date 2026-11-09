use std::future::Future;
use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime};
use tug_core::{Download, DownloadId, Library, Origin, Settings};
use tug_ipc::{Endpoint, Entry, Failure, Handler, IpcError, Request, Response, Server};

use url::Url;

use crate::{bridge, tray};

fn declined(settings: &Settings, link: &str, referrer: Option<&Url>) -> Option<String> {
    let link = Url::parse(link.trim()).ok()?;
    settings
        .excluded_site(&link, referrer)
        .map(|site| format!("Tug leaves downloads from {site} to the browser"))
}

pub fn entry(d: &Download) -> Entry {
    Entry {
        id: d.id.get(),
        name: d.name(),
        url: d.url.to_string(),
        state: d.state.as_str().into(),
        received: d.received,
        size: d.size,
    }
}

pub struct DesktopHandler<R: Runtime> {
    app: AppHandle<R>,
    library: Arc<Library>,
}

impl<R: Runtime> Handler for DesktopHandler<R> {
    fn handle(&self, request: Request) -> impl Future<Output = Response> + Send {
        let app = self.app.clone();
        let library = Arc::clone(&self.library);
        async move {
            match request {
                Request::Ping => Response::Pong,
                Request::Show => {
                    if let Some(window) = app.get_webview_window("main") {
                        tray::show(&window);
                    }
                    Response::Shown
                }
                Request::Add {
                    urls,
                    origin,
                    capture,
                } => {
                    let mut added = Vec::new();
                    let mut failed = Vec::new();
                    let origin = Origin::new(
                        origin.referrer.as_deref(),
                        origin.cookies.as_deref(),
                        origin.user_agent.as_deref(),
                    );
                    let settings = if capture {
                        library.settings().ok()
                    } else {
                        None
                    };
                    let ask = settings.as_ref().is_some_and(|s| s.confirm_captures);
                    let mut asked = false;
                    for url in urls {
                        let excluded = settings.as_ref().and_then(|settings| {
                            let referrer = origin.as_ref().ok().and_then(Origin::referrer);
                            declined(settings, &url, referrer)
                        });
                        let result = match (&origin, excluded) {
                            (_, Some(reason)) => Err(bridge::CommandError::invalid(reason)),
                            (Ok(origin), None) => {
                                bridge::add(&library, &url, None, origin, ask).await
                            }
                            (Err(e), None) => Err(bridge::CommandError::invalid(e.to_string())),
                        }
                        .and_then(|dto| Ok(library.get(DownloadId::from(dto.id))?));
                        match result {
                            Ok(download) => {
                                if ask {
                                    app.state::<bridge::AppState>().ask(download.id);
                                    asked = true;
                                }
                                added.push(entry(&download));
                            }
                            Err(e) => failed.push(Failure {
                                url,
                                reason: e.message,
                            }),
                        }
                    }
                    if asked {
                        bridge::emit_captures(&app);
                        if let Some(window) = app.get_webview_window("main") {
                            tray::show(&window);
                        }
                    }
                    Response::Added { added, failed }
                }
                Request::List => match library.list() {
                    Ok(downloads) => Response::List {
                        downloads: downloads.iter().map(entry).collect(),
                    },
                    Err(e) => Response::Refused {
                        reason: e.to_string(),
                    },
                },
            }
        }
    }
}

pub enum Claim {
    Owned(Server),
    Taken,
    Unavailable,
}

pub fn claim() -> Claim {
    let Ok(endpoint) = Endpoint::from_env() else {
        return Claim::Unavailable;
    };
    match tauri::async_runtime::block_on(Server::bind(&endpoint)) {
        Ok(server) => Claim::Owned(server),
        Err(IpcError::AlreadyRunning) => Claim::Taken,
        Err(_) => Claim::Unavailable,
    }
}

pub fn serve<R: Runtime>(app: &AppHandle<R>, library: Arc<Library>, server: Server) {
    let handler = Arc::new(DesktopHandler {
        app: app.clone(),
        library,
    });
    tauri::async_runtime::spawn(server.serve(handler));
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn a_capture_from_an_excluded_site_or_page_is_declined_with_the_reason() {
        let settings = Settings {
            excluded_sites: vec!["example.org".into()],
            ..Settings::default()
        };
        let page = Url::parse("https://www.example.org/inbox").unwrap();
        assert_eq!(
            declined(&settings, "https://files.example.org/a.iso", None).as_deref(),
            Some("Tug leaves downloads from example.org to the browser")
        );
        assert!(declined(&settings, "https://cdn.other.net/a.iso", Some(&page)).is_some());
        assert_eq!(
            declined(&settings, "https://cdn.other.net/a.iso", None),
            None
        );
        assert_eq!(declined(&settings, "not a link", Some(&page)), None);
    }
}
