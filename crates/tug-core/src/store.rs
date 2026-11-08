use std::ffi::OsString;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, Row, params};
use url::Url;

const MIGRATIONS: &[&str] = &[r"
    CREATE TABLE downloads (
        id          INTEGER PRIMARY KEY,
        url         TEXT    NOT NULL,
        dir         BLOB    NOT NULL,
        file        BLOB,
        state       TEXT    NOT NULL
                    CHECK (state IN ('queued', 'downloading', 'paused', 'done', 'failed')),
        size        INTEGER CHECK (size >= 0),
        received    INTEGER NOT NULL DEFAULT 0 CHECK (received >= 0),
        error       TEXT,
        added_ms    INTEGER NOT NULL,
        finished_ms INTEGER
    );
    CREATE INDEX downloads_state ON downloads (state);
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    ) WITHOUT ROWID;
"];

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error("download {id} has an unreadable {column}: {detail}")]
    Corrupt {
        id: i64,
        column: &'static str,
        detail: String,
    },
    #[error("{0} does not fit in the database")]
    TooLarge(u64),
    #[error("the database is at schema version {found}, newer than this Tug ({known})")]
    FromNewerTug { found: i64, known: i64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct DownloadId(i64);

impl DownloadId {
    pub const fn get(self) -> i64 {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadState {
    Queued,
    Downloading,
    Paused,
    Done,
    Failed,
}

impl DownloadState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Downloading => "downloading",
            Self::Paused => "paused",
            Self::Done => "done",
            Self::Failed => "failed",
        }
    }
}

impl FromStr for DownloadState {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "queued" => Ok(Self::Queued),
            "downloading" => Ok(Self::Downloading),
            "paused" => Ok(Self::Paused),
            "done" => Ok(Self::Done),
            "failed" => Ok(Self::Failed),
            other => Err(format!("unknown state {other:?}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDownload {
    pub url: Url,
    pub dir: PathBuf,
    pub added: SystemTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Download {
    pub id: DownloadId,
    pub url: Url,
    pub dir: PathBuf,
    pub file: Option<PathBuf>,
    pub state: DownloadState,
    pub size: Option<u64>,
    pub received: u64,
    pub error: Option<String>,
    pub added: SystemTime,
    pub finished: Option<SystemTime>,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> Result<Self, StoreError> {
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&mut conn)?;
        Ok(Self { conn })
    }

    pub fn schema_version(&self) -> Result<i64, StoreError> {
        Ok(self
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))?)
    }

    pub fn insert(&self, new: &NewDownload) -> Result<DownloadId, StoreError> {
        self.conn.execute(
            "INSERT INTO downloads (url, dir, state, added_ms) VALUES (?1, ?2, ?3, ?4)",
            params![
                new.url.as_str(),
                new.dir.as_os_str().as_bytes(),
                DownloadState::Queued.as_str(),
                to_ms(new.added),
            ],
        )?;
        Ok(DownloadId(self.conn.last_insert_rowid()))
    }

    pub fn get(&self, id: DownloadId) -> Result<Option<Download>, StoreError> {
        self.conn
            .query_row(&format!("{SELECT} WHERE id = ?1"), [id.0], read_row)
            .optional()?
            .transpose()
    }

    pub fn list(&self) -> Result<Vec<Download>, StoreError> {
        let mut stmt = self.conn.prepare(&format!("{SELECT} ORDER BY id"))?;
        let rows = stmt.query_map([], read_row)?;
        rows.map(|row| row?).collect()
    }

    pub fn set_state(
        &self,
        id: DownloadId,
        state: DownloadState,
        error: Option<&str>,
        at: SystemTime,
    ) -> Result<bool, StoreError> {
        let finished = matches!(state, DownloadState::Done).then(|| to_ms(at));
        let changed = self.conn.execute(
            "UPDATE downloads SET state = ?2, error = ?3, finished_ms = ?4 WHERE id = ?1",
            params![id.0, state.as_str(), error, finished],
        )?;
        Ok(changed > 0)
    }

    pub fn set_progress(
        &self,
        id: DownloadId,
        received: u64,
        size: Option<u64>,
    ) -> Result<bool, StoreError> {
        let size = size.map(to_sql_int).transpose()?;
        let changed = self.conn.execute(
            "UPDATE downloads SET received = ?2, size = ?3 WHERE id = ?1",
            params![id.0, to_sql_int(received)?, size],
        )?;
        Ok(changed > 0)
    }

    pub fn set_file(&self, id: DownloadId, file: &Path) -> Result<bool, StoreError> {
        let changed = self.conn.execute(
            "UPDATE downloads SET file = ?2 WHERE id = ?1",
            params![id.0, file.as_os_str().as_bytes()],
        )?;
        Ok(changed > 0)
    }

