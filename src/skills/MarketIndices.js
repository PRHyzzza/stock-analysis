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

  systemPrompt: `## 大盘环境分析能力
你可以通过 \`get_market_indices\` 获取大盘主要指数的实时行情，包括：
- **上证指数**（000001）
- **深证成指**（399001）
- **创业板指**（399006）
- **沪深300**（000300）
- **科创50**（000688）
- **中证500**（000905）

每个指数包含：当前点位、涨跌幅、成交量等信息。

基于这些数据你可以判断：
- 当前市场整体氛围（牛/熊/震荡）
- 大盘风格偏好（大盘股 vs 小盘股，成长 vs 价值）
- 个股走势与大盘的对比（强势股/弱势股）

当用户问"大盘""市场环境""指数""整体行情"时，调用此工具。建议在分析个股前先了解大盘环境。`,
};
