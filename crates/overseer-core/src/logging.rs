//! Thread-safe logging utilities.
//!
//! Provides simple, portable logging to files with timestamps.

use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::Path,
    sync::{Arc, Mutex},
};

/// Thread-safe handle to an append-only log file.
pub type LogHandle = Arc<Mutex<Option<File>>>;

/// Format current UTC time as ISO 8601 with milliseconds (e.g. 2026-02-04T10:15:30.123Z).
fn utc_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_secs = dur.as_secs();
    let millis = dur.subsec_millis();
    // Break total_secs into date/time components
    let days = total_secs / 86400;
    let time_secs = total_secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;
    // Convert days since epoch to y-m-d (civil calendar)
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m, d, hours, minutes, seconds, millis
    )
}

/// Convert days since Unix epoch to (year, month, day). Algorithm from Howard Hinnant.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Write a timestamped line to the log file (if present).
pub fn log_line(handle: &LogHandle, direction: &str, data: &str) {
    if let Ok(mut guard) = handle.lock() {
        if let Some(ref mut file) = *guard {
            let ts = utc_timestamp();
            let _ = writeln!(file, "[{}] {}: {}", ts, direction, data);
            let _ = file.flush();
        }
    }
}

/// Open (or create) a log file at `{log_dir}/{log_id}.log` and return a shared handle.
pub fn open_log_file(log_dir: Option<&str>, log_id: &str) -> LogHandle {
    let file = log_dir.and_then(|dir| {
        let path = Path::new(dir).join(format!("{}.log", log_id));
        std::fs::create_dir_all(dir).ok()?;
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()
    });
    Arc::new(Mutex::new(file))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use tempfile::tempdir;

    #[test]
    fn utc_timestamp_format() {
        let ts = utc_timestamp();
        // Should be ISO 8601 format: YYYY-MM-DDTHH:MM:SS.mmmZ
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.len(), 24);
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], "T");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
        assert_eq!(&ts[19..20], ".");
    }

    #[test]
    fn civil_from_days_epoch() {
        // Day 0 is 1970-01-01
        let (y, m, d) = civil_from_days(0);
        assert_eq!((y, m, d), (1970, 1, 1));
    }

    #[test]
    fn civil_from_days_known_date() {
        // 2000-01-01 is day 10957 since epoch
        let (y, m, d) = civil_from_days(10957);
        assert_eq!((y, m, d), (2000, 1, 1));
    }

    #[test]
    fn open_log_file_creates_file() {
        let dir = tempdir().unwrap();
        let log_dir = dir.path().to_str().unwrap();

        let handle = open_log_file(Some(log_dir), "test");
        assert!(handle.lock().unwrap().is_some());

        let log_path = dir.path().join("test.log");
        assert!(log_path.exists());
    }

    #[test]
    fn open_log_file_none_dir() {
        let handle = open_log_file(None, "test");
        assert!(handle.lock().unwrap().is_none());
    }

    #[test]
    fn log_line_writes_to_file() {
        let dir = tempdir().unwrap();
        let log_dir = dir.path().to_str().unwrap();

        let handle = open_log_file(Some(log_dir), "test");
        log_line(&handle, "STDIN", "hello world");

        // Read the file contents
        let log_path = dir.path().join("test.log");
        let mut contents = String::new();
        File::open(&log_path)
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();

        assert!(contents.contains("STDIN: hello world"));
        assert!(contents.contains("T")); // ISO timestamp
        assert!(contents.contains("Z")); // UTC marker
    }

    #[test]
    fn log_line_handles_none_file() {
        let handle: LogHandle = Arc::new(Mutex::new(None));
        // Should not panic
        log_line(&handle, "STDIN", "test");
    }
}
