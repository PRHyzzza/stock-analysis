/**
 * StockSearch Skill
 * 股票代码搜索：输入名称或代码片段，返回匹配的股票及市场标识
 * 用于用户提到模糊名称/代码时确认目标股票
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "stock-search",
  description: "股票搜索（名称/代码 → 股票代码）",

  tools: [
    {
      type: "function",
      function: {
        name: "search_stocks",
        description:
          "按名称或代码关键字搜索股票，返回匹配列表（code/name/market，market 为 SH/SZ/HK）。" +
          "当用户用简称、模糊名称、或只有部分代码提到股票时，先用它确认准确代码，再调用行情等工具。",
        parameters: {
          type: "object",
          properties: {
            keyword: {
              type: "string",
              description: "搜索关键字，如「茅台」「平安」「600」「腾讯」",
            },
          },
          required: ["keyword"],
        },
      },
    },
  ],

  toolImpl: {
    async search_stocks({ keyword }) {
      try {
        return JSON.stringify(await invoke("search_stocks", { keyword }), null, 2);
      } catch (e) {
        return `[错误] 股票搜索失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 股票搜索
\`search_stocks\` 按名称/代码关键字返回匹配股票及市场（SH/SZ/HK）。用户提到的股票名称不精确、或需要确认代码时先调用它，拿到准确代码后再取行情/K线/资金流等数据。`,
};
