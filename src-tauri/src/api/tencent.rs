/// 腾讯财经数据源
use crate::helpers::to_tencent_code;
use crate::types::{IntradayData, IntradayItem, KlineItem, MarketIndex, MoneyFlow, SearchResult, StockQuote};
use regex::Regex;

/// 获取个股实时行情（来自腾讯财经）
pub async fn fetch_stock_quote(code: &str) -> Result<StockQuote, String> {
    let t_code = to_tencent_code(code);
    let url = format!("https://qt.gtimg.cn/q={}", t_code);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Referer", "https://qt.gtimg.cn/")
        .send()
        .await
        .map_err(|e| format!("请求腾讯行情失败: {}", e))?;

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    let (text, _, _) = encoding_rs::GBK.decode(&bytes);
    let text = text.to_string();

    let fields: Vec<&str> = text.split('~').collect();
    if fields.len() < 40 {
        return Err(format!("腾讯API返回格式异常: {} 个字段", fields.len()));
    }

    let name = fields.get(1).unwrap_or(&"").to_string();
    let price = fields.get(3).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let prev_close = fields.get(4).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let open = fields.get(5).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let volume = fields.get(6).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let change = fields.get(31).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let change_pct = fields.get(32).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let high = fields.get(33).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let low = fields.get(34).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let turnover = fields.get(37).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let turnover_rate = fields.get(38).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let pe = fields.get(39).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let amplitude = fields.get(46).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);

    Ok(StockQuote {
        code: code.to_string(),
        name, price, prev_close, open, volume, turnover, change, change_pct, high, low,
        turnover_rate, pe, amplitude,
    })
}

/// 获取大盘指数实时行情
pub async fn fetch_index_quote(code: &str) -> Result<MarketIndex, String> {
    let t_code = if code.starts_with("000") || code.starts_with("6") {
        format!("sh{}", code)
    } else {
        format!("sz{}", code)
    };

    let url = format!("https://qt.gtimg.cn/q={}", t_code);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Referer", "https://qt.gtimg.cn/")
        .send()
        .await
        .map_err(|e| format!("请求腾讯行情失败: {}", e))?;

    let bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {}", e))?;
    let (text, _, _) = encoding_rs::GBK.decode(&bytes);
    let text = text.to_string();

    let fields: Vec<&str> = text.split('~').collect();
    if fields.len() < 40 {
        return Err(format!("腾讯API返回格式异常: {} 个字段", fields.len()));
    }

    let name = fields.get(1).unwrap_or(&"").to_string();
    let price = fields.get(3).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let change = fields.get(31).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let change_pct = fields.get(32).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);

    Ok(MarketIndex { code: code.to_string(), name, price, change, change_pct })
}

/// 获取个股主力资金流向（来自腾讯财经）
pub async fn fetch_money_flow(code: &str) -> Result<MoneyFlow, String> {
    let t_code = to_tencent_code(code);
    let url = format!("https://qt.gtimg.cn/q=ff_{}", t_code);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Referer", "https://qt.gtimg.cn/")
        .send()
        .await
        .map_err(|e| format!("请求资金流向失败: {}", e))?;

    let bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {}", e))?;
    let (text, _, _) = encoding_rs::GBK.decode(&bytes);
    let text = text.to_string();

    let fields: Vec<&str> = text.split('~').collect();
    if fields.len() < 12 {
        return Err("NO_DATA".to_string());
    }

    let p = |idx: usize| -> f64 {
        fields.get(idx).unwrap_or(&"0").trim().parse::<f64>().unwrap_or(0.0)
    };

    Ok(MoneyFlow { main_net_inflow: p(2), main_net_pct: p(3) })
}

/// 将 `\uXXXX` 转义序列还原为 Unicode 字符
fn unescape_unicode(s: &str) -> String {
    let re = Regex::new(r"\\u([0-9a-fA-F]{4})").unwrap();
    re.replace_all(s, |caps: &regex::Captures| {
        let hex = caps.get(1).unwrap().as_str();
        let code = u32::from_str_radix(hex, 16).unwrap_or(0xFFFD);
        char::from_u32(code).map(|c| c.to_string()).unwrap_or_else(|| format!("\\u{}", hex))
    })
    .to_string()
}

/// 搜索股票（来自腾讯智能搜索）
pub async fn fetch_search_results(keyword: &str) -> Result<Vec<SearchResult>, String> {
    let url = format!("https://smartbox.gtimg.cn/s3/?q={}&t=all", keyword);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Referer", "https://smartbox.gtimg.cn/")
        .send()
        .await
        .map_err(|e| format!("请求搜索失败: {}", e))?;

    let bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {}", e))?;
    let (text, _, _) = encoding_rs::GBK.decode(&bytes);
    let text = text.to_string();

    let mut results = Vec::new();
    if let Some(eq_pos) = text.find('=') {
        let value_part = &text[eq_pos + 1..];
        let value = value_part.trim().trim_matches('"').trim_end_matches(';').trim();
        for item in value.split('^') {
            let fields: Vec<&str> = item.split('~').collect();
            if fields.len() < 3 { continue; }
            let market_raw = fields[0].trim();
            let code = fields[1].trim().to_string();
            let name = unescape_unicode(fields[2].trim());
            let market = match market_raw {
                "sh" => "SH".to_string(),
                "sz" => "SZ".to_string(),
                _ => continue,
            };
            results.push(SearchResult { code, name, market });
        }
    }
    Ok(results)
}

