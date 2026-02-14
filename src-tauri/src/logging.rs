use std::{
    fs::{File, OpenOptions},
    io::Write,
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
pub fn open_log_file(log_dir: &Option<String>, log_id: &str) -> LogHandle {
    let file = log_dir.as_ref().and_then(|dir| {
        let path = std::path::Path::new(dir).join(format!("{}.log", log_id));
        std::fs::create_dir_all(dir).ok()?;
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()
    });
    Arc::new(Mutex::new(file))
}
