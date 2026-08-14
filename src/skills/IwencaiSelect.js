/**
 * IwencaiSelect Skill
 * 问财自然语言选股：AI 把用户条件翻译成问财查询语句，
 * 返回压缩后的结构化筛选结果（代码/名称/现价/关键条件列）。
 *
 * 复用 iwencaiClient 的 v 凭证 + 403 换 v 重试 + 会话级查询缓存，
 * 因此 AI 重复筛选不会触发问财限流。
 */
import { queryIwencai } from "../composables/iwencaiClient.js";
import { normalizeIwencaiResult } from "../composables/useIwencaiRobot.js";

/** 列选择白名单：始终保留代码/名称/现价，另保留与筛选条件相关的列 */
const ALWAYS_COL = ["股票代码", "股票简称", "代码", "名称", "现价", "最新价"];
const KEYWORD_COL = [
  "市值", "市盈率", "市净率", "净资产收益率", "roe", "净利润", "营收",
  "涨幅", "涨跌幅", "换手", "量比", "股息", "负债", "毛利", "自由流通",
  "成交额", "成交量", "每股收益", "每股净资产",
];
const MAX_COLS = 6;
const MAX_ROWS = 100;   // 全量返回：问财免费接口单次最多 100 行，整个列表都交给 AI 分析
const MAX_CHARS = 12000; // 100 行 × 6 列的 JSON 预算（超长时才兜底丢弃尾部行）

/** 数值格式化：大数带单位（亿/万），与问财窗口 cellText 语义一致 */
function fmtCell(v) {
  if (v === null || v === undefined || v === "") return null;
  const num = Number(v);
  if (Number.isFinite(num)) {
    const abs = Math.abs(num);
    if (abs >= 1e8) return (num / 1e8).toFixed(2) + "亿";
    if (abs >= 1e4) return (num / 1e4).toFixed(2) + "万";
    return Number.isInteger(num) ? String(num) : num.toFixed(2);
  }
  return String(v);
}

/**
 * 压缩问财结果：列白名单 + 数值格式化，控制回传模型的 token。
 * 行数不做裁剪（整个列表都返回），仅当 JSON 超长时兜底丢弃尾部行。
 * @returns {string} 紧凑 JSON 字符串（≤ MAX_CHARS，兜底时至少保留 3 行）
 */
function compressRows(result, question) {
  const { columns, rows } = normalizeIwencaiResult(result);
  if (!columns.length || !rows.length) {
    return JSON.stringify({ query: question, total: 0, count: 0, columns: [], rows: [] });
  }

  // 列选择：始终保留代码/名称列（找不到时兜底补上），再按关键词补条件相关列
  const picked = [];
  for (const col of columns) {
    if (picked.length >= MAX_COLS) break;
    const n = String(col.name || col.label || col.key || "").toLowerCase();
    if (
      ALWAYS_COL.some((a) => n.includes(a.toLowerCase())) ||
      KEYWORD_COL.some((k) => n.includes(k))
    ) {
      picked.push(col);
    }
  }
  if (!picked.some((c) => /代码/.test(String(c.name || "")))) {
    const codeCol = columns.find((c) => /代码/.test(String(c.name || "")));
    if (codeCol) picked.unshift(codeCol);
  }
  if (!picked.some((c) => /简称|名称/.test(String(c.name || "")))) {
    const nameCol = columns.find((c) => /简称|名称/.test(String(c.name || "")));
    if (nameCol) picked.unshift(nameCol);
  }

  const outRows = rows.slice(0, MAX_ROWS).map((row) => {
    const o = {};
    for (const col of picked) {
      const key = col.key ?? col.label ?? col.name;
      o[col.name || key] = fmtCell(row[key]);
    }
    return o;
  });

  const out = {
    query: question,
    total: result.rowCount ?? rows.length,
    count: outRows.length,
    columns: picked.map((c) => c.name || c.key),
    rows: outRows,
  };
  let json = JSON.stringify(out);
  // 超长兜底：逐行丢弃直到 ≤ MAX_CHARS（至少保留 3 行）
  while (json.length > MAX_CHARS && outRows.length > 3) {
    outRows.pop();
    out.count = outRows.length;
    json = JSON.stringify(out);
  }
  return json;
}

export default {
  name: "iwencai-select",
  description: "问财自然语言选股（按条件筛选全市场 A 股/北交所）",

  tools: [
    {
      type: "function",
      function: {
        name: "stock_screener",
        description:
          "问财自然语言选股：按条件筛选全市场 A 股/北交所股票，" +
          "返回匹配股票的代码、名称、现价及关键条件列（JSON）。" +
          "当用户要求按财务/估值/技术/资金条件选股（市盈率、市值、ROE、涨幅、换手率、股息率等）时使用。" +
          "只用于批量筛选，不用于单只股票详情（用 get_stock_quote 等）。",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description:
                "问财查询语句：中文条件、分号分隔，如「总市值小于300亿; 市盈率小于20; 连续3年净资产收益率大于15%」",
            },
          },
          required: ["question"],
        },
      },
    },
  ],

  toolImpl: {
    async stock_screener({ question }) {
      if (!question || !String(question).trim()) {
        return '[错误] 缺少查询条件：请提供用分号分隔的中文条件，如「市盈率小于20; 总市值大于100亿」。';
      }
      const q = String(question).trim();
      try {
        // perpage=100：免费接口单次上限，尽量把整个匹配列表都拿回来
        const result = await queryIwencai(q, 1, 100);
        if (!result || !result.datas || result.datas.length === 0) {
          return `[空结果] 问财未找到满足条件的股票：${q}`;
        }
        return compressRows(result, q);
      } catch (e) {
        return `[错误] 问财筛选失败: ${e}`;
      }
    },
  },

  systemPrompt: `## 问财选股 (stock_screener)
- 用户要求"按条件选股"时，先把口语条件翻译成问财查询语句：条件间用分号「;」分隔，用「大于/小于/不低于/不高于/等于」等明确表述，市值/成交额等带单位（亿/万），如「总市值小于300亿; 市盈率小于20; 连续3年净资产收益率大于15%」。
- 每轮最多调用 1-2 次筛选；筛选结果会**返回整个匹配列表（最多 100 只）**，基于完整结果集分析，不要只看前几只，也不要重复调问财。
- 问财主要覆盖 A 股/北交所，港股筛选不可靠；用户要求筛港股时告知该限制。
- 筛选返回的数值均来自问财，直接引用；不得编造、增删候选或数值。
- 典型流程：筛选（拿到完整列表）→ 按条件在列表内排序/筛选出重点候选 → 对重点候选（前 5-10 只）调用 get_stock_quote / get_stock_money_flow 验证 → 输出表格 + 每只 2-3 句理由 + 风险提示。
- 筛选结果 ≠ 买入建议，输出时给出风险提示。`,
};
