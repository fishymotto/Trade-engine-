use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeTagVisibilitySettings {
    #[serde(default = "default_true")]
    status: bool,
    #[serde(default = "default_true")]
    mistake: bool,
    #[serde(default = "default_true")]
    playbook: bool,
    #[serde(default = "default_true")]
    catalyst: bool,
    #[serde(default = "default_true")]
    game: bool,
    #[serde(default = "default_true")]
    out_tag: bool,
    #[serde(default = "default_true")]
    execution: bool,
}

fn default_true() -> bool {
    true
}

fn default_trade_tag_visibility() -> TradeTagVisibilitySettings {
    TradeTagVisibilitySettings {
        status: true,
        mistake: true,
        playbook: true,
        catalyst: true,
        game: true,
        out_tag: true,
        execution: true,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    notion_token: String,
    notion_database_url: String,
    export_folder: String,
    twelve_data_api_key: String,
    brl_to_usd_rate: f64,
    brl_ticker_list: String,
    #[serde(default)]
    daily_shutdown_risk_usd: f64,
    #[serde(default = "default_trade_tag_visibility")]
    trade_tag_visibility: TradeTagVisibilitySettings,
}

pub fn default_settings() -> AppSettings {
    AppSettings {
        notion_token: String::new(),
        notion_database_url: String::new(),
        export_folder: String::new(),
        twelve_data_api_key: String::new(),
        brl_to_usd_rate: 0.0,
        brl_ticker_list:
            "BBAS3, ITSA4, BBDC4, VALE3, ASAI3, CEAB3, ABEV3, PETR4, PRIO3, CSAN3, BRAV3, RECV3, COGN3, AMBP3, GGPS3, WEGE3, EMBJ3, HAPV3"
                .to_string(),
        daily_shutdown_risk_usd: 0.0,
        trade_tag_visibility: default_trade_tag_visibility(),
    }
}
