mod bridge;
mod cli;
mod format;
mod ipc;
mod tray;

use std::process::ExitCode;

use tauri::{Manager, WindowEvent};

fn main() -> Result<ExitCode, tauri::Error> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match cli::parse(&args) {
        cli::Command::Open => {
            if cli::hand_off(false) {
                return Ok(ExitCode::SUCCESS);
            }
        }
        command => return Ok(cli::run(command)),
    }
    let server = match ipc::claim() {
        ipc::Claim::Owned(server) => Some(server),
        ipc::Claim::Taken => {
            return Ok(if cli::hand_off(true) {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            });
        }
        ipc::Claim::Unavailable => None,
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(tray::TrayState::<tauri::Wry>::default())
        .setup(|app| {
            bridge::setup(app)?;
            let state = app.state::<bridge::AppState>();
            tray::spawn(
                app.handle(),
                app.path().app_cache_dir()?.join("icons"),
                state.library(),
                state.subscribe(),
            );
            if let Some(server) = server {
                ipc::serve(app.handle(), state.library(), server);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.state::<tray::TrayState<tauri::Wry>>().shown()
            {
                api.prevent_close();
                let _hidden = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            bridge::list_downloads,
            bridge::add_download,
            bridge::pause_download,
            bridge::resume_download,
            bridge::remove_download,
            bridge::get_settings,
            bridge::update_settings,
            bridge::open_file,
            bridge::show_in_folder,
            bridge::download_events,
            bridge::choose_download_folder,
            bridge::system_color_scheme,
        ])
        .run(tauri::generate_context!())?;
    Ok(ExitCode::SUCCESS)
}
