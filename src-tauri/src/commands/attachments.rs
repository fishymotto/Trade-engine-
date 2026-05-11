use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::utils::paths::playbook_attachments_dir;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAttachmentCategorySummary {
    key: String,
    label: String,
    file_count: usize,
    referenced_file_count: usize,
    orphaned_file_count: usize,
    total_bytes: u64,
    referenced_bytes: u64,
    orphaned_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAttachmentAuditResult {
    scanned_file_count: usize,
    referenced_file_count: usize,
    orphaned_file_count: usize,
    deleted_file_count: usize,
    total_bytes: u64,
    orphaned_bytes: u64,
    deleted_bytes: u64,
    missing_reference_count: usize,
    categories: Vec<WorkspaceAttachmentCategorySummary>,
}

#[derive(Default)]
struct WorkspaceAttachmentCategoryStats {
    file_count: usize,
    referenced_file_count: usize,
    orphaned_file_count: usize,
    total_bytes: u64,
    referenced_bytes: u64,
    orphaned_bytes: u64,
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

fn sanitize_file_name(value: &str) -> String {
    Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .map(sanitize_segment)
        .unwrap_or_else(|| "attachment".to_string())
}

fn build_destination_path(base_dir: &Path, segments: &[&str], original_name: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let file_name = format!("{}-{}", timestamp, sanitize_file_name(original_name));

    let mut destination_path = base_dir.to_path_buf();
    for segment in segments {
        destination_path = destination_path.join(sanitize_segment(segment));
    }

    destination_path.join(file_name)
}

fn decode_hex(hex: &str) -> Option<Vec<u8>> {
    let trimmed = hex.trim();
    if trimmed.is_empty() || trimmed.len() % 2 != 0 {
        return None;
    }

    let mut output = Vec::with_capacity(trimmed.len() / 2);
    let mut index = 0;
    while index < trimmed.len() {
        let chunk = &trimmed[index..index + 2];
        let parsed = u8::from_str_radix(chunk, 16).ok()?;
        output.push(parsed);
        index += 2;
    }

    Some(output)
}

fn collect_attachment_files(dir: &Path, attachments_root: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|_| "Could not scan the workspace attachments directory.".to_string())?;

    for entry in entries {
        let entry = entry.map_err(|_| "Could not scan the workspace attachments directory.".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "Could not inspect a workspace attachment entry.".to_string())?;
        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        if file_type.is_dir() {
            collect_attachment_files(&path, attachments_root, files)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let canonical_path = fs::canonicalize(&path)
            .map_err(|_| "Could not validate a workspace attachment path.".to_string())?;
        if canonical_path.starts_with(attachments_root) {
            files.push(canonical_path);
        }
    }

    Ok(())
}

fn prune_empty_attachment_dirs(dir: &Path, attachments_root: &Path) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|_| "Could not inspect the workspace attachments directory.".to_string())?;

    for entry in entries {
        let entry = entry.map_err(|_| "Could not inspect the workspace attachments directory.".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "Could not inspect a workspace attachment entry.".to_string())?;
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        prune_empty_attachment_dirs(&path, attachments_root)?;

        let mut child_entries = fs::read_dir(&path)
            .map_err(|_| "Could not inspect a workspace attachment directory.".to_string())?;
        if child_entries.next().is_none() && path != attachments_root {
            fs::remove_dir(&path)
                .map_err(|_| "Could not clean up an empty workspace attachment folder.".to_string())?;
        }
    }

    Ok(())
}

fn classify_attachment_category(relative_path: &Path) -> (String, String) {
    let segments: Vec<String> = relative_path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .map(|segment| segment.to_string())
        .collect();

    let first = segments.first().map(|value| value.as_str()).unwrap_or("");
    let third = segments.get(2).map(|value| value.as_str()).unwrap_or("");

    match first {
        "journal-inline-images" => (
            "journal-inline-images".to_string(),
            "Journal inline images".to_string(),
        ),
        "journal-screenshots" => (
            "journal-screenshots".to_string(),
            "Journal screenshots".to_string(),
        ),
        "playbook-inline-images" => (
            "playbook-inline-images".to_string(),
            "Playbook section images".to_string(),
        ),
        "playbook-aplus-inline-images" => (
            "playbook-aplus-inline-images".to_string(),
            "Playbook A+ notes images".to_string(),
        ),
        "library-inline-images" => (
            "library-inline-images".to_string(),
            "Library inline images".to_string(),
        ),
        "library-strong-view" => (
            "library-strong-view".to_string(),
            "Strong View attachments".to_string(),
        ),
        "library-ticker-group-icons" => (
            "library-ticker-group-icons".to_string(),
            "Ticker group icons".to_string(),
        ),
        "trade-review-inline-images" => (
            "trade-review-inline-images".to_string(),
            "Trade review images".to_string(),
        ),
        _ => match third {
            "screenshot" => (
                "playbook-screenshots".to_string(),
                "Playbook screenshots".to_string(),
            ),
            "recording" => (
                "playbook-recordings".to_string(),
                "Playbook recordings".to_string(),
            ),
            _ => (
                "other".to_string(),
                "Other attachments".to_string(),
            ),
        },
    }
}

