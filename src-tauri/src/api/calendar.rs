/// 同花顺 Fuyao 交易日历（A 股）
///
/// 接口：GET https://fuyao.aicubes.cn/api/a-share/calendar/trading-days
/// - 无参数，固定返回 `[今日-1年, 今日]` 的 A 股交易日（含沪深北，不含港股）
/// - 鉴权：请求头 `X-api-key`
/// - 响应包裹：`{ code, message, request_id, data: { timestamp, item: [{ date_ms, date }] } }`
///   业务错误以 HTTP 200 + 非 0 `code` 返回，需按 code 判断成功与否
use std::collections::BTreeSet;

/// Fuyao API 基础地址
const FUYAO_BASE: &str = "https://fuyao.aicubes.cn";

/// 获取 A 股近一年交易日（返回 "yyyy-MM-dd"，升序去重）
pub async fn fetch_trading_days(api_key: &str) -> Result<Vec<String>, String> {
    let client = super::build_http_client()?;
    let url = format!("{}/api/a-share/calendar/trading-days", FUYAO_BASE);

    let resp = client
        .get(&url)
        .header("X-api-key", api_key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求交易日历失败: {}", e))?;

    // 先检查状态码，避免网关返回的 HTML 被误报为"解析 JSON 失败"
    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "[INVALID_KEY] 同花顺 API Key 无效（HTTP 401/403）".to_string(),
            429 => "[RATE_LIMITED] 交易日历请求过于频繁，请稍后重试（HTTP 429）".to_string(),
            _ => format!("交易日历接口返回 HTTP {}", status),
        });
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析交易日历 JSON 失败: {}", e))?;

    let code = body["code"].as_i64().unwrap_or(-1);
    if code != 0 {
        let msg = body["message"].as_str().unwrap_or("").to_string();
        return Err(match code {
            2001 => "[NO_API_KEY] 同花顺 API Key 缺失或无效，请到 https://fuyao.aicubes.cn/admin/ 获取".to_string(),
            2003 => "[INVALID_KEY] 同花顺 API Key 无该接口权限".to_string(),
            4001 => "[RATE_LIMITED] 交易日历触发限流，请稍后重试".to_string(),
            _ => format!("交易日历接口返回 code={}: {}", code, msg),
        });
    }

    let items = body["data"]["item"]
        .as_array()
        .ok_or_else(|| "交易日历数据格式异常: 缺少 data.item".to_string())?;

    // BTreeSet 天然升序去重（接口偶发重复日期）
    let days: Vec<String> = items
        .iter()
        .filter_map(|item| item["date"].as_str())
        .filter_map(normalize_date)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    if days.is_empty() {
        return Err("交易日历返回空数据".to_string());
    }

    Ok(days)
}

/// `yyyyMMdd` / `yyyy-MM-dd` → `yyyy-MM-dd`（前端按字符串比较，必须统一格式；异常值丢弃）
fn normalize_date(raw: &str) -> Option<String> {
    let compact = raw.replace('-', "");
    if compact.len() != 8 || !compact.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(format!(
        "{}-{}-{}",
        &compact[0..4],
        &compact[4..6],
        &compact[6..8]
    ))
}
