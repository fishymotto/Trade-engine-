use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
pub fn pick_export_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.display().to_string())
}

#[tauri::command]
pub fn save_export_csv(export_folder: String, file_name: String, contents: String) -> Result<String, String> {
    let folder_path = PathBuf::from(&export_folder);
    if !folder_path.exists() {
        fs::create_dir_all(&folder_path)
            .map_err(|_| "The export folder could not be created.".to_string())?;
    }

    let file_path = folder_path.join(file_name);
    fs::write(&file_path, contents).map_err(|_| "The CSV file could not be saved.".to_string())?;

    Command::new("explorer")
        .arg(folder_path.as_os_str())
        .spawn()
        .map_err(|_| "The export folder was saved, but Windows could not open it.".to_string())?;

    Ok(file_path.display().to_string())
}