/// 获取个股 K 线数据（来自腾讯财经）
/// period: "day" | "week" | "month"
pub async fn fetch_kline_data(code: &str, period: &str) -> Result<Vec<KlineItem>, String> {
    use crate::helpers::parse_json_f64;

    let t_code = to_tencent_code(code);
    let url = format!(
        "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={},{},,,120,qfq",
        t_code, period
    );

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Referer", "https://web.ifzq.gtimg.cn/")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求 K 线数据失败: {}", e))?;

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let data_key = match period {
        "week" => "qfqweek",
        "month" => "qfqmonth",
        _ => "qfqday",
    };

    let klines = data
        .get("data")
        .and_then(|d| d.get(&t_code))
        .and_then(|s| s.get(data_key).or_else(|| {
            let fallback = match period { "week" => "week", "month" => "month", _ => "day" };
            s.get(fallback)
        }))
        .and_then(|d| d.as_array())
        .ok_or_else(|| "未找到 K 线数据".to_string())?;

    let items: Vec<KlineItem> = klines.iter().filter_map(|k| {
        let arr = k.as_array()?;
        if arr.len() < 6 { return None; }
        Some(KlineItem {
            date: arr[0].as_str().unwrap_or("").to_string(),
            open: parse_json_f64(&arr[1]),
            close: parse_json_f64(&arr[2]),
            high: parse_json_f64(&arr[3]),
            low: parse_json_f64(&arr[4]),
            volume: parse_json_f64(&arr[5]),
            turnover: arr.get(6).map(|v| parse_json_f64(v)).unwrap_or(0.0),
        })
    }).collect();

    if items.is_empty() {
        return Err("K 线数据为空".to_string());
    }
    Ok(items)
}

/// 获取个股分时数据（来自腾讯 AppStock）
/// 返回当日每分钟的 [时间, 价格, 成交量, 成交额]
/// API 返回格式：data.{t_code}.data.data 是字符串数组，每项 "HHmm price volume turnover"
/// 昨收从 data.{t_code}.qt.{t_code}[4] 获取
pub async fn fetch_intraday_data(code: &str) -> Result<IntradayData, String> {
    let t_code = to_tencent_code(code);
    let url = format!(
        "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={}",
        t_code
    );

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Referer", "https://web.ifzq.gtimg.cn/")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求分时数据失败: {}", e))?;

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    // 结构: data.{t_code}
    let stock_data = data
        .get("data")
        .and_then(|d| d.get(&t_code))
        .ok_or_else(|| "未找到分时数据".to_string())?;

    // 昨收: data.{t_code}.qt.{t_code}[4]
    let pre_close = stock_data
        .get("qt")
        .and_then(|q| q.get(&t_code))
        .and_then(|arr| arr.as_array())
        .and_then(|arr| arr.get(4))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    // 日期: data.{t_code}.data.date
    let date = stock_data
        .get("data")
        .and_then(|d| d.get("date"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 分时数据点: data.{t_code}.data.data — 字符串数组 ["HHmm price volume turnover", ...]
    let raw_data = stock_data
        .get("data")
        .and_then(|d| d.get("data"))
        .and_then(|v| v.as_array());

    let points = match raw_data {
        Some(arr) => arr,
        None => return Err("未找到分时数据点".to_string()),
    };

    let mut items = Vec::new();
    let mut cum_pv = 0.0; // ∑(price × volume)
    let mut cum_vol = 0.0; // ∑(volume)
    for point in points {
        let s = point.as_str().unwrap_or("");
        if s.is_empty() {
            continue;
        }
        let parts: Vec<&str> = s.split(' ').collect();
        if parts.len() >= 3 {
            // time: "0930" → "09:30"
            let raw_time = parts[0];
            let time = if raw_time.len() == 4 {
                format!("{}:{}", &raw_time[..2], &raw_time[2..])
            } else {
                raw_time.to_string()
            };
            let price: f64 = parts[1].parse().unwrap_or(0.0);
            let volume: f64 = parts[2].parse().unwrap_or(0.0);
            let turnover: f64 = parts.get(3).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);

            // 计算累计 VWAP
            cum_pv += price * volume;
            cum_vol += volume;
            let vwap = if cum_vol > 0.0 {
                (cum_pv / cum_vol * 100.0).round() / 100.0
            } else {
                0.0
            };

            items.push(IntradayItem { time, price, avg_price: 0.0, volume, turnover, vwap });
        }
    }

    if items.is_empty() {
        return Err("分时数据为空".to_string());
    }

    Ok(IntradayData { items, pre_close, date })
}
