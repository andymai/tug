mod bridge;

fn main() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| bridge::setup(app))
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
        ])
        .run(tauri::generate_context!())
}
