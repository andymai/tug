use std::future::Future;
use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime};
use tug_core::{Download, DownloadId, Library};
use tug_ipc::{Endpoint, Entry, Failure, Handler, IpcError, Request, Response, Server};

use crate::{bridge, tray};

pub fn entry(d: &Download) -> Entry {
    Entry {
        id: d.id.get(),
        name: bridge::display_name(d),
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
                Request::Add { urls } => {
                    let mut added = Vec::new();
                    let mut failed = Vec::new();
                    for url in urls {
                        let result = bridge::add(&library, &url, None)
                            .await
                            .and_then(|dto| Ok(library.get(DownloadId::from(dto.id))?));
                        match result {
                            Ok(download) => added.push(entry(&download)),
                            Err(e) => failed.push(Failure {
                                url,
                                reason: e.message,
                            }),
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
    match tauri::async_runtime::block_on(async { Server::bind(&endpoint) }) {
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
