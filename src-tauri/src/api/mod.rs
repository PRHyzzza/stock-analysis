/// API 客户端模块 — 按数据源拆分
pub mod eastmoney;
pub mod hotlist;
pub mod llm;
pub mod tencent;

// 重导出高频 API 函数，保持与 commands.rs 兼容
pub use eastmoney::{fetch_industry_analysis, fetch_industry_name, fetch_money_flow as fetch_money_flow_eastmoney};
pub use hotlist::fetch_hot_list;
pub use llm::call_llm;
pub use tencent::{fetch_index_quote, fetch_intraday_data, fetch_kline_data, fetch_money_flow, fetch_search_results, fetch_stock_quote};