    pub fn remove(&self, id: DownloadId) -> Result<bool, StoreError> {
        Ok(self
            .conn
            .execute("DELETE FROM downloads WHERE id = ?1", [id.0])?
            > 0)
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;
        Ok(())
    }
}

const SELECT: &str =
    "SELECT id, url, dir, file, state, size, received, error, added_ms, finished_ms FROM downloads";

fn migrate(conn: &mut Connection) -> Result<(), StoreError> {
    let known = i64::try_from(MIGRATIONS.len()).map_err(|_| StoreError::TooLarge(u64::MAX))?;
    let tx = conn.transaction()?;
    let found: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if found > known {
        return Err(StoreError::FromNewerTug { found, known });
    }
    for (version, sql) in (1..).zip(MIGRATIONS).skip_while(|(v, _)| *v <= found) {
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
    }
    tx.commit()?;
    Ok(())
}

fn read_row(row: &Row<'_>) -> rusqlite::Result<Result<Download, StoreError>> {
    let id: i64 = row.get(0)?;
    let url: String = row.get(1)?;
    let dir: Vec<u8> = row.get(2)?;
    let file: Option<Vec<u8>> = row.get(3)?;
    let state: String = row.get(4)?;
    let size: Option<i64> = row.get(5)?;
    let received: i64 = row.get(6)?;
    let error: Option<String> = row.get(7)?;
    let added: i64 = row.get(8)?;
    let finished: Option<i64> = row.get(9)?;

    let corrupt = |column, detail: String| StoreError::Corrupt { id, column, detail };
    Ok((|| {
        Ok(Download {
            id: DownloadId(id),
            url: Url::parse(&url).map_err(|e| corrupt("url", e.to_string()))?,
            dir: bytes_to_path(dir),
            file: file.map(bytes_to_path),
            state: state.parse().map_err(|e| corrupt("state", e))?,
            size: size
                .map(|s| u64::try_from(s).map_err(|e| corrupt("size", e.to_string())))
                .transpose()?,
            received: u64::try_from(received).map_err(|e| corrupt("received", e.to_string()))?,
            error,
            added: from_ms(added),
            finished: finished.map(from_ms),
        })
    })())
}

fn bytes_to_path(bytes: Vec<u8>) -> PathBuf {
    PathBuf::from(OsString::from_vec(bytes))
}

fn to_sql_int(n: u64) -> Result<i64, StoreError> {
    i64::try_from(n).map_err(|_| StoreError::TooLarge(n))
}

fn to_ms(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_millis()).unwrap_or(i64::MAX),
        Err(e) => i64::try_from(e.duration().as_millis()).map_or(i64::MIN, |ms| -ms),
    }
}

