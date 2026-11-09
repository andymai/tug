use std::ffi::OsString;
use std::fmt::Write as _;
use std::fs::{OpenOptions, Permissions};
use std::io;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, Row, params};
use url::Url;

use crate::category::Category;
use crate::origin::Origin;

const MIGRATIONS: &[&str] = &[
    r"
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
",
    r"
    CREATE TABLE events (
        id          INTEGER PRIMARY KEY,
        download_id INTEGER NOT NULL REFERENCES downloads (id) ON DELETE CASCADE,
        at_ms       INTEGER NOT NULL,
        kind        TEXT    NOT NULL
                    CHECK (kind IN ('added', 'started', 'resumed', 'paused', 'finished', 'failed')),
        bytes       INTEGER CHECK (bytes >= 0),
        detail      TEXT
    );
    CREATE INDEX events_download ON events (download_id, id);
",
    r"
    CREATE TABLE origins (
        download_id INTEGER PRIMARY KEY REFERENCES downloads (id) ON DELETE CASCADE,
        referrer    TEXT,
        cookies     TEXT,
        user_agent  TEXT
    );
",
    r"
    ALTER TABLE downloads ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
    UPDATE downloads SET position = id;
    CREATE INDEX downloads_queue ON downloads (state, position);
",
    r"
    CREATE VIRTUAL TABLE search USING fts5 (name, url, tokenize = 'unicode61 remove_diacritics 2');
    CREATE TRIGGER search_forget AFTER DELETE ON downloads BEGIN
        DELETE FROM search WHERE rowid = old.id;
    END;
",
    r"
    CREATE TABLE torrents (
        download_id INTEGER PRIMARY KEY REFERENCES downloads (id) ON DELETE CASCADE,
        info_hash   TEXT NOT NULL,
        torrent     BLOB NOT NULL
    );
",
];

// The search table's names come from Rust, so it fills the table when it adds it.
const SEARCH_SCHEMA: i64 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    First,
    Last,
    Up,
    Down,
}

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
    #[error("couldn't keep the database private: {0}")]
    Private(#[from] io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct DownloadId(i64);

impl DownloadId {
    pub const fn get(self) -> i64 {
        self.0
    }
}

impl From<i64> for DownloadId {
    fn from(id: i64) -> Self {
        Self(id)
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Added,
    Started,
    Resumed,
    Paused,
    Finished,
    Failed,
}

impl EventKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Started => "started",
            Self::Resumed => "resumed",
            Self::Paused => "paused",
            Self::Finished => "finished",
            Self::Failed => "failed",
        }
    }
}

