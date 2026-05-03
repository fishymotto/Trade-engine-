use std::fs;

use serde_json::Value;

use crate::utils::paths::journal_pages_path;
use crate::utils::storage::{load_backup_interval_minutes, try_read_latest_backup, write_json_with_backup};

struct JournalCounts {
    pages: usize,
    screenshots: usize,
    text_chars: usize,
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

fn doc_text_len(value: Option<&Value>) -> usize {
    let Some(node) = value else {
        return 0;
    };

    let mut total = node
        .get("text")
        .and_then(Value::as_str)
        .map(|text| text.trim().len())
        .unwrap_or(0);

    if let Some(children) = node.get("content").and_then(Value::as_array) {
        total += children.iter().map(|child| doc_text_len(Some(child))).sum::<usize>();
    }

    total
}

fn count_journal_content(value: &Value) -> JournalCounts {
    let fields = [
        "morningContent",
        "closingContent",
        "mppPlanContent",
        "inPlayStocksContent",
        "traderReachOutsContent",
        "notesContent",
    ];
    let mut counts = JournalCounts {
        pages: 0,
        screenshots: 0,
        text_chars: 0,
    };

    for page in rows_from_value(value) {
        counts.pages += 1;
        counts.screenshots += page
            .get("screenshotUrls")
            .and_then(Value::as_array)
            .map(|urls| urls.len())
            .unwrap_or(0);
        counts.text_chars += fields.iter().map(|field| doc_text_len(page.get(field))).sum::<usize>();
    }

    counts
}

fn should_skip_lossy_journal_write(candidate: &Value, existing: &Value) -> bool {
    let existing_counts = count_journal_content(existing);
    if existing_counts.pages < 10 {
        return false;
    }

    let candidate_counts = count_journal_content(candidate);
    candidate_counts.pages * 100 < existing_counts.pages * 80
        || (existing_counts.text_chars >= 1_000 && candidate_counts.text_chars * 100 < existing_counts.text_chars * 80)
        || (existing_counts.screenshots > 0 && candidate_counts.screenshots + 3 < existing_counts.screenshots)
}

#[tauri::command]
pub fn load_journal_pages(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = journal_pages_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved journal pages.".to_string())?;
    match parse_json(&raw) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            if let Some(backup_raw) = try_read_latest_backup(&path) {
                if let Ok(backup_parsed) = parse_json(&backup_raw) {
                    eprintln!("[journal] Loaded journal pages from latest backup snapshot.");
                    return Ok(backup_parsed);
                }
            }

            Err("Could not parse saved journal pages.".to_string())
        }
    }
}

#[tauri::command]
pub fn save_journal_pages(app_handle: tauri::AppHandle, pages: Value) -> Result<(), String> {
    let path = journal_pages_path(&app_handle)?;
    let backup_interval_minutes = load_backup_interval_minutes(&app_handle);
    if path.exists() {
        let existing_raw = fs::read_to_string(&path).map_err(|_| "Could not read saved journal pages.".to_string())?;
        if let Ok(existing) = parse_json(&existing_raw) {
            if should_skip_lossy_journal_write(&pages, &existing) {
                let candidate_counts = count_journal_content(&pages);
                let existing_counts = count_journal_content(&existing);
                eprintln!(
                    "[journal] Skipped lossy journal write: candidate_pages={} candidate_text={} existing_pages={} existing_text={}",
                    candidate_counts.pages,
                    candidate_counts.text_chars,
                    existing_counts.pages,
                    existing_counts.text_chars
                );
                return Ok(());
            }
        }
    }

    let raw = serde_json::to_string_pretty(&pages).map_err(|_| "Could not serialize journal pages.".to_string())?;
    write_json_with_backup(&path, &raw, "journal pages", backup_interval_minutes)
}
