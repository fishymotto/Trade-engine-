use serde_json::Value;

use crate::services::alpaca;

#[tauri::command]
pub async fn fetch_alpaca_stock_trades(
    api_key: String,
    secret_key: String,
    symbol: String,
    feed: Option<String>,
    start: String,
    end: String,
    limit: Option<u32>,
    page_token: Option<String>,
) -> Result<Value, String> {
    alpaca::fetch_stock_trades(api_key, secret_key, symbol, feed, start, end, limit, page_token).await
}
