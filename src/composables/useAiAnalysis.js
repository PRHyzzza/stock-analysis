import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getMergedTools, getToolImpl } from "../skills/index.js";
import { buildSystemPrompt } from "./aiContext.js";
import { callLlmStream } from "./llmClient.js";

const API_KEY_KEY = "stock-analysis-ai-api-key";
const MESSAGES_STORAGE_KEY = "stock-analysis-ai-messages";
const MODEL_KEY = "stock-analysis-ai-model";
const THINKING_ENABLED_KEY = "stock-analysis-ai-thinking";
const REASONING_EFFORT_KEY = "stock-analysis-ai-effort";

/** 可用模型列表（value → label） */
const AVAILABLE_MODELS = [
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];
const DEFAULT_MODEL = "deepseek-v4-flash";

// ============ 按股票隔离的消息存储 ============

function loadAllMessages() {
  try { return JSON.parse(localStorage.getItem(MESSAGES_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveAllMessages(map) {
  localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(map));
}

/** 删除指定股票的 AI 对话记录（供外部调用） */
export function deleteStockMessages(code) {
  const map = loadAllMessages();
  delete map[code];
  saveAllMessages(map);
}

// ============ 从 Skills 架构加载工具 ============

const TOOLS = getMergedTools();

// ============ Composable ============

export function useAiAnalysis() {
  const currentStockCode = ref(null);
  const currentModel = ref(localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL);
  const thinkingEnabled = ref(localStorage.getItem(THINKING_ENABLED_KEY) !== "false");
  const reasoningEffort = ref(localStorage.getItem(REASONING_EFFORT_KEY) || "high");
  const messages = ref([]);
  const loading = ref(false);
  const error = ref("");
  const apiKey = ref(localStorage.getItem(API_KEY_KEY) || "");

  /** 检查当前股票是否在自选股中 */
  function isInWatchlist(code) {
    try {
      const raw = localStorage.getItem("stock-analysis-watchlist");
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.some((s) => s.code === code);
    } catch {
      return false;
    }
  }

  // 自动持久化当前股票的消息（仅自选股才保存）
  watch(messages, (val) => {
    if (currentStockCode.value && isInWatchlist(currentStockCode.value)) {
      const map = loadAllMessages();
      map[currentStockCode.value] = val;
      saveAllMessages(map);
    }
  }, { deep: true });

  /** 切换到指定股票的对话 */
  function switchStock(code) {
    currentStockCode.value = code;
    if (code) {
      const map = loadAllMessages();
      messages.value = map[code] || [];
    } else {
      messages.value = [];
    }
    error.value = "";
  }

  function setApiKey(key) {
    apiKey.value = key;
    localStorage.setItem(API_KEY_KEY, key);
  }

  function clearHistory() {
    messages.value = [];
    error.value = "";
  }

  /**
   * 发送消息 → Agent 循环（最多 5 轮工具调用）+ 流式输出最终回答
   */
  async function sendMessage(text, currentStock, contextData) {
    if (!text.trim() || loading.value) return "";
    if (!apiKey.value) {
      error.value = "请先设置 API Key";
      throw new Error("NO_API_KEY");
    }

    messages.value.push({ role: "user", content: text });
    loading.value = true;
    error.value = "";

    // 流式占位消息（最终回答会被逐字填入）
    const streamMsgIdx = messages.value.length;
    messages.value.push({ role: "assistant", content: "", _streaming: true });

    try {
      const systemPrompt = buildSystemPrompt(currentStock, contextData);
      const recentMessages = messages.value
        .filter((m) => m.role !== "system" && !m._streaming)
        .slice(-20);
      const allMessages = [
        { role: "system", content: systemPrompt },
        ...recentMessages,
      ];

      let currentMessages = [...allMessages];
      let finalContent = "";

      // Agent 循环：每个 round 使用流式调用，工具调用完成后继续下一轮
      for (let round = 0; round < 5; round++) {
        const result = await callLlmStreamWrapped(currentMessages, (content, reasoning) => {
          // 实时更新流式消息
          const msg = messages.value[streamMsgIdx];
          if (msg) {
            msg.content = content;
            if (reasoning) msg._reasoning = reasoning;
          }
        });

        const toolCallsArr = result.tool_calls;
        if (toolCallsArr && toolCallsArr.length > 0) {
          // 记录 assistant 消息（包含 thinking 内容 + tool_calls）
          // 修复：保留 reasoning_content，确保 V4 思考模式下多轮对话正常
          currentMessages.push({
            role: "assistant",
            content: result.content || null,
            ...(result.reasoning_content ? { reasoning_content: result.reasoning_content } : {}),
            tool_calls: toolCallsArr,
          });

          // 清空占位消息准备下一轮
          const msg = messages.value[streamMsgIdx];
          if (msg) { msg.content = ""; delete msg._reasoning; }

          // 依次执行工具
          for (const tc of toolCallsArr) {
            const fnName = tc.function?.name || tc.function_name;
            const toolFn = getToolImpl(fnName);
            if (!toolFn) {
              currentMessages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: `[错误] 未知工具: ${fnName}`,
              });
              continue;
            }

            let args;
            try {
              args = typeof tc.function?.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : (tc.function?.arguments || {});
            } catch {
              currentMessages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: `[错误] 工具参数解析失败`,
              });
              continue;
            }

            const toolResult = await toolFn(args);
            currentMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResult,
            });
          }

          // 新一轮：重新创建流式占位
          messages.value[streamMsgIdx].content = "";
          delete messages.value[streamMsgIdx]._reasoning;
        } else {
          // 没有工具调用 → 最终回答已在流式回调中填入
          finalContent = result.content || "";
          break;
        }
      }

      if (!finalContent) {
        finalContent = "⚠️ 分析超时，请重试或简化您的问题。";
        messages.value[streamMsgIdx].content = finalContent;
      }

      // 移除流式标记
      delete messages.value[streamMsgIdx]._streaming;
      delete messages.value[streamMsgIdx]._reasoning;
      return finalContent;
    } catch (e) {
      if (e.message === "NO_API_KEY") throw e;
      const errMsg = `分析出错: ${e.message || e}`;
      const msg = messages.value[streamMsgIdx];
      if (msg) {
        msg.content = errMsg;
        delete msg._streaming;
        delete msg._reasoning;
      } else {
        messages.value.push({ role: "assistant", content: errMsg });
      }
      error.value = errMsg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function setModel(model) {
    currentModel.value = model;
    localStorage.setItem(MODEL_KEY, model);
  }

  function setThinkingEnabled(enabled) {
    thinkingEnabled.value = enabled;
    localStorage.setItem(THINKING_ENABLED_KEY, String(enabled));
  }

  function setReasoningEffort(effort) {
    reasoningEffort.value = effort;
    localStorage.setItem(REASONING_EFFORT_KEY, effort);
  }

  /** 非流式调用（兼容旧逻辑，不再使用） */
  async function callLlm(messagesList) {
    return await invoke("call_llm", {
      apiKey: apiKey.value,
      model: currentModel.value,
      messages: messagesList,
      tools: TOOLS,
      reasoningEffort: reasoningEffort.value,
      thinkingEnabled: thinkingEnabled.value,
    });
  }

  /**
   * 流式调用（已拆分到 llmClient.js，此处为适配封装）
   */
  function callLlmStreamWrapped(messagesList, onContentDelta) {
    return callLlmStream({
      apiKey: apiKey.value,
      model: currentModel.value,
      thinkingEnabled: thinkingEnabled.value,
      reasoningEffort: reasoningEffort.value,
      messages: messagesList,
      tools: TOOLS,
      onDelta: onContentDelta,
    });
  }

  return {
    messages,
    loading,
    error,
    apiKey,
    currentStockCode,
    currentModel,
    thinkingEnabled,
    reasoningEffort,
    availableModels: AVAILABLE_MODELS,
    setApiKey,
    setModel,
    setThinkingEnabled,
    setReasoningEffort,
    sendMessage,
    clearHistory,
    switchStock,
  };
}
