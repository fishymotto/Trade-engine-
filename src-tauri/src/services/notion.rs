use reqwest::Method;
use serde_json::Value;

pub async fn api_request(token: String, path: String, method: String, body: Option<String>) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let request_method =
        Method::from_bytes(method.as_bytes()).map_err(|_| format!("Unsupported HTTP method: {}", method))?;

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

