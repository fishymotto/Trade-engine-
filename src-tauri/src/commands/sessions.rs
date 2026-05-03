use std::fs;

use serde_json::Value;

use crate::utils::paths::sessions_path;
use crate::utils::storage::{load_backup_interval_minutes, try_read_latest_backup, write_json_with_backup};

struct SessionTagCounts {
    trades: usize,
    playbooks: usize,
    mistakes: usize,
    catalysts: usize,
    score: usize,
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

fn count_session_tags(value: &Value) -> SessionTagCounts {
    let mut counts = SessionTagCounts {
        trades: 0,
        playbooks: 0,
        mistakes: 0,
        catalysts: 0,
        score: 0,
    };

    for session in rows_from_value(value) {
        let Some(trades) = session.get("trades").and_then(Value::as_array) else {
            continue;
        };

        for trade in trades {
            counts.trades += 1;
            let playbooks = array_text_count(trade.get("setups"));
            let mistakes = array_text_count(trade.get("mistakes"));
            let catalysts = array_text_count(trade.get("catalyst"));
            let out_tags = array_text_count(trade.get("outTag"));
            let execution = array_text_count(trade.get("execution"));
            let game = if has_text(trade.get("game")) { 1 } else { 0 };

            counts.playbooks += if playbooks > 0 { 1 } else { 0 };
            counts.mistakes += if mistakes > 0 { 1 } else { 0 };
            counts.catalysts += if catalysts > 0 { 1 } else { 0 };
            counts.score += playbooks * 20 + mistakes * 10 + catalysts * 5 + out_tags + execution + game;
        }
    }

    counts
}

fn should_skip_lossy_session_write(candidate: &Value, existing: &Value) -> bool {
    let existing_counts = count_session_tags(existing);
    if existing_counts.trades < 500 {
        return false;
    }

    let candidate_counts = count_session_tags(candidate);
    candidate_counts.trades * 100 < existing_counts.trades * 80
        || (existing_counts.score >= 1_000 && candidate_counts.score * 100 < existing_counts.score * 97)
        || (existing_counts.playbooks >= 50 && candidate_counts.playbooks + 10 < existing_counts.playbooks)
        || (existing_counts.mistakes >= 50 && candidate_counts.mistakes + 10 < existing_counts.mistakes)
        || (existing_counts.catalysts > 0 && candidate_counts.catalysts < existing_counts.catalysts)
}

#[tauri::command]
pub fn load_trade_sessions(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = sessions_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade sessions.".to_string())?;
    match parse_json(&raw) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            if let Some(backup_raw) = try_read_latest_backup(&path) {
                if let Ok(backup_parsed) = parse_json(&backup_raw) {
                    eprintln!("[sessions] Loaded trade sessions from latest backup snapshot.");
                    return Ok(backup_parsed);
                }
            }

            Err("Could not parse saved trade sessions.".to_string())
        }
    }
}

#[tauri::command]
pub fn save_trade_sessions(app_handle: tauri::AppHandle, sessions: Value) -> Result<(), String> {
    let path = sessions_path(&app_handle)?;
    let backup_interval_minutes = load_backup_interval_minutes(&app_handle);
    if path.exists() {
        let existing_raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade sessions.".to_string())?;
        if let Ok(existing) = parse_json(&existing_raw) {
            if should_skip_lossy_session_write(&sessions, &existing) {
                let candidate_counts = count_session_tags(&sessions);
                let existing_counts = count_session_tags(&existing);
                eprintln!(
                    "[sessions] Skipped lossy session write: candidate_trades={} candidate_playbooks={} existing_trades={} existing_playbooks={}",
                    candidate_counts.trades,
                    candidate_counts.playbooks,
                    existing_counts.trades,
                    existing_counts.playbooks
                );
                return Ok(());
            }
        }
    }

    let raw =
        serde_json::to_string_pretty(&sessions).map_err(|_| "Could not serialize trade sessions.".to_string())?;
    write_json_with_backup(&path, &raw, "trade sessions", backup_interval_minutes)
}
