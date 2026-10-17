/// LLM (DeepSeek / OpenAI) API
use futures_util::StreamExt;
use serde::Serialize;
use tauri::Emitter;

/// 默认输出上限：DeepSeek V4 官方最大输出 384K tokens（上下文 1M），
/// 思考模式 reasoning_content 也占用输出预算。
/// 但主对话/画像更新/搜索改写等场景只需要 256~8K，不再统一顶到 393216
/// （超大 max_tokens 会让网关提前分配、拖慢首 token，个别兼容端点还会直接拒绝）。
const DEFAULT_MAX_TOKENS: u32 = 393216;

/// 模型官方最大输出上限，超过会直接 400，这里统一夹住
const MAX_OUTPUT_TOKENS: u32 = 393216;

/// 计算本次请求实际生效的 max_tokens：缺省/0 走默认值，超过模型上限则夹到上限
fn resolve_max_tokens(max_tokens: Option<u32>) -> u32 {
    max_tokens
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MAX_TOKENS)
        .min(MAX_OUTPUT_TOKENS)
}

/// 非流式调用 LLM（用于 Agent 工具调用环）
pub async fn call_llm(
    api_key: &str,
    model: &str,
    messages: &serde_json::Value,
    tools: &serde_json::Value,
    reasoning_effort: &str,
    thinking_enabled: bool,
    max_tokens: Option<u32>,
) -> Result<serde_json::Value, String> {
    let client = super::build_llm_http_client()?;
    let url = "https://api.deepseek.com/chat/completions";
    let max_tokens = resolve_max_tokens(max_tokens);
    eprintln!("[llm] 非流式请求生效 max_tokens = {}（model={}）", max_tokens, model);

    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), serde_json::json!(model));
    body.insert("messages".to_string(), messages.clone());
    body.insert("max_tokens".to_string(), serde_json::json!(max_tokens));

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

/// 找到 buf 中第一个 SSE 事件边界（\n\n 或 \r\n\r\n），返回事件字节长度（不含分隔符）
/// CRLF 兼容：\r\n\r\n 中不存在 \n\n 子序列，两种边界互不干扰
fn find_event_len(buf: &[u8]) -> Option<usize> {
    if let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
        return Some(pos);
    }
    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
        return Some(pos);
    }
    None
}

/// 构造「部分完成」终态 payload。
/// 前端（T2）据 `status == "partial"` 把本轮标记为中断而非成功；
/// 旧前端不读这些字段，只会当成功收尾，行为与改动前一致（向后兼容）。
fn partial_payload(reason: &str, warning: String) -> serde_json::Value {
    serde_json::json!({
        "status": "partial",
        "partial": true,
        "reason": reason,
        "warning": warning,
    })
}

/// 终态事件守卫：保证每次流式调用**恰好发一次** llm-done。
/// - 正常结束 / 收到 [DONE] / 流中断：显式 emit 后置 fired；
/// - 命令 future 被丢弃（窗口关闭、前端切换会话取消调用）：Drop 里补发中断终态，
///   否则前端永远等不到 llm-done，只能一直转圈。
struct DoneGuard {
    app_handle: tauri::AppHandle,
    sid: String,
    fired: bool,
}

impl DoneGuard {
    fn new(app_handle: tauri::AppHandle, sid: String) -> Self {
        Self { app_handle, sid, fired: false }
    }

    /// 发送终态事件（只发一次；重复调用会被忽略）
    fn finish(&mut self, data: serde_json::Value) {
        if self.fired {
            return;
        }
        self.fired = true;
        let _ = self.app_handle.emit("llm-done", StreamChunk { id: self.sid.clone(), data });
    }
}

