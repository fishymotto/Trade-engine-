use std::process::Command;

fn sanitize_external_url(raw_url: &str) -> Option<String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_view_source = trimmed
        .strip_prefix("view-source:")
        .or_else(|| trimmed.strip_prefix("VIEW-SOURCE:"))
        .unwrap_or(trimmed)
        .trim();

    let lower = without_view_source.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return None;
    }

    Some(without_view_source.to_string())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let sanitized = sanitize_external_url(&url).ok_or_else(|| {
        "Invalid URL. Only http(s) links are allowed, and local file paths are rejected.".to_string()
    })?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&sanitized)
            .spawn()
            .map_err(|_| "Windows could not open the link.".to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&sanitized)
            .spawn()
            .map_err(|_| "macOS could not open the link.".to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&sanitized)
            .spawn()
            .map_err(|_| "Linux could not open the link.".to_string())?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = sanitized;
        Err("Opening links is not supported on this platform.".to_string())
    }
}
