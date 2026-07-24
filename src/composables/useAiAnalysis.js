import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getMergedTools, getMergedToolImpl, getToolImpl, getMergedSystemPrompt } from "../skills/index.js";
import { buildSystemPrompt } from "./aiContext.js";
import { callLlmStream } from "./llmClient.js";
import { useUserProfileSingleton } from "./useUserProfile.js";
import { useSettings } from "./useSettings.js";
import { loadStockMessages, saveStockMessages, isStockInWatchlist } from "./aiMessageStore.js";

const API_KEY_KEY = "stock-analysis-ai-api-key";
const MODEL_KEY = "stock-analysis-ai-model";
const THINKING_ENABLED_KEY = "stock-analysis-ai-thinking";
const REASONING_EFFORT_KEY = "stock-analysis-ai-effort";

/** 可用模型列表（value → label） */
const AVAILABLE_MODELS = [
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];
const DEFAULT_MODEL = "deepseek-v4-flash";

// ============ 从 Skills 架构加载工具 ============

/** 根据是否开启联网搜索，返回当前激活的工具 */
function buildTools(webSearchEnabled) {
  const exclude = webSearchEnabled ? [] : ["web-search"];
  return {
    tools: getMergedTools({ excludeSkills: exclude }),
    toolImpl: getMergedToolImpl({ excludeSkills: exclude }),
  };
}

/**
 * 构建全局 AI 对话的系统提示词（无股票上下文）
 */
function buildGlobalSystemPrompt(userProfile) {
  const skillsPrompt = (() => { try { return getMergedSystemPrompt(); } catch { return ""; } })();

  return `你是一个专业的 A 股投资分析助手。你可以帮助用户：
- 查询任意 A 股股票的实时行情、K 线数据、资金流向
- 搜索最新的财经新闻、公司公告、市场热点
- 分析行业板块、大盘指数走势
- 回答投资相关的各类问题

## 可用工具
你拥有以下工具可以调用：
${skillsPrompt}

## 联网搜索
你具备联网搜索能力（web_search / web_fetch），当用户询问最新新闻、实时资讯时主动搜索。
搜索策略：先用 web_search 发现信息源，再选择性用 web_fetch 深入阅读。
回答中引用网络信息时标注来源 URL。

## 用户画像
${userProfile ? `当前用户画像：\n${userProfile}\n\n请结合用户画像提供个性化建议。` : "用户尚未设置画像。"}

## 注意事项
- 数据仅供参考，不构成投资建议
- 优先使用工具获取实时数据，而非凭记忆回答
- 用中文回复，简洁专业`;
}

// ============ Composable ============

const { state: settings } = useSettings();
const GLOBAL_CHAT_KEY = "__global__";

