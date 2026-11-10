// A place where a test can hold the task (see points.rs); nothing without the
// `test-points` feature.
macro_rules! point {
    ($library:expr, $name:literal) => {
        #[cfg(feature = "test-points")]
        $library.points.reach($name).await;
    };
}

mod category;
mod disk;
mod inspect;
mod library;
mod origin;
#[cfg(feature = "test-points")]
mod points;
mod progress;
mod schedule;
mod settings;
mod store;
mod torrent;
mod transfer;

pub use category::Category;
pub use disk::free_space;
pub use inspect::{Connection, ConnectionStatus, Inspection, LogLine, Segment, Server};
pub use library::{AddOptions, Cookies, Library, LibraryError, Tick, check_name};
pub use origin::{Origin, OriginError};
#[cfg(feature = "test-points")]
pub use points::Hold;
pub use progress::{
    Batch, MIN_INTERVAL, ProgressStream, Smoother, StreamOptions, Update, time_left,
};
pub use schedule::{MINUTES_PER_DAY, Schedule, ScheduleError, local_now};
pub use settings::{
    Appearance, DEFAULT_CONNECTIONS, DEFAULT_MAX_ACTIVE, MAX_ACTIVE, MAX_COLUMN_WIDTH,
    MAX_SAVED_VIEWS, MIN_COLUMN_WIDTH, SavedView, Settings, SettingsError, SlowHours, check_own,
    site,
};
pub use store::{
    Download, DownloadId, DownloadState, Event, EventKind, NewDownload, Place, Store, StoreError,
};
pub use torrent::{
    LOOKUP_WAIT, TorrentFile, TorrentOptions, TorrentPeer, TorrentSource, TorrentView,
};
pub use transfer::{
    Finished, Phase, Progress, Transfer, TransferError, TransferOptions, USER_AGENT,
};
