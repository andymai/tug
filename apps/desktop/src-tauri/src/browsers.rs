use std::fmt;
use std::fs::{self, OpenOptions, Permissions};
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{Map, Value};

pub const HOST_NAME: &str = "io.github.andymai.tug";
const CHROMIUM_ORIGINS: &[&str] = &["chrome-extension://adkjolghaomejbdpmjgloncdniplghfg/"];
const FIREFOX_EXTENSIONS: &[&str] = &["tug@andymai.github.io"];
const FIREFOX_FLATPAK: &str = "org.mozilla.firefox";

const CHROMIUM: &[(&str, &str, &str)] = &[
    ("Google Chrome", "google-chrome", "com.google.Chrome"),
    ("Chromium", "chromium", "org.chromium.Chromium"),
    ("Brave", "BraveSoftware/Brave-Browser", "com.brave.Browser"),
    ("Vivaldi", "vivaldi", "com.vivaldi.Vivaldi"),
    ("Microsoft Edge", "microsoft-edge", "com.microsoft.Edge"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Family {
    Chromium,
    Firefox,
}

#[derive(Debug)]
struct Target {
    name: String,
    family: Family,
    markers: Vec<PathBuf>,
    manifests: PathBuf,
    flatpak: Option<(&'static str, PathBuf)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Registered,
    NeedsPermission { app: String },
    Failed(String),
}

impl fmt::Display for Status {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Registered => f.write_str("Registered"),
            Self::NeedsPermission { app } => write!(
                f,
                "Needs permission to reach Tug outside its sandbox: flatpak override --user --talk-name=org.freedesktop.Flatpak {app}"
            ),
            Self::Failed(reason) => write!(f, "Failed: {reason}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub browser: String,
    pub status: Status,
}

#[derive(Debug, Clone)]
pub struct Places {
    pub home: PathBuf,
    pub config: PathBuf,
}

impl Places {
    pub fn from_env() -> Option<Self> {
        let absolute = |name: &str| {
            std::env::var_os(name)
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
        };
        let home = absolute("HOME")?;
        let config = absolute("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config"));
        Some(Self { home, config })
    }
}

fn targets(places: &Places) -> Vec<Target> {
    let mut all = Vec::new();
    for &(name, dir, app) in CHROMIUM {
        let native = places.config.join(dir);
        all.push(Target {
            name: name.into(),
            family: Family::Chromium,
            markers: vec![native.join("Local State")],
            manifests: native.join("NativeMessagingHosts"),
            flatpak: None,
        });
        let sandbox = places.home.join(".var").join("app").join(app);
        let config = sandbox.join("config").join(dir);
        all.push(Target {
            name: format!("{name} (Flatpak)"),
            family: Family::Chromium,
            markers: vec![config.join("Local State")],
            manifests: config.join("NativeMessagingHosts"),
            flatpak: Some((app, sandbox)),
        });
    }
    let profiles = |base: &Path| base.join("firefox").join("profiles.ini");
    all.push(Target {
        name: "Firefox".into(),
        family: Family::Firefox,
        markers: vec![
            profiles(&places.home.join(".mozilla")),
            profiles(&places.config.join("mozilla")),
        ],
        manifests: places.home.join(".mozilla").join("native-messaging-hosts"),
        flatpak: None,
    });
    let sandbox = places.home.join(".var").join("app").join(FIREFOX_FLATPAK);
    all.push(Target {
        name: "Firefox (Flatpak)".into(),
        family: Family::Firefox,
        markers: vec![
            profiles(&sandbox.join(".mozilla")),
            profiles(&sandbox.join("config").join("mozilla")),
        ],
        manifests: sandbox.join(".mozilla").join("native-messaging-hosts"),
        flatpak: Some((FIREFOX_FLATPAK, sandbox)),
    });
    all
}

pub fn host_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("couldn't find tug: {e}"))?;
    let host = exe
        .parent()
        .ok_or("couldn't find tug's folder")?
        .join("tug-host");
    if host.is_file() {
        Ok(host)
    } else {
        Err(format!("tug-host isn't next to tug at {}", host.display()))
    }
}

pub fn flatpak_permission(app: &str) -> Option<bool> {
    let output = Command::new("flatpak")
        .args(["info", "--show-permissions", app])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| talks(&String::from_utf8_lossy(&output.stdout)))
}

fn talks(permissions: &str) -> bool {
    permissions.lines().any(|line| {
        matches!(
            line.trim(),
            "org.freedesktop.Flatpak=talk" | "org.freedesktop.Flatpak=own"
        )
    })
}

pub fn register(
    places: &Places,
    host: &Path,
    permission: &dyn Fn(&str) -> Option<bool>,
) -> Vec<Report> {
    targets(places)
        .into_iter()
        .filter(|target| target.markers.iter().any(|marker| marker.is_file()))
        .filter_map(|target| {
            let status = match &target.flatpak {
                None => install(&target, host),
                Some((app, sandbox)) => match permission(app) {
                    None => return None,
                    Some(false) => Status::NeedsPermission {
                        app: (*app).to_owned(),
                    },
                    Some(true) => bridge(&target, sandbox, host),
                },
            };
            Some(Report {
                browser: target.name,
                status,
            })
        })
        .collect()
}

