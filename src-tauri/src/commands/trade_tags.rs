use std::fs;

use serde_json::Value;

use crate::utils::paths::{trade_tag_options_path, trade_tag_overrides_path};

#[tauri::command]
pub fn load_trade_tag_overrides(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = trade_tag_overrides_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade tag overrides.".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Could not parse saved trade tag overrides.".to_string())
}

#[tauri::command]
pub fn save_trade_tag_overrides(app_handle: tauri::AppHandle, overrides: Value) -> Result<(), String> {
    let path = trade_tag_overrides_path(&app_handle)?;
    let raw =
        serde_json::to_string_pretty(&overrides).map_err(|_| "Could not serialize trade tag overrides.".to_string())?;
    fs::write(path, raw).map_err(|_| "Could not save trade tag overrides.".to_string())
}

#[tauri::command]
pub fn load_trade_tag_options(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = trade_tag_options_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Object(Default::default()));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade tag options.".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Could not parse saved trade tag options.".to_string())
}

#[tauri::command]
pub fn save_trade_tag_options(app_handle: tauri::AppHandle, options: Value) -> Result<(), String> {
    let path = trade_tag_options_path(&app_handle)?;
    let raw =
        serde_json::to_string_pretty(&options).map_err(|_| "Could not serialize trade tag options.".to_string())?;
    fs::write(path, raw).map_err(|_| "Could not save trade tag options.".to_string())
}

