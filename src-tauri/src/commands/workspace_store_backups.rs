use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use crate::utils::paths::{
    headlines_path, historical_bars_path, journal_checklist_templates_path, review_templates_path,
    select_option_additions_path, trade_tag_catalog_path, workspace_state_path,
};
use crate::utils::storage::{load_backup_interval_minutes, try_read_latest_backup, write_json_with_backup};

struct WorkspaceStoreBackupTarget {
    path: PathBuf,
    label: &'static str,
}

fn parse_json(raw: &str) -> Result<Value, serde_json::Error> {
    serde_json::from_str(raw.trim_start_matches('\u{feff}'))
}

fn resolve_workspace_store_backup_target(
    app_handle: &tauri::AppHandle,
    store_key: &str,
) -> Result<WorkspaceStoreBackupTarget, String> {
    match store_key {
        "historical-bars" => Ok(WorkspaceStoreBackupTarget {
            path: historical_bars_path(app_handle)?,
            label: "historical bars",
        }),
        "journal-checklist-templates" => Ok(WorkspaceStoreBackupTarget {
            path: journal_checklist_templates_path(app_handle)?,
            label: "journal checklist templates",
        }),
        "workspace-state" => Ok(WorkspaceStoreBackupTarget {
            path: workspace_state_path(app_handle)?,
            label: "workspace state",
        }),
        "headlines" => Ok(WorkspaceStoreBackupTarget {
            path: headlines_path(app_handle)?,
            label: "headlines",
        }),
        "select-option-additions" => Ok(WorkspaceStoreBackupTarget {
            path: select_option_additions_path(app_handle)?,
            label: "select option additions",
        }),
        "review-templates" => Ok(WorkspaceStoreBackupTarget {
            path: review_templates_path(app_handle)?,
            label: "review templates",
        }),
        "trade-tag-catalog" => Ok(WorkspaceStoreBackupTarget {
            path: trade_tag_catalog_path(app_handle)?,
            label: "trade tag catalog",
        }),
        _ => Err("Unsupported workspace backup store key.".to_string()),
    }
}

#[tauri::command]
pub fn load_workspace_store_backup(
    app_handle: tauri::AppHandle,
    store_key: String,
) -> Result<Value, String> {
    let target = resolve_workspace_store_backup_target(&app_handle, store_key.trim())?;
    if !target.path.exists() {
        return Ok(Value::Null);
    }

    let raw = fs::read_to_string(&target.path)
        .map_err(|_| format!("Could not read saved {}.", target.label))?;
    match parse_json(&raw) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            if let Some(backup_raw) = try_read_latest_backup(&target.path) {
                if let Ok(backup_parsed) = parse_json(&backup_raw) {
                    eprintln!(
                        "[workspace-backup] Loaded {} from latest backup snapshot.",
                        target.label
                    );
                    return Ok(backup_parsed);
                }
            }

            Err(format!("Could not parse saved {}.", target.label))
        }
    }
}

#[tauri::command]
pub fn save_workspace_store_backup(
    app_handle: tauri::AppHandle,
    store_key: String,
    value: Value,
) -> Result<(), String> {
    let target = resolve_workspace_store_backup_target(&app_handle, store_key.trim())?;
    let backup_interval_minutes = load_backup_interval_minutes(&app_handle);
    let raw = serde_json::to_string_pretty(&value)
        .map_err(|_| format!("Could not serialize {}.", target.label))?;
    write_json_with_backup(&target.path, &raw, target.label, backup_interval_minutes)
}
