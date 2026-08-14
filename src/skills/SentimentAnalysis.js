/**
 * SentimentAnalysis Skill
 * 个股社区情绪：读取东方财富股吧帖子，统计看多/看空倾向与热度，供 AI 解读
 */
import { invoke } from "@tauri-apps/api/core";
import { deriveSentiment } from "../composables/useStockSentiment.js";

/** 压缩帖子列表（标题 + 热度，控制 token），最多 15 条 */
function compressPosts(posts) {
  return (posts || []).slice(0, 15).map((p) => ({
    title: p.title,
    author: p.author,
    read: p.clickCount,
    replies: p.commentCount,
    time: p.publishTime,
  }));
}

export default {
  name: "sentiment-analysis",
  description: "个股社区情绪（股吧帖子看多看空统计）",

  tools: [
    {
      type: "function",
      function: {
        name: "get_stock_sentiment",
        description:
          "读取个股的东方财富股吧社区情绪：返回帖子总数、看多/看空/中性统计、" +
          "情绪档位（冷淡/偏多/中性/偏空/狂热等）、热度，以及最新热帖标题列表。" +
          "当用户询问某只股票的社区情绪、散户看法、股吧讨论、人气热度时使用。",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "股票代码（A 股 6 位纯数字，如 600519）",
            },
          },
          required: ["code"],
        },
      },
    },
  ],

  toolImpl: {
    async get_stock_sentiment({ code }) {
      if (!code || !String(code).trim()) {
        return "[错误] 缺少股票代码";
      }
      try {
        const posts = (await invoke("get_stock_guba_posts", { code: String(code).trim(), count: 20 })) || [];
        if (!posts.length) {
          return `[空结果] 该股票（${code}）暂无股吧帖子数据（港股暂不支持）`;
        }
        const stats = deriveSentiment(posts);
        return JSON.stringify({
          code: String(code).trim(),
          stats: {
            ...stats,
            // hotPosts 已在 stats 中（按阅读量排序前 10），此处不再重复返回
          },
          // 最新 15 条帖子原始列表（供逐条语义审阅）
          posts: compressPosts(posts),
        });
      } catch (e) {
        return `[错误] 获取社区情绪失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 个股社区情绪 (get_stock_sentiment)
- 用户询问某只股票的社区情绪/散户看法/股吧讨论时调用 \`get_stock_sentiment\`，返回：
  - \`stats\`：关键词启发式统计（看多/看空/中性/问句帖数、加权看多占比 ratio、情绪明确度 judgedRatio、档位 level、热度 heat、热帖 hotPosts 按阅读量排序）
  - \`posts\`：最新 15 条帖子标题列表（供你逐条审阅）
- **统计的局限，必须知道**：\`stats\` 是本地关键词分类（短语表 + 否定词反转 + 问句识别 + 热度加权），可能误判反话、玩梗、隐喻、水军刷帖。
- **你的职责是语义判断优先**：逐条阅读 \`posts\` 标题，独立判断每条的真正倾向（包括反讽，如"龙头！呵呵"、玩梗、水军批量发帖模式），再与 \`stats\` 交叉验证；两者冲突时以你的语义判断为准，但需说明依据（引具体标题）。
- **档位解读辅助**：
  - \`judgedRatio\` 低（<0.5）说明多数帖子无明确情绪（中性/问句多）→ 是"观望/分歧氛围"，不是极端情绪，不要按看多占比夸大
  - \`questioning\` 多（问句帖）→ 散户犹豫、分歧大
  - 热帖（hotPosts）比普通帖更能代表主流情绪，解读时倾斜参考
- 港股暂不支持社区情绪，明确告知即可。
- 情绪仅供参考，不构成投资建议；情绪与基本面/行情背离时点出背离。`,
};
