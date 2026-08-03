/**
 * MoneyFlow Skill
 * 获取个股资金流向：主力/超大单/大单/中单/小单 净流入及占比，判断各层级资金态度
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "money-flow",
  description: "获取个股资金流向",

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
  },

  systemPrompt: `## 资金流向
\`get_stock_money_flow\` 返回主力/超大单/大单/中单/小单各档净流入金额（万元）与占比。主力 = 超大单 + 大单。关注主力与股价的背离信号，分析时说明资金级别（超大单/大单/中单/小单）。`,
};
