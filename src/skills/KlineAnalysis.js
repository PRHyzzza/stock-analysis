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
          "获取个股 K 线数据，用于技术分析（均线、MACD、KDJ 等）。支持日K(day)、周K(week)、月K(month)、分钟K(m5/m15/m30/m60)。日/周/月返回近 120 根（前复权），分钟级返回近 320 根（无复权，港股不支持分钟K）。",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "股票代码，如 600519",
            },
            period: {
              type: "string",
              enum: ["day", "week", "month", "m5", "m15", "m30", "m60"],
              description: "K 线周期：day=日K, week=周K, month=月K, m5=5分钟, m15=15分钟, m30=30分钟, m60=60分钟",
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
\`get_stock_kline\` 返回 OHLCV，周期与格式：
- **day/week/month**：前复权，近 120 根，date 为 \`yyyy-mm-dd\`
- **m5/m15/m30/m60**：无复权概念，近 320 根，date 为 \`yyyyMMddHHmm\`（12 位，如 202608140930 = 2026-08-14 09:30）；**港股不支持分钟 K 线**
- 均已截取最近 60 根返回

分钟级 K 线适用场景：日内趋势与短线支撑/压力位判断、T+0 操作参考、盘中动能分析；与分时数据（\`get_stock_intraday\`）互补——分时是逐分钟均价视角，分钟 K 是固定周期 OHLC 视角。

基于收盘价自行计算以下指标：

**计算公式（务必使用以下公式，不要凭记忆）：**
- **MA(N)** = 近 N 根收盘价的算术平均值
- **MACD(12,26,9)**：EMA12 = 前一期 EMA12 × 11/13 + 本期收盘 × 2/13；EMA26 同理（系数 25/27 和 2/27）；DIF = EMA12 − EMA26；DEA = 前一期 DEA × 8/10 + 本期 DIF × 2/10；MACD 柱 = 2 × (DIF − DEA)
- **KDJ(9,3,3)**：RSV = (收盘 − 9期最低) / (9期最高 − 9期最低) × 100；K = 前 K × 2/3 + RSV / 3；D = 前 D × 2/3 + K / 3；J = 3K − 2D
- **RSI(N)** = 100 − [100 / (1 + 近N期平均涨幅 ÷ 近N期平均跌幅)]，其中涨幅只计上涨期、跌幅只计下跌期（取绝对值）
- **BOLL(20,2)**：中轨 = MA20；上轨 = MA20 + 2 × 近20期收盘价标准差；下轨 = MA20 − 2 × 标准差

> 注意：如果系统上下文中已预计算并注入 MACD/KDJ/RSI/WR/MA 的最新值与信号（《预计算技术指标》章节），**直接引用这些数值**，无需重复计算；仅当查询的股票没有预计算数据时才按上述公式自行计算。

结合量价关系、K线形态（大阳线/十字星/锤子线/吞没/缺口）、支撑阻力位判断。注意 A 股 T+1 流动性风险。`,
};
