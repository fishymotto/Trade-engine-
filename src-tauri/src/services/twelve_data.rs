use serde_json::Value;

pub async fn fetch_time_series(
    api_key: String,
    symbol: String,
    exchange: Option<String>,
    interval: String,
    start_date: Option<String>,
    end_date: Option<String>,
    output_size: Option<u32>,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let mut request = client
        .get("https://api.twelvedata.com/time_series")
        .query(&[
            ("symbol", symbol.as_str()),
            ("interval", interval.as_str()),
            ("format", "JSON"),
            ("apikey", api_key.as_str()),
        ]);

    if let Some(start_date) = start_date.as_ref() {
        if !start_date.trim().is_empty() {
            request = request.query(&[("start_date", start_date.as_str())]);
        }
    }

    if let Some(end_date) = end_date.as_ref() {
        if !end_date.trim().is_empty() {
            request = request.query(&[("end_date", end_date.as_str())]);
        }
    }

    if let Some(output_size) = output_size {
        request = request.query(&[("outputsize", output_size.to_string())]);
    }

    if let Some(exchange) = exchange.as_ref() {
        if !exchange.trim().is_empty() {
            request = request.query(&[("exchange", exchange.as_str())]);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not reach Twelve Data: {}", error))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read Twelve Data response: {}", error))?;

    if !status.is_success() {
        return Err(if text.is_empty() {
            format!("Twelve Data returned {}", status)
        } else {
            text
        });
    }

    serde_json::from_str(&text).map_err(|error| format!("Invalid Twelve Data response: {}", error))
}

