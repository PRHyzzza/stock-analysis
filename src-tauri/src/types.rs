use serde::{Deserialize, Serialize};

/// 个股行情数据 (from Tencent API)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StockQuote {
    pub code: String,
    pub name: String,
    pub price: f64,
    pub prev_close: f64,
    pub open: f64,
    pub volume: f64,       // 成交量（手）
    pub turnover: f64,     // 成交额（万）
    pub change: f64,
    pub change_pct: f64,
    pub high: f64,
    pub low: f64,
    pub turnover_rate: f64, // 换手率
    pub pe: f64,           // 市盈率
    pub amplitude: f64,    // 振幅
}

/// 股票搜索结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub code: String,
    pub name: String,
    pub market: String, // "SH" / "SZ"
}

/// 营收排名数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RevenueRanking {
    pub stock_code: String,
    pub stock_name: String,
    pub total_operate_income: f64,      // 营业收入（元）
    pub total_operate_income_rank: i64, // 营收排名
}

/// 市场表现
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MarketPerformance {
    pub changerate: f64,         // 涨跌幅
    pub hs300_changerate: f64,    // 沪深300涨跌幅
    pub time_type: i64,          // 1:今日, 2:本周, 3:本月, 4:今年以来
}

/// 大盘指数数据
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MarketIndex {
    pub code: String,
    pub name: String,
    pub price: f64,
    pub change: f64,
    pub change_pct: f64,
}

/// 完整的行业分析数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndustryData {
    pub industry_name: String,
    pub market_performance: Vec<MarketPerformance>,     // 市场表现
    pub revenue_ranking: Vec<RevenueRanking>,           // 营收排名
}

/// K 线数据条目
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KlineItem {
    pub date: String,
    pub open: f64,
    pub close: f64,
    pub high: f64,
    pub low: f64,
    pub volume: f64,
    pub turnover: f64,
}

/// 主力资金流向数据（仅保留主力净流入）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MoneyFlow {
    pub main_net_inflow: f64,  // 主力净流入（万元）
    pub main_net_pct: f64,     // 主力净占比 (%)
}

/// 热榜股票条目
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HotStockItem {
    pub code: String,
    pub name: String,
    pub rate: String,            // 热度值
    pub rise_and_fall: f64,      // 涨跌幅
    pub hot_rank_chg: i64,       // 排名变化
    pub order: i64,              // 排名序号
    pub market: i64,             // 市场标识 17=SH, 33=SZ
    pub tags: Vec<String>,       // 概念标签
    pub popularity_tag: String,  // 人气标签
}

/// 热榜数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HotListData {
    pub stock_list: Vec<HotStockItem>,
}

