use std::fs;

use serde_json::Value;

use crate::utils::paths::{trade_tag_options_path, trade_tag_overrides_path};
use crate::utils::storage::{load_backup_interval_minutes, try_read_latest_backup, write_json_with_backup};

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

fn has_text(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .map(|text| !text.trim().is_empty())
        .unwrap_or(false)
}

fn array_text_count(value: Option<&Value>) -> usize {
    value
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter(|entry| entry.as_str().map(|text| !text.trim().is_empty()).unwrap_or(false))
                .count()
        })
        .unwrap_or(0)
}

fn override_richness_score(value: &Value) -> usize {
    rows_from_value(value)
        .iter()
        .map(|row| {
            let mistakes = array_text_count(row.get("mistakes"))
                + if has_text(row.get("mistake")) { 1 } else { 0 };
            let catalyst = array_text_count(row.get("catalyst"));

            (if has_text(row.get("playbook")) { 20 } else { 0 })
                + mistakes * 10
                + catalyst * 5
                + if has_text(row.get("status")) { 2 } else { 0 }
                + if has_text(row.get("game")) { 1 } else { 0 }
                + if has_text(row.get("outTag")) { 1 } else { 0 }
                + if has_text(row.get("execution")) { 1 } else { 0 }
        })
        .sum()
}

fn should_skip_lossy_override_write(candidate: &Value, existing: &Value) -> bool {
    let existing_count = rows_from_value(existing).len();
    if existing_count < 200 {
        return false;
    }

    let candidate_count = rows_from_value(candidate).len();
    let existing_score = override_richness_score(existing);
    let candidate_score = override_richness_score(candidate);

    candidate_count * 100 <= existing_count * 35
        || (existing_score >= 200 && candidate_score * 100 <= existing_score * 50)
}

#[tauri::command]
pub fn load_trade_tag_overrides(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = trade_tag_overrides_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade tag overrides.".to_string())?;
    match parse_json(&raw) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            if let Some(backup_raw) = try_read_latest_backup(&path) {
                if let Ok(backup_parsed) = parse_json(&backup_raw) {
                    eprintln!("[tags] Loaded trade tag overrides from latest backup snapshot.");
                    return Ok(backup_parsed);
                }
            }

            Err("Could not parse saved trade tag overrides.".to_string())
        }
    }
}

#[tauri::command]
pub fn save_trade_tag_overrides(app_handle: tauri::AppHandle, overrides: Value) -> Result<(), String> {
    let path = trade_tag_overrides_path(&app_handle)?;
    let backup_interval_minutes = load_backup_interval_minutes(&app_handle);
    if path.exists() {
        let existing_raw =
            fs::read_to_string(&path).map_err(|_| "Could not read saved trade tag overrides.".to_string())?;
        if let Ok(existing) = parse_json(&existing_raw) {
            if should_skip_lossy_override_write(&overrides, &existing) {
                eprintln!(
                    "[tags] Skipped lossy trade tag override write: candidate_rows={} existing_rows={}",
                    rows_from_value(&overrides).len(),
                    rows_from_value(&existing).len()
                );
                return Ok(());
            }
        }
    }

    let raw =
        serde_json::to_string_pretty(&overrides).map_err(|_| "Could not serialize trade tag overrides.".to_string())?;
    write_json_with_backup(&path, &raw, "trade tag overrides", backup_interval_minutes)
}

#[tauri::command]
pub fn load_trade_tag_options(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = trade_tag_options_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Object(Default::default()));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade tag options.".to_string())?;
    match parse_json(&raw) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            if let Some(backup_raw) = try_read_latest_backup(&path) {
                if let Ok(backup_parsed) = parse_json(&backup_raw) {
                    eprintln!("[tags] Loaded trade tag options from latest backup snapshot.");
                    return Ok(backup_parsed);
                }
            }

            Err("Could not parse saved trade tag options.".to_string())
        }
    }
}

#[tauri::command]
pub fn save_trade_tag_options(app_handle: tauri::AppHandle, options: Value) -> Result<(), String> {
    let path = trade_tag_options_path(&app_handle)?;
    let backup_interval_minutes = load_backup_interval_minutes(&app_handle);
    let raw =
        serde_json::to_string_pretty(&options).map_err(|_| "Could not serialize trade tag options.".to_string())?;
    write_json_with_backup(&path, &raw, "trade tag options", backup_interval_minutes)
}
