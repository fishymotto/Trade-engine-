#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    notion_token: String,
    notion_database_url: String,
    export_folder: String,
    twelve_data_api_key: String,
}

fn default_settings() -> AppSettings {
    AppSettings {
        notion_token: String::new(),
        notion_database_url: String::new(),
        export_folder: String::new(),
        twelve_data_api_key: String::new(),
    }
}

fn settings_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve app config directory: {}", error))?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|_| "Could not create the app config directory.".to_string())?;
    }

    Ok(config_dir.join("settings.json"))
}

fn sessions_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve app config directory: {}", error))?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|_| "Could not create the app config directory.".to_string())?;
    }

    Ok(config_dir.join("trade-sessions.json"))
}

fn trade_tag_overrides_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve app config directory: {}", error))?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|_| "Could not create the app config directory.".to_string())?;
    }

    Ok(config_dir.join("trade-tag-overrides.json"))
}

fn trade_tag_options_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve app config directory: {}", error))?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|_| "Could not create the app config directory.".to_string())?;
    }

    Ok(config_dir.join("trade-tag-options.json"))
}

#[tauri::command]
fn pick_export_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.display().to_string())
}

#[tauri::command]
fn save_export_csv(export_folder: String, file_name: String, contents: String) -> Result<String, String> {
    let folder_path = PathBuf::from(&export_folder);
    if !folder_path.exists() {
        fs::create_dir_all(&folder_path).map_err(|_| "The export folder could not be created.".to_string())?;
    }

    let file_path = folder_path.join(file_name);
    fs::write(&file_path, contents).map_err(|_| "The CSV file could not be saved.".to_string())?;

    Command::new("explorer")
        .arg(folder_path.as_os_str())
        .spawn()
        .map_err(|_| "The export folder was saved, but Windows could not open it.".to_string())?;

    Ok(file_path.display().to_string())
}

#[tauri::command]
fn load_app_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app_handle)?;
    if !path.exists() {
        return Ok(default_settings());
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved settings.".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Could not parse saved settings.".to_string())
}

#[tauri::command]
fn save_app_settings(app_handle: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app_handle)?;
    let raw = serde_json::to_string_pretty(&settings)
        .map_err(|_| "Could not serialize settings.".to_string())?;
    fs::write(path, raw).map_err(|_| "Could not save settings.".to_string())
}

#[tauri::command]
fn load_trade_sessions(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = sessions_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade sessions.".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Could not parse saved trade sessions.".to_string())
}

#[tauri::command]
fn save_trade_sessions(app_handle: tauri::AppHandle, sessions: Value) -> Result<(), String> {
    let path = sessions_path(&app_handle)?;
    let raw = serde_json::to_string_pretty(&sessions)
        .map_err(|_| "Could not serialize trade sessions.".to_string())?;
    fs::write(path, raw).map_err(|_| "Could not save trade sessions.".to_string())
}

#[tauri::command]
fn load_trade_tag_overrides(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = trade_tag_overrides_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade tag overrides.".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Could not parse saved trade tag overrides.".to_string())
}

#[tauri::command]
fn save_trade_tag_overrides(app_handle: tauri::AppHandle, overrides: Value) -> Result<(), String> {
    let path = trade_tag_overrides_path(&app_handle)?;
    let raw = serde_json::to_string_pretty(&overrides)
        .map_err(|_| "Could not serialize trade tag overrides.".to_string())?;
    fs::write(path, raw).map_err(|_| "Could not save trade tag overrides.".to_string())
}

#[tauri::command]
fn load_trade_tag_options(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let path = trade_tag_options_path(&app_handle)?;
    if !path.exists() {
        return Ok(Value::Object(Default::default()));
    }

    let raw = fs::read_to_string(&path).map_err(|_| "Could not read saved trade tag options.".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Could not parse saved trade tag options.".to_string())
}

#[tauri::command]
fn save_trade_tag_options(app_handle: tauri::AppHandle, options: Value) -> Result<(), String> {
    let path = trade_tag_options_path(&app_handle)?;
    let raw = serde_json::to_string_pretty(&options)
        .map_err(|_| "Could not serialize trade tag options.".to_string())?;
    fs::write(path, raw).map_err(|_| "Could not save trade tag options.".to_string())
}

#[tauri::command]
async fn notion_api_request(
    token: String,
    path: String,
    method: String,
    body: Option<String>,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let request_method = Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("Unsupported HTTP method: {}", method))?;

    let mut request = client
        .request(request_method, format!("https://api.notion.com{}", path))
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("Notion-Version", "2022-06-28");

    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not reach Notion: {}", error))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read Notion response: {}", error))?;

    if !status.is_success() {
        return Err(if text.is_empty() {
            format!("Notion returned {}", status)
        } else {
            text
        });
    }

    if text.trim().is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_str(&text).map_err(|error| format!("Invalid Notion response: {}", error))
    }
}

#[tauri::command]
async fn fetch_twelve_data_time_series(
    api_key: String,
    symbol: String,
    exchange: Option<String>,
    interval: String,
    start_date: Option<String>,
    end_date: Option<String>,
    output_size: Option<u32>,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let mut request = client
        .get("https://api.twelvedata.com/time_series")
        .query(&[
            ("symbol", symbol.as_str()),
            ("interval", interval.as_str()),
            ("format", "JSON"),
            ("apikey", api_key.as_str()),
        ]);

    if let Some(start_date) = start_date.as_ref() {
        if !start_date.trim().is_empty() {
            request = request.query(&[("start_date", start_date.as_str())]);
        }
    }

    if let Some(end_date) = end_date.as_ref() {
        if !end_date.trim().is_empty() {
            request = request.query(&[("end_date", end_date.as_str())]);
        }
    }

    if let Some(output_size) = output_size {
        request = request.query(&[("outputsize", output_size.to_string())]);
    }

    if let Some(exchange) = exchange.as_ref() {
        if !exchange.trim().is_empty() {
            request = request.query(&[("exchange", exchange.as_str())]);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not reach Twelve Data: {}", error))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read Twelve Data response: {}", error))?;

    if !status.is_success() {
        return Err(if text.is_empty() {
            format!("Twelve Data returned {}", status)
        } else {
            text
        });
    }

    serde_json::from_str(&text).map_err(|error| format!("Invalid Twelve Data response: {}", error))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_export_folder,
            save_export_csv,
            load_app_settings,
            save_app_settings,
            load_trade_sessions,
            save_trade_sessions,
            load_trade_tag_overrides,
            save_trade_tag_overrides,
            load_trade_tag_options,
            save_trade_tag_options,
            notion_api_request,
            fetch_twelve_data_time_series
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
