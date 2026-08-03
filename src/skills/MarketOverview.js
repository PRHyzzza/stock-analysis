/**
 * MarketOverview Skill
 * 市场全景数据：实时热榜 + 板块资金流向
 * 用于判断当日热点题材、资金进攻方向、市场情绪
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "market-overview",
  description: "获取市场全景数据（热榜、板块资金流向）",

  tools: [
    {
      type: "function",
      function: {
        name: "get_hot_list",
        description:
          "获取当日实时热榜（同花顺人气榜），返回热度排名靠前的股票，含热度值、涨跌幅、" +
          "排名变化、概念标签。用于判断市场热点题材、人气龙头股、情绪方向。",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_sector_money_flow",
        description:
          "获取板块资金流向排行（东方财富），返回各板块涨跌幅、主力净流入、超大单/大单/中单/小单净流入（万元）。" +
          "用于判断资金进攻/撤退方向、板块轮动、主线题材。",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
  ],

  toolImpl: {
    async get_hot_list() {
      try {
        return JSON.stringify(await invoke("get_hot_list"), null, 2);
      } catch (e) {
        return `[错误] 获取热榜失败: ${e}`;
      }
    },
    async get_sector_money_flow() {
      try {
        return JSON.stringify(await invoke("get_sector_money_flow"), null, 2);
      } catch (e) {
        return `[错误] 获取板块资金流向失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 市场全景
\`get_hot_list\` 返回人气热榜（热度值、涨跌幅、排名变化、概念标签），反映短线情绪与题材热度；\`get_sector_money_flow\` 返回板块主力/超大单/大单净流入排行，反映资金进攻方向。两者结合可判断：当日主线题材、资金是否聚焦、板块轮动节奏。分析大盘环境或题材热点时优先调用。`,
};
