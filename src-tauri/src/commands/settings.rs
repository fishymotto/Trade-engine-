use std::fs;

use crate::models::{default_settings, AppSettings};
use crate::utils::paths::settings_path;
use crate::utils::storage::{try_read_latest_backup, write_json_with_backup};

#[tauri::command]
pub fn load_app_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app_handle)?;
    if !path.exists() {
        return Ok(default_settings());
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved settings.".to_string())?;
    match serde_json::from_str(&raw) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            if let Some(backup_raw) = try_read_latest_backup(&path) {
                if let Ok(backup_parsed) = serde_json::from_str(&backup_raw) {
                    eprintln!("[settings] Loaded settings from latest backup snapshot.");
                    return Ok(backup_parsed);
                }
            }

            Err("Could not parse saved settings.".to_string())
        }
    }
}

#[tauri::command]
pub fn save_app_settings(app_handle: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app_handle)?;
    let backup_interval_minutes = settings.desktop_backup_interval_minutes();
    let raw = serde_json::to_string_pretty(&settings).map_err(|_| "Could not serialize settings.".to_string())?;
    write_json_with_backup(&path, &raw, "settings", backup_interval_minutes)
}
