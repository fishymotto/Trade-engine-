use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::utils::paths::playbook_attachments_dir;

const WORKSPACE_BUNDLE_VERSION: u32 = 1;
const WORKSPACE_BUNDLE_SOURCE: &str = "trade-engine-desktop";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceTransferScope {
    Full,
    SinceDate,
    DateRange,
    SelectedDates,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferAttachmentRecord {
    relative_path: String,
    #[serde(default)]
    original_path: Option<String>,
    #[serde(default)]
    byte_length: Option<usize>,
    content_hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferBundle {
    version: u32,
    exported_at: String,
    source: String,
    #[serde(default)]
    scope: Option<WorkspaceTransferScope>,
    #[serde(default)]
    start_date: Option<String>,
    #[serde(default)]
    end_date: Option<String>,
    #[serde(default)]
    selected_dates: Vec<String>,
    #[serde(default)]
    local_storage: Map<String, Value>,
    #[serde(default)]
    attachments: Vec<WorkspaceTransferAttachmentRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferExportResult {
    saved_path: String,
    attachment_count: usize,
    skipped_attachment_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferImportResult {
    bundle: WorkspaceTransferBundle,
    restored_attachment_count: usize,
    skipped_attachment_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferBundlePreview {
    scope: WorkspaceTransferScope,
    exported_at: String,
    start_date: Option<String>,
    end_date: Option<String>,
    selected_dates: Vec<String>,
    attachment_count: usize,
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{:02x}", byte));
    }
    output
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

fn normalize_bundle(mut bundle: WorkspaceTransferBundle) -> WorkspaceTransferBundle {
    bundle.version = WORKSPACE_BUNDLE_VERSION;
    if bundle.source.trim().is_empty() {
        bundle.source = WORKSPACE_BUNDLE_SOURCE.to_string();
    }
    if bundle.scope.is_none() {
        bundle.scope = Some(WorkspaceTransferScope::Full);
    }
    bundle
}

fn read_workspace_transfer_bundle(path: &Path) -> Result<WorkspaceTransferBundle, String> {
    if !path.exists() {
        return Err("The selected workspace bundle could not be found.".to_string());
    }

    let raw_bundle = fs::read_to_string(path)
        .map_err(|_| "The workspace bundle could not be read.".to_string())?;
    let bundle = serde_json::from_str::<WorkspaceTransferBundle>(raw_bundle.trim_start_matches('\u{feff}'))
        .map_err(|_| "The workspace bundle could not be parsed.".to_string())?;

    Ok(normalize_bundle(bundle))
}

fn sanitize_relative_path(raw: &str) -> Option<PathBuf> {
    let mut path = PathBuf::new();

    for component in Path::new(raw).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => path.push(segment),
            _ => return None,
        }
    }

    if path.as_os_str().is_empty() {
        return None;
    }

    Some(path)
}

fn replace_strings_in_value(value: &mut Value, replacements: &HashMap<String, String>) {
    match value {
        Value::String(current) => {
            if let Some(replacement) = replacements.get(current) {
                *current = replacement.clone();
            }
        }
        Value::Array(entries) => {
            for entry in entries {
                replace_strings_in_value(entry, replacements);
            }
        }
        Value::Object(record) => {
            for entry in record.values_mut() {
                replace_strings_in_value(entry, replacements);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub fn pick_workspace_bundle_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Trade Engine Workspace", &["json"])
        .pick_file()
        .map(|path| path.display().to_string())
}

#[tauri::command]
pub fn preview_workspace_bundle(path: String) -> Result<WorkspaceTransferBundlePreview, String> {
    let bundle_path = PathBuf::from(path.trim());
    let bundle = read_workspace_transfer_bundle(&bundle_path)?;
    let scope = bundle.scope.clone().unwrap_or(WorkspaceTransferScope::Full);

    Ok(WorkspaceTransferBundlePreview {
        scope,
        exported_at: bundle.exported_at,
        start_date: bundle.start_date,
        end_date: bundle.end_date,
        selected_dates: bundle.selected_dates,
        attachment_count: bundle.attachments.len(),
    })
}

#[tauri::command]
pub fn export_workspace_bundle(
    app_handle: tauri::AppHandle,
    export_folder: String,
    file_name: String,
    bundle: WorkspaceTransferBundle,
    attachment_paths: Vec<String>,
) -> Result<WorkspaceTransferExportResult, String> {
    let folder_path = PathBuf::from(&export_folder);
    if !folder_path.exists() {
        fs::create_dir_all(&folder_path)
            .map_err(|_| "The workspace export folder could not be created.".to_string())?;
    }

    let attachments_root = fs::canonicalize(playbook_attachments_dir(&app_handle)?)
        .map_err(|_| "Could not validate the workspace attachments directory.".to_string())?;
    let mut normalized_bundle = normalize_bundle(bundle);
    let mut skipped_attachment_paths: Vec<String> = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut serialized_attachments: Vec<WorkspaceTransferAttachmentRecord> = Vec::new();

    for original_path in attachment_paths {
        let trimmed = original_path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let dedupe_key = trimmed.to_ascii_lowercase();
        if !seen_paths.insert(dedupe_key) {
            continue;
        }

        let candidate_path = PathBuf::from(trimmed);
        if !candidate_path.is_absolute() || !candidate_path.exists() {
            skipped_attachment_paths.push(trimmed.to_string());
            continue;
        }

        let canonical_path = match fs::canonicalize(&candidate_path) {
            Ok(path) => path,
            Err(_) => {
                skipped_attachment_paths.push(trimmed.to_string());
                continue;
            }
        };

        if !canonical_path.starts_with(&attachments_root) {
            skipped_attachment_paths.push(trimmed.to_string());
            continue;
        }

        let relative_path = match canonical_path.strip_prefix(&attachments_root) {
            Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
            Err(_) => {
                skipped_attachment_paths.push(trimmed.to_string());
                continue;
            }
        };

        let bytes = match fs::read(&canonical_path) {
            Ok(bytes) => bytes,
            Err(_) => {
                skipped_attachment_paths.push(trimmed.to_string());
                continue;
            }
        };

        serialized_attachments.push(WorkspaceTransferAttachmentRecord {
            relative_path,
            original_path: Some(trimmed.to_string()),
            byte_length: Some(bytes.len()),
            content_hex: bytes_to_hex(&bytes),
        });
    }

    normalized_bundle.attachments = serialized_attachments;

    let file_path = folder_path.join(file_name);
    let raw_bundle = serde_json::to_string_pretty(&normalized_bundle)
        .map_err(|_| "The workspace bundle could not be serialized.".to_string())?;
    fs::write(&file_path, raw_bundle).map_err(|_| "The workspace bundle could not be saved.".to_string())?;

    Ok(WorkspaceTransferExportResult {
        saved_path: file_path.display().to_string(),
        attachment_count: normalized_bundle.attachments.len(),
        skipped_attachment_paths,
    })
}

#[tauri::command]
pub fn import_workspace_bundle(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<WorkspaceTransferImportResult, String> {
    let bundle_path = PathBuf::from(path.trim());
    let mut bundle = read_workspace_transfer_bundle(&bundle_path)?;

    let attachments_root = playbook_attachments_dir(&app_handle)?;
    let mut restored_attachment_count = 0usize;
    let mut skipped_attachment_paths: Vec<String> = Vec::new();
    let mut replacements: HashMap<String, String> = HashMap::new();

    for attachment in &bundle.attachments {
        let Some(relative_path) = sanitize_relative_path(&attachment.relative_path) else {
            if let Some(original_path) = &attachment.original_path {
                skipped_attachment_paths.push(original_path.clone());
            }
            continue;
        };

        let Some(bytes) = decode_hex(&attachment.content_hex) else {
            if let Some(original_path) = &attachment.original_path {
                skipped_attachment_paths.push(original_path.clone());
            }
            continue;
        };

        let destination_path = attachments_root.join(relative_path);
        if let Some(parent_dir) = destination_path.parent() {
            fs::create_dir_all(parent_dir)
                .map_err(|_| "Could not create imported attachment folders.".to_string())?;
        }

        fs::write(&destination_path, bytes)
            .map_err(|_| "Could not restore an imported workspace attachment.".to_string())?;
        restored_attachment_count += 1;

        if let Some(original_path) = &attachment.original_path {
            replacements.insert(original_path.clone(), destination_path.display().to_string());
        }
    }

    if !replacements.is_empty() {
        for value in bundle.local_storage.values_mut() {
            replace_strings_in_value(value, &replacements);
        }
    }

    bundle.attachments.clear();

    Ok(WorkspaceTransferImportResult {
        bundle,
        restored_attachment_count,
        skipped_attachment_paths,
    })
}
