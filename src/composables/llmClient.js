/**
 * LLM 流式调用客户端（从 useAiAnalysis.js 拆分）
 * 管理 Tauri SSE 事件监听，返回 Promise
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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
 * @returns {Promise<{content:string, tool_calls?:Array, reasoning_content?:string}>}
 */
export function callLlmStream(opts) {
  const { apiKey, model, thinkingEnabled, reasoningEffort, messages: messagesList, tools, onDelta } = opts;

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

    // 超时保护：Rust 端若既不发 done 也不发 error（网络假死/进程挂起），
    // Promise 会永久 pending 导致 loading 卡死 + 事件监听器泄漏。
    // 120s 无任何终态事件则强制失败（思考模式长停顿也足够覆盖）
    const timeoutTimer = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error("LLM 请求超时（120s 无响应）"));
    }, opts.timeoutMs || 120000);

    async function cleanup() {
      clearTimeout(timeoutTimer);
      if (unlistenChunk) { unlistenChunk(); unlistenChunk = null; }
      if (unlistenDone) { unlistenDone(); unlistenDone = null; }
      if (unlistenError) { unlistenError(); unlistenError = null; }
    }

    try {
      unlistenChunk = await listen("llm-chunk", (event) => {
        if (finished || event.payload?.id !== streamId) return;
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

        const toolCallsArr = Object.values(toolCallMap).filter((tc) => tc.function.name);
        resolve({
          content,
          ...(toolCallsArr.length > 0 ? { tool_calls: toolCallsArr } : {}),
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
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
