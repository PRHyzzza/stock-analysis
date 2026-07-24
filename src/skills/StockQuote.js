/**
 * StockQuote Skill
 * 获取个股实时行情：价格、涨跌幅、成交量、成交额、换手率、市盈率等
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "stock-quote",
  description: "获取个股实时行情数据",

  tools: [
    {
      type: "function",
      function: {
        name: "get_stock_quote",
        description:
          "获取个股实时行情，包括价格、涨跌幅、成交量、成交额、换手率、市盈率等。输入股票代码如 600519。",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "股票代码，如 600519 或 300750",
            },
          },
          required: ["code"],
        },
      },
    },
  ],

  toolImpl: {
    async get_stock_quote({ code }) {
      try {
        return JSON.stringify(await invoke("get_stock_quote", { code }), null, 2);
      } catch (e) {
        return `[错误] 获取行情失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 实时行情
\`get_stock_quote\` 返回价格、涨跌幅、成交量、换手率、PE、PB、总市值、流通市值等。获取后注意甄别涨停/跌停、ST 标识、新股涨跌幅限制。`,
};
