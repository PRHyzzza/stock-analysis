use crate::helpers::{to_tencent_code};
use crate::types::{MarketIndex, StockQuote};
use regex::Regex;

/// 获取个股行业分析数据（来自东方财富 HSF10）
pub async fn fetch_industry_analysis(em_code: &str) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://emweb.securities.eastmoney.com/PC_HSF10/IndustryAnalysis/PageAjax?code={}",
        em_code
    );
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Referer", "https://emweb.securities.eastmoney.com/")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let data = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    Ok(data)
}

/// 获取个股行业名称（从东方财富行情页提取）
pub async fn fetch_industry_name(code: &str) -> Result<String, String> {
    let t_code = to_tencent_code(code);
    let url = format!("https://quote.eastmoney.com/{}.html", t_code);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Referer", "https://quote.eastmoney.com/")
        .send()
        .await
        .map_err(|e| format!("请求行情页失败: {}", e))?;

    let html = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    // 从 HTML 中提取行业名称: boards2-90.xxx" target="_blank">行业名称</a>
    let re = regex::Regex::new(r#"boards2-\d+\.\w+"\s*target="_blank">([^<]+)</a>"#)
        .map_err(|e| format!("正则编译失败: {}", e))?;

    if let Some(cap) = re.captures(&html) {
        if let Some(name) = cap.get(1) {
            return Ok(name.as_str().to_string());
        }
    }

    Err("未找到行业信息".to_string())
}

/// 获取个股实时行情（来自腾讯财经）
pub async fn fetch_stock_quote_from_tencent(code: &str) -> Result<StockQuote, String> {
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

    // 腾讯 API 返回 GBK 编码，需手动解码
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    let (text, _, _) = encoding_rs::GBK.decode(&bytes);
    let text = text.to_string();

    // 解析腾讯格式: v_sh600519="1~名称~代码~价格~昨收~开盘~..."
    let fields: Vec<&str> = text.split('~').collect();
    if fields.len() < 40 {
        return Err(format!("腾讯API返回格式异常: {} 个字段", fields.len()));
    }

    let name = fields.get(1).unwrap_or(&"").to_string();
    let price = fields.get(3).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let prev_close = fields.get(4).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let open = fields.get(5).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let volume = fields.get(6).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0); // 手
    let change = fields.get(31).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let change_pct = fields.get(32).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let high = fields.get(33).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let low = fields.get(34).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let turnover = fields.get(37).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0); // 万
    let turnover_rate = fields.get(38).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let pe = fields.get(39).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let amplitude = fields.get(46).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);

    Ok(StockQuote {
        code: code.to_string(),
        name,
        price,
        prev_close,
        open,
        volume,
        turnover,
        change,
        change_pct,
        high,
        low,
        turnover_rate,
        pe,
        amplitude,
    })
}

/// 获取大盘指数实时行情
pub async fn fetch_index_quote(code: &str) -> Result<MarketIndex, String> {
    // 指数代码映射：000xxx 为上海交易所 (sh)，3xxxxx 为深圳交易所 (sz)
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
    let change = fields.get(31).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);
    let change_pct = fields.get(32).unwrap_or(&"0").parse::<f64>().unwrap_or(0.0);

    Ok(MarketIndex {
        code: code.to_string(),
        name,
        price,
        change,
        change_pct,
    })
}

/// 获取个股主力资金流向（来自腾讯财经）
/// 使用 ff_ 前缀接口: https://qt.gtimg.cn/q=ff_{code}
pub async fn fetch_money_flow(code: &str) -> Result<crate::types::MoneyFlow, String> {
    use crate::types::MoneyFlow;

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

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    let (text, _, _) = encoding_rs::GBK.decode(&bytes);
    let text = text.to_string();

    // 格式: v_ff_sh600519="market~name~主力净流入~主力净占比~..."
    // 如果数据不可用则返回空，此时用默认值兜底
    let fields: Vec<&str> = text.split('~').collect();
    if fields.len() < 12 {
        return Err(format!("NO_DATA"));
    }

    let p = |idx: usize| -> f64 {
        fields.get(idx).unwrap_or(&"0").trim().parse::<f64>().unwrap_or(0.0)
    };

    Ok(MoneyFlow {
        main_net_inflow: p(2),
        main_net_pct: p(3),
    })
}

