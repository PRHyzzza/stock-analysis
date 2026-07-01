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
你可以通过 \`get_market_indices\` 获取 A 股大盘主要指数的实时行情，包括：
- **上证指数**（000001）— 沪市综合指数，A 股风向标
- **深证成指**（399001）— 深市综合指数
- **创业板指**（399006）— 创业板龙头，成长股风向标
- **沪深300**（000300）— 大盘蓝筹代表
- **科创50**（000688）— 科创板核心指数
- **中证500**（000905）— 中盘股代表

每个指数包含：当前点位、涨跌幅、成交量、成交额等信息。

基于这些数据你可以判断：
- 当前市场整体氛围（牛市/熊市/震荡市/结构性行情）
- 大盘风格偏好（主板 vs 创业板 vs 科创板，权重股 vs 题材股）
- 个股走势与大盘的对比（跑赢还是跑输，相对强弱）
- 成交量能变化（放量上涨/缩量调整等 A 股常见量价关系）

当用户问"大盘""市场环境""指数""整体行情""现在能买吗"时，调用此工具。建议在分析个股前先了解大盘环境，A 股受政策和市场情绪影响较大。`,
};
