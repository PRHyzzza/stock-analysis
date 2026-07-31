/**
 * AI 上下文构建模块
 * 负责将预加载数据序列化为系统提示词上下文
 */
import systemPromptTemplate from "../prompts/system-prompt.md?raw";
import { getMergedTools, getMergedSystemPrompt } from "../skills/index.js";

const TOOLS = getMergedTools();

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
export function serializeContext(contextData) {
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

  if (contextData.positions && Array.isArray(contextData.positions) && contextData.positions.length > 0) {
    const posSummary = contextData.positions.map((p) => ({
      代码: p.code,
      名称: p.name,
      成本: p.buyPrice,
      数量: p.quantity,
      现价: p.price || p.buyPrice,
      买入日期: p.buyDate || "未知",
      盈亏: p.price && p.buyPrice ? `${((p.price - p.buyPrice) * (p.quantity || 0)).toFixed(2)} (${(((p.price - p.buyPrice) / p.buyPrice) * 100).toFixed(2)}%)` : "无实时价格",
    }));
    parts.push(`## 用户持仓数据\n${JSON.stringify(posSummary, null, 2)}\n（说明：以上是用户的当前持仓，用户可能会询问持仓分析、盈亏评估等问题，请结合这些数据回答。）`);
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

/**
 * 构建完整的 AI 系统提示词
 * @param {Object|null} currentStock - 当前选中的股票
 * @param {Object|null} contextData - 预加载的上下文数据
 * @param {string} userProfile - 用户画像 markdown 原文（可选）
 * @returns {string}
 */
export function buildSystemPrompt(currentStock, contextData, userProfile) {
  // 北京时间（始终计算，每次请求都附带最新时间）
  const beijingTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });

  // 判断是否为港股
  const isHK = currentStock?.market === "HK" || currentStock?.code?.length === 5;
  const currency = isHK ? "HK$" : "¥";

  // 构建当前股票上下文
  let context = "";
  if (currentStock) {
    context = `
## 当前上下文
用户正在查看的股票：${currentStock.name}（${currentStock.code}）${isHK ? " [港股]" : ""}
当前价格：${currency}${currentStock.price?.toFixed(2) ?? "--"}
涨跌幅：${currentStock.changePct != null
        ? (currentStock.changePct >= 0 ? "+" : "") +
        currentStock.changePct.toFixed(2) +
        "%"
        : "--"
      }
今开：${currentStock.open?.toFixed(2) ?? "--"}　最高：${currentStock.high?.toFixed(2) ?? "--"}　最低：${currentStock.low?.toFixed(2) ?? "--"}
昨收：${currentStock.prevClose?.toFixed(2) ?? "--"}　成交量：${currentStock.volume != null ? (currentStock.volume / 10000).toFixed(2) + '万手' : "--"}　成交额：${currentStock.turnover != null ? (currentStock.turnover / 10000).toFixed(2) + '亿' : "--"}
换手率：${currentStock.turnoverRate != null ? currentStock.turnoverRate.toFixed(2) + '%' : "--"}　市盈率：${currentStock.pe?.toFixed(2) ?? "--"}
货币单位：${isHK ? "港元 (HKD)" : "人民币 (CNY)"}
`;
  }

  // 市场交易规则
  const marketRules = isHK ? `## 港股市场须知
- **交易制度**：港股实行 T+0 交易，当日买入可当日卖出
- **无涨跌停限制**：港股不设涨跌停板，价格可大幅波动
- **交易时段**：早市 9:30-12:00，午市 13:00-16:00（全日交易）
- **交收制度**：T+2 交收（交易日后的第二个工作日完成资金与股票交割）
- **货币单位**：以港元 (HKD) 计价
- **费用结构**：涉及印花税、交易征费、交易费等多个项目，成本高于 A 股`
    : `## A 股市场须知
- **交易制度**：A 股实行 T+1 交易，当日买入次日才能卖出
- **涨跌停限制**：主板 ±10%，创业板 ±20%，科创板 ±20%，北交所 ±30%，ST 股 ±5%，退市整理期 ±10%
- **交易时段**：集合竞价 9:15-9:25，连续竞价 9:30-11:30、13:00-15:00
- **特殊标识**：ST/*ST 为风险警示股，N 为新股首日，C 为上市次日至第 5 日，U 为科创板未盈利
- **关键资金指标**：北向资金（沪深港通）是 A 股重要的外资风向标`;

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

  // 用户画像
  const profileSection = userProfile
    ? `\n## 👤 用户画像（自动学习）\n\n${userProfile}\n\n**说明**：以上基于历史对话自动生成，了解用户偏好即可，分析时点到为止。\n`
    : "";

  return systemPromptTemplate
    .replace("{{BEIJING_TIME}}", beijingTime)
    .replace("{{PRELOAD_SECTION}}", preloadSection)
    .replace("{{TOOLS}}", toolsList)
    .replace("{{SKILL_PROMPTS}}", getMergedSystemPrompt())
    .replace("{{USER_PROFILE}}", profileSection)
    .replace("{{MARKET_RULES}}", marketRules)
    .replace("{{STOCK_CONTEXT}}", context);
}
