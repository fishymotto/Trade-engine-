use std::fs;

use crate::models::{default_settings, AppSettings};
use crate::utils::paths::settings_path;

#[tauri::command]
pub fn load_app_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app_handle)?;
    if !path.exists() {
        return Ok(default_settings());
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved settings.".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Could not parse saved settings.".to_string())
}

#[tauri::command]
pub fn save_app_settings(app_handle: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app_handle)?;
    let raw = serde_json::to_string_pretty(&settings).map_err(|_| "Could not serialize settings.".to_string())?;
    fs::write(path, raw).map_err(|_| "Could not save settings.".to_string())
}

