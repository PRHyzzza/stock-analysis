/**
 * StockQuote Skill
 * 获取个股实时行情（单只 + 批量）：价格、涨跌幅、成交量、成交额、换手率、市盈率等
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "stock-quote",
  description: "获取个股实时行情数据（单只/批量）",

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
    {
      type: "function",
      function: {
        name: "get_stock_quotes_batch",
        description:
          "一次获取多只股票的实时行情（最多 50 只；A 股批量请求、港股逐只）。对比多只股票、分析板块内个股强弱、批量评估候选标的时使用，比逐只调用 get_stock_quote 更省轮次。返回数组，每项含 code/name/price/changePct/turnover 等字段。",
        parameters: {
          type: "object",
          properties: {
            codes: {
              type: "array",
              items: { type: "string" },
              description: "股票代码数组，如 [\"600519\", \"300750\"]，最多 50 只",
            },
          },
          required: ["codes"],
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
    async get_stock_quotes_batch({ codes }) {
      const list = Array.isArray(codes) ? codes.slice(0, 50) : [];
      if (list.length === 0) return "[错误] 未提供股票代码";
      try {
        return JSON.stringify(
          await invoke("get_stock_quotes_batch", { codes: list }),
          null,
          2
        );
      } catch (e) {
        return `[错误] 批量获取行情失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 实时行情
\`get_stock_quote\` 返回价格、涨跌幅、成交量(手)、成交额(万元)、换手率、市盈率(PE)、振幅等字段（无市值/PB 字段，不要引用不存在的数值）。获取后注意甄别涨停/跌停、ST 标识、新股涨跌幅限制。

\`get_stock_quotes_batch\` 一次查询多只股票（≤50 只），返回同结构数组；需要对比多只股票、或从热榜/选股结果中批量评估候选时优先用它。注意：批量接口对港股逐只请求，含港股时耗时略长。`,
};
