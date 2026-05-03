use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_BACKUP_FILES_PER_SOURCE: usize = 30;
const DEFAULT_BACKUP_INTERVAL_MINUTES: u64 = 0;
const MAX_BACKUP_INTERVAL_MINUTES: u64 = 60 * 24 * 30;

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn backup_dir_for(path: &Path) -> Option<PathBuf> {
    path.parent().map(|parent| parent.join("backups"))
}

fn backup_prefix_for(path: &Path) -> Option<String> {
    path.file_stem()
        .map(OsStr::to_string_lossy)
        .map(|stem| format!("{stem}.backup."))
}

fn backup_file_name_for(path: &Path, timestamp_millis: u128) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    let extension = path.extension().map(OsStr::to_string_lossy);

    Some(match extension {
        Some(extension) if !extension.is_empty() => {
            format!("{stem}.backup.{timestamp_millis}.{extension}")
        }
        _ => format!("{stem}.backup.{timestamp_millis}.bak"),
    })
}

fn sorted_backups_for(path: &Path) -> Vec<PathBuf> {
    let Some(backup_dir) = backup_dir_for(path) else {
        return vec![];
    };
    let Some(prefix) = backup_prefix_for(path) else {
        return vec![];
    };

    let Ok(entries) = fs::read_dir(&backup_dir) else {
        return vec![];
    };

    let mut files = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|entry_path| {
            entry_path
                .file_name()
                .and_then(OsStr::to_str)
                .map(|name| name.starts_with(&prefix))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    files.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    files
}

fn prune_old_backups(path: &Path) {
    let backups = sorted_backups_for(path);
    if backups.len() <= MAX_BACKUP_FILES_PER_SOURCE {
        return;
    }

    for stale_file in backups.into_iter().skip(MAX_BACKUP_FILES_PER_SOURCE) {
        if let Err(error) = fs::remove_file(&stale_file) {
            eprintln!(
                "[storage] Failed to prune backup file {}: {}",
                stale_file.display(),
                error
            );
        }
    }
}

fn resolve_settings_backup_interval_minutes(raw: &serde_json::Value) -> Option<u64> {
    if let Some(minutes) = raw.get("desktopBackupIntervalMinutes").and_then(serde_json::Value::as_u64) {
        return Some(minutes.min(MAX_BACKUP_INTERVAL_MINUTES));
    }

    raw.get("desktopBackupIntervalMinutes")
        .and_then(serde_json::Value::as_f64)
        .map(|value| {
            if !value.is_finite() || value < 0.0 {
                DEFAULT_BACKUP_INTERVAL_MINUTES
            } else {
                value.round() as u64
            }
        })
        .map(|minutes| minutes.min(MAX_BACKUP_INTERVAL_MINUTES))
}

pub fn load_backup_interval_minutes(app_handle: &tauri::AppHandle) -> u64 {
    let Ok(settings_path) = crate::utils::paths::settings_path(app_handle) else {
        return DEFAULT_BACKUP_INTERVAL_MINUTES;
    };

    let Ok(raw) = fs::read_to_string(settings_path) else {
        return DEFAULT_BACKUP_INTERVAL_MINUTES;
    };

    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return DEFAULT_BACKUP_INTERVAL_MINUTES;
    };

    resolve_settings_backup_interval_minutes(&parsed).unwrap_or(DEFAULT_BACKUP_INTERVAL_MINUTES)
}

fn has_recent_backup(path: &Path, min_interval_minutes: u64) -> bool {
    if min_interval_minutes == 0 {
        return false;
    }

    let Some(latest_backup_path) = sorted_backups_for(path).into_iter().next() else {
        return false;
    };

    let Ok(metadata) = fs::metadata(latest_backup_path) else {
        return false;
    };
    let Ok(modified_at) = metadata.modified() else {
        return false;
    };
    let Ok(elapsed) = SystemTime::now().duration_since(modified_at) else {
        return false;
    };

    elapsed < Duration::from_secs(min_interval_minutes.saturating_mul(60))
}

fn create_backup_snapshot_if_needed(path: &Path, min_interval_minutes: u64) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if has_recent_backup(path, min_interval_minutes) {
        return Ok(());
    }

    let Some(backup_dir) = backup_dir_for(path) else {
        return Ok(());
    };
    let Some(backup_name) = backup_file_name_for(path, now_millis()) else {
        return Ok(());
    };

    fs::create_dir_all(&backup_dir)
        .map_err(|_| format!("Could not create backup directory: {}", backup_dir.display()))?;

    let destination = backup_dir.join(backup_name);
    fs::copy(path, &destination)
        .map_err(|_| format!("Could not create backup snapshot for {}.", path.display()))?;

    prune_old_backups(path);
    Ok(())
}

pub fn write_json_with_backup(
    path: &Path,
    raw_json: &str,
    label: &str,
    min_backup_interval_minutes: u64,
) -> Result<(), String> {
    if let Ok(existing_raw) = fs::read_to_string(path) {
        if existing_raw == raw_json {
            return Ok(());
        }
    }

    create_backup_snapshot_if_needed(path, min_backup_interval_minutes)?;

    fs::write(path, raw_json).map_err(|_| format!("Could not save {}.", label))
}

pub fn try_read_latest_backup(path: &Path) -> Option<String> {
    let backups = sorted_backups_for(path);
    for backup_path in backups {
        match fs::read_to_string(&backup_path) {
            Ok(contents) => return Some(contents),
            Err(error) => {
                eprintln!(
                    "[storage] Failed to read backup file {}: {}",
                    backup_path.display(),
                    error
                );
            }
        }
    }

    None
}