/// 从东方财富 JSONP 响应中解析 klines 数组
fn parse_eastmoney_fflow_jsonp(text: &str) -> Result<(String, serde_json::Value), String> {
    let json_str = text
        .strip_prefix("jQuery(")
        .and_then(|s| s.strip_suffix(");"))
        .ok_or_else(|| "JSONP 解析失败: 格式异常".to_string())?;

    let json: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    let rc = json.get("rc").and_then(|v| v.as_i64()).unwrap_or(-1);
    if rc != 0 {
        return Err(format!("东方财富 API 返回异常: rc={}", rc));
    }

    let klines = json
        .pointer("/data/klines")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_str())
        .ok_or_else(|| "未找到资金流向数据".to_string())?;

    Ok((klines.to_string(), json))
}

/// 获取个股主力资金流向（来自东方财富，作为腾讯 API 的备选）
/// 优先使用 push2 实时接口，回退到 push2his 历史接口
pub async fn fetch_money_flow_eastmoney(code: &str) -> Result<crate::types::MoneyFlow, String> {
    use crate::types::MoneyFlow;

    // 构建 secid: 上海 1.xxx, 深圳 0.xxx
    let secid = if code.starts_with("6") {
        format!("1.{}", code)
    } else {
        format!("0.{}", code)
    };

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 1) 尝试 push2 实时接口 (有今日数据，无占比)
    let realtime_url = format!(
        "https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid={}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65&klt=101&lmt=1&ut=b2884a393a59ad64002292a3e90d46a5&cb=jQuery",
        secid
    );

    let resp = client
        .get(&realtime_url)
        .header("Referer", "https://data.eastmoney.com/")
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("请求东方财富资金流向失败: {}", e))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !text.is_empty() {
        if let Ok((klines, _json)) = parse_eastmoney_fflow_jsonp(&text) {
            let fields: Vec<&str> = klines.split(',').collect();
            if fields.len() >= 6 {
                let pf = |idx: usize| -> f64 {
                    fields.get(idx).unwrap_or(&"0").trim().parse::<f64>().unwrap_or(0.0)
                };
                // push2 实时: [0]date, [1]主力净流入(元), [2]小单, [3]中单, [4]大单, [5]超大单
                let main_net_inflow = pf(1) / 10000.0;

                // 尝试获取今日成交额来计算主力净占比
                let mut main_net_pct = 0.0;
                if let Ok(quote) = fetch_stock_quote_from_tencent(code).await {
                    if quote.turnover > 0.0 {
                        main_net_pct = (main_net_inflow / quote.turnover) * 100.0;
                    }
                }

                return Ok(MoneyFlow {
                    main_net_inflow,
                    main_net_pct,
                });
            }
        }
    }

    // 2) 回退到 push2his 历史接口 (昨日数据，有占比)
    let hist_url = format!(
        "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid={}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65&klt=101&lmt=1&ut=b2884a393a59ad64002292a3e90d46a5&cb=jQuery",
        secid
    );

    let resp = client
        .get(&hist_url)
        .header("Referer", "https://data.eastmoney.com/")
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("请求东方财富历史资金流向失败: {}", e))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let (klines, _json) = parse_eastmoney_fflow_jsonp(&text)?;

    let fields: Vec<&str> = klines.split(',').collect();
    if fields.len() < 11 {
        return Err(format!("东方财富数据字段不足: {}", fields.len()));
    }

    let pf = |idx: usize| -> f64 {
        fields.get(idx).unwrap_or(&"0").trim().parse::<f64>().unwrap_or(0.0)
    };

    // push2his 日线: [0]date, [1]主力净流入(元), [6]主力净占比(%)
    // 转换为万元 (÷10000) 以与腾讯 API 单位一致
    Ok(MoneyFlow {
        main_net_inflow: pf(1) / 10000.0,
        main_net_pct: pf(6),
    })
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
pub async fn fetch_search_results(keyword: &str) -> Result<Vec<crate::types::SearchResult>, String> {
    use crate::types::SearchResult;

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

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    let (text, _, _) = encoding_rs::GBK.decode(&bytes);
    let text = text.to_string();

    let mut results = Vec::new();

    // 格式: v_hint="sh~600519~贵州茅台~gzmt~GP-A^sz~000858~五粮液~...";
    // 提取 = 号后面的引号内容
    if let Some(eq_pos) = text.find('=') {
        let value_part = &text[eq_pos + 1..];
        let value = value_part.trim().trim_matches('"').trim_end_matches(';').trim();
        // 按 ^ 分割多个结果
        for item in value.split('^') {
            let fields: Vec<&str> = item.split('~').collect();
            if fields.len() < 3 {
                continue;
            }
            let market_raw = fields[0].trim();
            let code = fields[1].trim().to_string();
            let name = unescape_unicode(fields[2].trim());

            // 只保留 A 股 (sh/sz)
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
pub async fn fetch_kline_data(code: &str, period: &str) -> Result<Vec<crate::types::KlineItem>, String> {
    use crate::helpers::parse_json_f64;
    use crate::types::KlineItem;

    let t_code = to_tencent_code(code);
    let url = format!(
        "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={},{},,,120,qfq",
        t_code, period
    );

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36")
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

    // 腾讯 K 线返回格式：{ data: { sz300750: { qfqday: [...], qfqweek: [...], qfqmonth: [...] } } }
    let data_key = match period {
        "week" => "qfqweek",
        "month" => "qfqmonth",
        _ => "qfqday",
    };

    let klines = data
        .get("data")
        .and_then(|d| d.get(&t_code))
        .and_then(|s| s.get(data_key).or_else(|| {
            let fallback = match period {
                "week" => "week",
                "month" => "month",
                _ => "day",
            };
            s.get(fallback)
        }))
        .and_then(|d| d.as_array())
        .ok_or_else(|| "未找到 K 线数据".to_string())?;

    let mut items = Vec::new();
    for k in klines {
        let arr = match k.as_array() {
            Some(a) => a,
            None => continue,
        };
        if arr.len() < 6 {
            continue;
        }
        let date = arr[0].as_str().unwrap_or("").to_string();
        let open = parse_json_f64(&arr[1]);
        let close = parse_json_f64(&arr[2]);
        let high = parse_json_f64(&arr[3]);
        let low = parse_json_f64(&arr[4]);
        let volume = parse_json_f64(&arr[5]);
        let turnover = arr.get(6).map(|v| parse_json_f64(v)).unwrap_or(0.0);

        items.push(KlineItem {
            date,
            open,
            close,
            high,
            low,
            volume,
            turnover,
        });
    }

    if items.is_empty() {
        return Err("K 线数据为空".to_string());
    }

    Ok(items)
}

/// 调用 DeepSeek API 进行股票 AI 分析（含全部辅助数据）
pub async fn fetch_deepseek_ai_analysis(
    api_key: &str,
    stock_code: &str,
    stock_name: &str,
    price: f64,
    change: f64,
    change_pct: f64,
    high: f64,
    low: f64,
    open: f64,
    prev_close: f64,
    volume: f64,
    turnover: f64,
    turnover_rate: f64,
    pe: f64,
    amplitude: f64,
    // 新增：资金流向
    main_net_inflow: f64,
    main_net_pct: f64,
    // 新增：K 线数据（JSON 字符串）
    kline_json: &str,
    // 新增：行业数据
    industry_name: &str,
    industry_json: &str,
    // 新增：大盘指数（JSON 字符串）
    indices_json: &str,
) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("请先设置 DeepSeek API 密钥。\n\n点击上方输入框粘贴你的 API 密钥，然后点击「保存密钥」。".to_string());
    }

    // 解析并提取最近 30 根 K 线摘要
    let kline_summary = if kline_json.is_empty() || kline_json == "[]" {
        "暂无".to_string()
    } else {
        serde_json::from_str::<Vec<serde_json::Value>>(kline_json)
            .ok()
            .map(|items| {
                let total = items.len();
                let recent: Vec<String> = items.iter().rev().take(30).rev().map(|k| {
                    let date = k.get("date").and_then(|v| v.as_str()).unwrap_or("");
                    let open = k.get("open").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let close = k.get("close").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let high = k.get("high").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let low = k.get("low").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let vol = k.get("volume").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    format!("{:<12} {:<10.2} {:<10.2} {:<10.2} {:<10.2} {:<12.0}", date, open, close, high, low, vol)
                }).collect::<Vec<_>>();
                let mut s = format!("共 {} 根 K 线，最近 30 根：\n", total);
                s.push_str("日期         开盘      收盘      最高      最低      成交量\n");
                s.push_str(&recent.join("\n"));
                s
            })
            .unwrap_or_else(|| "解析失败".to_string())
    };

    // 解析行业数据
    let industry_section = if industry_json.is_empty() || industry_json == "{}" {
        String::new()
    } else {
        serde_json::from_str::<serde_json::Value>(industry_json)
            .ok()
            .map(|v| {
                let mut parts = vec![];
                // 市场表现
                if let Some(perf) = v.get("market_performance").and_then(|a| a.as_array()) {
                    let mut lines = vec!["## 行业市场表现".to_string()];
                    for item in perf {
                        let cr = item.get("changerate").and_then(|x| x.as_f64()).unwrap_or(0.0);
                        let hs = item.get("hs300_changerate").and_then(|x| x.as_f64()).unwrap_or(0.0);
                        let tt = item.get("time_type").and_then(|x| x.as_i64()).unwrap_or(0);
                        let label = match tt { 1 => "今日", 2 => "本周", 3 => "本月", _ => "今年以来" };
                        lines.push(format!("- {}：行业涨跌 {:.2}%，沪深300 {:.2}%", label, cr, hs));
                    }
                    parts.push(lines.join("\n"));
                }
                // 营收排名
                if let Some(rev) = v.get("revenue_ranking").and_then(|a| a.as_array()) {
                    let mut lines = vec!["## 行业营收排名（前 10）".to_string()];
                    for (i, item) in rev.iter().take(10).enumerate() {
                        let name = item.get("stock_name").and_then(|x| x.as_str()).unwrap_or("");
                        let income = item.get("total_operate_income").and_then(|x| x.as_f64()).unwrap_or(0.0);
                        let rank = item.get("total_operate_income_rank").and_then(|x| x.as_i64()).unwrap_or(0);
                        lines.push(format!("{}. {}（营收 {:.2} 亿，排名 {}）", i+1, name, income / 1e8, rank));
                    }
                    parts.push(lines.join("\n"));
                }
                if parts.is_empty() { String::new() } else { parts.join("\n\n") }
            })
            .unwrap_or_default()
    };

    // 解析大盘指数
    let indices_summary = if indices_json.is_empty() || indices_json == "[]" {
        String::new()
    } else {
        serde_json::from_str::<Vec<serde_json::Value>>(indices_json)
            .ok()
            .map(|items| {
                let mut lines = vec!["## 大盘指数行情".to_string()];
                for idx in &items {
                    let name = idx.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let p = idx.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let cp = idx.get("changePct").or_else(|| idx.get("change_pct")).and_then(|v| v.as_f64()).unwrap_or(0.0);
                    lines.push(format!("- {}：{:.2}（{:.2}%）", name, p, cp));
                }
                lines.join("\n")
            })
            .unwrap_or_default()
    };

    let mut prompt = format!(
        "你是一位专业的A股市场分析师。请对以下股票进行多维度的技术面和基本面分析。\n\n\
        【基础行情】\n\
        股票代码：{}\n\
        股票名称：{}\n\
        当前价格：{} 元\n\
        涨跌额：{} 元\n\
        涨跌幅：{}%\n\
        最高价：{} 元\n\
        最低价：{} 元\n\
        开盘价：{} 元\n\
        昨收价：{} 元\n\
        成交量：{} 手\n\
        成交额：{} 万元\n\
        换手率：{}%\n\
        市盈率：{}\n\
        振幅：{}%\n",
        stock_code, stock_name, price, change, change_pct,
        high, low, open, prev_close, volume, turnover,
        turnover_rate, pe, amplitude
    );

    // 资金流向
    prompt.push_str(&format!(
        "\n【主力资金流向】\n\
        主力净流入：{:.2} 万元\n\
        主力净占比：{:.2}%\n",
        main_net_inflow, main_net_pct
    ));

    // K 线数据
    prompt.push_str("\n【K 线数据】\n");
    prompt.push_str(&kline_summary);

    // 行业数据
    if !industry_section.is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str(&industry_section);
    }

    // 大盘指数
    if !indices_summary.is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str(&indices_summary);
    }

    // 如果提供了行业名称，加到提示中
    if !industry_name.is_empty() {
        prompt.push_str(&format!("\n\n所属行业：{}", industry_name));
    }

    prompt.push_str("\n\n\
        请从以下几个方面进行分析（使用Markdown格式）：\n\
        1. **技术面分析**：结合 K 线形态、均线系统、成交量变化进行分析\n\
        2. **基本面分析**：分析估值水平、盈利能力、成长性、财务健康\n\
        3. **资金面分析**：分析主力资金流向和行业资金动向\n\
        4. **综合建议**：给出短期策略和中期逻辑，以及风险提示\n\n\
        请用中文回答，分析要具体、专业，结合给出的全部数据。"
    );

    let client = reqwest::Client::builder()
        .user_agent("stock-analysis/1.0")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let body = serde_json::json!({
        "model": "deepseek-v4-flash",
        "messages": [
            {
                "role": "system",
                "content": "你是一位经验丰富的A股市场分析师，擅长技术分析和基本面分析。请基于给出的数据给出专业的分析建议。注意：分析结果仅供参考，不构成投资建议。回答请使用Markdown格式。"
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.7,
        "max_tokens": 2048,
        "stream": false
    });

    let resp = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 DeepSeek API 失败: {}", e))?;

    let data = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析 DeepSeek 响应失败: {}", e))?;

    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "DeepSeek 返回格式异常".to_string())?;

    Ok(content.to_string())
}
