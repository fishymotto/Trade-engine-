use std::fs;

use serde_json::Value;

use crate::utils::paths::{library_pages_path, playbooks_path, trade_reviews_path};
use crate::utils::storage::{load_backup_interval_minutes, try_read_latest_backup, write_json_with_backup};

const LOSSY_DROP_RATIO: usize = 35;
const ROW_DROP_THRESHOLD_PERCENT: usize = 80;
struct ValueCounts {
    rows: usize,
    serialized_size: usize,
}

fn rows_from_value(value: &Value) -> Vec<&Value> {
    if let Some(rows) = value.as_array() {
        return rows.iter().collect();
    }

    value
        .get("value")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().collect())
        .unwrap_or_default()
}

fn parse_json(raw: &str) -> Result<Value, serde_json::Error> {
    serde_json::from_str(raw.trim_start_matches('\u{feff}'))
}

fn serialized_size(value: &Value) -> usize {
    serde_json::to_string(value).map(|raw| raw.len()).unwrap_or(0)
}

fn counts_for_value(value: &Value) -> ValueCounts {
    ValueCounts {
        rows: rows_from_value(value).len(),
        serialized_size: serialized_size(value),
    }
}

fn extract_max_timestamp(value: &Value) -> Option<String> {
    match value {
        Value::Array(entries) => entries.iter().filter_map(extract_max_timestamp).max(),
        Value::Object(record) => {
            let own = ["updatedAt", "updated_at", "createdAt", "created_at"]
                .iter()
                .filter_map(|key| record.get(*key))
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .max();

            let nested = record.values().filter_map(extract_max_timestamp).max();
            own.into_iter().chain(nested).max()
        }
        _ => None,
    }
}

fn should_skip_lossy_write(candidate: &Value, existing: &Value) -> bool {
    let existing_counts = counts_for_value(existing);
    if existing_counts.rows < 10 && existing_counts.serialized_size < 25_000 {
        return false;
    }

    let candidate_counts = counts_for_value(candidate);
    let is_large_row_drop = existing_counts.rows > 0
        && candidate_counts.rows.saturating_mul(100) < existing_counts.rows.saturating_mul(ROW_DROP_THRESHOLD_PERCENT);
    let is_large_size_drop = existing_counts.serialized_size > 0
        && candidate_counts.serialized_size.saturating_mul(100)
            < existing_counts.serialized_size.saturating_mul(LOSSY_DROP_RATIO);

    if !is_large_row_drop && !is_large_size_drop {
        return false;
    }

    let existing_ts = extract_max_timestamp(existing);
    let candidate_ts = extract_max_timestamp(candidate);
    let has_newer_timestamp = matches!(
        (candidate_ts.as_deref(), existing_ts.as_deref()),
        (Some(candidate), Some(existing)) if candidate > existing
    );

    !has_newer_timestamp
}

fn load_json_file(path: std::path::PathBuf, label: &str) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }

    let raw = fs::read_to_string(&path).map_err(|_| format!("Could not read saved {}.", label))?;
    match parse_json(&raw) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            if let Some(backup_raw) = try_read_latest_backup(&path) {
                if let Ok(backup_parsed) = parse_json(&backup_raw) {
                    eprintln!("[workspace] Loaded {} from latest backup snapshot.", label);
                    return Ok(backup_parsed);
                }
            }

            Err(format!("Could not parse saved {}.", label))
        }
    }
}

fn save_json_file(
    path: std::path::PathBuf,
    label: &str,
    value: Value,
    backup_interval_minutes: u64,
) -> Result<(), String> {
    if path.exists() {
        let existing_raw = fs::read_to_string(&path).map_err(|_| format!("Could not read saved {}.", label))?;
        if let Ok(existing) = parse_json(&existing_raw) {
            if should_skip_lossy_write(&value, &existing) {
                let candidate_counts = counts_for_value(&value);
                let existing_counts = counts_for_value(&existing);
                eprintln!(
                    "[workspace] Skipped lossy {} write: candidate_rows={} candidate_size={} existing_rows={} existing_size={}",
                    label,
                    candidate_counts.rows,
                    candidate_counts.serialized_size,
                    existing_counts.rows,
                    existing_counts.serialized_size
                );
                return Ok(());
            }
        }
    }

    let raw = serde_json::to_string_pretty(&value).map_err(|_| format!("Could not serialize {}.", label))?;
    write_json_with_backup(&path, &raw, label, backup_interval_minutes)
}

#[tauri::command]
pub fn load_library_pages(app_handle: tauri::AppHandle) -> Result<Value, String> {
    load_json_file(library_pages_path(&app_handle)?, "library pages")
}

#[tauri::command]
pub fn save_library_pages(app_handle: tauri::AppHandle, pages: Value) -> Result<(), String> {
    save_json_file(
        library_pages_path(&app_handle)?,
        "library pages",
        pages,
        load_backup_interval_minutes(&app_handle),
    )
}

#[tauri::command]
pub fn load_playbooks(app_handle: tauri::AppHandle) -> Result<Value, String> {
    load_json_file(playbooks_path(&app_handle)?, "playbooks")
}

#[tauri::command]
pub fn save_playbooks(app_handle: tauri::AppHandle, playbooks: Value) -> Result<(), String> {
    save_json_file(
        playbooks_path(&app_handle)?,
        "playbooks",
        playbooks,
        load_backup_interval_minutes(&app_handle),
    )
}

#[tauri::command]
pub fn load_trade_reviews(app_handle: tauri::AppHandle) -> Result<Value, String> {
    load_json_file(trade_reviews_path(&app_handle)?, "trade reviews")
}

#[tauri::command]
pub fn save_trade_reviews(app_handle: tauri::AppHandle, reviews: Value) -> Result<(), String> {
    save_json_file(
        trade_reviews_path(&app_handle)?,
        "trade reviews",
        reviews,
        load_backup_interval_minutes(&app_handle),
    )
}
