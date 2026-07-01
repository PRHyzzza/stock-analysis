/// LLM (DeepSeek / OpenAI) API
pub async fn call_llm(
    api_key: &str,
    model: &str,
    messages: &serde_json::Value,
    tools: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = "https://api.deepseek.com/chat/completions";

    let client = reqwest::Client::builder()
        .user_agent("Ruiyan/1.0")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), serde_json::json!(model));
    body.insert("messages".to_string(), messages.clone());
    body.insert("temperature".to_string(), serde_json::json!(0.7));
    body.insert("max_tokens".to_string(), serde_json::json!(4096));

    if let Some(tools_arr) = tools.as_array() {
        if !tools_arr.is_empty() {
            body.insert("tools".to_string(), tools.clone());
            body.insert("tool_choice".to_string(), serde_json::json!("auto"));
        }
    }

    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("LLM 请求失败: {}", e))?;

    let status = resp.status();
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 LLM 响应失败: {}", e))?;

    if !status.is_success() {
        let err_msg = data
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");
        return Err(format!("LLM API 错误 ({}): {}", status, err_msg));
    }
    Ok(data)
}
