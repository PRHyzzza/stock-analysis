/// LLM (DeepSeek / OpenAI) API
use futures_util::StreamExt;
use serde::Serialize;
use tauri::Emitter;

/// 非流式调用 LLM（用于 Agent 工具调用环）
pub async fn call_llm(
    api_key: &str,
    model: &str,
    messages: &serde_json::Value,
    tools: &serde_json::Value,
    reasoning_effort: &str,
    thinking_enabled: bool,
) -> Result<serde_json::Value, String> {
    let url = "https://api.deepseek.com/chat/completions";

    let client = reqwest::Client::builder()
        .user_agent("stock-analysis/1.0")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), serde_json::json!(model));
    body.insert("messages".to_string(), messages.clone());
    body.insert("max_tokens".to_string(), serde_json::json!(4096));

    // 思考模式控制
    if !thinking_enabled {
        body.insert("thinking".to_string(), serde_json::json!({"type": "disabled"}));
        body.insert("temperature".to_string(), serde_json::json!(0.7));
    } else {
        // 思考模式下 temperature 被忽略，不发送避免混淆
        body.insert("reasoning_effort".to_string(), serde_json::json!(reasoning_effort));
    }

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

/// SSE 事件负载
#[derive(Clone, Serialize)]
struct StreamChunk {
    id: String,
    data: serde_json::Value,
}

/// 流式调用 LLM（用于最终回答的流式输出）
/// 通过 Tauri 事件 "llm-chunk" / "llm-done" / "llm-error" 推送结果
pub async fn call_llm_stream(
    app_handle: tauri::AppHandle,
    stream_id: &str,
    api_key: &str,
    model: &str,
    messages: &serde_json::Value,
    tools: &serde_json::Value,
    reasoning_effort: &str,
    thinking_enabled: bool,
) -> Result<(), String> {
    let url = "https://api.deepseek.com/chat/completions";

    let client = reqwest::Client::builder()
        .user_agent("stock-analysis/1.0")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), serde_json::json!(model));
    body.insert("messages".to_string(), messages.clone());
    body.insert("stream".to_string(), serde_json::json!(true));
    body.insert("max_tokens".to_string(), serde_json::json!(4096));

    if !thinking_enabled {
        body.insert("thinking".to_string(), serde_json::json!({"type": "disabled"}));
        body.insert("temperature".to_string(), serde_json::json!(0.7));
    } else {
        body.insert("reasoning_effort".to_string(), serde_json::json!(reasoning_effort));
    }

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
    if !status.is_success() {
        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("解析错误响应失败: {}", e))?;
        let err_msg = data
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");
        let _ = app_handle.emit("llm-error", StreamChunk {
            id: stream_id.to_string(),
            data: serde_json::json!({"error": format!("LLM API 错误 ({}): {}", status, err_msg)}),
        });
        return Err(format!("LLM API 错误 ({}): {}", status, err_msg));
    }

    // 解析 SSE 流
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let sid = stream_id.to_string();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取流数据失败: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // 处理完整的 SSE 事件（以 \n\n 分隔）
        while let Some(pos) = buffer.find("\n\n") {
            let event = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            for line in event.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        let _ = app_handle.emit("llm-done", StreamChunk {
                            id: sid.clone(),
                            data: serde_json::json!({}),
                        });
                        return Ok(());
                    }
                    // 解析 JSON 并发送
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        let _ = app_handle.emit("llm-chunk", StreamChunk {
                            id: sid.clone(),
                            data: parsed,
                        });
                    }
                }
            }
        }
    }

    // 流意外结束
    let _ = app_handle.emit("llm-done", StreamChunk {
        id: sid.clone(),
        data: serde_json::json!({"warning": "流意外结束"}),
    });
    Ok(())
}
