use crate::api::{
    call_llm as call_llm_api, fetch_hot_list, fetch_index_quote, fetch_industry_analysis,
    fetch_industry_name, fetch_intraday_data, fetch_kline_data, fetch_money_flow,
    fetch_money_flow_eastmoney, fetch_search_results, fetch_stock_quote,
};
use crate::types::{
    HotListData, IndustryData, IntradayData, KlineItem, MarketIndex, MarketPerformance,
    MoneyFlow, RevenueRanking, SearchResult, StockQuote,
};

/// 获取个股行业数据（行业名称 + 行业分析）
#[tauri::command]
pub async fn get_stock_industry(code: String) -> Result<IndustryData, String> {
    let em_code = crate::helpers::to_em_code(&code);

    let (name_result, analysis_result) = tokio::join!(
        fetch_industry_name(&code),
        fetch_industry_analysis(&em_code),
    );

    let industry_name = name_result?;
    let analysis = analysis_result?;

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

    Ok(IndustryData {
        industry_name,
        market_performance,
        revenue_ranking,
    })
}

/// 获取个股 K 线数据（日/周/月）
#[tauri::command]
pub async fn get_stock_kline(code: String, period: String) -> Result<Vec<KlineItem>, String> {
    fetch_kline_data(&code, &period).await
}

/// 获取个股分时数据
#[tauri::command]
pub async fn get_stock_intraday(code: String) -> Result<IntradayData, String> {
    fetch_intraday_data(&code).await
}

/// 获取个股实时行情
#[tauri::command]
pub async fn get_stock_quote(code: String) -> Result<StockQuote, String> {
    fetch_stock_quote(&code).await
}



/// 获取大盘指数实时行情（上证/深证/创业板/沪深300/科创50/中证500）
#[tauri::command]
pub async fn get_market_indices() -> Result<Vec<MarketIndex>, String> {
    let codes = vec!["000001", "399001", "399006", "000300", "000688", "000905"];
    let mut results = Vec::new();
    for code in codes {
        match fetch_index_quote(code).await {
            Ok(index) => results.push(index),
            Err(e) => eprintln!("获取指数 {} 失败: {}", code, e),
        }
    }
    Ok(results)
}

/// 搜索股票
#[tauri::command]
pub async fn search_stocks(keyword: String) -> Result<Vec<SearchResult>, String> {
    fetch_search_results(&keyword).await
}

/// 获取个股主力资金流向
/// 优先使用腾讯 API，如果无数据则使用东方财富 API 作为备选
#[tauri::command]
pub async fn get_stock_money_flow(code: String) -> Result<MoneyFlow, String> {
    // 先尝试腾讯 API
    match fetch_money_flow(&code).await {
        Ok(flow) => return Ok(flow),
        Err(e) => {
            // 如果腾讯返回 NO_DATA，尝试东方财富
            if e == "NO_DATA" {
                return fetch_money_flow_eastmoney(&code).await;
            }
            return Err(e);
        }
    }
}

/// 获取热榜数据
#[tauri::command]
pub async fn get_hot_list() -> Result<HotListData, String> {
    fetch_hot_list().await
}

/// 调用 LLM（兼容 DeepSeek / OpenAI）
#[tauri::command]
pub async fn call_llm(
    api_key: String,
    model: String,
    messages: serde_json::Value,
    tools: serde_json::Value,
) -> Result<serde_json::Value, String> {
    call_llm_api(&api_key, &model, &messages, &tools).await
}

