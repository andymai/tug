use std::ffi::OsString;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::str::FromStr;

use mdm_engine::download::MAX_CONNECTIONS;
use url::Url;

use crate::schedule::{Schedule, ScheduleError, local_now};
use crate::store::{Store, StoreError};

pub const DEFAULT_CONNECTIONS: u32 = 8;
pub const DEFAULT_MAX_ACTIVE: u32 = 3;
pub const MAX_ACTIVE: u32 = 16;

const DOWNLOAD_DIR: &str = "download_dir";
const CONNECTIONS: &str = "connections";
const SPEED_LIMIT: &str = "speed_limit";
const APPEARANCE: &str = "appearance";
const EXCLUDED_SITES: &str = "excluded_sites";
const CONFIRM_CAPTURES: &str = "confirm_captures";
const MAX_ACTIVE_KEY: &str = "max_active";
const SCHEDULE: &str = "schedule";
const SLOW_HOURS: &str = "slow_hours";
const SAVED_VIEWS: &str = "saved_views";
pub const MAX_SAVED_VIEWS: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

impl Appearance {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

impl FromStr for Appearance {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "system" => Ok(Self::System),
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            other => Err(format!("unknown appearance {other:?}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlowHours {
    pub limit: u64,
    pub hours: Schedule,
}

impl SlowHours {
    fn parse(text: &str) -> Option<Self> {
        let (limit, hours) = text.split_once(' ')?;
        let slow = Self {
            limit: limit.parse().ok().filter(|&n: &u64| n > 0)?,
            hours: hours.parse().ok()?,
        };
        Some(slow)
    }
}

// A search the person keeps in the sidebar. `view` is the window's own name for
// the list it ran in; the core keeps it as it comes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedView {
    pub name: String,
    pub view: String,
    pub query: String,
}

impl SavedView {
    fn check(&self) -> Result<(), SettingsError> {
        let plain = |text: &str| !text.trim().is_empty() && !text.chars().any(char::is_control);
        let view = !self.view.is_empty() && self.view.chars().all(|c| c.is_ascii_lowercase());
        if plain(&self.name) && plain(&self.query) && view && self.name.chars().count() <= 60 {
            Ok(())
        } else {
            Err(SettingsError::SavedView(self.name.clone()))
        }
    }

    fn line(&self) -> String {
        format!("{}\t{}\t{}", self.view, self.query, self.name)
    }

