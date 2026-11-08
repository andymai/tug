mod bridge;

fn main() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .setup(|app| bridge::setup(app))
        .invoke_handler(tauri::generate_handler![
            bridge::list_downloads,
            bridge::add_download,
            bridge::pause_download,
            bridge::resume_download,
            bridge::remove_download,
            bridge::get_settings,
            bridge::update_settings,
        ])
        .run(tauri::generate_context!())
}
