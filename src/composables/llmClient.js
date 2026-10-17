/**
 * LLM 流式调用客户端（从 useAiAnalysis.js 拆分）
 * 管理 Tauri SSE 事件监听，返回 Promise
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// 后端流中断原因 → 给用户看的中文说明（llm-done 的 reason 字段）
const REASON_TEXT = {
  stream_interrupted: "上游流式响应中断，内容可能不完整（可点重试继续）",
  client_disconnected: "连接中断，内容可能不完整（可按重试继续）",
};

/**
 * 流式调用 LLM（SSE），通过 Tauri 事件接收 chunk。
 * @param {Object} opts
 * @param {string} opts.apiKey - DeepSeek API Key
 * @param {string} opts.model - 模型名称
 * @param {boolean} opts.thinkingEnabled - 是否启用思考
 * @param {string} opts.reasoningEffort - 推理深度 ("high" | "max")
 * @param {Array} opts.messages - 消息列表
 * @param {Array} opts.tools - 工具定义列表
 * @param {(content: string, reasoning?: string) => void} opts.onDelta - 内容增量回调
 * @param {number} [opts.maxTokens] - 本次调用的 max_tokens（缺省由后端按 393216 兼容）
 * @param {number} [opts.timeoutMs] - 空闲超时（ms）：连续无任何 SSE 数据才失败
 * @returns {Promise<{content:string, tool_calls?:Array, reasoning_content?:string, interrupted?:boolean, warning?:string}>}
 */
export function callLlmStream(opts) {
  const { apiKey, model, thinkingEnabled, reasoningEffort, messages: messagesList, tools, maxTokens, onDelta } = opts;

  return new Promise(async (resolve, reject) => {
    // 每次调用生成唯一 streamId，按事件 payload.id 过滤，
    // 避免个股 AI 与全局 AI 并发流式时互相串流/提前终结
    const streamId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let unlistenChunk = null;
    let unlistenDone = null;
    let unlistenError = null;

    const toolCallMap = {};
    let content = "";
    let reasoningContent = null;
    let finished = false;

    // 空闲超时保护：Rust 端若既不发 done 也不发 error（网络假死/进程挂起），
    // Promise 会永久 pending 导致 loading 卡死 + 事件监听器泄漏。
    // 每收到一个 SSE 事件就重置计时，长回答不会被误杀（后端本身还有 240s 空闲超时）
    const idleTimeoutMs = opts.timeoutMs || 180000;
    let idleTimer = null;
    function resetIdleTimer() {
      if (finished) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error(`LLM 请求超时（${Math.round(idleTimeoutMs / 1000)}s 无数据）`));
      }, idleTimeoutMs);
    }
    resetIdleTimer();

    async function cleanup() {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (unlistenChunk) { unlistenChunk(); unlistenChunk = null; }
      if (unlistenDone) { unlistenDone(); unlistenDone = null; }
      if (unlistenError) { unlistenError(); unlistenError = null; }
    }

    try {
      unlistenChunk = await listen("llm-chunk", (event) => {
        if (finished || event.payload?.id !== streamId) return;
        resetIdleTimer(); // 收到数据即重置空闲计时
        const data = event.payload?.data;
        const delta = data?.choices?.[0]?.delta;
        if (!delta) return;

        if (delta.content) {
          content += delta.content;
          onDelta?.(content);
        }

        if (delta.reasoning_content) {
          reasoningContent = (reasoningContent || "") + delta.reasoning_content;
          onDelta?.(content, reasoningContent);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallMap[idx]) {
              toolCallMap[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
            }
            if (tc.id) toolCallMap[idx].id = tc.id;
            if (tc.type) toolCallMap[idx].type = tc.type;
            if (tc.function?.name) toolCallMap[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCallMap[idx].function.arguments += tc.function.arguments;
          }
        }
      });

      unlistenDone = await listen("llm-done", async (event) => {
        if (finished || event.payload?.id !== streamId) return;
        finished = true;
        await cleanup();

        // 后端流读取中断时发的是 llm-done + 中断终态（不是 llm-error）：
        //   正常结束 { data: {} }
        //   中断     { data: { status:"partial", partial:true, reason, warning } }
        // 此时 content 是半截的，透出 interrupted/warning 让上层提示「已中断（内容可能不完整）」并允许重试
        const payload = event.payload || {};
        const data = payload.data || payload;
        const reason = data.reason || "";
        const partial = data.status === "partial" || data.partial === true;
        const warning = data.warning
          || (partial ? REASON_TEXT[reason] || "流式响应中断，内容可能不完整" : null);

        const toolCallsArr = Object.values(toolCallMap).filter((tc) => tc.function.name);
        resolve({
          content,
          ...(toolCallsArr.length > 0 ? { tool_calls: toolCallsArr } : {}),
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          ...(warning ? { interrupted: true, warning: String(warning) } : {}),
        });
      });

      unlistenError = await listen("llm-error", async (event) => {
        if (finished || event.payload?.id !== streamId) return;
        finished = true;
        await cleanup();
        reject(new Error(event.payload?.data?.error || "LLM 流式请求失败"));
      });

      await invoke("call_llm_stream", {
        streamId,
        apiKey,
        model,
        messages: messagesList,
        tools,
        reasoningEffort,
        thinkingEnabled,
        ...(maxTokens ? { maxTokens } : {}),
      });
    } catch (e) {
      if (!finished) {
        finished = true;
        await cleanup();
        reject(e);
      }
    }
  });
}