export function useAiAnalysis(globalMode = false) {
  const currentStockCode = ref(globalMode ? GLOBAL_CHAT_KEY : null);
  const currentModel = ref(localStorage.getItem(MODEL_KEY) || settings.aiModel);
  const thinkingEnabled = ref(
    localStorage.getItem(THINKING_ENABLED_KEY) !== null
      ? localStorage.getItem(THINKING_ENABLED_KEY) !== "false"
      : settings.aiThinkingEnabled
  );
  const reasoningEffort = ref(localStorage.getItem(REASONING_EFFORT_KEY) || settings.aiReasoningEffort);
  const webSearchEnabled = ref(globalMode ? true : (settings.aiWebSearchEnabled !== false));
  const messages = ref([]);
  const loading = ref(false);
  const error = ref("");
  const apiKey = ref(localStorage.getItem(API_KEY_KEY) || "");

  // 当前激活的工具（根据 webSearchEnabled 动态切换）
  function activeTools() {
    return buildTools(webSearchEnabled.value);
  }

  // 设置变更时同步到 AI 状态（SettingsModal → AiModelControls）
  watch(() => settings.aiModel, (m) => { if (m) currentModel.value = m; });
  watch(() => settings.aiThinkingEnabled, (v) => { thinkingEnabled.value = v; });
  watch(() => settings.aiReasoningEffort, (v) => { if (v) reasoningEffort.value = v; });
  watch(() => settings.aiWebSearchEnabled, (v) => { webSearchEnabled.value = v !== false; });

  // 自动持久化当前股票的消息（仅自选股才保存；全局模式始终保存）
  watch(messages, (val) => {
    if (globalMode && currentStockCode.value) {
      saveStockMessages(currentStockCode.value, val);
    } else if (currentStockCode.value && isStockInWatchlist(currentStockCode.value)) {
      saveStockMessages(currentStockCode.value, val);
    }
  }, { deep: true });

  /** 切换到指定股票的对话 */
  function switchStock(code) {
    currentStockCode.value = code;
    messages.value = loadStockMessages(code);
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
   * 后台异步更新用户画像：用非流式调用让 AI 总结本轮对话，增量更新画像
   * 失败静默处理，不影响主流程
   */
  async function updateUserProfileBackground(userText, aiResponse) {
    try {
      const { profileContent, saveProfile } = useUserProfileSingleton();
      const currentProfile = profileContent.value || "";

      const updatePrompt = `你是一个用户画像分析器。请根据以下对话，更新用户画像（Markdown 格式，不超过200字）

## 当前画像
${currentProfile || "（尚无）"}

## 本轮对话
用户: ${userText}
AI: ${aiResponse.slice(0, 800)}

## 要求
1. 如果当前画像为空，请创建初始画像。
2. 如果已有画像，根据新对话微调（不要丢失原有信息）。
3. 聚焦：投资风格 + 关注方向 + 风险偏好。
4. 输出纯 Markdown，没有代码块包裹，没有多余解释。
5. 用中文。`;

      const result = await invoke("call_llm", {
        apiKey: apiKey.value,
        model: "deepseek-v4-flash",
        messages: [
          { role: "user", content: updatePrompt },
        ],
        tools: [],
        reasoningEffort: "low",
        thinkingEnabled: false,
      });

      const newContent = result?.choices?.[0]?.message?.content?.trim();
      if (newContent && newContent !== currentProfile) {
        await saveProfile(newContent);
      }
    } catch {
      // 画像更新失败不影响主流程
    }
  }

  /**
   * 发送消息 → Agent 循环 + 流式输出 + 后台画像更新
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
      // 获取用户画像注入系统提示词
      const { getProfileForContext } = useUserProfileSingleton();
      const userProfile = getProfileForContext();
      const systemPrompt = globalMode
        ? buildGlobalSystemPrompt(userProfile)
        : buildSystemPrompt(currentStock, contextData, userProfile);
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
            const toolFn = getToolImpl(fnName, { excludeSkills: webSearchEnabled.value ? [] : ["web-search"] });
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

      // 后台异步更新用户画像（全局模式跳过）
      if (!globalMode) updateUserProfileBackground(text, finalContent);

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
    settings.aiModel = model;
    localStorage.setItem(MODEL_KEY, model);
  }

  function setThinkingEnabled(enabled) {
    thinkingEnabled.value = enabled;
    settings.aiThinkingEnabled = enabled;
    localStorage.setItem(THINKING_ENABLED_KEY, String(enabled));
  }

  function setReasoningEffort(effort) {
    reasoningEffort.value = effort;
    settings.aiReasoningEffort = effort;
    localStorage.setItem(REASONING_EFFORT_KEY, effort);
  }

  function setWebSearchEnabled(enabled) {
    if (globalMode) return; // 全局模式始终开启联网
    webSearchEnabled.value = enabled;
    settings.aiWebSearchEnabled = enabled;
  }

  /** 全局模式：切换到全局对话 */
  function switchGlobal() {
    currentStockCode.value = GLOBAL_CHAT_KEY;
    messages.value = loadStockMessages(GLOBAL_CHAT_KEY);
    error.value = "";
  }

  /** 全局模式：发送消息（无需股票上下文） */
  async function sendGlobalMessage(text) {
    return sendMessage(text, null, null);
  }

  /** 非流式调用（兼容旧逻辑，不再使用） */
  async function callLlm(messagesList) {
    const { tools } = activeTools();
    return await invoke("call_llm", {
      apiKey: apiKey.value,
      model: currentModel.value,
      messages: messagesList,
      tools,
      reasoningEffort: reasoningEffort.value,
      thinkingEnabled: thinkingEnabled.value,
    });
  }

  /**
   * 流式调用（已拆分到 llmClient.js，此处为适配封装）
   */
  function callLlmStreamWrapped(messagesList, onContentDelta) {
    const { tools } = activeTools();
    return callLlmStream({
      apiKey: apiKey.value,
      model: currentModel.value,
      thinkingEnabled: thinkingEnabled.value,
      reasoningEffort: reasoningEffort.value,
      messages: messagesList,
      tools,
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
    setWebSearchEnabled,
    webSearchEnabled,
    sendMessage,
    sendGlobalMessage,
    switchGlobal,
    globalMode,
    clearHistory,
    switchStock,
  };
}
