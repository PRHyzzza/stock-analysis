use crate::api::{
    call_llm as call_llm_api, fetch_hot_list, fetch_index_quote, fetch_industry_analysis,
    fetch_industry_name, fetch_intraday_data, fetch_kline_data, fetch_money_flow,
    fetch_money_flow_eastmoney, fetch_search_results, fetch_sector_money_flow, fetch_stock_quote,
    parse_industry_analysis,
};
use crate::types::{
    HotListData, IndustryData, IntradayData, KlineItem, MarketIndex,
    MoneyFlow, SearchResult, SectorMoneyFlowItem, StockQuote,
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
    let mut data = parse_industry_analysis(&code, &analysis);
    data.industry_name = industry_name;
    Ok(data)
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



/// 获取大盘指数实时行情（上证/深证/创业板/沪深300/科创50/中证500/中证1000）
#[tauri::command]
pub async fn get_market_indices() -> Result<Vec<MarketIndex>, String> {
    let codes = vec!["000001", "399001", "399006", "000300", "000688", "000905", "000852"];
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

/// 获取全部板块资金流向（行业+概念），按主力净流入从高到低排序
#[tauri::command]
pub async fn get_sector_money_flow() -> Result<Vec<SectorMoneyFlowItem>, String> {
    fetch_sector_money_flow().await
}

/// 调用 LLM（兼容 DeepSeek / OpenAI）
#[tauri::command]
pub async fn call_llm(
    api_key: String,
    model: String,
    messages: serde_json::Value,
    tools: serde_json::Value,
    reasoning_effort: Option<String>,
    thinking_enabled: Option<bool>,
) -> Result<serde_json::Value, String> {
    let re = reasoning_effort.as_deref().unwrap_or("high");
    let te = thinking_enabled.unwrap_or(true);
    call_llm_api(&api_key, &model, &messages, &tools, re, te).await
}

/// 流式调用 LLM（通过 Tauri 事件推送结果）
#[tauri::command]
pub async fn call_llm_stream(
    app_handle: tauri::AppHandle,
    stream_id: String,
    api_key: String,
    model: String,
    messages: serde_json::Value,
    tools: serde_json::Value,
    reasoning_effort: Option<String>,
    thinking_enabled: Option<bool>,
) -> Result<(), String> {
    let re = reasoning_effort.as_deref().unwrap_or("high");
    let te = thinking_enabled.unwrap_or(true);
    crate::api::call_llm_stream(
        app_handle,
        &stream_id,
        &api_key,
        &model,
        &messages,
        &tools,
        re,
        te,
    ).await
}

