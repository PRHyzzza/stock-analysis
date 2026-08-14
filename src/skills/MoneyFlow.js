/**
 * MoneyFlow Skill
 * 获取个股资金流向：主力/超大单/大单/中单/小单 净流入及占比 + 近 N 日历史趋势
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "money-flow",
  description: "获取个股资金流向（当日快照 + 历史趋势）",

  tools: [
    {
      type: "function",
      function: {
        name: "get_stock_money_flow",
        description:
          "获取个股资金流向（主力/超大单/大单/中单/小单 各档净流入金额（万元）及占比），判断各层级资金动向。",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "股票代码，如 600519",
            },
          },
          required: ["code"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_stock_money_flow_history",
        description:
          "获取个股近 N 个交易日的主力资金净流入历史（单位万元，按日期升序，默认 30 天）。分析资金持续流入/流出趋势、判断资金态度是否转变时使用；与当日快照 get_stock_money_flow 结合，可回答「这几天主力一直在流出吗」类问题。",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "股票代码，如 600519",
            },
            limit: {
              type: "number",
              description: "返回最近 N 个交易日，默认 30，最大 60",
              minimum: 5,
              maximum: 60,
            },
          },
          required: ["code"],
        },
      },
    },
  ],

  toolImpl: {
    async get_stock_money_flow({ code }) {
      try {
        return JSON.stringify(
          await invoke("get_stock_money_flow", { code }),
          null,
          2
        );
      } catch (e) {
        return `[错误] 获取资金流向失败: ${e}`;
      }
    },
    async get_stock_money_flow_history({ code, limit }) {
      try {
        return JSON.stringify(
          await invoke("get_stock_money_flow_history", { code, limit: limit || 30 }),
          null,
          2
        );
      } catch (e) {
        return `[错误] 获取资金流向历史失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 资金流向
\`get_stock_money_flow\` 返回主力/超大单/大单/中单/小单各档净流入金额（万元）与占比。主力 = 超大单 + 大单。关注主力与股价的背离信号，分析时说明资金级别（超大单/大单/中单/小单）。

\`get_stock_money_flow_history\` 返回近 N 日主力净流入历史（万元，升序）。分析趋势时：连续多日净流入/流出比单日数值更有意义；结合价格走势判断「资金流入但股价滞涨」等背离；可用最近 5/10/20 日累计判断资金态度。`,
};