impl FromStr for EventKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "added" => Ok(Self::Added),
            "started" => Ok(Self::Started),
            "resumed" => Ok(Self::Resumed),
            "paused" => Ok(Self::Paused),
            "finished" => Ok(Self::Finished),
            "failed" => Ok(Self::Failed),
            other => Err(format!("unknown event {other:?}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub kind: EventKind,
    pub at: SystemTime,
    pub bytes: Option<u64>,
    pub detail: Option<String>,
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
    // The queue's order: lower goes first.
    pub position: i64,
}

impl Download {
    pub fn name(&self) -> String {
        name_of(&self.url, self.file.as_deref())
    }

    pub fn category(&self) -> Category {
        Category::of(&self.name())
    }

    pub fn is_torrent(&self) -> bool {
        self.url.scheme() == "magnet"
    }
}

// The info hash in a magnet link as librqbit writes it: 40 hex digits, also
// when the link gives the 32-letter base32 form.
pub fn info_hash(magnet: &str) -> Option<String> {
    let url = Url::parse(magnet).ok()?;
    let given = url.query_pairs().find_map(|(key, value)| {
        (key == "xt")
            .then(|| value.strip_prefix("urn:btih:").map(str::to_owned))
            .flatten()
    })?;
    match given.len() {
        40 if given.chars().all(|c| c.is_ascii_hexdigit()) => Some(given.to_ascii_lowercase()),
        32 => base32_hex(&given),
        _ => None,
    }
}

fn base32_hex(text: &str) -> Option<String> {
    let mut bits: u64 = 0;
    let mut held = 0;
    let mut hex = String::with_capacity(40);
    for c in text.chars() {
        let value = match c.to_ascii_uppercase() {
            letter @ 'A'..='Z' => u64::from(letter) - u64::from('A'),
            digit @ '2'..='7' => u64::from(digit) - u64::from('2') + 26,
            _ => return None,
        };
        bits = (bits << 5) | value;
        held += 5;
        if held >= 8 {
            held -= 8;
            write!(hex, "{:02x}", (bits >> held) & 0xff).ok()?;
        }
    }
    (hex.len() == 40).then_some(hex)
}

pub fn name_of(url: &Url, file: Option<&Path>) -> String {
    if let Some(name) = file.and_then(Path::file_name) {
        return name.to_string_lossy().into_owned();
    }
    if url.scheme() == "magnet" {
        return url
            .query_pairs()
            .find(|(key, value)| key == "dn" && !value.trim().is_empty())
            .map_or_else(|| "magnet link".to_owned(), |(_, name)| name.into_owned());
    }
    url.path_segments()
        .and_then(|mut s| s.rfind(|seg| !seg.is_empty()))
        .map_or_else(
            || url.host_str().unwrap_or("download").to_owned(),
            str::to_owned,
        )
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        private(path)?;
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
        // A finished download needs no cookies, also when a crash came between
        // its last two writes in an older Tug.
        conn.execute(
            "DELETE FROM origins WHERE download_id IN (SELECT id FROM downloads WHERE state = 'done')",
            [],
        )?;
        Ok(Self { conn })
    }

    pub fn schema_version(&self) -> Result<i64, StoreError> {
        Ok(self
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))?)
    }

    pub fn insert(&self, new: &NewDownload) -> Result<DownloadId, StoreError> {
        self.insert_from(new, &Origin::default())
    }

    pub fn insert_from(
        &self,
        new: &NewDownload,
        origin: &Origin,
    ) -> Result<DownloadId, StoreError> {
        self.insert_as(new, origin, DownloadState::Queued)
    }

    pub fn insert_as(
        &self,
        new: &NewDownload,
        origin: &Origin,
        state: DownloadState,
    ) -> Result<DownloadId, StoreError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO downloads (url, dir, state, added_ms, position)
             VALUES (?1, ?2, ?3, ?4, (SELECT IFNULL(MAX(position), 0) + 1 FROM downloads))",
            params![
                new.url.as_str(),
                new.dir.as_os_str().as_bytes(),
                state.as_str(),
                to_ms(new.added),
            ],
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO search (rowid, name, url) VALUES (?1, ?2, ?3)",
            params![id, name_of(&new.url, None), new.url.as_str()],
        )?;
        if !origin.is_empty() {
            tx.execute(
                "INSERT INTO origins (download_id, referrer, cookies, user_agent) VALUES (?1, ?2, ?3, ?4)",
                params![
                    id,
                    origin.referrer().map(Url::as_str),
                    origin.cookies(),
                    origin.user_agent(),
                ],
            )?;
        }
        tx.commit()?;
        Ok(DownloadId(id))
    }

    pub fn origin(&self, id: DownloadId) -> Result<Origin, StoreError> {
        let row = self
            .conn
            .query_row(
                "SELECT referrer, cookies, user_agent FROM origins WHERE download_id = ?1",
                [id.0],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((referrer, cookies, user_agent)) = row else {
            return Ok(Origin::default());
        };
        Origin::new(
            referrer.as_deref(),
            cookies.as_deref(),
            user_agent.as_deref(),
        )
        .map_err(|e| StoreError::Corrupt {
            id: id.0,
            column: "origin",
            detail: e.to_string(),
        })
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

    pub fn queued(&self) -> Result<Vec<DownloadId>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM downloads WHERE state = 'queued' ORDER BY position, id")?;
        let ids = stmt.query_map([], |row| row.get(0))?;
        Ok(ids
            .collect::<rusqlite::Result<Vec<i64>>>()?
            .into_iter()
            .map(DownloadId)
            .collect())
    }

    pub fn place(&self, id: DownloadId, place: Place) -> Result<bool, StoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let position: Option<i64> = tx
            .query_row(
                "SELECT position FROM downloads WHERE id = ?1 AND state = 'queued'",
                [id.0],
                |row| row.get(0),
            )
            .optional()?;
        let Some(position) = position else {
            return Ok(false);
        };
        match place {
            Place::First | Place::Last => {
                let edge = if place == Place::First {
                    "SELECT IFNULL(MIN(position), 0) - 1 FROM downloads"
                } else {
                    "SELECT IFNULL(MAX(position), 0) + 1 FROM downloads"
                };
                tx.execute(
                    &format!("UPDATE downloads SET position = ({edge}) WHERE id = ?1"),
                    [id.0],
                )?;
            }
            Place::Up | Place::Down => {
                let neighbor = if place == Place::Up {
                    "SELECT id, position FROM downloads WHERE state = 'queued' AND position < ?1 ORDER BY position DESC LIMIT 1"
                } else {
                    "SELECT id, position FROM downloads WHERE state = 'queued' AND position > ?1 ORDER BY position LIMIT 1"
                };
                let swap: Option<(i64, i64)> = tx
                    .query_row(neighbor, [position], |row| Ok((row.get(0)?, row.get(1)?)))
                    .optional()?;
                if let Some((other, other_position)) = swap {
                    tx.execute(
                        "UPDATE downloads SET position = ?2 WHERE id = ?1",
                        params![id.0, other_position],
                    )?;
                    tx.execute(
                        "UPDATE downloads SET position = ?2 WHERE id = ?1",
                        params![other, position],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(true)
    }

    pub fn set_state(
        &self,
        id: DownloadId,
        state: DownloadState,
        error: Option<&str>,
        at: SystemTime,
    ) -> Result<bool, StoreError> {
        let done = state == DownloadState::Done;
        let finished = done.then(|| to_ms(at));
        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE downloads SET state = ?2, error = ?3, finished_ms = ?4 WHERE id = ?1",
            params![id.0, state.as_str(), error, finished],
        )?;
        if done {
            tx.execute("DELETE FROM origins WHERE download_id = ?1", [id.0])?;
        }
        tx.commit()?;
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
        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE downloads SET file = ?2 WHERE id = ?1",
            params![id.0, file.as_os_str().as_bytes()],
        )?;
        if let Some(name) = file.file_name() {
            tx.execute(
                "UPDATE search SET name = ?2 WHERE rowid = ?1",
                params![id.0, name.to_string_lossy()],
            )?;
        }
        tx.commit()?;
        Ok(changed > 0)
    }

    // Each word matches the start of a word in the name or the link, in any order.
    pub fn search(&self, query: &str) -> Result<Vec<DownloadId>, StoreError> {
        let words: Vec<String> = query
            .split_whitespace()
            .map(|word| format!("\"{}\"*", word.replace('"', "\"\"")))
            .collect();
        if words.is_empty() {
            return Ok(Vec::new());
        }
        let mut stmt = self
            .conn
            .prepare("SELECT rowid FROM search WHERE search MATCH ?1 ORDER BY rank")?;
        let ids = stmt.query_map([words.join(" ")], |row| row.get(0))?;
        Ok(ids
            .collect::<rusqlite::Result<Vec<i64>>>()?
            .into_iter()
            .map(DownloadId)
            .collect())
    }

    pub fn set_torrent(
        &self,
        id: DownloadId,
        info_hash: &str,
        torrent: &[u8],
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO torrents (download_id, info_hash, torrent) VALUES (?1, ?2, ?3)
             ON CONFLICT (download_id) DO UPDATE SET info_hash = excluded.info_hash, torrent = excluded.torrent",
            params![id.0, info_hash, torrent],
        )?;
        Ok(())
    }

    pub fn torrent(&self, id: DownloadId) -> Result<Option<(String, Vec<u8>)>, StoreError> {
        Ok(self
            .conn
            .query_row(
                "SELECT info_hash, torrent FROM torrents WHERE download_id = ?1",
                [id.0],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    pub fn remove(&self, id: DownloadId) -> Result<bool, StoreError> {
        Ok(self
            .conn
            .execute("DELETE FROM downloads WHERE id = ?1", [id.0])?
            > 0)
    }

    pub fn add_event(&self, id: DownloadId, event: &Event) -> Result<(), StoreError> {
        let bytes = event.bytes.map(to_sql_int).transpose()?;
        self.conn.execute(
            "INSERT INTO events (download_id, at_ms, kind, bytes, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id.0, to_ms(event.at), event.kind.as_str(), bytes, event.detail],
        )?;
        Ok(())
    }

    pub fn events(&self, id: DownloadId) -> Result<Vec<Event>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT at_ms, kind, bytes, detail FROM events WHERE download_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map([id.0], |row| {
            let at: i64 = row.get(0)?;
            let kind: String = row.get(1)?;
            let bytes: Option<i64> = row.get(2)?;
            let detail: Option<String> = row.get(3)?;
            Ok((at, kind, bytes, detail))
        })?;
        let corrupt = |column, detail: String| StoreError::Corrupt {
            id: id.0,
            column,
            detail,
        };
        rows.map(|row| {
            let (at, kind, bytes, detail) = row?;
            Ok(Event {
                kind: kind.parse().map_err(|e| corrupt("event kind", e))?,
                at: from_ms(at),
                bytes: bytes
                    .map(|b| u64::try_from(b).map_err(|e| corrupt("event bytes", e.to_string())))
                    .transpose()?,
                detail,
            })
        })
        .collect()
    }

    #[cfg(test)]
    pub(crate) fn break_events(&self) {
        if let Err(e) = self.conn.execute_batch("DROP TABLE events") {
            panic!("could not drop the events table: {e}");
        }
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn setting_bytes(&self, key: &str) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn set_setting_bytes(&self, key: &str, value: &[u8]) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn remove_setting(&self, key: &str) -> Result<bool, StoreError> {
        Ok(self
            .conn
            .execute("DELETE FROM settings WHERE key = ?1", [key])?
            > 0)
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

// The origins table holds browser cookies: the database and its WAL files are
// the user's alone, also when an older Tug made them with the default mode.
fn private(path: &Path) -> io::Result<()> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(path)?;
    for suffix in ["", "-wal", "-shm"] {
        let mut file = path.as_os_str().to_owned();
        file.push(suffix);
        match std::fs::set_permissions(&file, Permissions::from_mode(0o600)) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
    }
    Ok(())
}

const SELECT: &str = "SELECT id, url, dir, file, state, size, received, error, added_ms, finished_ms, position FROM downloads";

fn migrate(conn: &mut Connection) -> Result<(), StoreError> {
    let known = i64::try_from(MIGRATIONS.len()).map_err(|_| StoreError::TooLarge(u64::MAX))?;
    let tx = conn.transaction()?;
    let found: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if found > known {
        return Err(StoreError::FromNewerTug { found, known });
    }
    for (version, sql) in (1..).zip(MIGRATIONS).skip_while(|(v, _)| *v <= found) {
        tx.execute_batch(sql)?;
        if version == SEARCH_SCHEMA {
            index(&tx)?;
        }
        tx.pragma_update(None, "user_version", version)?;
    }
    tx.commit()?;
    Ok(())
}

fn index(conn: &Connection) -> Result<(), StoreError> {
    let mut stmt = conn.prepare("SELECT id, url, file FROM downloads")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<Vec<u8>>>(2)?,
        ))
    })?;
    for row in rows {
        let (id, url, file) = row?;
        let file = file.map(bytes_to_path);
        let name = Url::parse(&url)
            .map_or_else(|_| url.clone(), |parsed| name_of(&parsed, file.as_deref()));
        conn.execute(
            "INSERT INTO search (rowid, name, url) VALUES (?1, ?2, ?3)",
            params![id, name, url],
        )?;
    }
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
    let position: i64 = row.get(10)?;

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
            position,
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
        assert_eq!(store.schema_version().unwrap(), 6);
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
        assert_eq!(store.schema_version().unwrap(), 6);
        assert_eq!(
            store.get(id).unwrap().unwrap().url.as_str(),
            "https://example.org/a.iso"
        );
    }

    #[test]
    fn events_keep_their_order_and_leave_with_their_download() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .insert(&new("https://example.org/a.iso", "/d"))
            .unwrap();
        let other = store
            .insert(&new("https://example.org/b.iso", "/d"))
            .unwrap();
        let at = UNIX_EPOCH + Duration::from_millis(1_800_000_000_500);
        let events = [
            Event {
                kind: EventKind::Added,
                at,
                bytes: None,
                detail: None,
            },
            Event {
                kind: EventKind::Paused,
                at,
                bytes: Some(1 << 20),
                detail: None,
            },
            Event {
                kind: EventKind::Failed,
                at,
                bytes: Some(2 << 20),
                detail: Some("the server closed the connection".into()),
            },
        ];
        for event in &events {
            store.add_event(id, event).unwrap();
        }
        store.add_event(other, &events[0]).unwrap();

        assert_eq!(store.events(id).unwrap(), events);
        assert!(store.remove(id).unwrap());
        assert!(store.events(id).unwrap().is_empty());
        assert_eq!(store.events(other).unwrap().len(), 1);
    }

    #[test]
    fn a_version_1_database_gains_the_events_table() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("tug.db");
        {
            let mut conn = Connection::open(&db).unwrap();
            let tx = conn.transaction().unwrap();
            tx.execute_batch(MIGRATIONS[0]).unwrap();
            tx.pragma_update(None, "user_version", 1).unwrap();
            tx.commit().unwrap();
        }
        let store = Store::open(&db).unwrap();
        assert_eq!(store.schema_version().unwrap(), 6);
        let id = store
            .insert(&new("https://example.org/a.iso", "/d"))
            .unwrap();
        store
            .add_event(
                id,
                &Event {
                    kind: EventKind::Added,
                    at: UNIX_EPOCH,
                    bytes: None,
                    detail: None,
                },
            )
            .unwrap();
        assert_eq!(store.events(id).unwrap().len(), 1);
    }

    #[test]
    fn an_origin_round_trips_and_leaves_with_its_download() {
        let store = Store::open_in_memory().unwrap();
        let origin = Origin::new(
            Some("https://example.org/page"),
            Some("session=abc"),
            Some("Mozilla/5.0"),
        )
        .unwrap();
        let with = store
            .insert_from(&new("https://example.org/a.iso", "/d"), &origin)
            .unwrap();
        let without = store
            .insert(&new("https://example.org/b.iso", "/d"))
            .unwrap();
        assert_eq!(store.origin(with).unwrap(), origin);
        assert_eq!(store.origin(without).unwrap(), Origin::default());

        store
            .set_state(with, DownloadState::Paused, None, SystemTime::now())
            .unwrap();
        assert_eq!(
            store.origin(with).unwrap(),
            origin,
            "a paused download resumes with it"
        );
        store
            .set_state(with, DownloadState::Done, None, SystemTime::now())
            .unwrap();
        assert_eq!(store.origin(with).unwrap(), Origin::default());

        let again = store
            .insert_from(&new("https://example.org/c.iso", "/d"), &origin)
            .unwrap();
        store.remove(again).unwrap();
        let left: i64 = store
            .conn
            .query_row("SELECT count(*) FROM origins", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn a_failed_forget_leaves_the_download_unfinished_with_its_origin() {
        let store = Store::open_in_memory().unwrap();
        let origin = Origin::new(None, Some("session=abc"), None).unwrap();
        let id = store
            .insert_from(&new("https://example.org/a.iso", "/d"), &origin)
            .unwrap();
        store
            .conn
            .execute_batch(
                "CREATE TRIGGER keep BEFORE DELETE ON origins BEGIN SELECT RAISE(ABORT, 'kept'); END;",
            )
            .unwrap();
        assert!(
            store
                .set_state(id, DownloadState::Done, None, SystemTime::now())
                .is_err()
        );
        assert_eq!(store.get(id).unwrap().unwrap().state, DownloadState::Queued);
        assert_eq!(store.origin(id).unwrap(), origin);
    }

    #[test]
    fn a_download_can_start_out_paused_with_its_origin_in_one_write() {
        let store = Store::open_in_memory().unwrap();
        let origin = Origin::new(None, Some("session=abc"), None).unwrap();
        let id = store
            .insert_as(
                &new("https://example.org/a.iso", "/d"),
                &origin,
                DownloadState::Paused,
            )
            .unwrap();
        assert_eq!(store.get(id).unwrap().unwrap().state, DownloadState::Paused);
        assert_eq!(store.origin(id).unwrap(), origin);
    }

    #[test]
    fn the_queue_keeps_its_order_and_moves_a_waiting_download() {
        let store = Store::open_in_memory().unwrap();
        let ids: Vec<DownloadId> = ["a", "b", "c", "d"]
            .iter()
            .map(|n| {
                store
                    .insert(&new(&format!("https://example.org/{n}.iso"), "/d"))
                    .unwrap()
            })
            .collect();
        let (a, b, c, d) = (ids[0], ids[1], ids[2], ids[3]);
        assert_eq!(store.queued().unwrap(), vec![a, b, c, d]);

        assert!(store.place(d, Place::First).unwrap());
        assert_eq!(store.queued().unwrap(), vec![d, a, b, c]);
        assert!(store.place(d, Place::Last).unwrap());
        assert_eq!(store.queued().unwrap(), vec![a, b, c, d]);
        assert!(store.place(c, Place::Up).unwrap());
        assert_eq!(store.queued().unwrap(), vec![a, c, b, d]);
        assert!(store.place(a, Place::Down).unwrap());
        assert_eq!(store.queued().unwrap(), vec![c, a, b, d]);
        assert!(store.place(c, Place::Up).unwrap());
        assert_eq!(
            store.queued().unwrap(),
            vec![c, a, b, d],
            "the first can't go further up"
        );

        store
            .set_state(b, DownloadState::Paused, None, SystemTime::now())
            .unwrap();
        assert_eq!(store.queued().unwrap(), vec![c, a, d]);
        assert!(
            !store.place(b, Place::First).unwrap(),
            "only a waiting download has a place"
        );
        assert!(store.place(d, Place::Up).unwrap());
        assert_eq!(
            store.queued().unwrap(),
            vec![c, d, a],
            "a paused download is no neighbor"
        );
    }

    #[test]
    fn search_finds_words_at_the_start_of_the_name_or_the_link() {
        let store = Store::open_in_memory().unwrap();
        let fedora = store
            .insert(&new("https://mirror.example.org/fedora-kde-44.iso", "/d"))
            .unwrap();
        let talk = store
            .insert(&new("https://media.example.net/v/7f3a", "/d"))
            .unwrap();
        let find = |query: &str| store.search(query).unwrap();
        assert_eq!(find("fedo"), [fedora]);
        assert_eq!(find("KDE 44"), [fedora]);
        assert_eq!(find("mirror"), [fedora]);
        assert_eq!(find("example").len(), 2);
        assert!(find("dora").is_empty(), "words match at their start");
        assert!(find("   ").is_empty());

        store
            .set_file(talk, Path::new("/d/conférence-2026.mp4"))
            .unwrap();
        assert_eq!(find("conference"), [talk], "accents don't matter");
        store.remove(fedora).unwrap();
        assert!(find("fedora").is_empty());
        for odd in ["\"", "a*", "-x", "AND", "(", "NEAR(a b)", "x:y"] {
            store.search(odd).unwrap();
        }
    }

    #[test]
    fn a_version_4_database_gains_a_search_of_its_downloads() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("tug.db");
        {
            let mut conn = Connection::open(&db).unwrap();
            let tx = conn.transaction().unwrap();
            for sql in &MIGRATIONS[..4] {
                tx.execute_batch(sql).unwrap();
            }
            tx.execute(
                "INSERT INTO downloads (url, dir, file, state, added_ms) VALUES ('https://example.org/x/7', x'2f', CAST('/d/backup.tar' AS BLOB), 'done', 0)",
                [],
            )
            .unwrap();
            tx.pragma_update(None, "user_version", 4).unwrap();
            tx.commit().unwrap();
        }
        let store = Store::open(&db).unwrap();
        assert_eq!(store.schema_version().unwrap(), 6);
        assert_eq!(store.search("backup").unwrap().len(), 1);
    }

    #[test]
    fn a_magnet_hash_reads_the_same_in_hex_and_in_base32() {
        let hex = "e4be9e4db876e3e3179778b03e906297be5c8dbe";
        for magnet in [
            format!("magnet:?xt=urn:btih:{hex}&dn=x"),
            format!("magnet:?xt=urn:btih:{}", hex.to_ascii_uppercase()),
            "magnet:?xt=urn:btih:4S7J4TNYO3R6GF4XPCYD5EDCS67FZDN6".to_owned(),
        ] {
            assert_eq!(info_hash(&magnet).as_deref(), Some(hex), "{magnet}");
        }
        for odd in [
            "magnet:?xt=urn:btih:00",
            "magnet:?dn=x",
            "https://example.org/",
        ] {
            assert_eq!(info_hash(odd), None, "{odd}");
        }
    }

    #[test]
    fn a_torrent_keeps_its_file_and_hash_until_its_download_goes() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .insert(&new(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Fedora%2044",
                "/d",
            ))
            .unwrap();
        assert_eq!(store.get(id).unwrap().unwrap().name(), "Fedora 44");
        assert_eq!(store.torrent(id).unwrap(), None);
        store.set_torrent(id, "0123", b"d4:infoe").unwrap();
        store.set_torrent(id, "4567", b"d4:infoee").unwrap();
        assert_eq!(
            store.torrent(id).unwrap(),
            Some(("4567".to_owned(), b"d4:infoee".to_vec()))
        );
        store.remove(id).unwrap();
        assert_eq!(store.torrent(id).unwrap(), None);
        let bare = store.insert(&new("magnet:?xt=urn:btih:00", "/d")).unwrap();
        assert_eq!(store.get(bare).unwrap().unwrap().name(), "magnet link");
    }

    #[test]
    fn opening_forgets_the_origins_of_finished_downloads() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("tug.db");
        let origin = Origin::new(None, Some("session=abc"), None).unwrap();
        let (done, paused) = {
            let store = Store::open(&db).unwrap();
            let done = store
                .insert_from(&new("https://example.org/a.iso", "/d"), &origin)
                .unwrap();
            let paused = store
                .insert_from(&new("https://example.org/b.iso", "/d"), &origin)
                .unwrap();
            store
                .conn
                .execute(
                    "UPDATE downloads SET state = 'done' WHERE id = ?1",
                    [done.0],
                )
                .unwrap();
            assert_eq!(store.origin(done).unwrap(), origin);
            (done, paused)
        };
        let store = Store::open(&db).unwrap();
        assert_eq!(store.origin(done).unwrap(), Origin::default());
        assert_eq!(store.origin(paused).unwrap(), origin);
    }

    #[test]
    fn the_database_and_its_wal_files_are_private() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("tug.db");
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        {
            let store = Store::open(&db).unwrap();
            store
                .insert(&new("https://example.org/a.iso", "/d"))
                .unwrap();
            for suffix in ["", "-wal", "-shm"] {
                let file = PathBuf::from(format!("{}{suffix}", db.display()));
                assert_eq!(mode(&file), 0o600, "{}", file.display());
            }
        }
        std::fs::set_permissions(&db, Permissions::from_mode(0o644)).unwrap();
        Store::open(&db).unwrap();
        assert_eq!(mode(&db), 0o600);
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
                position: 1,
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
    fn byte_settings_round_trip_and_settings_can_be_removed() {
        let store = Store::open_in_memory().unwrap();
        store
            .set_setting_bytes("download_dir", b"/home/u/caf\xe9")
            .unwrap();
        assert_eq!(
            store.setting_bytes("download_dir").unwrap().as_deref(),
            Some(&b"/home/u/caf\xe9"[..])
        );
        assert!(store.remove_setting("download_dir").unwrap());
        assert!(!store.remove_setting("download_dir").unwrap());
        assert_eq!(store.setting_bytes("download_dir").unwrap(), None);
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
            Err(StoreError::FromNewerTug { found: 99, known }) if Ok(known) == i64::try_from(MIGRATIONS.len())
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
