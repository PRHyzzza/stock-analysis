/**
 * WebSearch Skill
 * 提供 web_search（网页搜索）和 web_fetch（网页抓取）AI 工具
 * 使用 DuckDuckGo Lite 实现，免费无需 API Key
 */
import { invoke } from "@tauri-apps/api/core";

export default {
  name: "web-search",
  description: "联网搜索与网页抓取能力",

  tools: [
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "搜索互联网获取最新信息。关键词请用 2-5 个实词（如「贵州茅台 新闻」「AI芯片 政策 2026」），" +
          "不要用完整问句。搜不到结果时先判断：关键词是否太冷门/太长？换个更通用的说法试试，" +
          "最多搜 2 次，搜不到就直接说「未找到相关信息」。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索关键词，如「贵州茅台 最新新闻」「AI 板块 热点」「央行降息 2026」",
            },
            max_results: {
              type: "number",
              description: "期望返回的结果数量，默认 10，最大 15",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description:
          "获取指定网页的纯文本内容。当 web_search 返回了感兴趣的链接，或用已知 URL 需要读取具体内容时使用。" +
          "适用于读取财经新闻全文、公司公告详情、研究报告等。",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "要抓取的网页完整 URL，如 https://example.com/article/123",
            },
          },
          required: ["url"],
        },
      },
    },
  ],

  toolImpl: {
    async web_search({ query, max_results }) {
      try {
        const results = await invoke("web_search", {
          query,
          maxResults: max_results || 10,
        });
        if (!results || results.length === 0) {
          return "[空结果] 未找到结果。可能原因：关键词太冷门/太长/太具体。请用 2-3 个通用关键词重试一次，还不行就放弃搜索。";
        }
        // 格式化为 Markdown 列表方便 AI 理解
        const formatted = results.map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.snippet}\n   🔗 ${r.url}`
        ).join("\n\n");
        return `## 搜索结果（共 ${results.length} 条）\n\n${formatted}`;
      } catch (e) {
        return `[搜索失败] ${e}`;
      }
    },

    async web_fetch({ url }) {
      try {
        const text = await invoke("web_fetch", { url });
        if (!text || text.trim().length === 0) {
          return "该网页内容为空或无法解析。";
        }
        // 限制返回长度，避免 token 消耗过大
        const maxLen = 15000;
        const truncated = text.length > maxLen
          ? text.slice(0, maxLen) + "\n\n...（内容过长，已截断）"
          : text;
        return truncated;
      } catch (e) {
        return `[抓取失败] ${e}`;
      }
    },
  },

  systemPrompt: `## 联网搜索能力

你具备联网搜索和网页抓取能力。**使用前请先判断是否真的需要搜索**，避免无意义请求浪费资源。

### 判断是否需要搜索
**需要搜索的情况：**
- 用户明确要求搜索、查询最新资讯
- 问题涉及你的知识截止日期之后的实时事件（新闻、政策、公告、股价异动原因）
- 用户问「最近」「今天」「本周」等时间敏感问题
- 需要核实当前最新数据（如最新财报、最新政策）

**不需要搜索的情况：**
- 仅需股票行情/K线/资金流向 → 用本地工具（get_stock_quote、get_stock_kline 等）
- 一般投资知识、概念解释、技术分析原理
- 对话寒暄、功能咨询、帮你操作（如「帮我分析这支股票」→ 直接用本地数据）
- 你能凭训练知识自信回答的通用问题

### 搜索关键词策略（重要！）
- **用 2-5 个实词**，不要用完整问句。正确：「贵州茅台 2026 财报」，错误：「贵州茅台2026年的财报数据怎么样」
- **搜不到就换说法**：把冷门术语换成通用词（如「智算中心」→「算力 政策」），把长尾词精简
- **最多搜 2 次**：第一次没结果 → 换一组关键词 → 还没有 → 直接说「未找到相关信息」，不要死磕

### 抓取策略
- **按需抓取**：只有搜索结果摘要不够时才用 web_fetch 深入阅读
- **标注来源**：回答中引用网络信息时标注来源 URL；信息注明「仅供参考」`,
};
