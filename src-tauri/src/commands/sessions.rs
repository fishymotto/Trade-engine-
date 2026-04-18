use std::fs;

use serde_json::Value;

use crate::utils::paths::sessions_path;

#[tauri::command]
pub fn load_trade_sessions(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = sessions_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade sessions.".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Could not parse saved trade sessions.".to_string())
}

#[tauri::command]
pub fn save_trade_sessions(app_handle: tauri::AppHandle, sessions: Value) -> Result<(), String> {
    let path = sessions_path(&app_handle)?;
    let raw =
        serde_json::to_string_pretty(&sessions).map_err(|_| "Could not serialize trade sessions.".to_string())?;
    fs::write(path, raw).map_err(|_| "Could not save trade sessions.".to_string())
}

