/**
 * useStockSentiment — 个股社区情绪（东方财富股吧）
 *
 * 数据：Rust get_stock_guba_posts → 帖子列表（标题/作者/阅读/回复/时间）
 * 分析（纯前端，本地即时）：
 * - 看多/看空/中性分类：短语表优先 → 单词表 → 否定词反转 → 问句识别
 * - 情绪档位：加权看多占比 + 情绪明确度（judgedRatio）置信度修正
 * - 热度：总阅读量、平均回复、帖子数
 *
 * 帖子列表 5 分钟内存缓存（跨实例共享），避免频繁弹窗重复请求
 */

import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

// 帖子缓存（模块级）：{ code: { data, fetchedAt } }
const POSTS_CACHE_TTL = 5 * 60 * 1000;
const postsCache = new Map();

/**
 * 分类策略说明：
 * 1. 短语表优先（含完整语境，如"利好出尽"是看空而非看多）
 * 2. 单词表兜底（未命中任何短语时）
 * 3. 否定词反转：情绪词前 4 字符内出现否定词 → 倾向反转（"不看好"→空、"没跌停"→多）
 * 4. 问句识别："能买吗/会涨停吗"等疑问句 → 观望（不计入多空），单独统计 questioning
 * 5. 热度加权：单帖权重 = 1 + 回复加权 + 阅读加权，避免百万阅读帖与百阅读帖等权
 */

/** 看多短语（含完整语境，优先匹配） */
const BULLISH_PHRASES = [
  "放量突破", "缩量涨停", "一阳穿多", "反包", "地天板", "回踩确认", "回踩不破",
  "突破新高", "创出新高", "主升浪", "加速上涨", "强势涨停", "金针探底", "双底成立",
  "右侧买点", "业绩预增", "中报预增", "年报预增", "回购增持", "重组获批",
  "站上均线", "放量上攻", "大单流入", "主力加仓", "北向流入", "机构买入",
  "低开高走", "涨停潮", "连板", "翻倍", "起飞", "吃肉", "上车", "低吸",
  "企稳回升", "止跌企稳", "止跌回升", "回调到位", "洗盘结束", "黄金坑",
];

/** 看空短语 */
const BEARISH_PHRASES = [
  "利好出尽", "放量滞涨", "缩量反弹", "冲高回落", "高开低走", "炸板", "天地板",
  "断头铡刀", "破位下行", "破位下跌", "阴包阳", "黄昏之星", "双头", "圆弧顶",
  "主力出货", "高位出货", "出货", "诱多", "骗炮", "老乡别走", "接盘", "站岗",
  "山顶", "半山腰", "业绩暴雷", "业绩爆雷", "商誉减值", "戴维斯双杀", "退市风险",
  "阴跌不止", "无量阴跌", "套牢盘", "上方压力", "抛压沉重", "主力出逃", "机构出逃",
  "北向流出", "大单流出", "解禁", "破发", "别买", "别追", "别碰", "别接",
  "慎追", "慎买", "不看好", "不乐观", "没戏", "没救了", "凉了", "完了",
  "跑路", "割肉", "止损离场", "清仓走人", "套死", "深套",
];

/** 看多单词（短语未命中时兜底；命中短语优先） */
const BULLISH_WORDS = [
  "涨停", "大涨", "突破", "利好", "增持", "龙头", "反转", "拉升", "爆发",
  "回血", "企稳", "强势", "新高", "回购", "分红", "加仓", "看多", "主升",
  "翻红", "收红",
];

/** 看空单词 */
const BEARISH_WORDS = [
  "跌停", "大跌", "破位", "利空", "减持", "被套", "割肉", "退市", "跳水",
  "崩盘", "清仓", "跑路", "亏损", "爆雷", "下杀", "新低", "看空", "套牢",
  "阴跌", "退潮", "风险", "警示", "st", "跌跌不休", "弱势", "走弱",
];

/** 否定词：情绪词前 N 字符窗口内命中 → 倾向反转 */
const NEGATIONS = ["不", "没", "无", "别", "莫", "未", "非", "勿"];

/** 问句特征（命中即视为观望/提问，不计入多空） */
const QUESTION_PATTERNS = [
  /[?？]/,
  /^(能|该|可以|会|敢|还|是否|能不能|该不该|要不要|可不可以)/,
  /(吗|么|吧|呢|如何|怎么样|什么价位|多少|何时|为啥|为什么|怎么看|怎么看后市)$/,
];

