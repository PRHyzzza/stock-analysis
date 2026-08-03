/**
 * Intraday Skill
 * 获取个股当日分时数据：逐分钟价格、均价、VWAP、成交量
 * 用于分析当日走势形态（冲高回落/探底回升/封板等）
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "intraday",
  description: "获取个股当日分时走势数据",

  tools: [
    {
      type: "function",
      function: {
        name: "get_stock_intraday",
        description:
          "获取个股当日分时数据，返回逐分钟的价格、均价、VWAP、成交量/额。" +
          "用于判断当日走势形态（冲高回落、探底回升、单边拉升、横盘整理）、" +
          "均价线支撑压力、日内买卖点参考。返回 items 为分钟序列，preClose 为昨收。",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "股票代码，如 600519 或 300750，港股如 00700",
            },
          },
          required: ["code"],
        },
      },
    },
  ],

  toolImpl: {
    async get_stock_intraday({ code }) {
      try {
        return JSON.stringify(await invoke("get_stock_intraday", { code }), null, 2);
      } catch (e) {
        return `[错误] 获取分时数据失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 分时走势
\`get_stock_intraday\` 返回当日逐分钟数据（time/price/avgPrice/vwap/volume/turnover）及昨收价。分析要点：现价相对均价线位置（线上偏强、线下偏弱）、日内高低点时间与幅度、尾盘是否有异动放量。非交易时段返回上一交易日数据。`,
};
