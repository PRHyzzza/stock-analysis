/// API 客户端模块 — 按数据源拆分
pub mod eastmoney;
pub mod hotlist;
pub mod llm;
pub mod tencent;
pub mod web;

/// 构建项目统一的 HTTP 客户端
pub fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

// 重导出高频 API 函数，保持与 commands.rs 兼容
pub use eastmoney::{fetch_industry_analysis, fetch_industry_name, fetch_money_flow as fetch_money_flow_eastmoney, fetch_sector_money_flow, parse_industry_analysis};
pub use hotlist::fetch_hot_list;
pub use llm::{call_llm, call_llm_stream};
pub use tencent::{fetch_index_quote, fetch_intraday_data, fetch_kline_data, fetch_money_flow, fetch_search_results, fetch_stock_quote};
pub use web::{web_fetch, web_search, WebSearchResult};
