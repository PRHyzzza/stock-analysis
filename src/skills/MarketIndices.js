/**
 * MarketIndices Skill
 * 获取大盘主要指数实时行情：上证、深证、创业板、沪深300、科创50、中证500
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "market-indices",
  description: "获取大盘主要指数实时行情",

  tools: [
    {
      type: "function",
      function: {
        name: "get_market_indices",
        description:
          "获取大盘主要指数实时行情（上证指数、深证成指、创业板指、沪深300、科创50、中证500）。",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
  ],

  toolImpl: {
    async get_market_indices() {
      try {
        return JSON.stringify(await invoke("get_market_indices"), null, 2);
      } catch (e) {
        return `[错误] 获取大盘指数失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 大盘环境
\`get_market_indices\` 返回上证、深证、创业板、沪深300、科创50、中证500的点位和涨跌幅。判断市场氛围（牛/熊/震荡）、风格偏好（权重/题材/创业板/科创板）、个股相对强弱。`,
};
