use serde_json::Value;

fn normalize_feed(feed: Option<String>) -> String {
    if feed.unwrap_or_default().trim().eq_ignore_ascii_case("iex") {
        "iex".to_string()
    } else {
        "sip".to_string()
    }
}

pub async fn fetch_stock_trades(
    api_key: String,
    secret_key: String,
    symbol: String,
    feed: Option<String>,
    start: String,
    end: String,
    limit: Option<u32>,
    page_token: Option<String>,
) -> Result<Value, String> {
    let api_key = api_key.trim();
    let secret_key = secret_key.trim();
    let symbol = symbol.trim().to_ascii_uppercase();

    if api_key.is_empty() || secret_key.is_empty() {
        return Err("Add your Alpaca API key and secret in Settings first.".to_string());
    }

    if symbol.is_empty() {
        return Err("A stock symbol is required for the Alpaca request.".to_string());
    }

    let client = reqwest::Client::new();
    let url = format!("https://data.alpaca.markets/v2/stocks/{}/trades", symbol);
    let limit_value = limit.unwrap_or(10_000).clamp(1, 10_000).to_string();
    let feed_value = normalize_feed(feed);
    let mut request = client
        .get(url)
        .header("APCA-API-KEY-ID", api_key)
        .header("APCA-API-SECRET-KEY", secret_key)
        .query(&[
            ("start", start.as_str()),
            ("end", end.as_str()),
            ("limit", limit_value.as_str()),
            ("feed", feed_value.as_str()),
            ("sort", "asc"),
        ]);

    if let Some(page_token) = page_token.as_ref() {
        if !page_token.trim().is_empty() {
            request = request.query(&[("page_token", page_token.as_str())]);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not reach Alpaca Market Data: {}", error))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read Alpaca Market Data response: {}", error))?;

    if !status.is_success() {
        return Err(if text.is_empty() {
            format!("Alpaca Market Data returned {}", status)
        } else {
            text
        });
    }

    serde_json::from_str(&text).map_err(|error| format!("Invalid Alpaca Market Data response: {}", error))
}
