use serde_json::Value;

use crate::services::notion;

#[tauri::command]
pub async fn notion_api_request(
    token: String,
    path: String,
    method: String,
    body: Option<String>,
) -> Result<Value, String> {
    notion::api_request(token, path, method, body).await
}

