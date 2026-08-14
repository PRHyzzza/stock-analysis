/**
 * StockPicks Skill
 * 选股/推荐结果卡片渲染：AI 在给出选股结论时调用 render_stock_picks，
 * 前端把结构化结果渲染成卡片（代码/名称/现价/涨跌幅/理由 + 加入自选/查看详情按钮）。
 *
 * 实现方式：toolImpl 返回带 PICKS_MARKER 前缀的紧凑 JSON，
 * useAiAnalysis 拦截该标记并附加到最终 assistant 消息（msg.picks），
 * 长 JSON 不进入模型上下文（只回传确认信息），AiChatMessages 负责渲染卡片。
 */

/** 卡片数据标记前缀（useAiAnalysis 拦截用） */
export const PICKS_MARKER = "__STOCK_PICKS__";

const MAX_PICKS = 20;

/** 清洗单张卡片：只保留合法字段，code/name 必填 */
function cleanPick(p) {
  const code = String(p?.code ?? "").trim().replace(/\.(SH|SZ|BJ)$/i, "");
  const name = String(p?.name ?? "").trim();
  if (!code || !name) return null;
  const price = Number(p?.price);
  const changePct = Number(p?.changePct);
  return {
    code,
    name,
    price: Number.isFinite(price) ? price : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    reason: String(p?.reason ?? "").trim(),
  };
}

export default {
  name: "stock-picks",
  description: "选股/推荐结果卡片渲染",

  tools: [
    {
      type: "function",
      function: {
        name: "render_stock_picks",
        description:
          "把选股/推荐结论渲染成卡片展示（代码/名称/现价/涨跌幅/理由），" +
          "并提供「加入自选」「查看详情」操作。当用户要求选出/推荐股票并给出清单时，" +
          "在最终回答前调用一次，传入精选的股票列表（通常 3-10 只）。" +
          "代码必须是纯数字：A 股 6 位 / 北交所 6 位（43/82/83/87/88/92 开头）/ 港股 5 位，去掉 .SH/.SZ/.BJ 后缀。" +
          "现价与涨跌幅必须来自 get_stock_quote 等工具的真实返回，没有数据就不要填。",
        parameters: {
          type: "object",
          properties: {
            picks: {
              type: "array",
              description: "要渲染的股票卡片列表（建议 3-10 只）",
              items: {
                type: "object",
                properties: {
                  code: { type: "string", description: "股票代码（纯数字，去后缀）" },
                  name: { type: "string", description: "股票名称" },
                  price: { type: "number", description: "现价（来自行情工具，缺失可不填）" },
                  changePct: { type: "number", description: "涨跌幅 %（来自行情工具，缺失可不填）" },
                  reason: { type: "string", description: "入选/推荐理由（2-3 句，基于工具数据的真实判断）" },
                },
                required: ["code", "name"],
              },
            },
          },
          required: ["picks"],
        },
      },
    },
  ],

  toolImpl: {
    async render_stock_picks({ picks }) {
      if (!Array.isArray(picks) || picks.length === 0) {
        return "[错误] render_stock_picks 需要非空 picks 数组";
      }
      const clean = picks
        .slice(0, MAX_PICKS)
        .map(cleanPick)
        .filter(Boolean);
      if (clean.length === 0) {
        return "[错误] picks 缺少 code/name 字段";
      }
      return `${PICKS_MARKER}${JSON.stringify(clean)}`;
    },
  },

  systemPrompt: `## 选股结果卡片 (render_stock_picks)
- 当用户要求"选出/推荐股票"并给出清单时，在最终回答前调用 \`render_stock_picks\` 把精选结论渲染成卡片（通常 3-10 只）。
- 卡片数据必须真实：现价/涨跌幅来自 get_stock_quote 等工具返回，理由基于筛选与验证数据；没有数据就不填数值，绝不编造。
- 调用后正常输出分析文字（每只 2-3 句理由 + 风险提示），卡片会在回答下方展示。`,
};