fn install(target: &Target, path: &Path) -> Status {
    let Some(path) = path.to_str() else {
        return Status::Failed(format!("{} isn't valid UTF-8", path.display()));
    };
    let file = target.manifests.join(format!("{HOST_NAME}.json"));
    match write_file(&file, &manifest(target.family, path), 0o644) {
        Ok(()) => Status::Registered,
        Err(e) => Status::Failed(format!("couldn't write {}: {e}", file.display())),
    }
}

fn bridge(target: &Target, sandbox: &Path, host: &Path) -> Status {
    let Some(host_text) = host.to_str() else {
        return Status::Failed(format!("{} isn't valid UTF-8", host.display()));
    };
    let wrapper = sandbox.join("data").join(tug_ipc::APP_ID).join("tug-host");
    let script = format!(
        "#!/bin/sh\nexec flatpak-spawn --host --env=XDG_RUNTIME_DIR=\"$XDG_RUNTIME_DIR\" {} \"$@\"\n",
        quoted(host_text)
    );
    match write_file(&wrapper, script.as_bytes(), 0o755) {
        Ok(()) => install(target, &wrapper),
        Err(e) => Status::Failed(format!("couldn't write {}: {e}", wrapper.display())),
    }
}

fn quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

fn manifest(family: Family, path: &str) -> Vec<u8> {
    let mut fields = Map::new();
    fields.insert("name".into(), HOST_NAME.into());
    fields.insert("description".into(), "Tug".into());
    fields.insert("path".into(), path.into());
    fields.insert("type".into(), "stdio".into());
    let (key, allowed) = match family {
        Family::Chromium => ("allowed_origins", CHROMIUM_ORIGINS),
        Family::Firefox => ("allowed_extensions", FIREFOX_EXTENSIONS),
    };
    fields.insert(key.into(), allowed.into());
    let mut bytes = serde_json::to_vec_pretty(&Value::Object(fields)).unwrap_or_default();
    bytes.push(b'\n');
    bytes
}

fn write_file(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    if fs::read(path).is_ok_and(|old| old == bytes) {
        return fs::set_permissions(path, Permissions::from_mode(mode));
    }
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(io::ErrorKind::InvalidInput.into());
    };
    fs::create_dir_all(dir)?;
    let mut staged = name.to_os_string();
    staged.push(".new");
    let staged = dir.join(staged);
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(&staged)?;
    file.write_all(bytes)?;
    file.set_permissions(Permissions::from_mode(mode))?;
    drop(file);
    fs::rename(&staged, path)
}

