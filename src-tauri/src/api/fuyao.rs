/// 同花顺 Fuyao 官方数据 API（REST）
///
/// 覆盖范围（有 API Key 时优先走这里）：
/// - 标的检索 `/api/meta/tickers/search`：返回规范 thscode / ticker / name / exchange，
///   替代腾讯的联想搜索（代码与名称更权威，且能区分沪深北）
/// - 历史日 K `/api/a-share/prices/historical`：前复权、最长 10 年、带真实成交额；
///   周/月 K 由日 K 本地聚合（官方仅提供 `1d`）
/// - 热榜 `/api/a-share/special-data/hot-stock-list`：官方榜单，替代抓 10jqka 页面
/// - 短线情绪 `/api/a-share/special-data/limit-up-statistics` + `limit-up-pool` + `limit-down-pool`：
///   封板率 / 涨跌停家数 / 连板高度 / 涨停原因题材词频（超短线唯一可用的「环境温度」）
/// - 题材强度 `/api/a-share-index/constituents/ths-index-list-by-stock` + 板块快照：
///   个股所属概念/行业 + 板块当日涨幅
/// - 交易日历见 `calendar.rs`（同一个 Key）
///
/// 刻意**不做**的（官方能力不足或明确不对外，替换会降级）：
/// - 实时行情快照：Fuyao 快照没有 `name` / 换手率 / PE / 振幅，而本项目行情卡与 AI 上下文都要这些字段
/// - 分时、分钟 K：官方 K 线仅 `1d`，分钟与分时仍走腾讯
/// - 主力资金：官方文档明确「当前不作为端外接入入口」
/// - 指数行情：本项目指数走腾讯批量接口，字段齐全
///
/// 单位约定（与腾讯路径保持一致，勿在两处各写一套）：
/// - `KlineItem.volume`：手（Fuyao 返回股，÷100）
/// - `KlineItem.turnover`：恒为 0（腾讯日 K 无该字段，全项目按 `volume×close` 兜底，不在此处悄悄改成元）
/// - 失败一律返回可读中文错误，调用方负责降级到腾讯
use crate::types::{
    AuctionItem, AuctionOpportunities, BoardLevelItem, HotListData, HotStockItem, KlineItem,
    LadderDay, LadderStock, LimitUpLadder, MarketSentiment, SearchResult, SectorQuote, SectorRef,
    SectorStrength, StockSectors, ThemeItem,
};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

/// Fuyao API 基础地址
const BASE: &str = "https://fuyao.aicubes.cn";
/// 一天的毫秒数
const MS_DAY: i64 = 86_400_000;

// ── 代码与 thscode ─────────────────────────────────────

/// 6 位 A 股代码 → Fuyao thscode（带交易所后缀）
///
/// 规则与 `utils/market.js` / `utils/limit.js` 保持一致：
/// 43/82/83/87/88/92 → BJ；6/9 → SH；其余 → SZ。港股（5 位）与非法输入返回 None。
/// 入参允许带 `sh/sz/bj` 前缀或 `.SH/.SZ/.BJ` 后缀（外部来源常见）。
pub fn to_thscode(code: &str) -> Option<String> {
    let raw = code.trim();
    let stripped = raw
        .trim_start_matches(|c: char| c.is_ascii_alphabetic())
        .trim_start_matches('.');
    let digits = stripped.split('.').next().unwrap_or(stripped).trim();
    if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let suffix = if matches!(&digits[..2], "43" | "82" | "83" | "87" | "88" | "92") {
        "BJ"
    } else if digits.starts_with('6') || digits.starts_with('9') {
        "SH"
    } else {
        "SZ"
    };
    Some(format!("{}.{}", digits, suffix))
}

/// thscode → 6 位 ticker（去掉交易所后缀）
pub fn ticker_of(thscode: &str) -> &str {
    thscode.split('.').next().unwrap_or(thscode)
}

/// 交易所后缀 → 热榜里的市场标识（17=SH / 33=SZ；北交所官方榜单不出现，统一 0）
fn market_id(exchange: &str) -> i64 {
    match exchange {
        "SH" => 17,
        "SZ" => 33,
        _ => 0,
    }
}

// ── 时间 ──────────────────────────────────────────────

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 毫秒时间戳 → `YYYY-MM-DD`（按 Asia/Shanghai，UTC+8）
pub fn date_from_ms(ms: i64) -> String {
    let (y, m, d) = civil_from_days((ms + 8 * 3_600_000).div_euclid(MS_DAY));
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Howard Hinnant civil_from_days：日数 → (年, 月, 日)
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y } as i32, m, d)
}

/// (年, 月, 日) → 距 1970-01-01 的自然日数
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = y as i64 - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

