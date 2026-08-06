use crate::api::{
    call_llm as call_llm_api, fetch_hot_list, fetch_index_quote, fetch_industry_analysis,
    fetch_industry_name, fetch_intraday_data, fetch_kline_data, fetch_money_flow,
    fetch_money_flow_eastmoney, fetch_search_results, fetch_stock_quote,
    fetch_stock_quotes_batch, parse_industry_analysis,
};
use crate::types::{
    HotListData, IndustryData, IntradayData, KlineItem, MarketIndex,
    MoneyFlow, SearchResult, StockQuote, UpdateInfo,
};
use std::fs;
use tauri::Manager;

/// 用户画像持久化路径（app data dir 下的 user-profile.md）

/// 获取个股行业数据（行业名称 + 行业分析）
/// 港股不支持东方财富 HSF10 行业分析，返回空数据
#[tauri::command]
pub async fn get_stock_industry(code: String) -> Result<IndustryData, String> {
    // 港股暂不支持东方财富行业分析，返回空数据
    if crate::helpers::is_hk_stock(&code) {
        return Ok(IndustryData {
            industry_name: "港股".to_string(),
            market_performance: vec![],
            revenue_ranking: vec![],
        });
    }

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



/// 指数代码 → 显示名称（兜底条目用，避免前端显示裸代码）
fn index_name(code: &str) -> &'static str {
    match code {
        "000001" => "上证指数",
        "399001" => "深证成指",
        "399006" => "创业板指",
        "000300" => "沪深300",
        "000688" => "科创50",
        "000905" => "中证500",
        "000852" => "中证1000",
        _ => "未知指数",
    }
}

/// 获取当前应用版本
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 简单版本号比较：a > b 返回 1，相等返回 0，a < b 返回 -1
fn compare_versions(a: &str, b: &str) -> i32 {
    let pa: Vec<i32> = a.split('.').filter_map(|s| s.parse().ok()).collect();
    let pb: Vec<i32> = b.split('.').filter_map(|s| s.parse().ok()).collect();
    for i in 0..pa.len().max(pb.len()) {
        let va = pa.get(i).copied().unwrap_or(0);
        let vb = pb.get(i).copied().unwrap_or(0);
        if va != vb {
            return if va > vb { 1 } else { -1 };
        }
    }
    0
}

/// 检查 GitHub Releases 最新版本（限流 60 次/小时/IP，无认证）
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let client = crate::api::build_http_client()?;
    let resp = client
        .get("https://api.github.com/repos/PRHyzzza/stock-analysis/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("检查更新失败: HTTP {}", resp.status()));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析更新数据失败: {}", e))?;
    let latest = json["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    let url = json["html_url"].as_str().unwrap_or("").to_string();
    let current = env!("CARGO_PKG_VERSION").to_string();
    let has_update = !latest.is_empty() && compare_versions(&latest, &current) > 0;
    Ok(UpdateInfo {
        current,
        latest,
        url,
        has_update,
    })
}

/// 获取大盘指数实时行情（上证/深证/创业板/沪深300/科创50/中证500/中证1000）
#[tauri::command]
pub async fn get_market_indices() -> Result<Vec<MarketIndex>, String> {
    let codes = vec!["000001", "399001", "399006", "000300", "000688", "000905", "000852"];
    // 并行请求全部指数，避免串行等待拉高总延迟
    let results = futures_util::future::join_all(
        codes.iter().map(|code| fetch_index_quote(code)),
    )
    .await;

    let mut out = Vec::with_capacity(codes.len());
    for (code, res) in codes.iter().zip(results) {
        match res {
            Ok(index) => out.push(index),
            Err(e) => {
                eprintln!("获取指数 {} 失败: {}", code, e);
                // 兜底：确保前端始终收到所有指数条目，price=0 由前端展示为 "--"
                out.push(MarketIndex {
                    code: code.to_string(),
                    name: index_name(code).to_string(),
                    price: 0.0,
                    change: 0.0,
                    change_pct: 0.0,
                });
            }
        }
    }
    Ok(out)
}

/// 批量获取多只股票实时行情（腾讯批量接口，A 股一次请求，港股逐只）
#[tauri::command]
pub async fn get_stock_quotes_batch(codes: Vec<String>) -> Result<Vec<StockQuote>, String> {
    fetch_stock_quotes_batch(&codes).await
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

// ──────────────────────────────────────────
// 用户画像读写（存储在 Tauri app data dir）
// ──────────────────────────────────────────

const PROFILE_FILENAME: &str = "user-profile.md";

fn profile_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app data dir 失败: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))?;
    Ok(dir.join(PROFILE_FILENAME))
}

/// 读取用户画像（返回 md 原文，不存在则返回空字符串）
#[tauri::command]
pub fn read_user_profile(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = profile_path(&app_handle)?;
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| format!("读取画像文件失败: {}", e))
    } else {
        Ok(String::new())
    }
}

/// 保存用户画像（覆盖写入 md 文件）
#[tauri::command]
pub fn save_user_profile(app_handle: tauri::AppHandle, content: String) -> Result<(), String> {
    let path = profile_path(&app_handle)?;
    fs::write(&path, &content).map_err(|e| format!("写入画像文件失败: {}", e))
}

// ──────────────────────────────────────────
// Web 搜索与网页抓取
// ──────────────────────────────────────────

/// 网页搜索（东方财富新闻库，按时间倒序返回最新财经新闻）
#[tauri::command]
pub async fn web_search(query: String, max_results: Option<usize>) -> Result<Vec<crate::api::WebSearchResult>, String> {
    crate::api::web_search(&query, max_results.unwrap_or(10)).await
}

/// 网页抓取（获取指定 URL 的纯文本内容）
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<String, String> {
    crate::api::web_fetch(&url).await
}

/// 获取港元兑人民币汇率（CNY/HKD）
#[tauri::command]
pub async fn get_fx_rate() -> Result<f64, String> {
    crate::api::tencent::fetch_fx_rate().await
}

