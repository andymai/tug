#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Category {
    Video,
    Audio,
    Image,
    Document,
    Archive,
    Program,
    DiskImage,
    Other,
}

const VIDEO: &[&str] = &[
    "3gp", "avi", "flv", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "ogv", "webm",
    "wmv",
];
const AUDIO: &[&str] = &[
    "aac", "aiff", "alac", "ape", "flac", "m4a", "mka", "mp3", "oga", "ogg", "opus", "wav", "wma",
];
const IMAGE: &[&str] = &[
    "avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "jxl", "png", "psd", "svg", "tif",
    "tiff", "webp", "xcf",
];
const DOCUMENT: &[&str] = &[
    "azw3", "csv", "djvu", "doc", "docx", "epub", "md", "mobi", "odp", "ods", "odt", "pdf", "ppt",
    "pptx", "rtf", "txt", "xls", "xlsx",
];
const ARCHIVE: &[&str] = &[
    "7z", "bz2", "cab", "gz", "lz", "lz4", "lzma", "rar", "tar", "tbz2", "tgz", "txz", "tzst",
    "xz", "zip", "zst",
];
const PROGRAM: &[&str] = &[
    "apk",
    "appimage",
    "deb",
    "exe",
    "flatpak",
    "flatpakref",
    "jar",
    "msi",
    "rpm",
    "run",
    "sh",
    "snap",
];
const DISK_IMAGE: &[&str] = &["dmg", "img", "iso", "qcow2", "vdi", "vhd", "vhdx", "vmdk"];

impl Category {
    pub const ALL: [Self; 8] = [
        Self::Video,
        Self::Audio,
        Self::Image,
        Self::Document,
        Self::Archive,
        Self::Program,
        Self::DiskImage,
        Self::Other,
    ];

    pub fn of(name: &str) -> Self {
        let Some((_, extension)) = name.rsplit_once('.') else {
            return Self::Other;
        };
        let extension = extension.to_lowercase();
        [
            (VIDEO, Self::Video),
            (AUDIO, Self::Audio),
            (IMAGE, Self::Image),
            (DOCUMENT, Self::Document),
            (ARCHIVE, Self::Archive),
            (PROGRAM, Self::Program),
            (DISK_IMAGE, Self::DiskImage),
        ]
        .into_iter()
        .find(|(extensions, _)| extensions.contains(&extension.as_str()))
        .map_or(Self::Other, |(_, category)| category)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_takes_the_type_of_its_last_extension_in_any_case() {
        for (name, category) in [
            ("fedora-kde-44-x86_64.iso", Category::DiskImage),
            ("blender-5.1-linux-x64.tar.xz", Category::Archive),
            ("conference-talk-1080p.MP4", Category::Video),
            ("Tug-0.23.0-x86_64.AppImage", Category::Program),
            ("album.flac", Category::Audio),
            ("scan.HEIC", Category::Image),
            ("report.pdf", Category::Document),
            ("dataset-shard-07.parquet", Category::Other),
            ("README", Category::Other),
            (".bashrc", Category::Other),
            ("archive.", Category::Other),
        ] {
            assert_eq!(Category::of(name), category, "{name}");
        }
    }

    #[test]
    fn no_extension_belongs_to_two_types() {
        let lists = [VIDEO, AUDIO, IMAGE, DOCUMENT, ARCHIVE, PROGRAM, DISK_IMAGE];
        let mut seen = std::collections::HashSet::new();
        for extension in lists.iter().flat_map(|list| list.iter()) {
            assert!(seen.insert(extension), "{extension} is in two lists");
            assert_eq!(extension.to_lowercase(), **extension);
        }
    }
}
