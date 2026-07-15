/// 东方财富数据源
use crate::helpers::to_tencent_code;
use crate::types::{IndustryData, MarketPerformance, MoneyFlow, RevenueRanking, SectorMoneyFlowItem};

/// 获取个股行业分析数据（来自东方财富 HSF10）
pub async fn fetch_industry_analysis(em_code: &str) -> Result<serde_json::Value, String> {
    let client = super::build_http_client()?;
    let url = format!(
        "https://emweb.securities.eastmoney.com/PC_HSF10/IndustryAnalysis/PageAjax?code={}",
        em_code
    );

    let resp = client
        .get(&url)
        .header("Referer", "https://emweb.securities.eastmoney.com/")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    resp.json::<serde_json::Value>().await
        .map_err(|e| format!("解析 JSON 失败: {}", e))
}

/// 获取个股行业名称（从东方财富行情页提取）
pub async fn fetch_industry_name(code: &str) -> Result<String, String> {
    let client = super::build_http_client()?;
    let t_code = to_tencent_code(code);
    let url = format!("https://quote.eastmoney.com/{}.html", t_code);

    let resp = client
        .get(&url)
        .header("Referer", "https://quote.eastmoney.com/")
        .send()
        .await
        .map_err(|e| format!("请求行情页失败: {}", e))?;

    let html = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    let re = regex::Regex::new(r#"boards2-\d+\.\w+"\s*target="_blank">([^<]+)</a>"#)
        .map_err(|e| format!("正则编译失败: {}", e))?;

    if let Some(cap) = re.captures(&html) {
        if let Some(name) = cap.get(1) {
            return Ok(name.as_str().to_string());
        }
    }
    Err("未找到行业信息".to_string())
}

/// 从东方财富行业分析 JSON 中解析 IndustryData
pub fn parse_industry_analysis(code: &str, analysis: &serde_json::Value) -> IndustryData {
    // 解析市场表现 (scbx)
    let mut market_performance = Vec::new();
    if let Some(scbx) = analysis.get("scbx").and_then(|v| v.as_array()) {
        for item in scbx {
            market_performance.push(MarketPerformance {
                changerate: item.get("CHANGERATE").and_then(|v| v.as_f64()).unwrap_or(0.0),
                hs300_changerate: item.get("HS300_CHANGERATE").and_then(|v| v.as_f64()).unwrap_or(0.0),
                time_type: item.get("TIME_TYPE").and_then(|v| v.as_i64()).unwrap_or(0),
            });
        }
    }

    // 解析营收排名 (gsgm_yysr)
    let mut revenue_ranking = Vec::new();
    if let Some(yysr) = analysis.get("gsgm_yysr").and_then(|v| v.as_array()) {
        for item in yysr {
            let sc = item.get("CORRE_SECURITY_CODE").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if sc.is_empty() { continue; }
            revenue_ranking.push(RevenueRanking {
                stock_code: sc,
                stock_name: item.get("CORRE_SECURITY_NAME").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                total_operate_income: item.get("TOTAL_OPERATEINCOME").and_then(|v| v.as_f64()).unwrap_or(0.0),
                total_operate_income_rank: item.get("TOTAL_OPERATEINCOME_RANK").and_then(|v| v.as_i64()).unwrap_or(0),
            });
        }
    }
    // 如果当前股票不在列表中，从 gsgm 补
    if !revenue_ranking.iter().any(|r| r.stock_code == code) {
        if let Some(gsgm) = analysis.get("gsgm").and_then(|v| v.as_array()) {
            if let Some(item) = gsgm.first() {
                let sc = item.get("CORRE_SECURITY_CODE").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if !sc.is_empty() {
                    revenue_ranking.push(RevenueRanking {
                        stock_code: sc,
                        stock_name: item.get("CORRE_SECURITY_NAME").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        total_operate_income: item.get("TOTAL_OPERATEINCOME").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        total_operate_income_rank: item.get("TOTAL_OPERATEINCOME_RANK").and_then(|v| v.as_i64()).unwrap_or(0),
                    });
                }
            }
        }
    }
    revenue_ranking.sort_by(|a, b| a.total_operate_income_rank.cmp(&b.total_operate_income_rank));

    IndustryData {
        industry_name: String::new(), // 调用方需要单独设置
        market_performance,
        revenue_ranking,
    }
}

/// 从东方财富 JSONP 响应中解析 klines 数组
fn parse_fflow_jsonp(text: &str) -> Result<(String, serde_json::Value), String> {
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
pub async fn fetch_money_flow(code: &str) -> Result<MoneyFlow, String> {
    let secid = if code.starts_with("6") {
        format!("1.{}", code)
    } else {
        format!("0.{}", code)
    };

    let client = super::build_http_client()?;

    // 1) push2 实时接口
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

    let text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !text.is_empty() {
        if let Ok((klines, _)) = parse_fflow_jsonp(&text) {
            let fields: Vec<&str> = klines.split(',').collect();
            if fields.len() >= 6 {
                let pf = |idx: usize| -> f64 {
                    fields.get(idx).unwrap_or(&"0").trim().parse::<f64>().unwrap_or(0.0)
                };
                let main_net_inflow = pf(1) / 10000.0;

                // 尝试获取今日成交额来计算主力净占比
                let mut main_net_pct = 0.0;
                if let Ok(quote) = super::tencent::fetch_stock_quote(code).await {
                    if quote.turnover > 0.0 {
                        main_net_pct = (main_net_inflow / quote.turnover) * 100.0;
                    }
                }
                return Ok(MoneyFlow { main_net_inflow, main_net_pct });
            }
        }
    }

    // 2) 回退到 push2his 历史接口
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

    let text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    let (klines, _) = parse_fflow_jsonp(&text)?;

    let fields: Vec<&str> = klines.split(',').collect();
    if fields.len() < 11 {
        return Err(format!("东方财富数据字段不足: {}", fields.len()));
    }

    let pf = |idx: usize| -> f64 {
        fields.get(idx).unwrap_or(&"0").trim().parse::<f64>().unwrap_or(0.0)
    };

    Ok(MoneyFlow {
        main_net_inflow: pf(1) / 10000.0,
        main_net_pct: pf(6),
    })
}

/// 获取行业板块资金流向，按主力净流入从高到低排序
pub async fn fetch_sector_money_flow() -> Result<Vec<SectorMoneyFlowItem>, String> {
    let client = super::build_http_client()?;

    let url = format!(
        "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:90+s:4&fields=f12,f14,f2,f3,f62,f66,f72,f78,f84&ut=8dec03ba335b81bf4ebdf7b29ec27d15"
    );

    let resp = client
        .get(&url)
        .header("Referer", "https://data.eastmoney.com/bkzj/")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求板块资金流向失败: {}", e))?;

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let list = data
        .pointer("/data/diff")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "未找到板块资金流向数据".to_string())?;

    let mut results = Vec::new();
    for item in list {
        let pf = |key: &str| -> f64 {
            item.get(key)
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
        };
        results.push(SectorMoneyFlowItem {
            code: item.get("f12").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            name: item.get("f14").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            change_pct: pf("f3"),
            main_net_inflow: pf("f62") / 10000.0,
            super_large_net: pf("f66") / 10000.0,
            large_net: pf("f72") / 10000.0,
            medium_net: pf("f78") / 10000.0,
            small_net: pf("f84") / 10000.0,
        });
    }

    if results.is_empty() {
        return Err("未找到板块资金流向数据".to_string());
    }

    Ok(results)
}
