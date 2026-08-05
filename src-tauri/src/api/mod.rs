/// API 客户端模块 — 按数据源拆分
pub mod eastmoney;
pub mod hotlist;
pub mod llm;
pub mod tencent;
pub mod web;

use std::sync::OnceLock;
use std::time::Duration;

/// 通用 HTTP 客户端（全局复用，避免每次请求重建连接池 + TLS 握手）
static HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
/// LLM 专用 HTTP 客户端（无总超时，流式响应可能持续数分钟）
static LLM_HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

/// 构建项目统一的 HTTP 客户端
/// 连接超时 10s，总超时 15s，防止单个请求卡死整个流程
/// 返回全局单例引用（reqwest::Client 线程安全，连接池可复用）
pub fn build_http_client() -> Result<&'static reqwest::Client, String> {
    HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .danger_accept_invalid_certs(true)
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(15))
                .build()
                .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// 构建 LLM 专用 HTTP 客户端（无总超时，流式响应可能持续数分钟）
/// 返回全局单例引用（非流式工具调用环同样适用，避免 15s 超时截断）
pub fn build_llm_http_client() -> Result<&'static reqwest::Client, String> {
    LLM_HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .danger_accept_invalid_certs(true)
                .connect_timeout(Duration::from_secs(10))
                .pool_idle_timeout(Duration::from_secs(90))
                .build()
                .map_err(|e| format!("创建 LLM HTTP 客户端失败: {}", e))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

// 重导出高频 API 函数，保持与 commands.rs 兼容
pub use eastmoney::{fetch_industry_analysis, fetch_industry_name, fetch_money_flow as fetch_money_flow_eastmoney, fetch_sector_money_flow, parse_industry_analysis};
pub use hotlist::fetch_hot_list;
pub use llm::{call_llm, call_llm_stream};
pub use tencent::{fetch_index_quote, fetch_intraday_data, fetch_kline_data, fetch_money_flow, fetch_search_results, fetch_stock_quote, fetch_stock_quotes_batch};
pub use web::{web_fetch, web_search, WebSearchResult};
