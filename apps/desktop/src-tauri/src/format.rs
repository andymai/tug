#[allow(
    clippy::cast_precision_loss,
    reason = "a size shown with three significant figures"
)]
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 999.5 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        return format!("{value:.0} B");
    }
    let digits = if value >= 99.95 {
        0
    } else if value >= 9.995 {
        1
    } else {
        2
    };
    format!("{value:.digits$} {}", UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1 << 20;

    #[test]
    fn sizes_read_as_the_window_shows_them() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(412 * MB), "412 MB");
        assert_eq!(format_bytes(18 * MB + 400 * 1024), "18.4 MB");
        assert_eq!(format_bytes(4 * 1024 * MB + 205 * MB), "4.20 GB");
    }
}
