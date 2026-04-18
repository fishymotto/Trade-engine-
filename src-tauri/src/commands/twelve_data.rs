use serde_json::Value;

use crate::services::twelve_data;

#[tauri::command]
pub async fn fetch_twelve_data_time_series(
    api_key: String,
    symbol: String,
    exchange: Option<String>,
    interval: String,
    start_date: Option<String>,
    end_date: Option<String>,
    output_size: Option<u32>,
) -> Result<Value, String> {
    twelve_data::fetch_time_series(api_key, symbol, exchange, interval, start_date, end_date, output_size).await
}

