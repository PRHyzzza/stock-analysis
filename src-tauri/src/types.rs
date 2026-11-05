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
    pub market: String, // "SH" / "SZ" / "HK"
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

/// 版本更新信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,   // 当前版本
    pub latest: String,    // 最新版本
    pub url: String,       // Release 页面 URL
    pub has_update: bool,  // 是否有新版本
}

/// 完整的行业分析数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndustryData {
    pub industry_name: String,
    pub market_performance: Vec<MarketPerformance>,     // 市场表现
    pub revenue_ranking: Vec<RevenueRanking>,           // 营收排名
}

/// 分时数据条目
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntradayItem {
    pub time: String,    // HH:mm
    pub price: f64,
    pub avg_price: f64,  // 简单均价
    pub volume: f64,     // 成交量（手）
    pub turnover: f64,   // 成交额（元）
    pub vwap: f64,       // VWAP 累计加权均价
}

/// 分时完整数据
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntradayData {
    pub items: Vec<IntradayItem>,
    pub pre_close: f64,
    pub date: String,
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

/// 个股资金流向数据（全部分档净流入 + 占比）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MoneyFlow {
    pub main_net_inflow: f64,     // 主力净流入（万元）
    pub main_net_pct: f64,        // 主力净占比 (%)
    pub super_large_net: f64,     // 超大单净流入（万元）
    pub super_large_pct: f64,     // 超大单净占比 (%)
    pub large_net: f64,           // 大单净流入（万元）
    pub large_pct: f64,           // 大单净占比 (%)
    pub medium_net: f64,          // 中单净流入（万元）
    pub medium_pct: f64,          // 中单净占比 (%)
    pub small_net: f64,           // 小单净流入（万元）
    pub small_pct: f64,           // 小单净占比 (%)
}

/// 单日资金流向历史条目（东方财富 daykline，单位：万元）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MoneyFlowHistoryItem {
    pub date: String,             // 交易日 YYYY-MM-DD
    pub main_net_inflow: f64,     // 主力净流入（万元）
    pub super_large_net: f64,     // 超大单净流入（万元）
    pub large_net: f64,           // 大单净流入（万元）
    pub medium_net: f64,          // 中单净流入（万元）
    pub small_net: f64,           // 小单净流入（万元）
    pub close: f64,               // 收盘价
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

// ── 短线情绪 / 题材（同花顺 special-data + 同花顺指数）──────

/// 市场情绪温度计（涨停强度）
///
/// 只做**短线环境描述**：封板率 / 涨跌停家数 / 连板高度 / 题材热度。
/// 全部来自同花顺当日数据，字段缺失一律保留 `None`，不用 0 冒充（0 跌停与「没拿到」是两件事）。
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MarketSentiment {
    pub trade_date: String,          // 归属交易日 YYYY-MM-DD
    pub fetched_at: i64,             // 数据就绪时间（毫秒）
    pub seal_rate: Option<f64>,      // 封板率（0-1 小数）
    pub limit_up: i64,               // 封板家数
    pub touched: i64,                // 触板家数（封板率的基数）
    pub open_count: i64,             // 炸板家数
    pub limit_down: Option<i64>,     // 跌停家数（拉取失败时为 None，不写 0）
    pub max_board: i64,              // 当日最高连板数
    pub boards: Vec<BoardLevelItem>, // 连板档位分布
    pub themes: Vec<ThemeItem>,      // 涨停原因题材热度（Top N）
}

/// 连板档位（一板/二板/…/五板以上）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoardLevelItem {
    pub level: String,                // one / two / three / four / five_plus
    pub count: i64,                   // 家数
    pub promotion_rate: Option<f64>,  // 晋级率（0-1；one 档为 None）
}

/// 题材热度项（涨停原因分组计数）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeItem {
    pub name: String,
    pub count: i64,
}

/// 个股所属的板块（同花顺概念 / 行业）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StockSectors {
    pub code: String,        // 6 位裸码
    pub sectors: Vec<SectorRef>,
}

/// 板块引用
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SectorRef {
    pub thscode: String, // 如 886042.TI
    pub name: String,
    pub kind: String,    // cn_concept / industry / region / tzs
}

/// 板块当日强度（快照涨幅）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SectorQuote {
    pub thscode: String,
    /// 当日涨跌幅（百分数原值，如 3.21）；快照缺该字段时为 None，不写 0
    pub change_pct: Option<f64>,
}

