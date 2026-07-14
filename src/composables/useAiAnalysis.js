import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getMergedTools, getMergedSystemPrompt, getToolImpl } from "../skills/index.js";
import systemPromptTemplate from "../prompts/system-prompt.md?raw";

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

// ============ 构建系统提示词 ============

/**
 * 计算移动平均线
 * @param {Array} data - K 线数据 [{ close }]
 * @param {number} period - 周期
 * @returns {Array} [{ time, value }]
 */
function computeMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) continue;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    result.push({ time: data[i].date || data[i].time, value: Math.round((sum / period) * 100) / 100 });
  }
  return result;
}

/**
 * 将预加载数据序列化为上下文字符串
 */
function serializeContext(contextData) {
  if (!contextData) return "";
  const parts = [];

  if (contextData.klineData && Array.isArray(contextData.klineData) && contextData.klineData.length > 0) {
    const recent = contextData.klineData.slice(-30);
    const maPeriods = [5, 10, 20, 30, 60];
    const maData = {};
    for (const p of maPeriods) {
      if (contextData.klineData.length >= p) {
        const maValues = computeMA(contextData.klineData, p);
        maData[`MA${p}`] = maValues.slice(-30);
      }
    }
    parts.push(`## 预加载 K 线数据（最近 ${recent.length} 根日K，已包含在上下文中无需重新调用工具）\n${JSON.stringify(recent, null, 2)}`);
    parts.push(`## 预计算移动平均线（MA）\n${JSON.stringify(maData, null, 2)}\n（说明：以上为系统预计算的 MA5/MA10/MA20/MA30/MA60 值，你可以直接使用，无需自己计算。）`);
  }

  if (contextData.moneyFlow) {
    parts.push(`## 预加载主力资金数据\n${JSON.stringify(contextData.moneyFlow, null, 2)}`);
  }

  if (contextData.industryData) {
    parts.push(`## 预加载行业分析数据\n${JSON.stringify(contextData.industryData, null, 2)}`);
  }

  if (contextData.indices && Array.isArray(contextData.indices) && contextData.indices.length > 0) {
    parts.push(`## 预加载大盘指数\n${JSON.stringify(contextData.indices, null, 2)}`);
  }

  if (contextData.chipData) {
    const chip = contextData.chipData;
    const costStr = chip.costLevels
      ? `COST5=${chip.costLevels.COST5}, COST15=${chip.costLevels.COST15}, COST50=${chip.costLevels.COST50}, COST85=${chip.costLevels.COST85}, COST95=${chip.costLevels.COST95}`
      : "无";
    const profitPct = chip.distribution
      ? chip.distribution.filter((d) => d.price < chip.currentPrice).reduce((s, d) => s + d.ratio, 0) * 100
      : 0;
    parts.push(`## 预加载筹码分布数据
筹码峰价格：${chip.peakPrice}
平均持仓成本：${chip.avgCost}
当前价：${chip.currentPrice}
获利比例：${profitPct.toFixed(1)}%
套牢比例：${(100 - profitPct).toFixed(1)}%
分位成本：${costStr}`);
  }

  return parts.join("\n\n");
}

