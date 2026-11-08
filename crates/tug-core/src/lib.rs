mod store;
mod transfer;

pub use store::{Download, DownloadId, DownloadState, NewDownload, Store, StoreError};
pub use transfer::{Phase, Progress, Transfer, USER_AGENT};
