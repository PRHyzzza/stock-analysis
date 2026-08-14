/**
 * useStockSentiment — 个股社区情绪（东方财富股吧）
 *
 * 数据：Rust get_stock_guba_posts → 帖子列表（标题/作者/阅读/回复/时间）
 * 分析（纯前端，本地即时）：
 * - 看多/看空/中性分类：标题关键词统计
 * - 情绪档位：看多占比 + 热度加权
 * - 热度：总阅读量、平均回复、帖子数
 *
 * 帖子列表 5 分钟内存缓存（跨实例共享），避免频繁弹窗重复请求
 */

import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/** 看涨关键词（命中即计为看多） */
const BULLISH_WORDS = [
  "涨停", "大涨", "突破", "利好", "增持", "龙头", "低吸", "反转", "拉升",
  "爆发", "连板", "回血", "企稳", "上车", "起飞", "抄底", "翻倍", "强势",
  "新高", "回购", "分红", "吃肉", "加仓", "看多", "主升", "放量上涨", "大单",
];

/** 看跌关键词（命中即计为看空） */
const BEARISH_WORDS = [
  "跌停", "大跌", "破位", "利空", "减持", "被套", "割肉", "退市", "跳水",
  "崩盘", "清仓", "跑路", "亏损", "爆雷", "下杀", "出货", "新低", "凉了",
  "看空", "套牢", "阴跌", "退潮", "主力出逃", "放量下跌", "别买",
];

// 帖子缓存（模块级）：{ code: { data, fetchedAt } }
const POSTS_CACHE_TTL = 5 * 60 * 1000;
const postsCache = new Map();

/** 标题情绪分类：看多 / 看空 / 中性 */
export function classifyTitle(title) {
  const t = String(title || "").toLowerCase();
  let bull = 0;
  let bear = 0;
  for (const w of BULLISH_WORDS) if (t.includes(w.toLowerCase())) bull++;
  for (const w of BEARISH_WORDS) if (t.includes(w.toLowerCase())) bear++;
  if (bull > bear) return "bullish";
  if (bear > bull) return "bearish";
  return "neutral";
}

/** 由帖子列表推导情绪统计 */
export function deriveSentiment(posts) {
  const list = Array.isArray(posts) ? posts : [];
  let bull = 0;
  let bear = 0;
  let neutral = 0;
  let totalClicks = 0;
  let totalComments = 0;
  for (const p of list) {
    const c = classifyTitle(p.title);
    if (c === "bullish") bull++;
    else if (c === "bearish") bear++;
    else neutral++;
    totalClicks += Number(p.clickCount) || 0;
    totalComments += Number(p.commentCount) || 0;
  }
  const judged = bull + bear;
  const ratio = judged > 0 ? bull / judged : 0.5; // 看多占（有明确倾向的帖子中）
  const total = list.length;

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

  // 情绪档位：看多占比主导 + 热度微调（热度低时倾向中性）
  let level;
  if (total < 3) level = "冷淡";
  else if (ratio >= 0.7) level = "狂热";
  else if (ratio >= 0.58) level = "偏多";
  else if (ratio >= 0.42) level = "中性";
  else if (ratio >= 0.3) level = "偏空";
  else level = "极度恐慌";

  return {
    total,
    bull,
    bear,
    neutral,
    ratio: judged > 0 ? Math.round(ratio * 100) / 100 : null,
    bullPct: total > 0 ? Math.round((bull / total) * 100) : 0,
    bearPct: total > 0 ? Math.round((bear / total) * 100) : 0,
    neutralPct: total > 0 ? Math.round((neutral / total) * 100) : 0,
    totalClicks,
    avgComments: total > 0 ? Math.round((totalComments / total) * 10) / 10 : 0,
    heat,
    level,
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