fn from_ms(ms: i64) -> SystemTime {
    let magnitude = Duration::from_millis(ms.unsigned_abs());
    if ms >= 0 {
        UNIX_EPOCH + magnitude
    } else {
        UNIX_EPOCH - magnitude
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new(url: &str, dir: &str) -> NewDownload {
        NewDownload {
            url: Url::parse(url).unwrap(),
            dir: PathBuf::from(dir),
            added: UNIX_EPOCH + Duration::from_millis(1_762_600_000_123),
        }
    }

    #[test]
    fn migrates_a_fresh_database_to_the_latest_schema() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), 1);
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn reopening_keeps_rows_and_does_not_migrate_twice() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("tug.db");
        let id = Store::open(&db)
            .unwrap()
            .insert(&new("https://example.org/a.iso", "/home/u/Downloads"))
            .unwrap();
        let store = Store::open(&db).unwrap();
        assert_eq!(store.schema_version().unwrap(), 1);
        assert_eq!(
            store.get(id).unwrap().unwrap().url.as_str(),
            "https://example.org/a.iso"
        );
    }

    #[test]
    fn a_new_download_round_trips_with_its_defaults() {
        let store = Store::open_in_memory().unwrap();
        let input = new("https://example.org/fedora.iso", "/home/u/Downloads");
        let id = store.insert(&input).unwrap();
        let got = store.get(id).unwrap().unwrap();
        assert_eq!(
            got,
            Download {
                id,
                url: input.url,
                dir: input.dir,
                file: None,
                state: DownloadState::Queued,
                size: None,
                received: 0,
                error: None,
                added: input.added,
                finished: None,
            }
        );
    }

    #[test]
    fn paths_that_are_not_utf8_survive_exactly() {
        let store = Store::open_in_memory().unwrap();
        let dir = bytes_to_path(b"/home/u/caf\xe9".to_vec());
        let id = store
            .insert(&NewDownload {
                dir: dir.clone(),
                ..new("https://example.org/a", "/")
            })
            .unwrap();
        let file = dir.join(OsString::from_vec(b"r\xe9sum\xe9.pdf".to_vec()));
        store.set_file(id, &file).unwrap();
        let got = store.get(id).unwrap().unwrap();
        assert_eq!(got.dir, dir);
        assert_eq!(got.file, Some(file));
    }

    #[test]
    fn state_progress_and_errors_persist() {
        let store = Store::open_in_memory().unwrap();
        let id = store.insert(&new("https://example.org/a", "/d")).unwrap();
        let at = UNIX_EPOCH + Duration::from_secs(1_800_000_123);

        assert!(store.set_progress(id, 1 << 20, Some(4 << 20)).unwrap());
        assert!(
            store
                .set_state(id, DownloadState::Failed, Some("refused"), at)
                .unwrap()
        );
        let failed = store.get(id).unwrap().unwrap();
        assert_eq!((failed.received, failed.size), (1 << 20, Some(4 << 20)));
        assert_eq!(
            (failed.state, failed.error.as_deref(), failed.finished),
            (DownloadState::Failed, Some("refused"), None)
        );

        assert!(store.set_state(id, DownloadState::Done, None, at).unwrap());
        let done = store.get(id).unwrap().unwrap();
        assert_eq!(
            (done.state, done.error, done.finished),
            (DownloadState::Done, None, Some(at))
        );
    }

    #[test]
    fn updates_and_removal_report_whether_the_download_exists() {
        let store = Store::open_in_memory().unwrap();
        let id = store.insert(&new("https://example.org/a", "/d")).unwrap();
        let missing = DownloadId(id.get() + 1);
        assert!(!store.set_progress(missing, 1, None).unwrap());
        assert!(store.remove(id).unwrap());
        assert!(!store.remove(id).unwrap());
        assert_eq!(store.get(id).unwrap(), None);
    }

    #[test]
    fn list_returns_downloads_in_the_order_they_were_added() {
        let store = Store::open_in_memory().unwrap();
        let ids: Vec<_> = ["a", "b", "c"]
            .iter()
            .map(|n| {
                store
                    .insert(&new(&format!("https://example.org/{n}"), "/d"))
                    .unwrap()
            })
            .collect();
        let listed: Vec<_> = store.list().unwrap().into_iter().map(|d| d.id).collect();
        assert_eq!(listed, ids);
    }

    #[test]
    fn settings_insert_then_overwrite() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.setting("connections").unwrap(), None);
        store.set_setting("connections", "8").unwrap();
        store.set_setting("connections", "16").unwrap();
        assert_eq!(store.setting("connections").unwrap().as_deref(), Some("16"));
    }

    #[test]
    fn the_schema_rejects_an_unknown_state() {
        let store = Store::open_in_memory().unwrap();
        let err = store
            .conn
            .execute(
                "INSERT INTO downloads (url, dir, state, added_ms) VALUES ('https://x', x'2f', 'lost', 0)",
                [],
            )
            .unwrap_err();
        assert!(err.to_string().contains("CHECK constraint failed"), "{err}");
    }

    #[test]
    fn a_corrupt_row_is_named_not_panicked_on() {
        let store = Store::open_in_memory().unwrap();
        let id = store.insert(&new("https://example.org/a", "/d")).unwrap();
        store
            .conn
            .execute(
                "UPDATE downloads SET url = 'not a url' WHERE id = ?1",
                [id.get()],
            )
            .unwrap();
        match store.get(id) {
            Err(StoreError::Corrupt { column: "url", .. }) => {}
            other => panic!("expected a corrupt url, got {other:?}"),
        }
    }

    #[test]
    fn a_database_from_a_newer_tug_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("tug.db");
        Connection::open(&db)
            .unwrap()
            .pragma_update(None, "user_version", 99)
            .unwrap();
        assert!(matches!(
            Store::open(&db),
            Err(StoreError::FromNewerTug {
                found: 99,
                known: 1
            })
        ));
    }

    #[test]
    fn sizes_beyond_sqlite_integers_are_refused() {
        let store = Store::open_in_memory().unwrap();
        let id = store.insert(&new("https://example.org/a", "/d")).unwrap();
        assert!(matches!(
            store.set_progress(id, u64::MAX, None),
            Err(StoreError::TooLarge(u64::MAX))
        ));
    }

    #[test]
    fn times_before_the_epoch_round_trip() {
        let before = UNIX_EPOCH - Duration::from_millis(5_000);
        assert_eq!(from_ms(to_ms(before)), before);
    }
}