function buildSystemPrompt(currentStock, contextData) {
  // 北京时间
  const beijingTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });

  // 构建当前股票上下文
  let context = "";
  if (currentStock) {
    context = `
## 当前上下文
🕐 北京时间：${beijingTime}
用户正在查看的股票：${currentStock.name}（${currentStock.code}）
当前价格：¥${currentStock.price?.toFixed(2) ?? "--"}
涨跌幅：${currentStock.changePct != null
        ? (currentStock.changePct >= 0 ? "+" : "") +
        currentStock.changePct.toFixed(2) +
        "%"
        : "--"
      }
今开：${currentStock.open?.toFixed(2) ?? "--"}　最高：${currentStock.high?.toFixed(2) ?? "--"}　最低：${currentStock.low?.toFixed(2) ?? "--"}
昨收：${currentStock.prevClose?.toFixed(2) ?? "--"}　成交量：${currentStock.volume != null ? (currentStock.volume / 10000).toFixed(2) + '万手' : "--"}　成交额：${currentStock.turnover != null ? (currentStock.turnover / 10000).toFixed(2) + '亿' : "--"}
换手率：${currentStock.turnoverRate != null ? currentStock.turnoverRate.toFixed(2) + '%' : "--"}　市盈率：${currentStock.pe?.toFixed(2) ?? "--"}
`;
  }

  // 预加载数据
  const preloadedData = serializeContext(contextData);
  const preloadSection = preloadedData
    ? `
## 系统已预加载的数据（你已拥有这些数据，不需要重复调用工具获取）

${preloadedData}

**注意**：以上数据已随当前选中股票一起加载。如果用户问的是当前股票，你已掌握这些数据，直接分析即可，无需再调用工具。
如果用户问的是其他股票，请调用对应工具查询。
`
    : "";

  // 工具列表
  const toolsList = TOOLS.map(
    (t) => `- \`${t.function.name}\` — ${t.function.description}`
  ).join("\n");

  return systemPromptTemplate
    .replace("{{PRELOAD_SECTION}}", preloadSection)
    .replace("{{TOOLS}}", toolsList)
    .replace("{{SKILL_PROMPTS}}", getMergedSystemPrompt())
    .replace("{{STOCK_CONTEXT}}", context);
}

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

  // 流式事件监听器清理函数
  let unlistenChunk = null;
  let unlistenDone = null;
  let unlistenError = null;

  // 自动持久化当前股票的消息
  watch(messages, (val) => {
    if (currentStockCode.value) {
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
        const result = await callLlmStream(currentMessages, (content) => {
          // 实时更新流式消息
          const msg = messages.value[streamMsgIdx];
          if (msg) msg.content = content;
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
          if (msg) msg.content = "";

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
      return finalContent;
    } catch (e) {
      if (e.message === "NO_API_KEY") throw e;
      const errMsg = `分析出错: ${e.message || e}`;
      const msg = messages.value[streamMsgIdx];
      if (msg) {
        msg.content = errMsg;
        delete msg._streaming;
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
   * 流式调用 LLM（SSE），通过 Tauri 事件接收 chunk。
   * @param {Array} messagesList
   * @param {(content: string) => void} onContentDelta — 每次收到内容增量时的回调
   * @returns {Promise<{content:string, tool_calls?:Array, reasoning_content?:string}>}
   */
  function callLlmStream(messagesList, onContentDelta) {
    return new Promise(async (resolve, reject) => {
      // 清理上一次的监听器
      if (unlistenChunk) { unlistenChunk(); unlistenChunk = null; }
      if (unlistenDone) { unlistenDone(); unlistenDone = null; }
      if (unlistenError) { unlistenError(); unlistenError = null; }

      const toolCallMap = {};   // idx → 累积的 tool_call
      let content = "";
      let reasoningContent = null;
      let finished = false;

      try {
        unlistenChunk = await listen("llm-chunk", (event) => {
          if (finished) return;
          const data = event.payload?.data;
          const delta = data?.choices?.[0]?.delta;
          if (!delta) return;

          // 累积 content
          if (delta.content) {
            content += delta.content;
            onContentDelta?.(content);
          }

          // 累积 reasoning_content（思考链）
          if (delta.reasoning_content) {
            reasoningContent = (reasoningContent || "") + delta.reasoning_content;
          }

          // 累积 tool_calls（增量碎片拼接）
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

        unlistenDone = await listen("llm-done", async () => {
          if (finished) return;
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
          if (finished) return;
          finished = true;
          await cleanup();
          reject(new Error(event.payload?.data?.error || "LLM 流式请求失败"));
        });

        // 发起流式请求
        await invoke("call_llm_stream", {
          streamId: "main",
          apiKey: apiKey.value,
          model: currentModel.value,
          messages: messagesList,
          tools: TOOLS,
          reasoningEffort: reasoningEffort.value,
          thinkingEnabled: thinkingEnabled.value,
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

  async function cleanup() {
    if (unlistenChunk) { unlistenChunk(); unlistenChunk = null; }
    if (unlistenDone) { unlistenDone(); unlistenDone = null; }
    if (unlistenError) { unlistenError(); unlistenError = null; }
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