fn inspect_workspace_attachments(
    app_handle: tauri::AppHandle,
    referenced_paths: Vec<String>,
    delete_orphans: bool,
) -> Result<WorkspaceAttachmentAuditResult, String> {
    let attachments_dir = playbook_attachments_dir(&app_handle)?;
    let attachments_root = fs::canonicalize(&attachments_dir)
        .map_err(|_| "Could not validate the workspace attachments directory.".to_string())?;

    let mut referenced_files: HashSet<PathBuf> = HashSet::new();
    let mut missing_reference_count = 0usize;
    let mut seen_references: HashSet<String> = HashSet::new();

    for original_path in referenced_paths {
        let trimmed = original_path.trim();
        if trimmed.is_empty() || !seen_references.insert(trimmed.to_string()) {
            continue;
        }

        let referenced_path = PathBuf::from(trimmed);
        if !referenced_path.is_absolute() || !referenced_path.exists() {
            missing_reference_count += 1;
            continue;
        }

        let canonical_path = match fs::canonicalize(&referenced_path) {
            Ok(path) => path,
            Err(_) => {
                missing_reference_count += 1;
                continue;
            }
        };

        if !canonical_path.starts_with(&attachments_root) {
            missing_reference_count += 1;
            continue;
        }

        referenced_files.insert(canonical_path);
    }

    let mut attachment_files: Vec<PathBuf> = Vec::new();
    collect_attachment_files(&attachments_root, &attachments_root, &mut attachment_files)?;

    let mut referenced_file_count = 0usize;
    let mut orphaned_file_count = 0usize;
    let mut deleted_file_count = 0usize;
    let mut total_bytes = 0u64;
    let mut orphaned_bytes = 0u64;
    let mut deleted_bytes = 0u64;
    let mut category_stats: std::collections::HashMap<String, (String, WorkspaceAttachmentCategoryStats)> =
        std::collections::HashMap::new();

    for attachment_path in attachment_files {
        let metadata = fs::metadata(&attachment_path)
            .map_err(|_| "Could not inspect a workspace attachment file.".to_string())?;
        let byte_length = metadata.len();
        total_bytes += byte_length;
        let relative_path = attachment_path
            .strip_prefix(&attachments_root)
            .map_err(|_| "Could not classify a workspace attachment path.".to_string())?;
        let (category_key, category_label) = classify_attachment_category(relative_path);
        let (_, stats) = category_stats
            .entry(category_key)
            .or_insert_with(|| (category_label, WorkspaceAttachmentCategoryStats::default()));
        stats.file_count += 1;
        stats.total_bytes += byte_length;

        if referenced_files.contains(&attachment_path) {
            referenced_file_count += 1;
            stats.referenced_file_count += 1;
            stats.referenced_bytes += byte_length;
            continue;
        }

        orphaned_file_count += 1;
        orphaned_bytes += byte_length;
        stats.orphaned_file_count += 1;
        stats.orphaned_bytes += byte_length;

        if delete_orphans {
            fs::remove_file(&attachment_path)
                .map_err(|_| "Could not remove an unused workspace attachment.".to_string())?;
            deleted_file_count += 1;
            deleted_bytes += byte_length;
        }
    }

    if delete_orphans {
        prune_empty_attachment_dirs(&attachments_root, &attachments_root)?;
    }

    let mut categories: Vec<WorkspaceAttachmentCategorySummary> = category_stats
        .into_iter()
        .map(|(key, (label, stats))| WorkspaceAttachmentCategorySummary {
            key,
            label,
            file_count: stats.file_count,
            referenced_file_count: stats.referenced_file_count,
            orphaned_file_count: stats.orphaned_file_count,
            total_bytes: stats.total_bytes,
            referenced_bytes: stats.referenced_bytes,
            orphaned_bytes: stats.orphaned_bytes,
        })
        .collect();
    categories.sort_by(|left, right| {
        right
            .total_bytes
            .cmp(&left.total_bytes)
            .then_with(|| left.label.cmp(&right.label))
    });

    Ok(WorkspaceAttachmentAuditResult {
        scanned_file_count: referenced_file_count + orphaned_file_count,
        referenced_file_count,
        orphaned_file_count,
        deleted_file_count,
        total_bytes,
        orphaned_bytes,
        deleted_bytes,
        missing_reference_count,
        categories,
    })
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

    let attachments_dir = playbook_attachments_dir(&app_handle)?;
    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment");
    let destination_path =
        build_destination_path(&attachments_dir, &[&playbook_id, &example_id, &kind], original_name);
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
pub fn save_workspace_attachment(
    app_handle: tauri::AppHandle,
    category: String,
    record_id: String,
    slot_key: String,
    file_name: String,
    content_hex: String,
) -> Result<String, String> {
    let Some(bytes) = decode_hex(&content_hex) else {
        return Err("The attachment data could not be decoded.".to_string());
    };

    let attachments_dir = playbook_attachments_dir(&app_handle)?;
    let destination_path =
        build_destination_path(&attachments_dir, &[&category, &record_id, &slot_key], &file_name);
    let destination_dir = destination_path
        .parent()
        .ok_or_else(|| "Could not resolve the destination folder.".to_string())?;

    if !destination_dir.exists() {
        fs::create_dir_all(destination_dir)
            .map_err(|_| "Could not create the attachment folder.".to_string())?;
    }

    fs::write(&destination_path, bytes).map_err(|_| "The attachment could not be saved.".to_string())?;

    Ok(destination_path.display().to_string())
}

#[tauri::command]
pub fn delete_playbook_attachment(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Ok(());
    }

    let attachments_dir = playbook_attachments_dir(&app_handle)?;
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

#[tauri::command]
pub fn audit_workspace_attachments(
    app_handle: tauri::AppHandle,
    referenced_paths: Vec<String>,
) -> Result<WorkspaceAttachmentAuditResult, String> {
    inspect_workspace_attachments(app_handle, referenced_paths, false)
}

#[tauri::command]
pub fn prune_workspace_attachments(
    app_handle: tauri::AppHandle,
    referenced_paths: Vec<String>,
) -> Result<WorkspaceAttachmentAuditResult, String> {
    inspect_workspace_attachments(app_handle, referenced_paths, true)
}
