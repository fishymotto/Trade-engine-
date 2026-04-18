use std::fs;
use std::path::PathBuf;

use tauri::Manager;

fn ensure_config_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve app config directory: {}", error))?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|_| "Could not create the app config directory.".to_string())?;
    }

    Ok(config_dir)
}

pub fn settings_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("settings.json"))
}

pub fn sessions_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("trade-sessions.json"))
}

pub fn trade_tag_overrides_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("trade-tag-overrides.json"))
}

pub fn trade_tag_options_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("trade-tag-options.json"))
}

