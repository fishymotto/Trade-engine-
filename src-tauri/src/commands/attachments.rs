use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

fn ensure_attachments_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
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

fn sanitize_segment(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "untitled".to_string();
    }

    let mut sanitized = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            sanitized.push(ch.to_ascii_lowercase());
            continue;
        }

        if ch == '.' {
            sanitized.push('.');
            continue;
        }

        sanitized.push('-');
    }

    sanitized
        .trim_matches('-')
        .trim_matches('.')
        .to_string()
        .chars()
        .take(80)
        .collect()
}

fn build_destination_path(
    base_dir: &Path,
    playbook_id: &str,
    example_id: &str,
    kind: &str,
    source_path: &Path,
) -> PathBuf {
    let playbook_segment = sanitize_segment(playbook_id);
    let example_segment = sanitize_segment(example_id);
    let kind_segment = sanitize_segment(kind);

    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(sanitize_segment)
        .unwrap_or_else(|| "attachment".to_string());

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let file_name = format!("{}-{}", timestamp, original_name);

    base_dir
        .join(playbook_segment)
        .join(example_segment)
        .join(kind_segment)
        .join(file_name)
}

#[tauri::command]
pub fn pick_and_save_playbook_attachment(
    app_handle: tauri::AppHandle,
    playbook_id: String,
    example_id: String,
    kind: String,
) -> Result<String, String> {
    let mut dialog = rfd::FileDialog::new();
    dialog = dialog.set_title("Add Playbook Attachment");

    match kind.as_str() {
        "screenshot" => {
            dialog = dialog.add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif"]);
        }
        "recording" => {
            dialog = dialog.add_filter("Videos", &["mp4", "webm", "mov", "mkv", "avi"]);
        }
        _ => return Err("Unsupported attachment kind.".to_string()),
    }

    let picked = dialog.pick_file();
    let Some(source_path) = picked else {
        return Ok("".to_string());
    };

    if !source_path.exists() {
        return Err("The selected file could not be found.".to_string());
    }

    let attachments_dir = ensure_attachments_dir(&app_handle)?;
    let destination_path =
        build_destination_path(&attachments_dir, &playbook_id, &example_id, &kind, &source_path);
    let destination_dir = destination_path
        .parent()
        .ok_or_else(|| "Could not resolve the destination folder.".to_string())?;

    if !destination_dir.exists() {
        fs::create_dir_all(destination_dir)
            .map_err(|_| "Could not create the attachment folder.".to_string())?;
    }

    fs::copy(&source_path, &destination_path)
        .map_err(|_| "The attachment could not be saved.".to_string())?;

    Ok(destination_path.display().to_string())
}

#[tauri::command]
pub fn delete_playbook_attachment(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Ok(());
    }

    let attachments_dir = ensure_attachments_dir(&app_handle)?;
    let attachments_root = fs::canonicalize(&attachments_dir)
        .map_err(|_| "Could not validate the attachments directory.".to_string())?;

    let target_path = PathBuf::from(&path);
    if !target_path.is_absolute() {
        return Err("Attachment path must be absolute.".to_string());
    }

    if !target_path.exists() {
        return Ok(());
    }

    let canonical_target = fs::canonicalize(&target_path)
        .map_err(|_| "Could not validate the attachment path.".to_string())?;

    if !canonical_target.starts_with(&attachments_root) {
        return Err("Only attachments saved by the app can be deleted.".to_string());
    }

    fs::remove_file(&canonical_target).map_err(|_| "The attachment could not be deleted.".to_string())?;
    Ok(())
}
