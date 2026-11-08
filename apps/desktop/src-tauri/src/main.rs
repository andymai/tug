mod bridge;
mod tray;

use tauri::{Manager, WindowEvent};

fn main() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(tray::TrayState::<tauri::Wry>::default())
        .setup(|app| {
            bridge::setup(app)?;
            tray::spawn(app.handle(), app.path().app_cache_dir()?.join("icons"));
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
        .run(tauri::generate_context!())
}