impl Drop for DoneGuard {
    fn drop(&mut self) {
        if !self.fired {
            // 理论只有 future 被丢弃才会走到这里（正常路径都显式 finish）
            self.finish(partial_payload(
                "client_disconnected",
                "LLM 流式调用被取消，已返回部分内容".to_string(),
            ));
        }
    }
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
    max_tokens: Option<u32>,
) -> Result<(), String> {
    let client = super::build_llm_http_client()?;
    let url = "https://api.deepseek.com/chat/completions";
    let max_tokens = resolve_max_tokens(max_tokens);
    eprintln!("[llm] 流式请求生效 max_tokens = {}（model={}）", max_tokens, model);

    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), serde_json::json!(model));
    body.insert("messages".to_string(), messages.clone());
    body.insert("stream".to_string(), serde_json::json!(true));
    body.insert("max_tokens".to_string(), serde_json::json!(max_tokens));

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
    // 注意：必须按字节累积、按事件边界切分后再解码 UTF-8。
    // 若按 chunk from_utf8_lossy，多字节汉字跨 TCP chunk 边界会被切成 U+FFFD 乱码
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let sid = stream_id.to_string();
    // 终态守卫：正常结束/中断都显式 finish；future 被丢弃时由 Drop 补发
    let mut guard = DoneGuard::new(app_handle.clone(), sid.clone());

    // 处理一个完整 SSE 事件（事件字节不含结尾分隔符）
    // 返回 true = 继续读取，false = 已收到 [DONE] 终止标记
    // `data:` 前缀兼容有/无空格两种写法（RFC 中 "data:" 后可有可无空格）
    let handle_event = |event_bytes: &[u8]| -> bool {
        let event = String::from_utf8_lossy(event_bytes);
        for line in event.lines() {
            let data = line.strip_prefix("data:").map(str::trim_start);
            if let Some(data) = data {
                if data == "[DONE]" {
                    return false; // 终止标记
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
        true
    };

    // 找到 buf 中第一个 SSE 事件边界（\n\n 或 \r\n\r\n），返回事件字节长度（不含分隔符）
    // CRLF 兼容：\r\n\r\n 中不存在 \n\n 子序列，两种边界互不干扰
    // （实现见模块级 find_event_len，便于单测）

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                // 连接中断或超时：保留已收到的内容，但必须让前端知道这是**不完整**结果
                // （旧实现只带 warning，前端 llm-done 处理器不读 warning，会当成功收尾）
                guard.finish(partial_payload(
                    "stream_interrupted",
                    format!("流读取中断: {}", e),
                ));
                return Ok(());
            }
        };
        buf.extend_from_slice(&chunk);

        // 处理完整的 SSE 事件（ASCII 边界即 UTF-8 字符边界，切分安全）
        while let Some(len) = find_event_len(&buf) {
            let event_bytes: Vec<u8> = buf.drain(..len).collect();
            // 移除分隔符（2 字节 \n\n 或 4 字节 \r\n\r\n）
            let sep_len = if len + 1 < buf.len() && buf[len] == b'\r' && buf[len + 1] == b'\n' { 4 } else { 2 };
            buf.drain(..sep_len);
            if !handle_event(&event_bytes) {
                // 收到 [DONE]：正常结束（内容完整）
                guard.finish(serde_json::json!({}));
                return Ok(());
            }
        }
    }

    // 流结束：flush 剩余缓冲（最后一个事件可能没有以空行结尾，如连接被网关截断）。
    // 不完整事件（如 data: {"partial...）JSON 解析失败会被静默忽略，不会误发
    if !buf.is_empty() {
        // 去掉尾部残留的行结束符（\n / \r\n），再按事件处理
        while buf.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
            buf.pop();
        }
        if !buf.is_empty() && !handle_event(&buf) {
            guard.finish(serde_json::json!({}));
            return Ok(());
        }
    }

    // 流正常结束（服务端没发 [DONE] 但连接正常关闭，视为完整）
    guard.finish(serde_json::json!({}));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_max_tokens_defaults_and_clamps() {
        assert_eq!(resolve_max_tokens(None), 393216);
        assert_eq!(resolve_max_tokens(Some(0)), 393216);
        assert_eq!(resolve_max_tokens(Some(4096)), 4096);
        assert_eq!(resolve_max_tokens(Some(256)), 256);
        assert_eq!(resolve_max_tokens(Some(1_000_000)), 393216);
    }

    #[test]
    fn find_event_len_detects_lf_and_crlf_boundaries() {
        // 纯 LF：事件 7 字节 "data: x"，边界在 7
        assert_eq!(find_event_len(b"data: x\n\ndata: y"), Some(7));
        // CRLF：同样 7 字节，边界为 4 字节 \r\n\r\n
        assert_eq!(find_event_len(b"data: x\r\n\r\ndata: y"), Some(7));
        // 只有一个 \n 不算事件边界
        assert_eq!(find_event_len(b"data: x\n"), None);
        // 缓冲区里没有任何分隔符
        assert_eq!(find_event_len(b"data: {\"a\":1}"), None);
        // 空缓冲区
        assert_eq!(find_event_len(b""), None);
        // 跨块场景：分隔符被拆到两个 chunk 时，拼接后仍能找到
        let mut buf = Vec::new();
        buf.extend_from_slice(b"data: x\r\n");
        assert_eq!(find_event_len(&buf), None);
        buf.extend_from_slice(b"\r\ndata: y");
        assert_eq!(find_event_len(&buf), Some(7));
    }

    #[test]
    fn find_event_len_prefers_first_boundary() {
        let buf = b"data: a\n\ndata: b\n\n";
        assert_eq!(find_event_len(buf), Some(7));
    }

    #[test]
    fn partial_payload_marks_status_and_reason() {
        for reason in ["client_disconnected", "stream_interrupted"] {
            let payload = partial_payload(reason, "测试中断".to_string());
            assert_eq!(payload["status"], "partial");
            assert_eq!(payload["partial"], true);
            assert_eq!(payload["reason"], reason);
            assert_eq!(payload["warning"], "测试中断");
        }
    }
}
