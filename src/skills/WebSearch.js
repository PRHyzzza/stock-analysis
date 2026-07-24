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
          "搜索互联网获取最新信息、新闻、热点。当用户询问超出你知识范围的实时信息时使用此工具。" +
          "适用于查询股票新闻、财经资讯、公司公告、市场热点等。返回标题、摘要和 URL。",
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
          return "未找到相关搜索结果，建议更换关键词或缩小范围。";
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

你具备联网搜索和网页抓取能力：

### web_search — 搜索互联网
- 当用户询问最新新闻、实时资讯、市场热点时主动搜索
- 搜索关键词应精确、有针对性（建议使用中文关键词）
- 获得搜索结果后，可以根据需要进一步用 web_fetch 获取全文

### web_fetch — 抓取网页
- 当 web_search 返回了感兴趣的链接，或用户提供了具体 URL 时使用
- 抓取结果会自动提取纯文本，去除 HTML 标签和样式

### 使用原则
1. **优先使用本地数据**：如果本地工具（get_stock_quote、get_stock_kline 等）能回答，优先使用本地数据
2. **补充实时信息**：对于新闻、公告、政策等实时/文本信息，使用 web_search
3. **先搜后读**：先用 web_search 发现信息源，再选择性用 web_fetch 深入阅读
4. **标注来源**：回答中引用网络信息时，标注来源 URL
5. **谨慎判断**：网络信息可能不准确，标注「仅供参考」`,
};