/** 短语匹配（返回命中的短语列表） */
function matchPhrases(title, phrases) {
  return phrases.filter((p) => title.includes(p));
}

/** 否定窗口检测：检查 pos 前 4 个字符内是否有否定词 */
function hasNegationBefore(title, pos) {
  const start = Math.max(0, pos - 4);
  const window = title.slice(start, pos);
  return NEGATIONS.some((n) => window.includes(n));
}

/**
 * 标题情绪分类：看多 / 看空 / 中性（观望）
 * @returns {"bullish"|"bearish"|"neutral"}
 */
function classifyTitle(title) {
  const t = String(title || "").toLowerCase().trim();
  if (!t) return "neutral";

  // 问句 → 观望（"会涨停吗"不是看多，"还能拿吗"不是看空）
  if (QUESTION_PATTERNS.some((re) => re.test(t))) return "neutral";

  // 短语优先（含完整语境，避免"利好出尽"被"利好"误判为看多）
  const bullPhrases = matchPhrases(t, BULLISH_PHRASES);
  const bearPhrases = matchPhrases(t, BEARISH_PHRASES);
  if (bullPhrases.length > 0 || bearPhrases.length > 0) {
    return bullPhrases.length > bearPhrases.length ? "bullish" : bearPhrases.length > bullPhrases.length ? "bearish" : "neutral";
  }

  // 单词兜底 + 否定反转（"不看好""别追高"）
  let bull = 0;
  let bear = 0;
  for (const w of BULLISH_WORDS) {
    const idx = t.indexOf(w);
    if (idx !== -1) {
      // 否定窗口内的情绪词反转：仅当窗口中只有否定词、没有其他情绪词时反转
      bull += hasNegationBefore(t, idx) ? -1 : 1;
    }
  }
  for (const w of BEARISH_WORDS) {
    const idx = t.indexOf(w);
    if (idx !== -1) {
      bear += hasNegationBefore(t, idx) ? -1 : 1;
    }
  }
  // 反转后的负计数归零处理（"不跌了"→ bear=-1 → 视为 0，但"不跌"本身偏多信息已由反转表达）
  bull = Math.max(0, bull);
  bear = Math.max(0, bear);
  if (bull > bear) return "bullish";
  if (bear > bull) return "bearish";
  return "neutral";
}

/** 单帖权重：回复/阅读越多权重越高（上限 16），避免大热帖与小帖等权 */
function postWeight(p) {
  const replies = Math.min(Math.floor((Number(p.commentCount) || 0) / 5), 10);
  const clicks = Math.min(Math.floor((Number(p.clickCount) || 0) / 20000), 5);
  return 1 + replies + clicks;
}