    fn parse(line: &str) -> Option<Self> {
        let mut fields = line.splitn(3, '\t');
        let saved = Self {
            view: fields.next()?.to_owned(),
            query: fields.next()?.to_owned(),
            name: fields.next()?.to_owned(),
        };
        saved.check().ok().map(|()| saved)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub download_dir: PathBuf,
    pub connections: u32,
    pub speed_limit: Option<u64>,
    pub appearance: Appearance,
    pub excluded_sites: Vec<String>,
    pub confirm_captures: bool,
    pub max_active: u32,
    pub schedule: Option<Schedule>,
    pub slow_hours: Option<SlowHours>,
    pub saved_views: Vec<SavedView>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SettingsError {
    #[error("downloads at once must be between 1 and {MAX_ACTIVE}, not {0}")]
    MaxActive(u32),
    #[error("connections must be between 1 and {MAX_CONNECTIONS}, not {0}")]
    Connections(u32),
    #[error("a speed limit must be above zero")]
    ZeroSpeedLimit,
    #[error("the download folder must be an absolute path, not {}", .0.display())]
    RelativeDir(PathBuf),
    #[error("{0:?} isn't a site, like example.org")]
    Site(String),
    #[error("{0} is in the list twice")]
    DuplicateSite(String),
    #[error("{0:?} can't be a saved view")]
    SavedView(String),
    #[error("{0:?} is saved twice")]
    DuplicateView(String),
    #[error("Tug keeps at most {MAX_SAVED_VIEWS} saved views")]
    TooManyViews,
    #[error(transparent)]
    Schedule(#[from] ScheduleError),
}

pub fn site(input: &str) -> Result<String, SettingsError> {
    let refuse = || SettingsError::Site(input.to_owned());
    let trimmed = input.trim();
    let bare = trimmed.strip_prefix("*.").unwrap_or(trimmed);
    let link = if bare.contains("://") {
        Url::parse(bare)
    } else {
        Url::parse(&format!("https://{bare}"))
    }
    .map_err(|_| refuse())?;
    match link.host_str() {
        Some(host) if !host.is_empty() => Ok(host.trim_end_matches('.').to_owned()),
        _ => Err(refuse()),
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: default_download_dir(),
            connections: DEFAULT_CONNECTIONS,
            speed_limit: None,
            appearance: Appearance::System,
            excluded_sites: Vec::new(),
            confirm_captures: true,
            max_active: DEFAULT_MAX_ACTIVE,
            schedule: None,
            slow_hours: None,
            saved_views: Vec::new(),
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), SettingsError> {
        if !(1..=MAX_CONNECTIONS).contains(&self.connections) {
            return Err(SettingsError::Connections(self.connections));
        }
        if !(1..=MAX_ACTIVE).contains(&self.max_active) {
            return Err(SettingsError::MaxActive(self.max_active));
        }
        if let Some(schedule) = self.schedule {
            schedule.validate()?;
        }
        if let Some(slow) = self.slow_hours {
            if slow.limit == 0 {
                return Err(SettingsError::ZeroSpeedLimit);
            }
            slow.hours.validate()?;
        }
        if self.speed_limit == Some(0) {
            return Err(SettingsError::ZeroSpeedLimit);
        }
        if !self.download_dir.is_absolute() {
            return Err(SettingsError::RelativeDir(self.download_dir.clone()));
        }
        for (at, entry) in self.excluded_sites.iter().enumerate() {
            if site(entry).ok().as_ref() != Some(entry) {
                return Err(SettingsError::Site(entry.clone()));
            }
            if self.excluded_sites[..at].contains(entry) {
                return Err(SettingsError::DuplicateSite(entry.clone()));
            }
        }
        if self.saved_views.len() > MAX_SAVED_VIEWS {
            return Err(SettingsError::TooManyViews);
        }
        for (at, saved) in self.saved_views.iter().enumerate() {
            saved.check()?;
            if self.saved_views[..at]
                .iter()
                .any(|other| other.view == saved.view && other.query == saved.query)
            {
                return Err(SettingsError::DuplicateView(saved.name.clone()));
            }
        }
        Ok(())
    }

    pub fn speed_limit_at(&self, weekday: u8, minute: u16) -> Option<u64> {
        match self.slow_hours {
            Some(slow) if slow.hours.is_open(weekday, minute) => Some(
                self.speed_limit
                    .map_or(slow.limit, |limit| limit.min(slow.limit)),
            ),
            _ => self.speed_limit,
        }
    }

    pub fn speed_limit_now(&self) -> Option<u64> {
        let (weekday, minute) = local_now();
        self.speed_limit_at(weekday, minute)
    }

    pub fn excluded_site<'a>(&'a self, link: &Url, referrer: Option<&Url>) -> Option<&'a str> {
        let hosts: Vec<&str> = [Some(link), referrer]
            .into_iter()
            .flatten()
            .filter_map(Url::host_str)
            .collect();
        self.excluded_sites
            .iter()
            .find(|entry| {
                hosts.iter().any(|host| {
                    host.trim_end_matches('.')
                        .strip_suffix(entry.as_str())
                        .is_some_and(|rest| rest.is_empty() || rest.ends_with('.'))
                })
            })
            .map(String::as_str)
    }

    pub(crate) fn load(store: &Store) -> Result<Self, StoreError> {
        let defaults = Self::default();
        let download_dir = store
            .setting_bytes(DOWNLOAD_DIR)?
            .map_or(defaults.download_dir, |bytes| {
                PathBuf::from(OsString::from_vec(bytes))
            });
        let connections = store
            .setting(CONNECTIONS)?
            .and_then(|v| v.parse().ok())
            .filter(|n| (1..=MAX_CONNECTIONS).contains(n))
            .unwrap_or(defaults.connections);
        let speed_limit = store
            .setting(SPEED_LIMIT)?
            .and_then(|v| v.parse().ok())
            .filter(|&n: &u64| n > 0);
        let appearance = store
            .setting(APPEARANCE)?
            .and_then(|v| v.parse().ok())
            .unwrap_or_default();
        let mut excluded_sites: Vec<String> = Vec::new();
        for entry in store.setting(EXCLUDED_SITES)?.unwrap_or_default().lines() {
            if site(entry).ok().as_deref() == Some(entry)
                && !excluded_sites.iter().any(|e| e == entry)
            {
                excluded_sites.push(entry.to_owned());
            }
        }
        let confirm_captures = store
            .setting(CONFIRM_CAPTURES)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.confirm_captures);
        let max_active = store
            .setting(MAX_ACTIVE_KEY)?
            .and_then(|v| v.parse().ok())
            .filter(|n| (1..=MAX_ACTIVE).contains(n))
            .unwrap_or(defaults.max_active);
        let schedule = store.setting(SCHEDULE)?.and_then(|v| v.parse().ok());
        let slow_hours = store
            .setting(SLOW_HOURS)?
            .and_then(|v| SlowHours::parse(&v));
        let mut saved_views: Vec<SavedView> = Vec::new();
        for saved in store
            .setting(SAVED_VIEWS)?
            .unwrap_or_default()
            .lines()
            .filter_map(SavedView::parse)
        {
            let twice = saved_views
                .iter()
                .any(|other| other.view == saved.view && other.query == saved.query);
            if !twice && saved_views.len() < MAX_SAVED_VIEWS {
                saved_views.push(saved);
            }
        }
        Ok(Self {
            download_dir,
            connections,
            speed_limit,
            appearance,
            excluded_sites,
            confirm_captures,
            max_active,
            schedule,
            slow_hours,
            saved_views,
        })
    }

