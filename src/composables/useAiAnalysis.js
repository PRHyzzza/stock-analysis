import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getMergedTools, getMergedSystemPrompt, getToolImpl } from "../skills/index.js";

const API_KEY_KEY = "stock-analysis-ai-api-key";
const MESSAGES_STORAGE_KEY = "stock-analysis-ai-messages";
const DEFAULT_MODEL = "deepseek-chat";

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
  let context = "";
  if (currentStock) {
    context = `
## 当前上下文
用户正在查看的股票：${currentStock.name}（${currentStock.code}）
当前价格：¥${currentStock.price?.toFixed(2) ?? "--"}
涨跌幅：${
      currentStock.changePct != null
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

  // 注入预加载数据
  const preloadedData = serializeContext(contextData);
  let preloadSection = "";
  if (preloadedData) {
    preloadSection = `
## 系统已预加载的数据（你已拥有这些数据，不需要重复调用工具获取）

${preloadedData}

**注意**：以上数据已随当前选中股票一起加载。如果用户问的是当前股票，你已掌握这些数据，直接分析即可，无需再调用工具。
如果用户问的是其他股票，请调用对应工具查询。
`;
  }

  const mergedSystemPrompt = getMergedSystemPrompt();

  return `你是"锐眼 AI"——一个内置于"锐眼"桌面端 A 股分析工具中的智能分析助手。你的任务是利用可调用的工具获取实时数据，为用户提供专业、深度的 A 股个股分析参考。

## 核心能力
1. **综合数据分析** — 结合行情、K线、资金流、行业、大盘等多维度数据
2. **技术面分析** — 通过 K 线数据自行计算均线趋势、判断 MACD/KDJ 等指标状态
3. **资金面分析** — 通过主力资金流向判断大资金态度，关注北向资金动向
4. **今日走势分析** — 当日分时走势、关键价位支撑压力分析
5. **大盘环境** — 结合大盘指数判断整体市场氛围
6. **股票对比** — 当用户问到其他股票时，主动调用 get_stock_quote 等工具查询并对比${preloadSection}
## 可用工具
${TOOLS.map(
  (t) =>
    `- \`${t.function.name}\` — ${t.function.description}`
).join("\n")}

## 工具能力详解

${mergedSystemPrompt}

## A 股市场须知
- **交易制度**：A 股实行 T+1 交易，当日买入次日才能卖出
- **涨跌停限制**：主板 ±10%，创业板 ±20%，科创板 ±20%，北交所 ±30%，ST 股 ±5%，退市整理期 ±10%
- **交易时段**：集合竞价 9:15-9:25，连续竞价 9:30-11:30、13:00-15:00
- **特殊标识**：ST/*ST 为风险警示股，N 为新股首日，C 为上市次日至第 5 日，U 为科创板未盈利
- **关键资金指标**：北向资金（沪深港通）是 A 股重要的外资风向标

## 分析原则
- **基于数据**：每次分析必须先调用工具获取实时数据，不要凭记忆回答
- **多维度**：至少从 2-3 个维度综合分析（技术面 + 资金面 + 行业面）
- **具体引用**：引用具体数值，如"当前价格 ¥256.80，涨幅 +1.23%"
- **A 股术语**：使用"主力""量能""换手""冲高回落""探底回升""封板""开板""炸板"等 A 股投资者熟悉的语言
- **风险提示**：明确指出不确定性，不承诺收益
- **主动回应**：面对"能不能买""什么价位可以买入""目标价多少"等询问，结合实时数据给出明确的参考分析。可以基于技术面（支撑位/阻力位/均线位置）给出参考价位区间，但必须同时附带风险提示（如"需结合自身风险承受能力判断""以上为技术分析参考，不构成投资建议"）
- **简洁有力**：每条回答控制在 300 字以内，用中文
- **适当使用 emoji**：如 📊 📈 📉 🏭 💰 ⚠️ ✅ 🔥 🧊
- **对比分析**：当用户问"和XX比怎么样""相比之下"时，主动查询对比标的的数据，做多维对比${context}
---
`;
}

// ============ Composable ============

export function useAiAnalysis() {
  const currentStockCode = ref(null);
  const messages = ref([]);
  const loading = ref(false);
  const error = ref("");
  const apiKey = ref(localStorage.getItem(API_KEY_KEY) || "");

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
   * 发送消息 → Agent 循环（最多 5 轮工具调用）
   * @param {string} text - 用户输入
   * @param {object|null} currentStock - 当前选中的股票
   * @param {object} [contextData] - 预加载的上下文数据
   * @param {Array} [contextData.klineData] - K 线数据
   * @param {object} [contextData.moneyFlow] - 主力资金数据
   * @param {object} [contextData.industryData] - 行业分析数据
   * @param {Array} [contextData.indices] - 大盘指数数据
   * @returns {Promise<string>} 最终回答
   */
  async function sendMessage(text, currentStock, contextData) {
    if (!text.trim() || loading.value) return "";
    if (!apiKey.value) {
      error.value = "请先设置 DeepSeek API Key";
      throw new Error("NO_API_KEY");
    }

    // 添加用户消息
    messages.value.push({ role: "user", content: text });
    loading.value = true;
    error.value = "";

    try {
      const systemPrompt = buildSystemPrompt(currentStock, contextData);
      // 取最近 20 条消息作为上下文
      const recentMessages = messages.value
        .filter((m) => m.role !== "system")
        .slice(-20);
      const allMessages = [
        { role: "system", content: systemPrompt },
        ...recentMessages,
      ];

      let currentMessages = [...allMessages];
      let finalContent = "";

      // Agent 循环：最多 5 轮工具调用
      for (let round = 0; round < 5; round++) {
        const response = await callLlm(currentMessages);

        const choice = response.choices?.[0];
        if (!choice) {
          throw new Error(`LLM 返回异常: ${JSON.stringify(response)}`);
        }

        const msg = choice.message;

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // 记录 assistant 消息（含工具调用）
          currentMessages.push({
            role: "assistant",
            content: msg.content || null,
            tool_calls: msg.tool_calls.map((tc) => ({
              id: tc.id,
              type: tc.type,
              function: tc.function,
            })),
          });

          // 依次执行工具
          for (const tc of msg.tool_calls) {
            const fn = tc.function;
            const toolFn = getToolImpl(fn.name);
            if (!toolFn) {
              currentMessages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: `[错误] 未知工具: ${fn.name}`,
              });
              continue;
            }

            let args;
            try {
              args = JSON.parse(fn.arguments);
            } catch {
              currentMessages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: `[错误] 工具参数解析失败: ${fn.arguments}`,
              });
              continue;
            }

            const result = await toolFn(args);
            currentMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: result,
            });
          }
        } else {
          // 没有工具调用 → 这是最终回答
          finalContent = msg.content || "";
          break;
        }
      }

      if (!finalContent) {
        finalContent = "⚠️ 分析超时，请重试或简化您的问题。";
      }

      messages.value.push({ role: "assistant", content: finalContent });
      return finalContent;
    } catch (e) {
      if (e.message === "NO_API_KEY") throw e;
      const errMsg = `分析出错: ${e.message || e}`;
      messages.value.push({ role: "assistant", content: errMsg });
      error.value = errMsg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function callLlm(messagesList) {
    return await invoke("call_llm", {
      apiKey: apiKey.value,
      model: DEFAULT_MODEL,
      messages: messagesList,
      tools: TOOLS,
    });
  }

  return {
    messages,
    loading,
    error,
    apiKey,
    currentStockCode,
    setApiKey,
    sendMessage,
    clearHistory,
    switchStock,
  };
}