/** 由帖子列表推导情绪统计 */
export function deriveSentiment(posts) {
  const list = Array.isArray(posts) ? posts : [];
  let bullW = 0;
  let bearW = 0;
  let bull = 0;
  let bear = 0;
  let neutral = 0;
  let questioning = 0;
  let totalClicks = 0;
  let totalComments = 0;
  const judgedPosts = [];

  for (const p of list) {
    const w = postWeight(p);
    const c = classifyTitle(p.title);
    if (c === "bullish") {
      bull++;
      bullW += w;
      judgedPosts.push({ p, c });
    } else if (c === "bearish") {
      bear++;
      bearW += w;
      judgedPosts.push({ p, c });
    } else {
      neutral++;
      // 问句帖单列（用于"分歧/观望氛围"提示）
      const t = String(p.title || "");
      if (QUESTION_PATTERNS.some((re) => re.test(t))) questioning++;
    }
    totalClicks += Number(p.clickCount) || 0;
    totalComments += Number(p.commentCount) || 0;
  }

  const total = list.length;
  const judged = bull + bear;
  // 方向：加权看多占比（明确倾向帖内）——大热帖权重更高，代表更多关注者的立场
  const ratio = bullW + bearW > 0 ? bullW / (bullW + bearW) : 0.5;
  // 明确度（计数口径）：表达明确倾向的帖子占全部帖子的比例。
  // 中性/问句帖多（judgedRatio 低）→ 观望氛围，档位向中性收敛，
  // 避免"18 条中性 + 2 条看空"被热帖权重误判为极端情绪
  const judgedRatio = total > 0 ? judged / total : 0;
  const bullPct = total > 0 ? Math.round((bull / total) * 100) : 0;
  const bearPct = total > 0 ? Math.round((bear / total) * 100) : 0;
  const neutralPct = total > 0 ? Math.round((neutral / total) * 100) : 0;

  // 热度（0-100）：帖子数 + 平均阅读 + 平均回复 三因子归一化
  const avgClicks = total > 0 ? totalClicks / total : 0;
  const avgComments = total > 0 ? totalComments / total : 0;
  const heat = Math.min(
    100,
    Math.round(
      Math.min(total, 40) * 1.2 +          // 帖子量（上限 40 条视为很热）
      Math.min(avgClicks / 50, 40) +        // 平均阅读（5000 阅读封顶 40 分）
      Math.min(avgComments * 2, 20)          // 平均回复（10 条回复封顶 20 分）
    )
  );

  // 情绪档位：加权看多占比主导 + 明确度修正
  // 基础档：ratio 越靠近 1 越狂热、越靠近 0 越恐慌
  let level;
  if (total < 3) {
    level = "冷淡";
  } else if (judgedRatio < 0.25) {
    // 绝大多数帖子无明确情绪（中性/问句）→ 观望氛围，即使少数帖一致也不下重判
    level = "中性";
  } else {
    if (ratio >= 0.7) level = "狂热";
    else if (ratio >= 0.58) level = "偏多";
    else if (ratio >= 0.42) level = "中性";
    else if (ratio >= 0.3) level = "偏空";
    else level = "极度恐慌";
    // 明确度衰减：倾向明确的帖子不足一半时向中性收敛一级（样本噪声大）
    if (judgedRatio < 0.5 && level !== "中性") {
      level = { 狂热: "偏多", 偏多: "中性", 偏空: "中性", 极度恐慌: "偏空" }[level] || "中性";
    }
    // 样本量保护：明确倾向帖太少时极端档位降一级
    // （避免少数爆款帖权重主导，如 2 条大热看多帖把 10 条帖子判成"狂热"）
    if (judged < 8) {
      level = { 狂热: "偏多", 极度恐慌: "偏空" }[level] || level;
    }
  }

  // 热门帖子（按阅读量降序，供 UI/AI 展示）
  const hotPosts = [...list]
    .sort((a, b) => (Number(b.clickCount) || 0) - (Number(a.clickCount) || 0))
    .slice(0, 10);

  return {
    total,
    bull,
    bear,
    neutral,
    questioning,           // 问句/观望帖数量（分歧氛围参考）
    ratio: bullW + bearW > 0 ? Math.round(ratio * 100) / 100 : null,
    judgedRatio: Math.round(judgedRatio * 100) / 100, // 情绪明确度（0-1，计数口径：明确倾向帖占比）
    bullPct,
    bearPct,
    neutralPct,
    totalClicks,
    avgComments: total > 0 ? Math.round((totalComments / total) * 10) / 10 : 0,
    heat,
    level,
    hotPosts,
  };
}

export function useStockSentiment() {
  const posts = ref([]);
  const loading = ref(false);
  const error = ref("");

  let requestSeq = 0; // 竞态保护：切换股票丢弃旧响应

  /** 加载某股票的股吧帖子（5 分钟缓存命中时零请求） */
  async function load(code) {
    if (!code) return;
    const seq = ++requestSeq;
    const cached = postsCache.get(code);
    if (cached && Date.now() - cached.fetchedAt < POSTS_CACHE_TTL) {
      posts.value = cached.data;
      error.value = "";
      return;
    }
    loading.value = true;
    error.value = "";
    try {
      const data = await invoke("get_stock_guba_posts", { code, count: 20 });
      if (seq !== requestSeq) return;
      posts.value = data || [];
      if (postsCache.size >= 100) {
        const oldest = postsCache.keys().next().value;
        if (oldest != null) postsCache.delete(oldest);
      }
      postsCache.set(code, { data: posts.value, fetchedAt: Date.now() });
    } catch (e) {
      if (seq !== requestSeq) return;
      error.value = String(e);
      posts.value = [];
    } finally {
      if (seq === requestSeq) loading.value = false;
    }
  }

  /** 帖子原文链接（东财股吧） */
  function postUrl(post) {
    return `https://guba.eastmoney.com/news,${post.code ?? ""},${post.id}.html`;
  }

  return { posts, loading, error, load, postUrl };
}
