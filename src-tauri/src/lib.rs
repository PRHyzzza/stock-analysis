// Stock Analysis - Tauri backend
//
// Modules:
//   types     - data structures (StockQuote, KlineItem, IndustryData, etc.)
//   helpers   - utility functions (code conversion, JSON parsing)
//   api       - API client functions (Tencent, East Money)
//   commands  - Tauri command handlers

mod api;
pub mod commands;
pub mod helpers;
pub mod types;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_stock_industry,
            commands::get_stock_intraday,
            commands::get_stock_kline,
            commands::get_stock_quote,
            commands::get_market_indices,
            commands::search_stocks,
            commands::get_stock_money_flow,
            commands::get_hot_list,
            commands::call_llm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
