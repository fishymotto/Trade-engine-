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

pub fn journal_pages_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("journal-pages.json"))
}

pub fn historical_bars_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("historical-bars.json"))
}

pub fn journal_checklist_templates_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("journal-checklist-templates.json"))
}

pub fn workspace_state_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("workspace-state.json"))
}

pub fn library_pages_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("library-pages.json"))
}

pub fn playbooks_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("playbooks.json"))
}

pub fn trade_reviews_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("trade-reviews.json"))
}

pub fn trade_tag_overrides_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("trade-tag-overrides.json"))
}

pub fn trade_tag_options_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("trade-tag-options.json"))
}

pub fn headlines_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("headlines.json"))
}

pub fn select_option_additions_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("select-option-additions.json"))
}

pub fn review_templates_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("review-templates.json"))
}

pub fn trade_tag_catalog_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_config_dir(app_handle)?.join("trade-tag-catalog.json"))
}

pub fn playbook_attachments_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {}", error))?;

    let attachments_dir = data_dir.join("playbook-attachments");
    if !attachments_dir.exists() {
        fs::create_dir_all(&attachments_dir)
            .map_err(|_| "Could not create the playbook attachments directory.".to_string())?;
    }

    Ok(attachments_dir)
}
