use std::io;
use std::path::Path;

// The bytes free for this user in the file system that holds `path`. A folder
// that isn't there yet counts as the nearest one above it that is.
pub fn free_space(path: &Path) -> io::Result<u64> {
    let there = path
        .ancestors()
        .find(|dir| dir.exists())
        .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
    let stats = rustix::fs::statvfs(there)?;
    Ok(stats.f_bavail.saturating_mul(stats.f_frsize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_and_one_not_yet_made_count_the_same_disk() {
        let dir = tempfile::tempdir().unwrap();
        let free = free_space(dir.path()).unwrap();
        assert!(free > 0);
        let later = dir.path().join("not").join("yet");
        let again = free_space(&later).unwrap();
        assert!(again.abs_diff(free) < 64 << 20, "{free} then {again}");
    }
}
