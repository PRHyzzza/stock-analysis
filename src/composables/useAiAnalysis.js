import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getMergedTools, getMergedToolImpl, getToolImpl, getMergedSystemPrompt } from "../skills/index.js";
import { buildSystemPrompt, serializeContext } from "./aiContext.js";
import { callLlmStream } from "./llmClient.js";
import { useUserProfileSingleton } from "./useUserProfile.js";
import { useSettings } from "./useSettings.js";
import { loadStockMessages, saveStockMessages, isStockInWatchlist } from "./aiMessageStore.js";

const API_KEY_KEY = "stock-analysis-ai-api-key";
const MODEL_KEY = "stock-analysis-ai-model";
const THINKING_ENABLED_KEY = "stock-analysis-ai-thinking";
const REASONING_EFFORT_KEY = "stock-analysis-ai-effort";

/** localStorage 安全读取（隐私模式/quota 异常时返回 null） */
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** localStorage 安全写入（quota 满等异常静默忽略） */
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* ignore quota errors */ }
}

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
 * 按字符预算裁剪历史消息（从最新往前保留，总字符不超过 maxChars，至少保留最后一条）
 * 防止长对话 token 超限，控制成本
 */
function trimMessagesToBudget(messages, maxChars = 6000) {
  const result = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const len = (messages[i].content || "").length;
    if (result.length > 0 && total + len > maxChars) break;
    result.unshift(messages[i]);
    total += len;
  }
  return result;
}

/**
 * 构建全局 AI 对话的系统提示词（无股票上下文）
 * @param {string} userProfile - 用户画像 markdown
 * @param {Object|null} currentStock - 快捷引用股票（@代码，有则走 buildSystemPrompt）
 * @param {Object|null} contextData - 预加载数据（大盘指数 / 用户持仓）
 * @param {boolean} webSearchEnabled - 联网搜索是否开启
 */
function buildGlobalSystemPrompt(userProfile, currentStock = null, contextData = null, webSearchEnabled = true) {
  const skillsPrompt = (() => { try { return getMergedSystemPrompt({ excludeSkills: webSearchEnabled ? [] : ["web-search"] }); } catch { return ""; } })();
  const preloaded = contextData ? serializeContext(contextData) : "";

  return `你是一个专业的 A 股 + 港股投资分析助手。你可以帮助用户：
- 查询任意 A 股 / 港股股票的实时行情、K 线数据、资金流向
- 搜索最新的财经新闻、公司公告、市场热点
- 分析行业板块、大盘指数走势
- 回答投资相关的各类问题

## 可用工具
你拥有以下工具可以调用：
${skillsPrompt}

## 联网搜索${webSearchEnabled ? `
联网搜索已开启。**回答任何问题前，先搜索再回答**，流程如下：
1. **想关键词**：把问题拆成 2-3 组**实词**关键词（如「茅台怎么样」→「贵州茅台 批价」「贵州茅台 中报」）
2. **搜索**：调用 \`web_search\` 获取最新新闻/公告/政策；搜不到换通用说法重试，最多 2 次
3. **叠加软件数据**：再调用本地工具获取实时数据（个股→\`get_stock_quote\`/\`get_stock_kline\`/\`get_stock_money_flow\`，大盘→\`get_market_indices\`）
4. **综合回答**：搜索信息 + 实时数据结合，标注来源；两者矛盾以实时数据为准
⚠️ **关键词铁律**：搜索词只用实词（实体+维度+年份），**禁止**「最新消息/最新新闻/怎么样/如何/情况/动态」等泛词——泛词会导致搜索返回无关新闻` : `
联网搜索已关闭，不要尝试调用搜索工具，直接使用本地工具与已有知识回答。`}

## 用户画像
${userProfile ? userProfile : "（未设置）"}

> 画像仅作参考，回答时点到为止，不要复述画像内容。

${preloaded ? `## 系统已预加载的数据
${preloaded}

**注意**：以上大盘指数、持仓及热榜股票数据已随对话预加载。用户询问大盘环境、指数走势、持仓情况或热榜选股时，直接使用这些数据回答，无需重复调用工具。若热榜数据存在，请基于预加载的热榜行情与资金流数据综合分析哪些股票值得买入。
` : ""}

