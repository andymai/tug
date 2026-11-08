use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;
use tug_core::{
    Batch, Download, DownloadId, DownloadState, Library, LibraryError, Phase, ProgressStream,
    Settings, Store, StreamOptions, Update,
};
use url::Url;

pub const PROGRESS_EVENT: &str = "progress";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "DownloadState")]
pub enum StateDto {
    Queued,
    Downloading,
    Paused,
    Done,
    Failed,
}

impl From<DownloadState> for StateDto {
    fn from(state: DownloadState) -> Self {
        match state {
            DownloadState::Queued => Self::Queued,
            DownloadState::Downloading => Self::Downloading,
            DownloadState::Paused => Self::Paused,
            DownloadState::Done => Self::Done,
            DownloadState::Failed => Self::Failed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Download")]
pub struct DownloadDto {
    #[ts(type = "number")]
    pub id: i64,
    pub url: String,
    pub name: String,
    pub dir: String,
    pub file: Option<String>,
    pub state: StateDto,
    #[ts(type = "number | null")]
    pub size: Option<u64>,
    #[ts(type = "number")]
    pub received: u64,
    pub error: Option<String>,
    #[ts(type = "number")]
    pub added_ms: u64,
    #[ts(type = "number | null")]
    pub finished_ms: Option<u64>,
}

impl From<&Download> for DownloadDto {
    fn from(d: &Download) -> Self {
        Self {
            id: d.id.get(),
            url: d.url.to_string(),
            name: display_name(d),
            dir: d.dir.to_string_lossy().into_owned(),
            file: d.file.as_ref().map(|f| f.to_string_lossy().into_owned()),
            state: d.state.into(),
            size: d.size,
            received: d.received,
            error: d.error.clone(),
            added_ms: unix_ms(d.added),
            finished_ms: d.finished.map(unix_ms),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "Phase")]
pub enum PhaseDto {
    Starting,
    Downloading,
    Finishing,
    Done,
    Failed,
    Stopped,
}

impl From<Phase> for PhaseDto {
    fn from(phase: Phase) -> Self {
        match phase {
            Phase::Starting => Self::Starting,
            Phase::Downloading => Self::Downloading,
            Phase::Finishing => Self::Finishing,
            Phase::Done => Self::Done,
            Phase::Failed => Self::Failed,
            Phase::Stopped => Self::Stopped,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ProgressUpdate")]
pub struct UpdateDto {
    #[ts(type = "number")]
    pub id: i64,
    pub phase: PhaseDto,
    #[ts(type = "number")]
    pub received: u64,
    #[ts(type = "number | null")]
    pub total: Option<u64>,
    #[ts(type = "number")]
    pub speed: u64,
    #[ts(type = "number | null")]
    pub left_ms: Option<u64>,
    #[ts(type = "number")]
    pub connections: usize,
}

impl From<&Update> for UpdateDto {
    fn from(u: &Update) -> Self {
        Self {
            id: u.id.get(),
            phase: u.phase.into(),
            received: u.received,
            total: u.total,
            speed: u.speed,
            left_ms: u
                .left
                .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX)),
            connections: u.connections,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ProgressBatch")]
pub struct BatchDto {
    #[ts(type = "number")]
    pub seq: u64,
    pub updates: Vec<UpdateDto>,
    #[ts(type = "number[]")]
    pub settled: Vec<i64>,
    pub error: Option<String>,
}

impl From<&Batch> for BatchDto {
    fn from(b: &Batch) -> Self {
        Self {
            seq: b.seq,
            updates: b.updates.iter().map(UpdateDto::from).collect(),
            settled: b.settled.iter().map(|id| id.get()).collect(),
            error: b.error.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Settings")]
pub struct SettingsDto {
    pub download_dir: String,
    pub connections: u32,
    #[ts(type = "number | null")]
    pub speed_limit: Option<u64>,
}

impl From<&Settings> for SettingsDto {
    fn from(s: &Settings) -> Self {
        Self {
            download_dir: s.download_dir.to_string_lossy().into_owned(),
            connections: s.connections,
            speed_limit: s.speed_limit,
        }
    }
}

impl From<SettingsDto> for Settings {
    fn from(s: SettingsDto) -> Self {
        Self {
            download_dir: PathBuf::from(s.download_dir),
            connections: s.connections,
            speed_limit: s.speed_limit,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorKind {
    NotFound,
    Invalid,
    Storage,
    Engine,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct CommandError {
    pub kind: ErrorKind,
    pub message: String,
}

impl CommandError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Invalid,
            message: message.into(),
        }
    }
}

impl From<LibraryError> for CommandError {
    fn from(e: LibraryError) -> Self {
        let kind = match &e {
            LibraryError::Unknown(_) => ErrorKind::NotFound,
            LibraryError::Settings(_) => ErrorKind::Invalid,
            LibraryError::Store(_) | LibraryError::Delete { .. } => ErrorKind::Storage,
            LibraryError::Engine(_) => ErrorKind::Engine,
            LibraryError::Poisoned => ErrorKind::Internal,
        };
        Self {
            kind,
            message: e.to_string(),
        }
    }
}

pub struct AppState {
    library: Arc<Library>,
    _stream: ProgressStream,
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let store = Store::open(&dir.join("tug.db"))?;
    let (library, stream) = tauri::async_runtime::block_on(async {
        let library = Arc::new(Library::open(store).await?);
        let stream = ProgressStream::spawn(Arc::clone(&library), StreamOptions::default());
        Ok::<_, LibraryError>((library, stream))
    })?;
    forward_progress(app.handle().clone(), &stream);
    app.manage(AppState {
        library,
        _stream: stream,
    });
    Ok(())
}

fn forward_progress(app: AppHandle, stream: &ProgressStream) {
    let mut rx = stream.subscribe();
    tauri::async_runtime::spawn(async move {
        while rx.changed().await.is_ok() {
            let batch = BatchDto::from(&**rx.borrow_and_update());
            if app.emit(PROGRESS_EVENT, batch).is_err() {
                break;
            }
        }
    });
}

pub fn list(library: &Library) -> Result<Vec<DownloadDto>, CommandError> {
    Ok(library.list()?.iter().map(DownloadDto::from).collect())
}

pub async fn add(
    library: &Library,
    url: &str,
    dir: Option<&str>,
) -> Result<DownloadDto, CommandError> {
    let url = Url::parse(url.trim())
        .map_err(|e| CommandError::invalid(format!("{url} is not a link: {e}")))?;
    if !matches!(url.scheme(), "http" | "https" | "ftp" | "ftps") {
        return Err(CommandError::invalid(format!(
            "Tug can't download {} links",
            url.scheme()
        )));
    }
    let dir = match dir {
        Some(dir) => PathBuf::from(dir),
        None => library.settings()?.download_dir,
    };
    let id = library.add(url, &dir).await?;
    Ok(DownloadDto::from(&library.get(id)?))
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects State by value"
)]
pub fn list_downloads(state: tauri::State<'_, AppState>) -> Result<Vec<DownloadDto>, CommandError> {
    list(&state.library)
}

#[tauri::command]
pub async fn add_download(
    state: tauri::State<'_, AppState>,
    url: String,
    dir: Option<String>,
) -> Result<DownloadDto, CommandError> {
    add(&state.library, &url, dir.as_deref()).await
}

#[tauri::command]
pub async fn pause_download(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), CommandError> {
    Ok(state.library.pause(DownloadId::from(id)).await?)
}

#[tauri::command]
pub async fn resume_download(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), CommandError> {
    Ok(state.library.resume(DownloadId::from(id)).await?)
}

#[tauri::command]
pub async fn remove_download(
    state: tauri::State<'_, AppState>,
    id: i64,
    delete_file: bool,
) -> Result<(), CommandError> {
    Ok(state
        .library
        .remove(DownloadId::from(id), delete_file)
        .await?)
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects State by value"
)]
pub fn get_settings(state: tauri::State<'_, AppState>) -> Result<SettingsDto, CommandError> {
    Ok(SettingsDto::from(&state.library.settings()?))
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects State by value"
)]
pub fn update_settings(
    state: tauri::State<'_, AppState>,
    settings: SettingsDto,
) -> Result<(), CommandError> {
    Ok(state.library.update_settings(Settings::from(settings))?)
}

fn display_name(d: &Download) -> String {
    if let Some(name) = d.file.as_deref().and_then(Path::file_name) {
        return name.to_string_lossy().into_owned();
    }
    d.url
        .path_segments()
        .and_then(|mut s| s.rfind(|seg| !seg.is_empty()))
        .map_or_else(
            || d.url.host_str().unwrap_or("download").to_owned(),
            str::to_owned,
        )
}

fn unix_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    async fn library() -> Library {
        Library::open(Store::open_in_memory().unwrap())
            .await
            .unwrap()
    }

    fn stored(url: &str, file: Option<&str>) -> Download {
        Download {
            id: DownloadId::from(7),
            url: Url::parse(url).unwrap(),
            dir: PathBuf::from("/home/u/Downloads"),
            file: file.map(PathBuf::from),
            state: DownloadState::Paused,
            size: Some(4096),
            received: 1024,
            error: None,
            added: UNIX_EPOCH + Duration::from_millis(1_762_600_000_123),
            finished: None,
        }
    }

    #[test]
    fn a_download_crosses_the_bridge_with_a_display_name() {
        let dto = DownloadDto::from(&stored("https://example.org/iso/fedora.iso?mirror=1", None));
        assert_eq!(dto.name, "fedora.iso");
        assert_eq!(
            (dto.id, dto.state, dto.size, dto.received),
            (7, StateDto::Paused, Some(4096), 1024)
        );
        assert_eq!(dto.added_ms, 1_762_600_000_123);

        let named = DownloadDto::from(&stored(
            "https://example.org/get?id=3",
            Some("/home/u/Downloads/report.pdf"),
        ));
        assert_eq!(named.name, "report.pdf");
        let bare = DownloadDto::from(&stored("https://example.org/", None));
        assert_eq!(bare.name, "example.org");
    }

    #[test]
    fn json_uses_camel_case_and_lowercase_states() {
        let json = serde_json::to_value(DownloadDto::from(&stored(
            "https://example.org/a.zip",
            None,
        )))
        .unwrap();
        assert_eq!(json["state"], "paused");
        assert_eq!(json["addedMs"], 1_762_600_000_123_u64);
        assert!(json["finishedMs"].is_null());
    }

    #[test]
    fn library_errors_map_to_kinds_the_ui_can_act_on() {
        assert_eq!(
            CommandError::from(LibraryError::Unknown(3)).kind,
            ErrorKind::NotFound
        );
        let invalid = CommandError::from(LibraryError::Settings(
            tug_core::SettingsError::ZeroSpeedLimit,
        ));
        assert_eq!(invalid.kind, ErrorKind::Invalid);
        assert!(invalid.message.contains("speed limit"));
    }

    #[test]
    fn settings_round_trip_through_the_dto() {
        let settings = Settings {
            download_dir: PathBuf::from("/home/u/Downloads"),
            connections: 12,
            speed_limit: Some(1 << 20),
        };
        assert_eq!(Settings::from(SettingsDto::from(&settings)), settings);
    }

    #[tokio::test]
    async fn adding_refuses_what_is_not_a_download_link() {
        let library = library().await;
        for url in ["not a link", "mailto:a@example.org", "file:///etc/passwd"] {
            let err = add(&library, url, Some("/tmp")).await.unwrap_err();
            assert_eq!(err.kind, ErrorKind::Invalid, "{url}");
        }
        assert!(list(&library).unwrap().is_empty());
    }
}