pub fn register_everywhere() -> Result<Vec<Report>, String> {
    let places = Places::from_env().ok_or("HOME is not set")?;
    let host = host_path()?;
    Ok(register(&places, &host, &flatpak_permission))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::os::unix::fs::MetadataExt;

    use super::*;

    fn places() -> (tempfile::TempDir, Places) {
        let dir = tempfile::tempdir().unwrap();
        let places = Places {
            home: dir.path().join("home"),
            config: dir.path().join("home").join(".config"),
        };
        (dir, places)
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "").unwrap();
    }

    fn read(path: &Path) -> Value {
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }

    fn report(browser: &str, status: Status) -> Report {
        Report {
            browser: browser.into(),
            status,
        }
    }

    const HOST: &str = "/opt/tug/tug-host";

    #[test]
    fn a_browser_that_never_ran_is_left_alone() {
        let (_dir, places) = places();
        fs::create_dir_all(places.config.join("chromium").join("NativeMessagingHosts")).unwrap();
        fs::create_dir_all(places.home.join(".mozilla").join("native-messaging-hosts")).unwrap();
        assert_eq!(
            register(&places, Path::new(HOST), &|_| Some(true)),
            Vec::new()
        );
        assert!(
            fs::read_dir(places.config.join("chromium").join("NativeMessagingHosts"))
                .unwrap()
                .next()
                .is_none()
        );
    }

    #[test]
    fn native_browsers_point_at_the_host() {
        let (_dir, places) = places();
        touch(&places.config.join("google-chrome").join("Local State"));
        touch(
            &places
                .config
                .join("BraveSoftware")
                .join("Brave-Browser")
                .join("Local State"),
        );
        touch(
            &places
                .config
                .join("mozilla")
                .join("firefox")
                .join("profiles.ini"),
        );

        assert_eq!(
            register(&places, Path::new(HOST), &|_| None),
            vec![
                report("Google Chrome", Status::Registered),
                report("Brave", Status::Registered),
                report("Firefox", Status::Registered),
            ]
        );
        let chrome = read(
            &places
                .config
                .join("google-chrome")
                .join("NativeMessagingHosts")
                .join("io.github.andymai.tug.json"),
        );
        assert_eq!(
            chrome,
            serde_json::json!({
                "name": "io.github.andymai.tug",
                "description": "Tug",
                "path": HOST,
                "type": "stdio",
                "allowed_origins": ["chrome-extension://adkjolghaomejbdpmjgloncdniplghfg/"],
            })
        );
        let firefox = read(
            &places
                .home
                .join(".mozilla")
                .join("native-messaging-hosts")
                .join("io.github.andymai.tug.json"),
        );
        assert_eq!(firefox["path"], HOST);
        assert_eq!(
            firefox["allowed_extensions"],
            serde_json::json!(["tug@andymai.github.io"])
        );
        assert!(firefox.get("allowed_origins").is_none());
    }

    #[test]
    fn a_flatpak_browser_that_may_reach_the_host_gets_a_bridge() {
        let (_dir, places) = places();
        let sandbox = places
            .home
            .join(".var")
            .join("app")
            .join("com.google.Chrome");
        touch(
            &sandbox
                .join("config")
                .join("google-chrome")
                .join("Local State"),
        );

        let asked = std::cell::RefCell::new(Vec::new());
        let reports = register(&places, Path::new(HOST), &|app| {
            asked.borrow_mut().push(app.to_owned());
            Some(true)
        });
        assert_eq!(
            reports,
            vec![report("Google Chrome (Flatpak)", Status::Registered)]
        );
        assert_eq!(asked.into_inner(), vec!["com.google.Chrome".to_owned()]);

        let wrapper = sandbox
            .join("data")
            .join("io.github.andymai.Tug")
            .join("tug-host");
        assert_eq!(
            fs::read_to_string(&wrapper).unwrap(),
            "#!/bin/sh\nexec flatpak-spawn --host --env=XDG_RUNTIME_DIR=\"$XDG_RUNTIME_DIR\" '/opt/tug/tug-host' \"$@\"\n"
        );
        assert_eq!(fs::metadata(&wrapper).unwrap().mode() & 0o777, 0o755);
        let manifest = read(
            &sandbox
                .join("config")
                .join("google-chrome")
                .join("NativeMessagingHosts")
                .join("io.github.andymai.tug.json"),
        );
        assert_eq!(manifest["path"], wrapper.to_str().unwrap());
    }

    #[test]
    fn a_flatpak_browser_without_permission_gets_the_command_and_no_files() {
        let (_dir, places) = places();
        let sandbox = places.home.join(".var").join("app").join(FIREFOX_FLATPAK);
        touch(
            &sandbox
                .join(".mozilla")
                .join("firefox")
                .join("profiles.ini"),
        );
        touch(
            &places
                .home
                .join(".var")
                .join("app")
                .join("com.vivaldi.Vivaldi")
                .join("config")
                .join("vivaldi")
                .join("Local State"),
        );

        let reports = register(&places, Path::new(HOST), &|app| {
            (app == FIREFOX_FLATPAK).then_some(false)
        });
        assert_eq!(
            reports,
            vec![report(
                "Firefox (Flatpak)",
                Status::NeedsPermission {
                    app: FIREFOX_FLATPAK.into()
                }
            )]
        );
        assert!(
            !sandbox
                .join(".mozilla")
                .join("native-messaging-hosts")
                .exists()
        );
        assert!(!sandbox.join("data").exists());
        assert!(reports[0].status.to_string().ends_with(
            "flatpak override --user --talk-name=org.freedesktop.Flatpak org.mozilla.firefox"
        ));
    }

    #[test]
    fn an_unchanged_manifest_is_not_rewritten_and_a_changed_one_is() {
        let (_dir, places) = places();
        touch(&places.config.join("chromium").join("Local State"));
        let file = places
            .config
            .join("chromium")
            .join("NativeMessagingHosts")
            .join("io.github.andymai.tug.json");

        register(&places, Path::new(HOST), &|_| None);
        let first = fs::metadata(&file).unwrap().ino();
        register(&places, Path::new(HOST), &|_| None);
        assert_eq!(fs::metadata(&file).unwrap().ino(), first);

        register(&places, Path::new("/usr/bin/tug-host"), &|_| None);
        assert_eq!(read(&file)["path"], "/usr/bin/tug-host");
        assert_eq!(fs::metadata(&file).unwrap().mode() & 0o777, 0o644);
        assert!(
            !file
                .with_file_name("io.github.andymai.tug.json.new")
                .exists()
        );
    }

    #[test]
    fn quoting_survives_the_shell() {
        let path = "/home/o'brien/tug $HOME/`x`/tug-host";
        let output = Command::new("sh")
            .args(["-c", &format!("printf %s {}", quoted(path))])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8(output.stdout).unwrap(), path);
    }

    #[test]
    fn only_a_talk_or_own_rule_counts_as_permission() {
        let listed = |rule: &str| {
            format!(
                "[Context]\nshared=network;ipc;\n\n[Session Bus Policy]\norg.kde.StatusNotifierWatcher=talk\n{rule}\n"
            )
        };
        assert!(talks(&listed("org.freedesktop.Flatpak=talk")));
        assert!(talks(&listed("org.freedesktop.Flatpak=own")));
        assert!(!talks(&listed("org.freedesktop.Flatpak=none")));
        assert!(!talks(&listed("org.freedesktop.Flatpak.Foo=talk")));
    }
}