/// 板块强度组合结果：板块涨幅 + 个股→板块映射
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SectorStrength {
    pub fetched_at: i64,
    pub quotes: Vec<SectorQuote>,
    pub by_stock: Vec<StockSectors>,
}

/// 写入本地历史库的信号事件（前端 signals 计算完成后回传）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignalEventInput {
    pub code: String,
    #[serde(default)]
    pub kind: String,   // trap / volume / ma / t0 等来源分类
    #[serde(default)]
    pub name: String,   // 信号名称（含 emoji 前缀，原样保留）
    #[serde(default)]
    pub time: String,   // 时间锚点，日 K 类信号可为空
    #[serde(default)]
    pub dir: String,    // bull / bear
    #[serde(default)]
    pub detail: String, // 说明文本
    #[serde(default)]
    pub price: f64,
}

/// 写入本地历史库的提醒事件（通知成功发送后回传）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AlertEventInput {
    pub code: String,
    #[serde(default)]
    pub kind: String, // watchlist / ma / price
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub price: f64,
    #[serde(default)]
    pub target: f64, // 触发目标价（无则 0）
}

/// 从本地历史库读出的信号事件（历史信号胜率统计用）
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignalEventRow {
    pub ts: i64,
    pub date: String,   // YYYY-MM-DD（UTC+8）
    pub code: String,
    pub kind: String,   // trap / volume
    pub name: String,
    pub time: String,   // 日内时间锚点，日 K 类信号为空
    pub dir: String,    // bull / bear
    pub detail: String,
    pub price: f64,     // 触发时价格（0 表示未记录，无法计算收益）
}

/// 本地历史库概况
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DbStats {
    pub path: String,
    pub size_bytes: u64,
    pub quote_rows: i64,
    pub quote_codes: i64,
    pub quote_first_date: String,
    pub quote_last_date: String,
    pub kline_rows: i64,
    pub kline_codes: i64,
    pub kline_first_date: String,
    pub kline_last_date: String,
    pub money_rows: i64,
    pub signal_rows: i64,
    pub alert_rows: i64,
    pub watchlist_rows: i64,
    /// 各事件表的今日（UTC+8）条数，用于区分「累计」与「今天真的发生过」
    #[serde(default)]
    pub signal_rows_today: i64,
    #[serde(default)]
    pub alert_rows_today: i64,
    /// 提醒事件按（代码/日期/类型）去重后的条数；alert_event 不去重落库，仅按行数展示会夸大触发次数
    #[serde(default)]
    pub alert_rows_distinct: i64,
    /// alert_event 的日期覆盖范围（YYYY-MM-DD，无数据为空串）
    #[serde(default)]
    pub alert_first_date: String,
    #[serde(default)]
    pub alert_last_date: String,
}


// ── 短线事件（连板天梯 / 集合竞价异动）──────────────

/// 连板梯队（近 30 个交易日）
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LimitUpLadder {
    pub fetched_at: i64,
    /// 窗口内交易日，按接口返回顺序（新 → 旧）
    pub dates: Vec<String>,
    pub days: Vec<LadderDay>,
}

/// 某个交易日的连板矩阵
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LadderDay {
    pub date: String,
    pub stocks: Vec<LadderStock>,
}

/// 连板矩阵里的单只票
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LadderStock {
    pub code: String,
    pub name: String,
    /// 连板数（2 板及以上）
    pub board_num: i64,
    /// 次一交易日是否继续封板（晋级）；最近交易日没有次日参考，为 None
    pub seal_nextday: Option<bool>,
}

/// 集合竞价异动（按代码批量查询）
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AuctionOpportunities {
    pub fetched_at: i64,
    pub trade_date: String,
    pub items: Vec<AuctionItem>,
}

/// 单条竞价异动
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuctionItem {
    pub code: String,
    pub name: String,
    /// 异动名称，如「涨停试盘」
    pub warn_name: String,
    /// 原始类型码（68710 等），上游新增类型时名称可能为 null
    pub warn_type: String,
    pub bid_price: Option<f64>,
    /// 竞价涨幅（百分数，已从上游的小数比例 ×100）
    pub bid_change_pct: Option<f64>,
    pub bid_amount: Option<f64>,
    pub prev_amount: Option<f64>,
    /// 异动时间 HH:mm（上海时区）
    pub at: Option<String>,
}
