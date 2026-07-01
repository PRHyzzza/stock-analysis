/// 同花顺热榜
use crate::types::{HotListData, HotStockItem};

/// 获取热榜数据
pub async fn fetch_hot_list() -> Result<HotListData, String> {
    let url = "https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour&list_type=normal";

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(url)
        .header("Referer", "https://www.10jqka.com.cn/")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求热榜数据失败: {}", e))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析热榜 JSON 失败: {}", e))?;

    let stock_list = body["data"]["stock_list"]
        .as_array()
        .ok_or_else(|| "热榜数据格式异常: 缺少 data.stock_list".to_string())?;

    let items: Vec<HotStockItem> = stock_list
        .iter()
        .map(|item| {
            let tags: Vec<String> = item["tag"]["concept_tag"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();

            HotStockItem {
                code: item["code"].as_str().unwrap_or("").to_string(),
                name: item["name"].as_str().unwrap_or("").to_string(),
                rate: item["rate"].as_str().unwrap_or("0").to_string(),
                rise_and_fall: item["rise_and_fall"].as_f64().unwrap_or(0.0),
                hot_rank_chg: item["hot_rank_chg"].as_i64().unwrap_or(0),
                order: item["order"].as_i64().unwrap_or(0),
                market: item["market"].as_i64().unwrap_or(0),
                tags,
                popularity_tag: item["tag"]["popularity_tag"]
                    .as_str().unwrap_or("").to_string(),
            }
        })
        .collect();

    Ok(HotListData { stock_list: items })
}
