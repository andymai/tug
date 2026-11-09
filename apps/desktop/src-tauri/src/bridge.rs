use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use ts_rs::TS;
use tug_core::{
    Appearance, Batch, Category, Download, DownloadId, DownloadState, Event, EventKind, Library,
    LibraryError, Origin, Phase, Place, ProgressStream, SavedView, Schedule, Settings, SlowHours,
    Store, StreamOptions, TorrentOptions, TorrentSource, Update,
};
use url::Url;

pub const PROGRESS_EVENT: &str = "progress";
pub const COLOR_SCHEME_EVENT: &str = "color-scheme";
pub const CAPTURES_EVENT: &str = "captures";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "Place")]
pub enum PlaceDto {
    First,
    Last,
    Up,
    Down,
}

impl From<PlaceDto> for Place {
    fn from(place: PlaceDto) -> Self {
        match place {
            PlaceDto::First => Self::First,
            PlaceDto::Last => Self::Last,
            PlaceDto::Up => Self::Up,
            PlaceDto::Down => Self::Down,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum CaptureAnswer {
    Download,
    Cancel,
    Later,
}

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "Category")]
pub enum CategoryDto {
    Video,
    Audio,
    Image,
    Document,
    Archive,
    Program,
    Disk,
    Other,
}

impl From<Category> for CategoryDto {
    fn from(category: Category) -> Self {
        match category {
            Category::Video => Self::Video,
            Category::Audio => Self::Audio,
            Category::Image => Self::Image,
            Category::Document => Self::Document,
            Category::Archive => Self::Archive,
            Category::Program => Self::Program,
            Category::DiskImage => Self::Disk,
            Category::Other => Self::Other,
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
    pub category: CategoryDto,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "EventKind")]
pub enum EventKindDto {
    Added,
    Started,
    Resumed,
    Paused,
    Finished,
    Failed,
}

impl From<EventKind> for EventKindDto {
    fn from(kind: EventKind) -> Self {
        match kind {
            EventKind::Added => Self::Added,
            EventKind::Started => Self::Started,
            EventKind::Resumed => Self::Resumed,
            EventKind::Paused => Self::Paused,
            EventKind::Finished => Self::Finished,
            EventKind::Failed => Self::Failed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "DownloadEvent")]
pub struct EventDto {
    pub kind: EventKindDto,
    #[ts(type = "number")]
    pub at_ms: u64,
    #[ts(type = "number | null")]
    pub bytes: Option<u64>,
    pub detail: Option<String>,
}

impl From<&Event> for EventDto {
    fn from(e: &Event) -> Self {
        Self {
            kind: e.kind.into(),
            at_ms: unix_ms(e.at),
            bytes: e.bytes,
            detail: e.detail.clone(),
        }
    }
}

impl From<&Download> for DownloadDto {
    fn from(d: &Download) -> Self {
        Self {
            id: d.id.get(),
            url: d.url.to_string(),
            name: d.name(),
            category: d.category().into(),
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
    #[ts(type = "number")]
    pub revision: u64,
    pub error: Option<String>,
}

impl From<&Batch> for BatchDto {
    fn from(b: &Batch) -> Self {
        Self {
            seq: b.seq,
            updates: b.updates.iter().map(UpdateDto::from).collect(),
            settled: b.settled.iter().map(|id| id.get()).collect(),
            revision: b.revision,
            error: b.error.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "Appearance")]
pub enum AppearanceDto {
    System,
    Light,
    Dark,
}

impl From<Appearance> for AppearanceDto {
    fn from(a: Appearance) -> Self {
        match a {
            Appearance::System => Self::System,
            Appearance::Light => Self::Light,
            Appearance::Dark => Self::Dark,
        }
    }
}

impl From<AppearanceDto> for Appearance {
    fn from(a: AppearanceDto) -> Self {
        match a {
            AppearanceDto::System => Self::System,
            AppearanceDto::Light => Self::Light,
            AppearanceDto::Dark => Self::Dark,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "ColorScheme")]
pub enum ColorSchemeDto {
    Light,
    Dark,
}

pub const fn scheme_of(scheme: ashpd::desktop::settings::ColorScheme) -> Option<ColorSchemeDto> {
    use ashpd::desktop::settings::ColorScheme;
    match scheme {
        ColorScheme::PreferDark => Some(ColorSchemeDto::Dark),
        ColorScheme::PreferLight => Some(ColorSchemeDto::Light),
        ColorScheme::NoPreference => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Schedule")]
pub struct ScheduleDto {
    pub days: u8,
    pub start: u16,
    pub stop: u16,
}

impl From<Schedule> for ScheduleDto {
    fn from(s: Schedule) -> Self {
        Self {
            days: s.days,
            start: s.start,
            stop: s.stop,
        }
    }
}

impl From<ScheduleDto> for Schedule {
    fn from(s: ScheduleDto) -> Self {
        Self {
            days: s.days,
            start: s.start,
            stop: s.stop,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "SlowHours")]
pub struct SlowHoursDto {
    #[ts(type = "number")]
    pub limit: u64,
    pub hours: ScheduleDto,
}

impl From<SlowHours> for SlowHoursDto {
    fn from(s: SlowHours) -> Self {
        Self {
            limit: s.limit,
            hours: s.hours.into(),
        }
    }
}

impl From<SlowHoursDto> for SlowHours {
    fn from(s: SlowHoursDto) -> Self {
        Self {
            limit: s.limit,
            hours: s.hours.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "SavedView")]
pub struct SavedViewDto {
    pub name: String,
    pub view: String,
    pub query: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Settings")]
pub struct SettingsDto {
    pub download_dir: String,
    pub connections: u32,
    #[ts(type = "number | null")]
    pub speed_limit: Option<u64>,
    pub appearance: AppearanceDto,
    pub excluded_sites: Vec<String>,
    pub confirm_captures: bool,
    pub max_active: u32,
    pub schedule: Option<ScheduleDto>,
    pub slow_hours: Option<SlowHoursDto>,
    pub saved_views: Vec<SavedViewDto>,
}

impl From<&Settings> for SettingsDto {
    fn from(s: &Settings) -> Self {
        Self {
            download_dir: s.download_dir.to_string_lossy().into_owned(),
            connections: s.connections,
            speed_limit: s.speed_limit,
            appearance: s.appearance.into(),
            excluded_sites: s.excluded_sites.clone(),
            confirm_captures: s.confirm_captures,
            max_active: s.max_active,
            schedule: s.schedule.map(ScheduleDto::from),
            slow_hours: s.slow_hours.map(SlowHoursDto::from),
            saved_views: s
                .saved_views
                .iter()
                .map(|saved| SavedViewDto {
                    name: saved.name.clone(),
                    view: saved.view.clone(),
                    query: saved.query.clone(),
                })
                .collect(),
        }
    }
}

impl SettingsDto {
    pub fn apply(self, current: &Settings) -> Settings {
        let unchanged = self.download_dir == current.download_dir.to_string_lossy();
        let mut next = Settings::from(self);
        if unchanged {
            next.download_dir.clone_from(&current.download_dir);
        }
        next
    }
}

impl From<SettingsDto> for Settings {
    fn from(s: SettingsDto) -> Self {
        Self {
            download_dir: PathBuf::from(s.download_dir),
            connections: s.connections,
            speed_limit: s.speed_limit,
            appearance: s.appearance.into(),
            excluded_sites: s
                .excluded_sites
                .into_iter()
                .map(|entry| tug_core::site(&entry).unwrap_or(entry))
                .collect(),
            confirm_captures: s.confirm_captures,
            max_active: s.max_active,
            schedule: s.schedule.map(Schedule::from),
            slow_hours: s.slow_hours.map(SlowHours::from),
            saved_views: s
                .saved_views
                .into_iter()
                .map(|saved| SavedView {
                    name: saved.name,
                    view: saved.view,
                    query: saved.query,
                })
                .collect(),
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
    pub fn invalid(message: impl Into<String>) -> Self {
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
            LibraryError::Settings(_)
            | LibraryError::NotATorrent
            | LibraryError::DuplicateTorrent(_) => ErrorKind::Invalid,
            LibraryError::Store(_) | LibraryError::Delete { .. } => ErrorKind::Storage,
            LibraryError::Engine(_) | LibraryError::Torrent(_) | LibraryError::NoTorrents => {
                ErrorKind::Engine
            }
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
    stream: ProgressStream,
    captures: Mutex<Vec<DownloadId>>,
}

impl AppState {
    pub fn library(&self) -> Arc<Library> {
        Arc::clone(&self.library)
    }

    pub fn ask(&self, id: DownloadId) {
        if let Ok(mut captures) = self.captures.lock() {
            captures.push(id);
        }
    }

    fn answered(&self, id: DownloadId) -> bool {
        self.captures.lock().is_ok_and(|mut captures| {
            let before = captures.len();
            captures.retain(|&waiting| waiting != id);
            captures.len() != before
        })
    }

    fn prune(&self, batch: &Batch) -> bool {
        self.captures
            .lock()
            .is_ok_and(|mut captures| drop_started(&mut captures, batch))
    }

    pub fn captures(&self) -> Vec<DownloadDto> {
        let waiting = self
            .captures
            .lock()
            .map(|captures| captures.clone())
            .unwrap_or_default();
        waiting
            .into_iter()
            .filter_map(|id| self.library.get(id).ok())
            .filter(|download| download.state == DownloadState::Paused)
            .map(|download| DownloadDto::from(&download))
            .collect()
    }

    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<Arc<Batch>> {
        self.stream.subscribe()
    }

    pub fn settled(&self) -> tokio::sync::broadcast::Receiver<DownloadId> {
        self.stream.settled()
    }
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let store = Store::open(&dir.join("tug.db"))?;
    let (library, stream) = tauri::async_runtime::block_on(async {
        let torrents = TorrentOptions::new(dir.join("torrents"));
        let library = Arc::new(Library::open_with(store, Some(torrents)).await?);
        let stream = ProgressStream::spawn(Arc::clone(&library), StreamOptions::default());
        Ok::<_, LibraryError>((library, stream))
    })?;
    forward_progress(app.handle().clone(), &stream);
    forward_color_scheme(app.handle().clone());
    app.manage(AppState {
        library,
        stream,
        captures: Mutex::default(),
    });
    Ok(())
}

// A capture that another action started (Resume all, the list's Resume) no
// longer waits for an answer, and the sheet must stop asking about it.
fn drop_started(captures: &mut Vec<DownloadId>, batch: &Batch) -> bool {
    let before = captures.len();
    captures.retain(|id| {
        !batch.settled.contains(id) && !batch.updates.iter().any(|update| update.id == *id)
    });
    captures.len() != before
}

fn forward_progress(app: AppHandle, stream: &ProgressStream) {
    let mut rx = stream.subscribe();
    tauri::async_runtime::spawn(async move {
        while rx.changed().await.is_ok() {
            let batch = Arc::clone(&rx.borrow_and_update());
            if app.emit(PROGRESS_EVENT, BatchDto::from(&*batch)).is_err() {
                break;
            }
            if app
                .try_state::<AppState>()
                .is_some_and(|state| state.prune(&batch))
            {
                emit_captures(&app);
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
    origin: &Origin,
    paused: bool,
) -> Result<DownloadDto, CommandError> {
    let url = Url::parse(url.trim())
        .map_err(|e| CommandError::invalid(format!("{url} is not a link: {e}")))?;
    if !matches!(url.scheme(), "http" | "https" | "ftp" | "ftps" | "magnet") {
        return Err(CommandError::invalid(format!(
            "Tug can't download {} links",
            url.scheme()
        )));
    }
    let dir = match dir {
        Some(dir) => PathBuf::from(dir),
        None => library.settings()?.download_dir,
    };
    let id = if url.scheme() == "magnet" {
        library
            .add_torrent(TorrentSource::Magnet(url.to_string()), &dir)
            .await?
    } else if paused {
        library.add_paused(url, &dir, origin)?
    } else {
        library.add_from(url, &dir, origin).await?
    };
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
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects State by value"
)]
pub fn search_downloads(
    state: tauri::State<'_, AppState>,
    query: String,
) -> Result<Vec<i64>, CommandError> {
    Ok(state
        .library
        .search(&query)?
        .into_iter()
        .map(DownloadId::get)
        .collect())
}

#[tauri::command]
pub async fn add_download(
    state: tauri::State<'_, AppState>,
    url: String,
    dir: Option<String>,
) -> Result<DownloadDto, CommandError> {
    add(
        &state.library,
        &url,
        dir.as_deref(),
        &Origin::default(),
        false,
    )
    .await
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
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), CommandError> {
    let id = DownloadId::from(id);
    state.library.resume(id).await?;
    started(&app, id);
    Ok(())
}

// A resume between two progress ticks can start and stop a capture unseen by
// the batch pruning, so every resume also takes it off the sheet.
pub fn started<R: tauri::Runtime>(app: &AppHandle<R>, id: DownloadId) {
    if app
        .try_state::<AppState>()
        .is_some_and(|state| state.answered(id))
    {
        emit_captures(app);
    }
}

#[tauri::command]
pub fn emit_captures<R: tauri::Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    let _sent = app.emit(CAPTURES_EVENT, state.captures());
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects State by value"
)]
pub fn pending_captures(state: tauri::State<'_, AppState>) -> Vec<DownloadDto> {
    state.captures()
}

#[tauri::command]
pub async fn answer_capture(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
    answer: CaptureAnswer,
) -> Result<(), CommandError> {
    let id = DownloadId::from(id);
    state.answered(id);
    let result = match answer {
        CaptureAnswer::Download => state.library.resume(id).await,
        CaptureAnswer::Cancel => state.library.remove_if_paused(id).await.map(|_| ()),
        CaptureAnswer::Later => Ok(()),
    };
    emit_captures(&app);
    Ok(result?)
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects State by value"
)]
pub fn place_download(
    state: tauri::State<'_, AppState>,
    id: i64,
    place: PlaceDto,
) -> Result<(), CommandError> {
    state.library.place(DownloadId::from(id), place.into())?;
    Ok(())
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
    let current = state.library.settings()?;
    Ok(state.library.update_settings(settings.apply(&current))?)
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects State by value"
)]
pub fn download_events(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<Vec<EventDto>, CommandError> {
    Ok(state
        .library
        .events(DownloadId::from(id))?
        .iter()
        .map(EventDto::from)
        .collect())
}

fn forward_color_scheme(app: AppHandle) {
    use futures_util::StreamExt;

    tauri::async_runtime::spawn(async move {
        let Ok(portal) = ashpd::desktop::settings::Settings::new().await else {
            return;
        };
        let Ok(mut changes) = portal.receive_color_scheme_changed().await else {
            return;
        };
        while let Some(scheme) = changes.next().await {
            if app.emit(COLOR_SCHEME_EVENT, scheme_of(scheme)).is_err() {
                break;
            }
        }
    });
}

#[tauri::command]
pub async fn system_color_scheme() -> Option<ColorSchemeDto> {
    let portal = ashpd::desktop::settings::Settings::new().await.ok()?;
    scheme_of(portal.color_scheme().await.ok()?)
}

pub fn folder_from_uri(uri: &str) -> Result<PathBuf, CommandError> {
    Url::parse(uri)
        .ok()
        .filter(|url| url.scheme() == "file")
        .and_then(|url| url.to_file_path().ok())
        .ok_or_else(|| CommandError::invalid(format!("{uri} is not a local folder")))
}

#[tauri::command]
pub async fn choose_download_folder(
    state: tauri::State<'_, AppState>,
) -> Result<Option<SettingsDto>, CommandError> {
    use ashpd::desktop::file_chooser::SelectedFiles;

    let current = state.library.settings()?;
    let portal = |e: ashpd::Error| CommandError {
        kind: ErrorKind::Internal,
        message: format!("the folder chooser failed: {e}"),
    };
    let request = SelectedFiles::open_file()
        .title("Choose the download folder")
        .accept_label("Choose")
        .modal(true)
        .directory(true)
        .current_folder(&current.download_dir)
        .map_err(portal)?
        .send()
        .await
        .map_err(portal)?;
    let files = match request.response() {
        Ok(files) => files,
        Err(ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled)) => return Ok(None),
        Err(e) => return Err(portal(e)),
    };
    let Some(uri) = files.uris().first() else {
        return Ok(None);
    };
    let next = Settings {
        download_dir: folder_from_uri(uri.as_str())?,
        ..current
    };
    state.library.update_settings(next.clone())?;
    Ok(Some(SettingsDto::from(&next)))
}

pub fn finished_file(d: &Download) -> Result<&Path, CommandError> {
    match (&d.file, d.state) {
        (Some(file), DownloadState::Done) => Ok(file),
        _ => Err(CommandError::invalid(format!(
            "{} isn't finished yet",
            d.name()
        ))),
    }
}

pub fn file_url(path: &Path) -> Result<Url, CommandError> {
    Url::from_file_path(path)
        .map_err(|()| CommandError::invalid(format!("{} is not a full path", path.display())))
}

fn opener_error(e: &tauri_plugin_opener::Error) -> CommandError {
    CommandError {
        kind: ErrorKind::Internal,
        message: format!("couldn't open it: {e}"),
    }
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects AppHandle and State by value"
)]
pub fn open_file(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), CommandError> {
    open_download(&app, &state.library.get(DownloadId::from(id))?)
}

pub fn open_download<R: tauri::Runtime>(
    app: &AppHandle<R>,
    download: &Download,
) -> Result<(), CommandError> {
    let url = file_url(finished_file(download)?)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| opener_error(&e))
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects AppHandle and State by value"
)]
pub fn show_in_folder(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), CommandError> {
    reveal_download(&app, &state.library.get(DownloadId::from(id))?)
}

pub fn reveal_download<R: tauri::Runtime>(
    app: &AppHandle<R>,
    download: &Download,
) -> Result<(), CommandError> {
    match finished_file(download) {
        Ok(file) if file.exists() => app
            .opener()
            .reveal_item_in_dir(file)
            .map_err(|e| opener_error(&e)),
        _ => app
            .opener()
            .open_url(file_url(&download.dir)?, None::<&str>)
            .map_err(|e| opener_error(&e)),
    }
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
    fn an_event_crosses_the_bridge_in_camel_case() {
        let event = Event {
            kind: EventKind::Failed,
            at: UNIX_EPOCH + Duration::from_millis(1_762_600_000_123),
            bytes: Some(1024),
            detail: Some("the server closed the connection".into()),
        };
        assert_eq!(
            serde_json::to_value(EventDto::from(&event)).unwrap(),
            serde_json::json!({
                "kind": "failed",
                "atMs": 1_762_600_000_123_u64,
                "bytes": 1024,
                "detail": "the server closed the connection",
            })
        );
    }

    #[test]
    fn appearance_and_the_portal_scheme_cross_in_lowercase() {
        use ashpd::desktop::settings::ColorScheme;

        for appearance in [Appearance::System, Appearance::Light, Appearance::Dark] {
            let dto = AppearanceDto::from(appearance);
            assert_eq!(
                serde_json::to_value(dto).unwrap(),
                serde_json::json!(appearance.as_str())
            );
            assert_eq!(Appearance::from(dto), appearance);
        }
        assert_eq!(
            scheme_of(ColorScheme::PreferDark),
            Some(ColorSchemeDto::Dark)
        );
        assert_eq!(
            scheme_of(ColorScheme::PreferLight),
            Some(ColorSchemeDto::Light)
        );
        assert_eq!(scheme_of(ColorScheme::NoPreference), None);
        assert_eq!(
            serde_json::to_value(ColorSchemeDto::Dark).unwrap(),
            serde_json::json!("dark")
        );
    }

    #[test]
    fn a_portal_uri_becomes_the_folder_byte_for_byte() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        assert_eq!(
            folder_from_uri("file:///home/u/caf%E9%20files").unwrap(),
            Path::new(OsStr::from_bytes(b"/home/u/caf\xe9 files"))
        );
        assert_eq!(
            folder_from_uri("https://example.org/x").unwrap_err().kind,
            ErrorKind::Invalid
        );
        assert!(folder_from_uri("not a uri").is_err());
    }

    #[test]
    fn saving_settings_keeps_a_folder_that_is_not_utf8() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let current = Settings {
            download_dir: PathBuf::from(OsStr::from_bytes(b"/home/u/caf\xe9")),
            connections: 8,
            speed_limit: None,
            appearance: Appearance::System,
            excluded_sites: Vec::new(),
            confirm_captures: true,
            max_active: 3,
            schedule: None,
            slow_hours: None,
            saved_views: Vec::new(),
        };
        let dto = SettingsDto {
            connections: 4,
            ..SettingsDto::from(&current)
        };
        let next = dto.apply(&current);
        assert_eq!(next.download_dir, current.download_dir);
        assert_eq!(next.connections, 4);

        let moved = SettingsDto {
            download_dir: "/data".into(),
            ..SettingsDto::from(&current)
        };
        assert_eq!(moved.apply(&current).download_dir, Path::new("/data"));
    }

    #[test]
    fn only_a_finished_download_has_a_file_to_open() {
        let mut d = stored(
            "https://example.org/fedora.iso",
            Some("/home/u/Downloads/fedora.iso"),
        );
        let err = finished_file(&d).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Invalid);
        assert_eq!(err.message, "fedora.iso isn't finished yet");

        d.state = DownloadState::Done;
        assert_eq!(
            finished_file(&d).unwrap(),
            Path::new("/home/u/Downloads/fedora.iso")
        );

        d.file = None;
        assert!(finished_file(&d).is_err());
    }

    #[test]
    fn a_path_opens_as_a_file_url_that_keeps_every_byte() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let path = Path::new(OsStr::from_bytes(b"/home/u/Downloads/caf\xe9 (1).iso"));
        let url = file_url(path).unwrap();
        assert_eq!(url.as_str(), "file:///home/u/Downloads/caf%E9%20(1).iso");
        assert_eq!(url.to_file_path().unwrap(), path);

        assert_eq!(
            file_url(Path::new("Downloads")).unwrap_err().kind,
            ErrorKind::Invalid
        );
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
        assert_eq!(
            (dto.category, named.category),
            (CategoryDto::Disk, CategoryDto::Document)
        );
        let bare = DownloadDto::from(&stored("https://example.org/", None));
        assert_eq!(bare.name, "example.org");
        assert_eq!(bare.category, CategoryDto::Other);
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
    fn a_capture_that_starts_elsewhere_stops_waiting() {
        let id = |n: i64| DownloadId::from(n);
        let mut captures = vec![id(1), id(2), id(3)];
        let quiet = Batch {
            seq: 1,
            updates: Vec::new(),
            settled: Vec::new(),
            revision: 2,
            error: None,
        };
        assert!(!drop_started(&mut captures, &quiet));
        let started = Batch {
            seq: 2,
            updates: vec![Update {
                id: id(2),
                phase: Phase::Downloading,
                received: 0,
                total: None,
                speed: 0,
                left: None,
                connections: 1,
            }],
            settled: vec![id(3)],
            revision: 3,
            error: None,
        };
        assert!(drop_started(&mut captures, &started));
        assert_eq!(captures, vec![id(1)]);
    }

    #[test]
    fn settings_round_trip_through_the_dto() {
        let settings = Settings {
            download_dir: PathBuf::from("/home/u/Downloads"),
            connections: 12,
            speed_limit: Some(1 << 20),
            appearance: Appearance::System,
            excluded_sites: vec!["example.org".into()],
            confirm_captures: false,
            max_active: 3,
            schedule: Some(Schedule {
                days: Schedule::EVERY_DAY,
                start: 60,
                stop: 7 * 60,
            }),
            slow_hours: Some(SlowHours {
                limit: 1 << 20,
                hours: Schedule {
                    days: 0b001_1111,
                    start: 9 * 60,
                    stop: 17 * 60,
                },
            }),
            saved_views: vec![SavedView {
                name: "Linux images".into(),
                view: "disk".into(),
                query: "fedora iso".into(),
            }],
        };
        assert_eq!(Settings::from(SettingsDto::from(&settings)), settings);
        let typed = SettingsDto {
            excluded_sites: vec!["https://Mail.Example.net/inbox".into(), "not a site".into()],
            ..SettingsDto::from(&settings)
        };
        assert_eq!(
            Settings::from(typed).excluded_sites,
            vec!["mail.example.net".to_owned(), "not a site".to_owned()],
            "the store refuses what isn't a site"
        );
    }

    #[tokio::test]
    async fn adding_refuses_what_is_not_a_download_link() {
        let library = library().await;
        for url in ["not a link", "mailto:a@example.org", "file:///etc/passwd"] {
            let err = add(&library, url, Some("/tmp"), &Origin::default(), false)
                .await
                .unwrap_err();
            assert_eq!(err.kind, ErrorKind::Invalid, "{url}");
        }
        assert!(list(&library).unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_magnet_link_becomes_a_torrent_download() {
        let magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Fedora%2044";
        let plain = library().await;
        let err = add(&plain, magnet, Some("/tmp"), &Origin::default(), false)
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Engine);

        let state = tempfile::tempdir().unwrap();
        let torrents = Library::open_with(
            Store::open_in_memory().unwrap(),
            Some(TorrentOptions {
                local_only: true,
                ..TorrentOptions::new(state.path().to_owned())
            }),
        )
        .await
        .unwrap();
        let dto = add(&torrents, magnet, Some("/tmp"), &Origin::default(), false)
            .await
            .unwrap();
        assert_eq!(dto.name, "Fedora 44");
        assert!(
            dto.url.starts_with("magnet:?xt=urn:btih:0123"),
            "{}",
            dto.url
        );
        let twice = add(&torrents, magnet, Some("/tmp"), &Origin::default(), false)
            .await
            .unwrap_err();
        assert_eq!(twice.kind, ErrorKind::Invalid, "{}", twice.message);
    }
}
