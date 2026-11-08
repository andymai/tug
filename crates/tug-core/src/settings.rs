use std::ffi::OsString;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use mdm_engine::download::MAX_CONNECTIONS;

use crate::store::{Store, StoreError};

pub const DEFAULT_CONNECTIONS: u32 = 8;

const DOWNLOAD_DIR: &str = "download_dir";
const CONNECTIONS: &str = "connections";
const SPEED_LIMIT: &str = "speed_limit";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub download_dir: PathBuf,
    pub connections: u32,
    pub speed_limit: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SettingsError {
    #[error("connections must be between 1 and {MAX_CONNECTIONS}, not {0}")]
    Connections(u32),
    #[error("a speed limit must be above zero")]
    ZeroSpeedLimit,
    #[error("the download folder must be an absolute path, not {}", .0.display())]
    RelativeDir(PathBuf),
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: default_download_dir(),
            connections: DEFAULT_CONNECTIONS,
            speed_limit: None,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), SettingsError> {
        if !(1..=MAX_CONNECTIONS).contains(&self.connections) {
            return Err(SettingsError::Connections(self.connections));
        }
        if self.speed_limit == Some(0) {
            return Err(SettingsError::ZeroSpeedLimit);
        }
        if !self.download_dir.is_absolute() {
            return Err(SettingsError::RelativeDir(self.download_dir.clone()));
        }
        Ok(())
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
        Ok(Self {
            download_dir,
            connections,
            speed_limit,
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
        }
    }

    #[test]
    fn defaults_are_valid() {
        let defaults = Settings::default();
        assert_eq!(defaults.connections, DEFAULT_CONNECTIONS);
        assert_eq!(defaults.speed_limit, None);
        defaults.validate().unwrap();
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
        };
        settings.save(&store).unwrap();
        assert_eq!(Settings::load(&store).unwrap(), settings);

        let unlimited = Settings {
            speed_limit: None,
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
        let loaded = Settings::load(&store).unwrap();
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