/// `YYYY-MM-DD` → 自然日数（非法返回 None）
fn parse_date(date: &str) -> Option<i64> {
    let mut it = date.split('-');
    let y: i32 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let d: u32 = it.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

/// 周一为 0 的星期序号（1970-01-01 是周四）
fn weekday_mon0(days: i64) -> i64 {
    (days + 3).rem_euclid(7)
}

// ── HTTP ──────────────────────────────────────────────

/// 业务错误码 → 可读中文（与 `calendar.rs` 的口径一致）
fn map_code(code: i64, msg: &str, what: &str) -> String {
    match code {
        2001 => "[NO_API_KEY] 同花顺 API Key 缺失或无效，请在「设置」里填写".to_string(),
        2003 => "[INVALID_KEY] 同花顺 API Key 无该接口权限".to_string(),
        4001 => "[RATE_LIMITED] 同花顺接口触发限流，请稍后重试".to_string(),
        1001 | 1002 | 1003 | 1004 => format!("{}参数不合法(code={}): {}", what, code, msg),
        _ => format!("{}接口返回 code={}: {}", what, code, msg),
    }
}

/// GET 一个 Fuyao 接口并解出 `data`
async fn fetch_data(path_query: &str, api_key: &str, what: &str) -> Result<Value, String> {
    let client = super::build_http_client()?;
    let url = format!("{}{}", BASE, path_query);
    let resp = client
        .get(&url)
        .header("X-api-key", api_key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求{}失败: {}", what, e))?;

    // 统一入口：先校状态码再解析，避免 WAF 的 HTML 被误报成 JSON 解析失败
    let body = super::read_json(resp, what).await?;
    let code = body["code"].as_i64().unwrap_or(-1);
    if code != 0 {
        let msg = body["message"].as_str().unwrap_or("");
        return Err(map_code(code, msg, what));
    }
    Ok(body["data"].clone())
}

fn num(v: &Value) -> f64 {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0)
}

// ── 标的检索 ──────────────────────────────────────────

/// 解析检索结果（纯函数，便于单测）
fn parse_search(data: &Value) -> Vec<SearchResult> {
    data["item"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|it| {
                    let ticker = it["ticker"].as_str()?.trim();
                    let exchange = it["exchange"].as_str().unwrap_or("").trim();
                    if ticker.len() != 6 || exchange.is_empty() {
                        return None;
                    }
                    Some(SearchResult {
                        code: ticker.to_string(),
                        name: it["name"].as_str().unwrap_or("").to_string(),
                        market: exchange.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 按关键词检索 A 股（走官方 ticker search）
pub async fn fetch_search(keyword: &str, api_key: &str, limit: u32) -> Result<Vec<SearchResult>, String> {
    let q: String = url::form_urlencoded::byte_serialize(keyword.trim().as_bytes()).collect();
    let limit = limit.clamp(1, 50);
    let data = fetch_data(
        &format!(
            "/api/meta/tickers/search?q={}&asset_type=a-share&limit={}",
            q, limit
        ),
        api_key,
        "标的检索",
    )
    .await?;
    Ok(parse_search(&data))
}

// ── 历史 K 线 ─────────────────────────────────────────

/// 解析日 K（纯函数）：volume 股 → 手，turnover 恒 0（见文件头单位约定）
fn parse_bars(data: &Value) -> Vec<KlineItem> {
    let mut bars: Vec<KlineItem> = data["item"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|it| {
                    let ms = it["date_ms"].as_i64()?;
                    Some(KlineItem {
                        date: date_from_ms(ms),
                        open: num(&it["open_price"]),
                        close: num(&it["close_price"]),
                        high: num(&it["high_price"]),
                        low: num(&it["low_price"]),
                        volume: num(&it["volume"]) / 100.0,
                        turnover: 0.0,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    bars.sort_by(|a, b| a.date.cmp(&b.date));
    bars.dedup_by(|a, b| a.date == b.date);
    bars.retain(|b| b.close > 0.0);
    bars
}

/// 把日 K 聚合成周/月 K（纯函数）
///
/// - 周：按「周一日期」分组，取该周最后一个交易日作为 label（与腾讯周 K 的日期口径一致）
/// - 月：按自然月分组，取该月最后一个交易日作为 label
/// - open 取首根、close 取末根、high/low 取极值、volume 求和
pub fn aggregate(bars: &[KlineItem], period: &str) -> Vec<KlineItem> {
    if period != "week" && period != "month" {
        return bars.to_vec();
    }
    let mut out: Vec<(String, KlineItem)> = Vec::new();
    for bar in bars {
        let Some(days) = parse_date(&bar.date) else { continue };
        let key = if period == "week" {
            format!("w{}", days - weekday_mon0(days))
        } else {
            format!("m{}", &bar.date[..7.min(bar.date.len())])
        };
        match out.last_mut() {
            Some((k, agg)) if *k == key => {
                agg.high = agg.high.max(bar.high);
                agg.low = agg.low.min(bar.low);
                agg.close = bar.close;
                agg.volume += bar.volume;
                agg.turnover += bar.turnover;
                agg.date = bar.date.clone();
            }
            _ => {
                out.push((
                    key,
                    KlineItem {
                        date: bar.date.clone(),
                        open: bar.open,
                        close: bar.close,
                        high: bar.high,
                        low: bar.low,
                        volume: bar.volume,
                        turnover: bar.turnover,
                    },
                ));
            }
        }
    }
    out.into_iter().map(|(_, b)| b).collect()
}

/// 取多少天的窗口才够凑出 `limit` 根周/月 K（10 年封顶，符合官方限制）
fn window_days(period: &str, limit: u32) -> i64 {
    let l = limit.max(1) as i64;
    let d = match period {
        "week" => l * 7 + 14,
        "month" => l * 31 + 40,
        _ => l * 2 + 10,
    };
    d.min(3650)
}

/// 拉取日/周/月 K（前复权）
///
/// @param period 已由调用方归一化（day/week/month）
/// @param limit  期望返回的根数（靠尾部截断）
pub async fn fetch_kline(
    code: &str,
    period: &str,
    limit: u32,
    api_key: &str,
) -> Result<Vec<KlineItem>, String> {
    let thscode = to_thscode(code).ok_or_else(|| "同花顺 K 线仅支持 6 位 A 股代码".to_string())?;
    let end = now_ms();
    let start = end - window_days(period, limit) * MS_DAY;
    let data = fetch_data(
        &format!(
            "/api/a-share/prices/historical?thscode={}&interval=1d&start={}&end={}&adjust=forward",
            thscode, start, end
        ),
        api_key,
        "历史 K 线",
    )
    .await?;

    let daily = parse_bars(&data);
    if daily.is_empty() {
        return Err("同花顺 K 线数据为空".to_string());
    }
    let mut bars = aggregate(&daily, period);
    let keep = limit.max(1) as usize;
    if bars.len() > keep {
        bars = bars.split_off(bars.len() - keep);
    }
    Ok(bars)
}

// ── 热榜 ──────────────────────────────────────────────

/// 解析热榜（纯函数）
fn parse_hot(data: &Value) -> Vec<HotStockItem> {
    data["item"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|it| {
                    let thscode = it["thscode"].as_str().unwrap_or("");
                    let ticker = it["ticker"].as_str().unwrap_or_else(|| ticker_of(thscode));
                    if ticker.len() != 6 {
                        return None;
                    }
                    let exchange = thscode.split('.').nth(1).unwrap_or("");
                    Some(HotStockItem {
                        code: ticker.to_string(),
                        name: it["name"].as_str().unwrap_or("").to_string(),
                        rate: it["heat"].as_str().unwrap_or("0").to_string(),
                        // 涨跌幅由调用方用批量快照补齐；拿不到时保持 0 并在日志里说明
                        rise_and_fall: 0.0,
                        hot_rank_chg: it["rank_change"].as_i64().unwrap_or(0),
                        order: it["rank"].as_i64().unwrap_or(0),
                        market: market_id(exchange),
                        tags: Vec::new(),
                        popularity_tag: String::new(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 批量取涨跌幅（热榜补字段用；失败不影响榜单本身）
async fn fetch_change_map(codes: &[String], api_key: &str) -> Result<Vec<(String, f64)>, String> {
    if codes.is_empty() {
        return Ok(Vec::new());
    }
    let thscodes: Vec<String> = codes.iter().filter_map(|c| to_thscode(c)).collect();
    if thscodes.is_empty() {
        return Ok(Vec::new());
    }
    let data = fetch_data(
        &format!("/api/a-share/prices/snapshot?thscodes={}", thscodes.join(",")),
        api_key,
        "行情快照",
    )
    .await?;
    Ok(data["item"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|it| {
                    let ticker = it["ticker"].as_str()?.to_string();
                    Some((ticker, num(&it["price_change_ratio_pct"])))
                })
                .collect()
        })
        .unwrap_or_default())
}

/// 获取同花顺官方热榜（日榜），并用快照补齐涨跌幅
pub async fn fetch_hot_list(api_key: &str, limit: u32) -> Result<HotListData, String> {
    let limit = limit.clamp(1, 100);
    let data = fetch_data(
        &format!(
            "/api/a-share/special-data/hot-stock-list?period=day&limit={}",
            limit
        ),
        api_key,
        "热榜",
    )
    .await?;

    let mut items = parse_hot(&data);
    if items.is_empty() {
        return Err("同花顺热榜返回空列表".to_string());
    }
    let codes: Vec<String> = items.iter().map(|i| i.code.clone()).collect();
    match fetch_change_map(&codes, api_key).await {
        Ok(map) => {
            for item in items.iter_mut() {
                if let Some((_, pct)) = map.iter().find(|(c, _)| *c == item.code) {
                    item.rise_and_fall = *pct;
                }
            }
        }
        // 涨跌幅是附加信息：拿不到就保持 0，榜单本身仍然可用
        Err(e) => eprintln!("[fuyao] 热榜涨跌幅补齐失败: {e}"),
    }
    Ok(HotListData { stock_list: items })
}

// ── 短线情绪 / 题材（special-data + 同花顺指数）────────
//
// 这几条接口是**短线/超短线**的核心输入，与日 K 打分互补：
// 日 K 说明「这票最近强不强」，情绪与题材说明「今天的钱往哪儿走」。
// 全部需要 Key；任何一条失败都只降级自己，不影响其它字段（缺失一律保留 None，不写 0）。

/// `YYYY-MM-DD` → 该日上海时区零点的毫秒戳（special-data 的 `date_ms` 要的就是这个）
fn date_to_ms(date: &str) -> Option<i64> {
    parse_date(date).map(|d| d * MS_DAY - 8 * 3_600_000)
}

/// 涨停原因 → 题材词（按常见分隔符拆开）
///
/// 上游 `limit_up_reason` 形如「存储芯片」「AI算力+液冷」「机器人、减速器」，
/// 直接按整串计数会把「同一题材的不同写法」拆散，所以先拆再统计。
/// 超过 12 个字的片段大概率是整句话而非题材名，直接丢弃（宁可少数，不要噪音）。
///
/// **实测（2026-11-05 盘中）**：涨停池里大量记录的 `limit_up_reason` 是「其它」——
/// 上游归因尚未完成时就用这个词占位。把它当题材统计会让 Top1 永远是「其它」，
/// 因此这里是硬过滤：占位词一律不计数，全天都对不齐时 `themes` 返回空，
/// 由前端如实显示「题材归因暂未就绪」，而不是编一个榜首出来。
fn split_themes(reason: &str) -> Vec<String> {
    const PLACEHOLDERS: [&str; 6] = ["其它", "其他", "无", "未知", "--", "暂未归因"];
    reason
        .split(|c: char| {
            matches!(
                c,
                '+' | '＋' | '、' | '/' | '，' | ',' | ';' | '；' | ' ' | '　' | '|' | '｜'
            )
        })
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && s.chars().count() <= 12)
        .filter(|s| !PLACEHOLDERS.contains(s))
        .map(|s| s.to_string())
        .collect()
}

/// 涨停池 → 题材热度 Top N（纯函数，便于单测）
///
/// 同一只票里重复出现的同一题材只计一次（避免一条 reason 写两遍把计数刷高）。
fn theme_heat(items: &[Value], top: usize) -> Vec<ThemeItem> {
    use std::collections::{HashMap, HashSet};
    let mut count: HashMap<String, i64> = HashMap::new();
    for it in items {
        let reason = it["limit_up_reason"].as_str().unwrap_or("").trim();
        if reason.is_empty() {
            continue;
        }
        let mut seen: HashSet<String> = HashSet::new();
        for theme in split_themes(reason) {
            if !seen.insert(theme.clone()) {
                continue;
            }
            *count.entry(theme).or_insert(0) += 1;
        }
    }
    let mut list: Vec<ThemeItem> = count
        .into_iter()
        .map(|(name, count)| ThemeItem { name, count })
        .collect();
    // 计数降序；同分按名称升序，保证同样输入永远同样顺序（前端缓存与快照对比才不会抖）
    list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    list.truncate(top);
    list
}

/// 涨停统计 + 涨停池 → MarketSentiment（纯函数）
fn parse_sentiment(
    stats: &Value,
    pool_items: &[Value],
    limit_down: Option<i64>,
) -> MarketSentiment {
    let boards = stats["page_boards"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|b| {
                    Some(BoardLevelItem {
                        level: b["board_level"].as_str()?.to_string(),
                        count: b["stock_count"].as_i64().unwrap_or(0),
                        promotion_rate: b["promotion_rate"].as_f64(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // 最高连板取池内 continue_day_cnt 的最大值；池按连板倒序返回，但这里不依赖排序
    let max_board = pool_items
        .iter()
        .map(|it| it["continue_day_cnt"].as_i64().unwrap_or(0))
        .max()
        .unwrap_or(0);

    MarketSentiment {
        trade_date: stats["trade_date"].as_str().unwrap_or("").to_string(),
        fetched_at: stats["timestamp"].as_i64().unwrap_or_else(now_ms),
        seal_rate: stats["seal_rate"].as_f64(),
        limit_up: stats["limit_up_stock_count"].as_i64().unwrap_or(0),
        touched: stats["touched_limit_up_stock_count"].as_i64().unwrap_or(0),
        open_count: stats["open_stock_count"].as_i64().unwrap_or(0),
        limit_down,
        max_board,
        boards,
        themes: theme_heat(pool_items, 8),
    }
}

/// 拉取当日市场情绪（涨停统计 + 涨停池题材 + 跌停家数）
///
/// 三次请求都是轻量的；前端按交易日 + 5 分钟缓存，不会每次打分都打接口。
pub async fn fetch_market_sentiment(
    date: Option<&str>,
    api_key: &str,
) -> Result<MarketSentiment, String> {
    let date = date
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| date_from_ms(now_ms()));
    let ms = date_to_ms(&date).ok_or_else(|| format!("非法交易日: {}", date))?;

    let stats = fetch_data(
        &format!("/api/a-share/special-data/limit-up-statistics?date={}", date),
        api_key,
        "涨停统计",
    )
    .await?;

    // 涨停池：200 条上限覆盖绝大多数交易日，用来取最高连板与题材词频
    let pool = fetch_data(
        &format!(
            "/api/a-share/special-data/limit-up-pool?date_ms={}&page=1&size=200&sort_field=continue_day_cnt&sort_dir=desc",
            ms
        ),
        api_key,
        "涨停池",
    )
    .await?;
    let pool_items = pool["item"].as_array().cloned().unwrap_or_default();

    // 跌停家数：拿不到就保持 None——0 跌停和「没拿到」在情绪判断里是两回事
    let limit_down = match fetch_data(
        &format!(
            "/api/a-share/special-data/limit-down-pool?date_ms={}&page=1&size=1",
            ms
        ),
        api_key,
        "跌停池",
    )
    .await
    {
        Ok(v) => v["pagination"]["total"].as_i64(),
        Err(e) => {
            eprintln!("[fuyao] 跌停池降级（情绪仍可用）: {e}");
            None
        }
    };

    Ok(parse_sentiment(&stats, &pool_items, limit_down))
}

/// 拉取「个股 → 所属板块」+ 板块当日涨幅
///
/// 短线看的是**题材**：同样一根阳线，来自当日最强的概念还是来自没人看的行业，含义完全不同。
/// 板块涨幅拿不到时只丢 quotes，个股映射照样返回（前端据此仍能显示所属题材，只是没有强度）。
pub async fn fetch_sector_strength(
    codes: &[String],
    api_key: &str,
) -> Result<SectorStrength, String> {
    let mut thscodes: Vec<String> = Vec::new();
    for code in codes.iter().take(100) {
        if let Some(t) = to_thscode(code) {
            thscodes.push(t);
        }
    }
    if thscodes.is_empty() {
        return Ok(SectorStrength {
            fetched_at: now_ms(),
            ..Default::default()
        });
    }

    // thscode 只含数字与点，逗号是接口约定分隔符，不做百分号编码
    let data = fetch_data(
        &format!(
            "/api/a-share-index/constituents/ths-index-list-by-stock?thscode={}",
            thscodes.join(",")
        ),
        api_key,
        "个股板块",
    )
    .await?;

    let mut by_stock: Vec<StockSectors> = Vec::new();
    for it in data["item"].as_array().cloned().unwrap_or_default() {
        let thscode = it["thscode"].as_str().unwrap_or("");
        if thscode.is_empty() {
            continue;
        }
        // 接口不传 type 时返回全部四类（概念/行业/地域/特色）。地域与特色指数对短线判断没意义，
        // 只留行业 + 概念。行业通常 1 个、概念可达十来个，所以两者分开截断，
        // 否则按返回顺序 take(N) 会把排在后面的行业整个截掉。
        let all: Vec<SectorRef> = it["index_list"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| {
                        Some(SectorRef {
                            thscode: s["thscode"].as_str()?.to_string(),
                            name: s["name"].as_str().unwrap_or("").to_string(),
                            kind: s["type"].as_str().unwrap_or("").to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let mut picked: Vec<SectorRef> = all
            .iter()
            .filter(|s| s.kind == "industry")
            .cloned()
            .collect();
        let mut concept_n = 0usize;
        for s in all.iter().filter(|s| s.kind == "cn_concept") {
            if concept_n >= 5 {
                break;
            }
            picked.push(s.clone());
            concept_n += 1;
        }

        by_stock.push(StockSectors {
            code: ticker_of(thscode).to_string(),
            sectors: picked,
        });
    }

    // 板块去重后分批查快照：URL 长度有限，且单批失败不影响其它批
    let mut uniq: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for s in by_stock.iter().flat_map(|x| x.sectors.iter()) {
        if seen.insert(s.thscode.clone()) {
            uniq.push(s.thscode.clone());
        }
    }
    // 自选池通常 10–20 只，80 个板块足够覆盖；超出的部分只丢「强度」不丢映射
    uniq.truncate(80);

    let mut quotes: Vec<SectorQuote> = Vec::new();
    for chunk in uniq.chunks(20) {
        let path = format!(
            "/api/a-share-index/prices/snapshot?thscodes={}",
            chunk.join(",")
        );
        match fetch_data(&path, api_key, "板块快照").await {
            Ok(d) => {
                for it in d["item"].as_array().cloned().unwrap_or_default() {
                    if let Some(ts) = it["thscode"].as_str() {
                        quotes.push(SectorQuote {
                            thscode: ts.to_string(),
                            change_pct: it["price_change_ratio_pct"].as_f64(),
                        });
                    }
                }
            }
            // 单批失败不影响其余批次，也不影响个股映射
            Err(e) => eprintln!("[fuyao] 板块快照降级: {e}"),
        }
    }

    Ok(SectorStrength {
        fetched_at: now_ms(),
        quotes,
        by_stock,
    })
}

// ── 短线事件：连板天梯 / 集合竞价异动 ──────────────────
//
// 为什么补这两个：日 K 因子与短期收益基本无关（IC ≈ -0.04，见 §7.35 实测），
// 真正带信息量的是**事件**——连板晋级和二板接力是短线情绪最直接的可观察量。

/// 毫秒戳 → 上海时区 `HH:mm`
fn hhmm_from_ms(ms: i64) -> String {
    let secs = (ms + 8 * 3_600_000).div_euclid(1000);
    let day = secs.rem_euclid(86_400);
    format!("{:02}:{:02}", day / 3600, (day % 3600) / 60)
}

/// 连板天梯的固定六档（上游缺档会补空数组）
const LADDER_KEYS: [&str; 6] = [
    "two_board",
    "three_board",
    "four_board",
    "five_board",
    "six_board",
    "seven_over",
];

/// 解析连板天梯（纯函数）
///
/// `seal_nextday` 是**次一交易日是否继续封板**，也是唯一能直接算晋级率的口径；
/// 最近一个交易日没有次日参考，该字段为 null——调用方统计时必须把 null 排除，
/// 否则会把「还没发生」当成「没晋级」，把晋级率系统性压低估。
fn parse_ladder(data: &Value) -> LimitUpLadder {
    let dates = data["window"]["date_list"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|d| d.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let mut days: Vec<LadderDay> = Vec::new();
    for day in data["item"].as_array().cloned().unwrap_or_default() {
        let date = day["date"].as_str().unwrap_or("").to_string();
        if date.is_empty() {
            continue;
        }
        let mut stocks: Vec<LadderStock> = Vec::new();
        for key in LADDER_KEYS {
            for s in day["boards"][key].as_array().cloned().unwrap_or_default() {
                let code = s["ticker"].as_str().unwrap_or("");
                if code.is_empty() {
                    continue;
                }
                stocks.push(LadderStock {
                    code: code.to_string(),
                    name: s["name"].as_str().unwrap_or("").to_string(),
                    board_num: s["board_num"].as_i64().unwrap_or(0),
                    seal_nextday: s["seal_nextday"].as_bool(),
                });
            }
        }
        days.push(LadderDay { date, stocks });
    }

    LimitUpLadder {
        fetched_at: data["timestamp"].as_i64().unwrap_or_else(now_ms),
        dates,
        days,
    }
}

/// 拉取近 30 个交易日的连板梯队（一次请求返回整批，适合算晋级率）
pub async fn fetch_limit_up_ladder(api_key: &str) -> Result<LimitUpLadder, String> {
    let data = fetch_data(
        "/api/a-share/special-data/limit-up-ladder",
        api_key,
        "连板天梯",
    )
    .await?;
    Ok(parse_ladder(&data))
}

/// 解析集合竞价异动（纯函数）
///
/// 上游 `bid_change_ratio` 是**小数比例**（0.03 = 3%），这里统一 ×100 成百分数，
/// 避免下游一半地方乘 100、一半地方不乘。
fn parse_auction(data: &Value) -> AuctionOpportunities {
    let items = data["item"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|it| {
                    let ticker = it["ticker"].as_str()?.trim();
                    if ticker.len() != 6 {
                        return None;
                    }
                    Some(AuctionItem {
                        code: ticker.to_string(),
                        name: it["name"].as_str().unwrap_or("").to_string(),
                        warn_name: it["warn_name"].as_str().unwrap_or("").to_string(),
                        warn_type: it["warn_type"].as_str().unwrap_or("").to_string(),
                        bid_price: it["bid_price"].as_f64(),
                        bid_change_pct: it["bid_change_ratio"].as_f64().map(|v| v * 100.0),
                        bid_amount: it["bid_amount"].as_f64(),
                        prev_amount: it["previous_amount"].as_f64(),
                        at: it["warn_timestamp"].as_i64().map(hhmm_from_ms),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    AuctionOpportunities {
        fetched_at: data["timestamp"].as_i64().unwrap_or_else(now_ms),
        trade_date: data["trade_date"].as_str().unwrap_or("").to_string(),
        items,
    }
}

/// 查询一批股票的集合竞价异动（接口单次最多 50 个代码、每页最多 20 条）
pub async fn fetch_auction_opportunities(
    codes: &[String],
    date: Option<&str>,
    api_key: &str,
) -> Result<AuctionOpportunities, String> {
    let thscodes: Vec<String> = codes.iter().take(50).filter_map(|c| to_thscode(c)).collect();
    let mut path = String::from(
        "/api/a-share/special-data/auction-stock-opportunities?market=a_share&page=1&size=20&sort_by=warn_time&sort_order=desc",
    );
    if let Some(d) = date.map(str::trim).filter(|d| !d.is_empty()) {
        path.push_str(&format!("&date={}", d));
    }
    if !thscodes.is_empty() {
        path.push_str(&format!("&thscodes={}", thscodes.join(",")));
    }
    let data = fetch_data(&path, api_key, "竞价异动").await?;
    Ok(parse_auction(&data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn thscode_按板块加后缀() {
        assert_eq!(to_thscode("600519").as_deref(), Some("600519.SH"));
        assert_eq!(to_thscode("688981").as_deref(), Some("688981.SH"));
        assert_eq!(to_thscode("000001").as_deref(), Some("000001.SZ"));
        assert_eq!(to_thscode("300750").as_deref(), Some("300750.SZ"));
        assert_eq!(to_thscode("830799").as_deref(), Some("830799.BJ"));
        assert_eq!(to_thscode("920002").as_deref(), Some("920002.BJ"));
        assert_eq!(to_thscode(" 600519.SH ").as_deref(), Some("600519.SH"));
        assert_eq!(to_thscode("sh600519").as_deref(), Some("600519.SH"));
        assert_eq!(to_thscode("00700"), None, "5 位港股不走同花顺 K 线");
        assert_eq!(to_thscode("abc"), None);
    }

    #[test]
    fn ticker_去掉后缀() {
        assert_eq!(ticker_of("600519.SH"), "600519");
        assert_eq!(ticker_of("830799.BJ"), "830799");
    }

    #[test]
    fn 毫秒转日期按东八区() {
        // 2024-05-20 00:00:00 +08:00
        assert_eq!(date_from_ms(1_716_134_400_000), "2024-05-20");
        // 东八区当天 23:59 仍是同一天
        assert_eq!(date_from_ms(1_716_134_400_000 + 86_399_000), "2024-05-20");
        // 再下一秒跨到次日
        assert_eq!(date_from_ms(1_716_134_400_000 + 86_400_000), "2024-05-21");
    }

    #[test]
    fn 日期与天数可往返() {
        for date in ["2020-01-01", "2024-02-29", "2026-11-02"] {
            let days = parse_date(date).expect("应能解析");
            let (y, m, d) = civil_from_days(days);
            assert_eq!(format!("{:04}-{:02}-{:02}", y, m, d), date);
        }
    }

    #[test]
    fn 解析日k_成交量换算成手() {
        let data = json!({
            "item": [
                {"date_ms": 1_716_134_400_000i64, "open_price": 10.0, "high_price": 10.5, "low_price": 9.8, "close_price": 10.2, "volume": 123400.0, "turnover": 999.0},
                {"date_ms": 1_716_220_800_000i64, "open_price": 10.2, "high_price": 10.8, "low_price": 10.1, "close_price": 10.6, "volume": 200000.0, "turnover": 0.0}
            ]
        });
        let bars = parse_bars(&data);
        assert_eq!(bars.len(), 2);
        assert_eq!(bars[0].date, "2024-05-20");
        assert_eq!(bars[0].volume, 1234.0, "股 → 手（÷100）");
        assert_eq!(bars[0].turnover, 0.0, "成交额恒为 0，避免与腾讯路径两套单位");
        assert_eq!(bars[1].date, "2024-05-21");
    }

    #[test]
    fn 周k按月k聚合() {
        let mk = |date: &str, o: f64, c: f64, h: f64, l: f64, v: f64| KlineItem {
            date: date.to_string(),
            open: o,
            close: c,
            high: h,
            low: l,
            volume: v,
            turnover: 0.0,
        };
        // 2024-05-20(一) ~ 05-31(五)，跨两周
        let bars = vec![
            mk("2024-05-20", 10.0, 10.2, 10.3, 9.9, 100.0),
            mk("2024-05-21", 10.2, 10.1, 10.4, 10.0, 100.0),
            mk("2024-05-24", 10.1, 10.5, 10.6, 10.0, 100.0),
            mk("2024-05-27", 10.5, 10.8, 11.0, 10.4, 100.0),
            mk("2024-05-31", 10.8, 11.2, 11.3, 10.7, 100.0),
        ];
        let week = aggregate(&bars, "week");
        assert_eq!(week.len(), 2, "5/20~5/24 与 5/27~5/31 各一根");
        assert_eq!(week[0].date, "2024-05-24", "周 K 取该周最后一个交易日");
        assert_eq!(week[0].open, 10.0);
        assert_eq!(week[0].close, 10.5);
        assert_eq!(week[0].high, 10.6);
        assert_eq!(week[0].low, 9.9);
        assert_eq!(week[0].volume, 300.0);

        let month = aggregate(&bars, "month");
        assert_eq!(month.len(), 1);
        assert_eq!(month[0].date, "2024-05-31");
        assert_eq!(month[0].open, 10.0);
        assert_eq!(month[0].close, 11.2);
        assert_eq!(month[0].high, 11.3);
        assert_eq!(month[0].low, 9.9);
        assert_eq!(month[0].volume, 500.0);
    }

    #[test]
    fn 解析检索结果() {
        let data = json!({
            "item": [
                {"thscode": "601318.SH", "ticker": "601318", "name": "中国平安", "exchange": "SH", "asset_type": "a-share"},
                {"thscode": "000001.SZ", "ticker": "000001", "name": "平安银行", "exchange": "SZ", "asset_type": "a-share"},
                {"thscode": "00700.HK", "ticker": "00700", "name": "腾讯控股", "exchange": null, "asset_type": "hk-share"}
            ]
        });
        let out = parse_search(&data);
        assert_eq!(out.len(), 2, "5 位/无交易所的一律丢弃");
        assert_eq!(out[0].code, "601318");
        assert_eq!(out[0].market, "SH");
        assert_eq!(out[1].name, "平安银行");
    }

    #[test]
    fn 解析热榜并映射市场() {
        let data = json!({
            "item": [
                {"thscode": "603822.SH", "ticker": "603822", "name": "嘉澳环保", "rank": 1, "heat": "1941909", "rank_change": 7, "rank_trend": "up"},
                {"thscode": "000725.SZ", "ticker": "000725", "name": "京东方A", "rank": 2, "heat": "1000", "rank_change": -3, "rank_trend": "down"}
            ]
        });
        let items = parse_hot(&data);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].code, "603822");
        assert_eq!(items[0].order, 1);
        assert_eq!(items[0].rate, "1941909");
        assert_eq!(items[0].hot_rank_chg, 7);
        assert_eq!(items[0].market, 17);
        assert_eq!(items[1].market, 33);
        assert_eq!(items[1].hot_rank_chg, -3);
    }

    #[test]
    fn 日期转当日零点毫秒按东八区() {
        // 2024-05-20 00:00:00 +08:00 = 1716134400000
        assert_eq!(date_to_ms("2024-05-20"), Some(1_716_134_400_000));
        assert_eq!(date_to_ms("2024-13-01"), None);
        assert_eq!(date_to_ms("20240520"), None);
    }

    #[test]
    fn 题材按分隔符拆开并丢掉整句() {
        assert_eq!(
            split_themes("存储芯片+AI算力"),
            vec!["存储芯片".to_string(), "AI算力".to_string()]
        );
        assert_eq!(
            split_themes("机器人、减速器"),
            vec!["机器人".to_string(), "减速器".to_string()]
        );
        assert_eq!(split_themes("  "), Vec::<String>::new());
        // 超过 12 字的多半是整句描述，不当题材名
        assert!(split_themes("公司公告称拟收购某标的百分之五十一股权").is_empty());
        // 实测上游盘中常用「其它」占位，不能进题材榜
        assert!(split_themes("其它").is_empty());
        assert_eq!(
            split_themes("其它+存储芯片"),
            vec!["存储芯片".to_string()]
        );
    }

    #[test]
    fn 题材热度按只数计数且同票不重复() {
        let items = vec![
            json!({"limit_up_reason": "存储芯片+AI算力"}),
            json!({"limit_up_reason": "存储芯片"}),
            // 同一只票重复写同一题材，只算一次
            json!({"limit_up_reason": "存储芯片+存储芯片"}),
            json!({"limit_up_reason": null}),
            json!({"limit_up_reason": ""}),
        ];
        let heat = theme_heat(&items, 8);
        assert_eq!(heat.len(), 2);
        assert_eq!(heat[0].name, "存储芯片");
        assert_eq!(heat[0].count, 3);
        assert_eq!(heat[1].name, "AI算力");
        assert_eq!(heat[1].count, 1);
    }

    #[test]
    fn 解析情绪含缺失跌停家数() {
        let stats = json!({
            "trade_date": "2026-11-05",
            "timestamp": 1791957420015i64,
            "seal_rate": 0.647887323943662,
            "open_stock_count": 25,
            "limit_up_stock_count": 46,
            "touched_limit_up_stock_count": 71,
            "page_boards": [
                {"board_level": "one", "stock_count": 28, "promotion_rate": null},
                {"board_level": "two", "stock_count": 14, "promotion_rate": 0.25}
            ]
        });
        let pool = vec![
            json!({"continue_day_cnt": 2, "limit_up_reason": "存储芯片"}),
            json!({"continue_day_cnt": 5, "limit_up_reason": "存储芯片"}),
        ];
        let s = parse_sentiment(&stats, &pool, Some(9));
        assert_eq!(s.trade_date, "2026-11-05");
        assert_eq!(s.limit_up, 46);
        assert_eq!(s.touched, 71);
        assert_eq!(s.open_count, 25);
        assert_eq!(s.limit_down, Some(9));
        assert_eq!(s.max_board, 5);
        assert_eq!(s.boards.len(), 2);
        assert_eq!(s.boards[0].promotion_rate, None);
        assert_eq!(s.themes.len(), 1);
        assert_eq!(s.themes[0].count, 2);

        // 跌停数据没拉到 → None，不能当成「今天 0 跌停」
        let s2 = parse_sentiment(&stats, &[], None);
        assert_eq!(s2.limit_down, None);
        assert_eq!(s2.max_board, 0);
        assert!(s2.themes.is_empty());
    }

    #[test]
    fn 毫秒转时分按东八区() {
        // 2026-11-05 09:25:00 +08:00
        assert_eq!(hhmm_from_ms(1_793_841_900_000), "09:25");
        // 同一天 14:56
        assert_eq!(hhmm_from_ms(1_793_841_900_000 + 5 * 3_600_000 + 31 * 60_000), "14:56");
        // 跨日边界：UTC 16:00 = 东八区次日 00:00
        assert_eq!(hhmm_from_ms(1_793_808_000_000), "00:00");
    }

    #[test]
    fn 解析连板天梯保留空板位与未定次日() {
        let data = json!({
            "timestamp": 1793848495963i64,
            "window": {"length": 2, "date_list": ["2026-11-05", "2026-11-04"]},
            "item": [
                {"date": "2026-11-05", "boards": {
                    "two_board": [
                        {"ticker": "002309", "name": "中利集团", "board_num": 2, "seal_nextday": null}
                    ],
                    "three_board": [], "four_board": [], "five_board": [], "six_board": [], "seven_over": []
                }},
                {"date": "2026-11-04", "boards": {
                    "two_board": [
                        {"ticker": "600641", "name": "先导基电", "board_num": 2, "seal_nextday": true},
                        {"ticker": "001360", "name": "南矿集团", "board_num": 2, "seal_nextday": false}
                    ],
                    "seven_over": [
                        {"ticker": "603598", "name": "引力传媒", "board_num": 8, "seal_nextday": true}
                    ]
                }}
            ]
        });
        let l = parse_ladder(&data);
        assert_eq!(l.dates.len(), 2);
        assert_eq!(l.days.len(), 2);
        assert_eq!(l.days[0].date, "2026-11-05");
        assert_eq!(l.days[0].stocks.len(), 1);
        // 最近交易日没有次日结果 → None，不能当成 false
        assert_eq!(l.days[0].stocks[0].seal_nextday, None);
        assert_eq!(l.days[1].stocks.len(), 3);
        assert_eq!(l.days[1].stocks[1].seal_nextday, Some(false));
        // 七板以上也要收集进来
        let top = l.days[1].stocks.iter().find(|s| s.board_num == 8).unwrap();
        assert_eq!(top.code, "603598");
    }

    #[test]
    fn 解析竞价异动把小数比例转成百分数() {
        let data = json!({
            "timestamp": 1791957420099i64,
            "trade_date": "2026-10-12",
            "item": [
                {
                    "thscode": "603190.SH", "ticker": "603190", "name": "亚通精工",
                    "warn_type": "68710", "warn_name": "涨停试盘",
                    "warn_timestamp": 1791767895000i64,
                    "bid_price": 16.03, "bid_change_ratio": 0.032, "bid_amount": 137858,
                    "previous_amount": 29087826
                },
                {"ticker": "abc", "name": "非法代码"},
                {"ticker": "000001", "name": "平安银行", "warn_type": "68711", "warn_name": null, "bid_change_ratio": null}
            ]
        });
        let a = parse_auction(&data);
        assert_eq!(a.trade_date, "2026-10-12");
        assert_eq!(a.items.len(), 2, "非法代码要丢掉");
        assert_eq!(a.items[0].bid_change_pct, Some(3.2));
        assert_eq!(a.items[0].warn_name, "涨停试盘");
        assert!(a.items[0].at.is_some());
        // 缺失的涨幅保留 None，不写 0
        assert_eq!(a.items[1].bid_change_pct, None);
        assert_eq!(a.items[1].warn_name, "");
    }
}
