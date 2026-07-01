/**
 * MoneyFlow Skill
 * 获取个股主力资金流向：主力净流入/流出金额及占比，判断大资金态度
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "money-flow",
  description: "获取个股主力资金流向",

  tools: [
    {
      type: "function",
      function: {
        name: "get_stock_money_flow",
        description:
          "获取个股主力资金流向（主力净流入/流出金额及占比），判断大资金动向。",
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

  systemPrompt: `## 资金流向分析能力
你可以通过 \`get_stock_money_flow\` 获取个股的主力资金流向数据，包括：
- **主力净流入/流出金额**（超大单 + 大单，单位：亿元）
- **主力净流入/流出占比**
- **今日主力净流入趋势**（分时段统计）
- **近 5/10 日主力资金累计流向**
- **散户与主力资金对比**

基于这些数据你可以判断：
- 大资金是买入还是卖出？力度如何？
- 主力资金是否持续流入/流出？
- 主力资金态度与股价走势是否一致（背离信号）？
- 近期资金面是否改善？
- 结合北向资金动向综合判断外资态度

当用户问"资金""主力""资金流向""谁在买""主力动向""北向"时，调用此工具。分析时说明资金级别（超大单/大单/中单/小单），这是 A 股盘口的重要分析维度。`,
};
