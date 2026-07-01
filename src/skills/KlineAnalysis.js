/**
 * KlineAnalysis Skill
 * 获取 K 线数据用于技术分析：均线、MACD、KDJ、RSI、布林带等
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "kline-analysis",
  description: "获取 K 线数据做技术分析",

  tools: [
    {
      type: "function",
      function: {
        name: "get_stock_kline",
        description:
          "获取个股 K 线数据，用于技术分析（均线、MACD、KDJ 等）。支持日K(day)、周K(week)、月K(month)。返回近 120 根。",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "股票代码，如 600519",
            },
            period: {
              type: "string",
              enum: ["day", "week", "month"],
              description: "K 线周期：day=日K, week=周K, month=月K",
            },
          },
          required: ["code", "period"],
        },
      },
    },
  ],

  toolImpl: {
    async get_stock_kline({ code, period }) {
      try {
        const data = await invoke("get_stock_kline", { code, period });
        const sliced = Array.isArray(data) ? data.slice(-60) : data;
        return JSON.stringify(sliced, null, 2);
      } catch (e) {
        return `[错误] 获取 K 线失败: ${e}`;
      }
    },
  },

  systemPrompt: `## K 线技术分析能力
你可以通过 \`get_stock_kline\` 获取个股的 K 线数据，支持日K、周K、月K 三个周期（返回近 120 根，已截取最近 60 根用于分析）。

基于 K 线数据你可以自行计算和判断：
- **移动平均线（MA）**：计算 MA5、MA10、MA20、MA60，判断多头/空头排列、金叉/死叉
- **MACD**：计算 DIF、DEA、MACD 柱，判断金叉/死叉、顶背离/底背离
- **KDJ**：计算 K、D、J 值，判断超买/超卖
- **RSI**：计算 RSI6、RSI12、RSI24
- **布林带（BOLL）**：计算中轨、上轨、下轨
- **成交量分析**：量价配合、放量/缩量、天量/地量
- **K 线形态**：大阳线/大阴线、十字星、锤子线、吞没形态、跳空缺口等 A 股常见形态
- **支撑/阻力位**：通过前高前低、均线位置、缺口判断

当用户问"技术面""走势""K线""买点""卖点""支撑""压力"时，调用此工具获取数据后给出计算分析。注意结合 A 股 T+1 制度提醒次日才能卖出的流动性风险。`,
};