    pub(crate) fn save(&self, store: &Store) -> Result<(), StoreError> {
        store.set_setting_bytes(DOWNLOAD_DIR, self.download_dir.as_os_str().as_bytes())?;
        store.set_setting(CONNECTIONS, &self.connections.to_string())?;
        match self.speed_limit {
            Some(limit) => store.set_setting(SPEED_LIMIT, &limit.to_string())?,
            None => {
                store.remove_setting(SPEED_LIMIT)?;
            }
        }
        store.set_setting(APPEARANCE, self.appearance.as_str())?;
        if self.excluded_sites.is_empty() {
            store.remove_setting(EXCLUDED_SITES)?;
        } else {
            store.set_setting(EXCLUDED_SITES, &self.excluded_sites.join("\n"))?;
        }
        store.set_setting(CONFIRM_CAPTURES, &self.confirm_captures.to_string())?;
        store.set_setting(MAX_ACTIVE_KEY, &self.max_active.to_string())?;
        match &self.schedule {
            Some(schedule) => store.set_setting(SCHEDULE, &schedule.to_string())?,
            None => {
                store.remove_setting(SCHEDULE)?;
            }
        }
        match &self.slow_hours {
            Some(slow) => {
                store.set_setting(SLOW_HOURS, &format!("{} {}", slow.limit, slow.hours))?;
            }
            None => {
                store.remove_setting(SLOW_HOURS)?;
            }
        }
        if self.saved_views.is_empty() {
            store.remove_setting(SAVED_VIEWS)?;
        } else {
            let lines: Vec<String> = self.saved_views.iter().map(SavedView::line).collect();
            store.set_setting(SAVED_VIEWS, &lines.join("\n"))?;
        }
        Ok(())
    }
}

fn default_download_dir() -> PathBuf {
    dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
        .unwrap_or_else(|| Path::new("/tmp").to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> Settings {
        Settings {
            download_dir: PathBuf::from("/home/u/Downloads"),
            connections: 8,
            speed_limit: None,
            appearance: Appearance::System,
            excluded_sites: Vec::new(),
            confirm_captures: true,
            max_active: 3,
            schedule: None,
            slow_hours: None,
            saved_views: Vec::new(),
        }
    }

    fn sites(entries: &[&str]) -> Settings {
        Settings {
            excluded_sites: entries.iter().map(|&e| e.to_owned()).collect(),
            ..valid()
        }
    }

    fn link(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn a_site_is_its_host_however_it_is_typed() {
        for (typed, host) in [
            ("example.org", "example.org"),
            ("  Example.ORG ", "example.org"),
            ("https://mail.example.org/inbox?x=1", "mail.example.org"),
            ("*.example.org", "example.org"),
            ("example.org:8080/files", "example.org"),
            ("example.org.", "example.org"),
            ("bücher.example", "xn--bcher-kva.example"),
            ("127.0.0.1", "127.0.0.1"),
        ] {
            assert_eq!(site(typed), Ok(host.to_owned()), "{typed}");
        }
        for typed in ["", "   ", "https://", "exa mple.org", "[::1"] {
            assert_eq!(
                site(typed),
                Err(SettingsError::Site(typed.to_owned())),
                "{typed:?}"
            );
        }
    }

    #[test]
    fn a_site_covers_its_subdomains_and_the_pages_on_it() {
        let settings = sites(&["example.org"]);
        assert_eq!(
            settings.excluded_site(&link("https://example.org/a.iso"), None),
            Some("example.org")
        );
        assert_eq!(
            settings.excluded_site(&link("https://cdn.example.org/a.iso"), None),
            Some("example.org")
        );
        assert_eq!(
            settings.excluded_site(
                &link("https://cdn.other.net/a.iso"),
                Some(&link("https://www.example.org/page"))
            ),
            Some("example.org")
        );
        assert_eq!(
            settings.excluded_site(&link("https://example.org./a.iso"), None),
            Some("example.org")
        );
        assert_eq!(
            settings.excluded_site(
                &link("https://cdn.other.net/a.iso"),
                Some(&link("https://www.example.org./page"))
            ),
            Some("example.org")
        );
        assert_eq!(
            settings.excluded_site(&link("https://badexample.org/a.iso"), None),
            None
        );
        assert_eq!(
            settings.excluded_site(&link("https://example.org.evil.net/a.iso"), None),
            None
        );
        assert_eq!(
            sites(&[]).excluded_site(&link("https://example.org/"), None),
            None
        );
    }

    #[test]
    fn downloads_at_once_stay_between_one_and_the_maximum() {
        for max_active in [0, MAX_ACTIVE + 1] {
            assert_eq!(
                Settings {
                    max_active,
                    ..valid()
                }
                .validate(),
                Err(SettingsError::MaxActive(max_active))
            );
        }
        let store = Store::open_in_memory().unwrap();
        store.set_setting(MAX_ACTIVE_KEY, "99").unwrap();
        assert_eq!(
            Settings::load(&store).unwrap().max_active,
            DEFAULT_MAX_ACTIVE
        );
    }

    #[test]
    fn the_slow_hours_take_the_lower_limit_while_they_last() {
        let slow = SlowHours {
            limit: 1 << 20,
            hours: Schedule {
                days: Schedule::EVERY_DAY,
                start: 9 * 60,
                stop: 17 * 60,
            },
        };
        let open = |speed_limit| {
            Settings {
                speed_limit,
                slow_hours: Some(slow),
                ..valid()
            }
            .speed_limit_at(0, 12 * 60)
        };
        assert_eq!(open(None), Some(1 << 20));
        assert_eq!(open(Some(4 << 20)), Some(1 << 20));
        assert_eq!(open(Some(256 << 10)), Some(256 << 10));
        let evening = Settings {
            speed_limit: Some(4 << 20),
            slow_hours: Some(slow),
            ..valid()
        };
        assert_eq!(evening.speed_limit_at(0, 20 * 60), Some(4 << 20));
        assert_eq!(
            Settings {
                slow_hours: Some(SlowHours { limit: 0, ..slow }),
                ..valid()
            }
            .validate(),
            Err(SettingsError::ZeroSpeedLimit)
        );
    }

    fn saved(name: &str, view: &str, query: &str) -> SavedView {
        SavedView {
            name: name.into(),
            view: view.into(),
            query: query.into(),
        }
    }

    #[test]
    fn saved_views_are_plain_one_line_text_and_each_search_once() {
        let with = |views: Vec<SavedView>| {
            Settings {
                saved_views: views,
                ..valid()
            }
            .validate()
        };
        with(vec![
            saved("Linux images", "disk", "fedora iso"),
            saved("fedora", "all", "fedora"),
        ])
        .unwrap();
        for bad in [
            saved(" ", "all", "fedora"),
            saved("fedora", "all", "  "),
            saved("two\nlines", "all", "fedora"),
            saved("fedora", "All", "fedora"),
            saved("fedora", "", "fedora"),
            saved(&"x".repeat(61), "all", "fedora"),
        ] {
            assert_eq!(
                with(vec![bad.clone()]),
                Err(SettingsError::SavedView(bad.name.clone())),
                "{bad:?}"
            );
        }
        assert_eq!(
            with(vec![
                saved("a", "all", "fedora"),
                saved("b", "all", "fedora")
            ]),
            Err(SettingsError::DuplicateView("b".into()))
        );
        assert_eq!(
            with(
                (0..=MAX_SAVED_VIEWS)
                    .map(|n| saved("v", "all", &n.to_string()))
                    .collect()
            ),
            Err(SettingsError::TooManyViews)
        );

        let store = Store::open_in_memory().unwrap();
        store
            .set_setting(
                SAVED_VIEWS,
                "disk\tfedora iso\tLinux images\nbroken\nall\tfedora iso\tagain\ndisk\tfedora iso\ttwice",
            )
            .unwrap();
        assert_eq!(
            Settings::load(&store).unwrap().saved_views,
            vec![
                saved("Linux images", "disk", "fedora iso"),
                saved("again", "all", "fedora iso")
            ]
        );
    }

    #[test]
    fn excluded_sites_must_be_clean_and_once() {
        assert_eq!(
            sites(&["Example.org"]).validate(),
            Err(SettingsError::Site("Example.org".into()))
        );
        assert_eq!(
            sites(&["example.org", "example.org"]).validate(),
            Err(SettingsError::DuplicateSite("example.org".into()))
        );
        sites(&["example.org", "mail.example.net"])
            .validate()
            .unwrap();
    }

    #[test]
    fn defaults_are_valid() {
        let defaults = Settings::default();
        assert_eq!(defaults.connections, DEFAULT_CONNECTIONS);
        assert_eq!(defaults.speed_limit, None);
        defaults.validate().unwrap();
    }

    #[test]
    fn an_unknown_appearance_loads_as_system() {
        let store = Store::open_in_memory().unwrap();
        store.set_setting(APPEARANCE, "sepia").unwrap();
        assert_eq!(
            Settings::load(&store).unwrap().appearance,
            Appearance::System
        );
    }

    #[test]
    fn an_empty_store_loads_the_defaults() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(Settings::load(&store).unwrap(), Settings::default());
    }

    #[test]
    fn saved_settings_load_back_exactly() {
        let store = Store::open_in_memory().unwrap();
        let settings = Settings {
            download_dir: PathBuf::from(OsString::from_vec(
                b"/home/u/t\xe9l\xe9chargements".to_vec(),
            )),
            connections: 16,
            speed_limit: Some(2 << 20),
            appearance: Appearance::Dark,
            excluded_sites: vec!["example.org".into(), "mail.example.net".into()],
            confirm_captures: false,
            max_active: 3,
            schedule: Some(Schedule {
                days: 0b001_1111,
                start: 22 * 60,
                stop: 6 * 60,
            }),
            slow_hours: Some(SlowHours {
                limit: 512 << 10,
                hours: Schedule {
                    days: 0b001_1111,
                    start: 9 * 60,
                    stop: 17 * 60,
                },
            }),
            saved_views: vec![saved("Linux images", "disk", "fedora iso")],
        };
        settings.save(&store).unwrap();
        assert_eq!(Settings::load(&store).unwrap(), settings);

        let unlimited = Settings {
            speed_limit: None,
            excluded_sites: Vec::new(),
            schedule: None,
            slow_hours: None,
            saved_views: Vec::new(),
            ..settings
        };
        unlimited.save(&store).unwrap();
        assert_eq!(Settings::load(&store).unwrap(), unlimited);
    }

    #[test]
    fn unreadable_values_fall_back_to_the_defaults() {
        let store = Store::open_in_memory().unwrap();
        store.set_setting(CONNECTIONS, "lots").unwrap();
        store.set_setting(SPEED_LIMIT, "0").unwrap();
        store
            .set_setting(EXCLUDED_SITES, "example.org\nNot A Site\nexample.org")
            .unwrap();
        store.set_setting(CONFIRM_CAPTURES, "sometimes").unwrap();
        store.set_setting(SCHEDULE, "0 60 420").unwrap();
        store.set_setting(SLOW_HOURS, "0 127 540 1020").unwrap();
        let loaded = Settings::load(&store).unwrap();
        assert_eq!((loaded.schedule, loaded.slow_hours), (None, None));
        assert_eq!(loaded.excluded_sites, vec!["example.org".to_owned()]);
        assert!(loaded.confirm_captures);
        assert_eq!(
            (loaded.connections, loaded.speed_limit),
            (DEFAULT_CONNECTIONS, None)
        );
    }

    #[test]
    fn validation_names_what_is_wrong() {
        for connections in [0, MAX_CONNECTIONS + 1] {
            assert_eq!(
                Settings {
                    connections,
                    ..valid()
                }
                .validate(),
                Err(SettingsError::Connections(connections))
            );
        }
        assert_eq!(
            Settings {
                speed_limit: Some(0),
                ..valid()
            }
            .validate(),
            Err(SettingsError::ZeroSpeedLimit)
        );
        assert_eq!(
            Settings {
                download_dir: PathBuf::from("Downloads"),
                ..valid()
            }
            .validate(),
            Err(SettingsError::RelativeDir(PathBuf::from("Downloads")))
        );
        valid().validate().unwrap();
    }
}