## A 股交易制度
- **T+1**：当日买入次日才能卖出
- **涨跌停**：主板 ±10%，创业板/科创板 ±20%，北交所 ±30%
- **特殊标识**：ST/*ST（风险警示）、N（新股首日）、C（上市次日至第5日）、U（科创板未盈利）

## 港股交易制度
- **T+0**：当日买入可当日卖出，无涨跌停限制
- **交易时段**：早市 9:30-12:00，午市 13:00-16:00
- **交收制度**：T+2 交收
- **货币**：港元 (HKD) 计价

## 注意事项
- 数据仅供参考，不构成投资建议
- 分析股票时调用工具获取实时数据，通用知识可直接回答
- 港股以港元计价，分析时注意货币单位
- 用户输入 @代码（如 @600519）时，该股票行情已注入上下文，优先直接分析
- 用中文回复，简洁专业`;
}

// ============ Composable ============

const { state: settings } = useSettings();
const GLOBAL_CHAT_KEY = "__global__";

export function useAiAnalysis(globalMode = false) {
  const currentStockCode = ref(globalMode ? GLOBAL_CHAT_KEY : null);
  const currentModel = ref(safeGetItem(MODEL_KEY) || settings.aiModel);
  const thinkingEnabled = ref(
    safeGetItem(THINKING_ENABLED_KEY) !== null
      ? safeGetItem(THINKING_ENABLED_KEY) !== "false"
      : settings.aiThinkingEnabled
  );
  const reasoningEffort = ref(safeGetItem(REASONING_EFFORT_KEY) || settings.aiReasoningEffort);
  const webSearchEnabled = ref(settings.aiWebSearchEnabled !== false);
  const messages = ref([]);
  const loading = ref(false);
  const error = ref("");
  const apiKey = ref(safeGetItem(API_KEY_KEY) || "");

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
    safeSetItem(API_KEY_KEY, key);
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

      const updatePrompt = `根据对话更新用户画像。**输出必须极简**：固定三行，每行一个短语（≤20字），禁止长句、禁止解释、禁止标题、禁止列表嵌套：
- 投资风格：
- 关注方向：
- 风险偏好：
无新信息则原样输出原画像，不要改写。

当前画像：
${currentProfile || "（空）"}

对话：
用户: ${userText}
AI: ${aiResponse}`;

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
   * @param {boolean} skipProfileUpdate - true 时不更新用户画像（自动生成的分析指令，如热榜选股）
   */
  async function sendMessage(text, currentStock, contextData, skipProfileUpdate = false) {
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
        ? (currentStock
            ? buildSystemPrompt(currentStock, contextData, userProfile, webSearchEnabled.value)  // @代码 快捷引用 → 完整个股上下文
            : buildGlobalSystemPrompt(userProfile, null, contextData, webSearchEnabled.value))  // 纯全局 → 注入指数/持仓
        : buildSystemPrompt(currentStock, contextData, userProfile, webSearchEnabled.value);
      const recentMessages = trimMessagesToBudget(
        messages.value.filter((m) => m.role !== "system" && !m._streaming)
      );
      const allMessages = [
        { role: "system", content: systemPrompt },
        ...recentMessages,
      ];

      let currentMessages = [...allMessages];
      let finalContent = "";
      let emptySearchCount = 0;  // 连续空搜索计数

      // Agent 循环：每个 round 使用流式调用，工具调用完成后继续下一轮
      // 不限制轮数、不限制时间，直到 AI 给出最终回答
      for (let round = 0; ; round++) {
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

            // 检测连续空搜索：搜 2 次都没结果 → 注入提示让 AI 放弃搜索
            if (fnName === "web_search" && toolResult.startsWith("[空结果]")) {
              emptySearchCount++;
              currentMessages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: toolResult,
              });
              if (emptySearchCount >= 2) {
                currentMessages.push({
                  role: "system",
                  content: "[系统提示] 已连续 2 次搜索无结果，请不要再尝试搜索。直接用已有数据或知识回答用户，告知「暂未找到相关信息」即可。",
                });
              }
              continue;
            }
            if (fnName === "web_search") {
              emptySearchCount = 0;  // 搜到了，重置计数
            }

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
        // 模型未返回正式内容（极端情况）：若有已流式输出的思考内容则保留展示
        const partial = messages.value[streamMsgIdx];
        if (partial?._reasoning) {
          finalContent = `（未生成完整回答，仅保留思考过程，请重试或简化您的问题）\n\n${partial._reasoning}`;
          messages.value[streamMsgIdx].content = finalContent;
        } else {
          finalContent = "⚠️ 分析未返回结果，请重试或简化您的问题。";
          messages.value[streamMsgIdx].content = finalContent;
        }
      }

      // 移除流式标记
      delete messages.value[streamMsgIdx]._streaming;
      delete messages.value[streamMsgIdx]._reasoning;

      // 后台异步更新用户画像（全局对话同样学习用户偏好；热榜选股等自动指令跳过，避免污染画像）
      if (!skipProfileUpdate) {
        updateUserProfileBackground(text, finalContent);
      }

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
    safeSetItem(MODEL_KEY, model);
  }

  function setThinkingEnabled(enabled) {
    thinkingEnabled.value = enabled;
    settings.aiThinkingEnabled = enabled;
    safeSetItem(THINKING_ENABLED_KEY, String(enabled));
  }

  function setReasoningEffort(effort) {
    reasoningEffort.value = effort;
    settings.aiReasoningEffort = effort;
    safeSetItem(REASONING_EFFORT_KEY, effort);
  }

  function setWebSearchEnabled(enabled) {
    webSearchEnabled.value = enabled;
    settings.aiWebSearchEnabled = enabled;
  }

  /** 全局模式：切换到全局对话 */
  function switchGlobal() {
    currentStockCode.value = GLOBAL_CHAT_KEY;
    messages.value = loadStockMessages(GLOBAL_CHAT_KEY);
    error.value = "";
  }

  /** 全局模式：发送消息（可选 @代码 快捷股票上下文 + 指数/持仓预加载） */
  async function sendGlobalMessage(text, stock = null, contextData = null, skipProfileUpdate = false) {
    return sendMessage(text, stock, contextData, skipProfileUpdate);
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
