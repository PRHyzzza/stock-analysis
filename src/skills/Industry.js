/**
 * Industry Skill
 * 获取个股行业分析数据：所属行业、营收排名、市场表现等
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "industry-analysis",
  description: "获取个股行业分析数据",

  tools: [
    {
      type: "function",
      function: {
        name: "get_stock_industry",
        description:
          "获取个股行业分析数据：所属行业名称、行业内营收排名、市场表现（相对沪深300超额收益）。",
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
    async get_stock_industry({ code }) {
      try {
        return JSON.stringify(
          await invoke("get_stock_industry", { code }),
          null,
          2
        );
      } catch (e) {
        return `[错误] 获取行业数据失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 行业分析
\`get_stock_industry\` 返回申万行业分类、营收排名、相对沪深300超额收益。分析行业地位（龙头/跟随/边缘）、景气度和板块联动效应。`,
};
