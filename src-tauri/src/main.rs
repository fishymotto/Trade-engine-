#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod models;
mod services;
mod utils;

use commands::*;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_export_folder,
            save_export_csv,
            pick_and_save_playbook_attachment,
            delete_playbook_attachment,
            open_external_url,
            load_app_settings,
            save_app_settings,
            load_trade_sessions,
            save_trade_sessions,
            load_trade_tag_overrides,
            save_trade_tag_overrides,
            load_trade_tag_options,
            save_trade_tag_options,
            notion_api_request,
            fetch_twelve_data_time_series
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
