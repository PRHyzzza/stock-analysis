/// 同花顺 Fuyao 官方数据 API（REST）
///
/// 覆盖范围（有 API Key 时优先走这里）：
/// - 标的检索 `/api/meta/tickers/search`：返回规范 thscode / ticker / name / exchange，
///   替代腾讯的联想搜索（代码与名称更权威，且能区分沪深北）
/// - 历史日 K `/api/a-share/prices/historical`：前复权、最长 10 年、带真实成交额；
///   周/月 K 由日 K 本地聚合（官方仅提供 `1d`）
/// - 热榜 `/api/a-share/special-data/hot-stock-list`：官方榜单，替代抓 10jqka 页面
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
use crate::types::{HotListData, HotStockItem, KlineItem, SearchResult};
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
}
