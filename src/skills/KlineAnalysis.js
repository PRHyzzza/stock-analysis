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

  systemPrompt: `## K 线技术分析
\`get_stock_kline\` 返回日K/周K/月K OHLCV（近120根，已截取最近60根）。基于收盘价自行计算以下指标：

**计算公式（务必使用以下公式，不要凭记忆）：**
- **MA(N)** = 近 N 日收盘价的算术平均值
- **MACD(12,26,9)**：EMA12 = 前一日 EMA12 × 11/13 + 今日收盘 × 2/13；EMA26 同理（系数 25/27 和 2/27）；DIF = EMA12 − EMA26；DEA = 前一日 DEA × 8/10 + 今日 DIF × 2/10；MACD 柱 = 2 × (DIF − DEA)
- **KDJ(9,3,3)**：RSV = (收盘 − 9日最低) / (9日最高 − 9日最低) × 100；K = 前 K × 2/3 + RSV / 3；D = 前 D × 2/3 + K / 3；J = 3K − 2D
- **RSI(N)** = 100 − [100 / (1 + 近N日平均涨幅 ÷ 近N日平均跌幅)]，其中涨幅只计上涨日、跌幅只计下跌日（取绝对值）
- **BOLL(20,2)**：中轨 = MA20；上轨 = MA20 + 2 × 近20日收盘价标准差；下轨 = MA20 − 2 × 标准差

结合量价关系、K线形态（大阳线/十字星/锤子线/吞没/缺口）、支撑阻力位判断。注意 A 股 T+1 流动性风险。`,
};
