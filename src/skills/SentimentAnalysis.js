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
          stats,
          posts: compressPosts(posts),
        });
      } catch (e) {
        return `[错误] 获取社区情绪失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 个股社区情绪 (get_stock_sentiment)
- 用户询问某只股票的社区情绪/散户看法/股吧讨论时调用 \`get_stock_sentiment\`，返回帖子统计（看多看空占比、情绪档位、热度）与最新热帖标题。
- **只能基于工具返回的帖子标题与统计判断**，不得编造帖子内容或凭空断言情绪；标题中的反话、玩梗、水军刷帖可能导致失真，需提示不确定性。
- 港股暂不支持社区情绪，明确告知即可。
- 情绪仅供参考，不构成投资建议；情绪与基本面/行情背离时点出背离。`,
};
