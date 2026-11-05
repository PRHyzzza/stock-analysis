/**
 * marketSentiment — 短线/超短线的「情绪 + 题材」口径（**纯函数**）
 *
 * 为什么单独成文件：`paperScore.js` 打的是「个股日线强度」，回答不了短线最要紧的问题——
 * **今天的钱往哪儿走**。同一根阳线，来自当日最强概念和来自没人看的行业，含义完全不同；
 * 同样的 65 分，在涨停 120 家的普涨日和跌停 30 家的杀跌日，含义也完全不同。
 *
 * 这里把两件事变成可计算、可解释的量：
 * 1. `sentimentOf()`：全市场情绪温度 → 0-100 分 + 标签 + **环境系数**（0.90–1.10）
 * 2. `sectorBoostOf()`：个股所属板块的当日强度 → 题材加成（0–8）
 *
 * 硬约束（与 §7.35 一致）：
 * - **只做参考**，不参与成交，也不产生买卖指令
 * - 数据缺失就说缺失：`limit_down` 拿不到时给中性分并标注「未知」，不许当 0 家跌停算
 * - 不通用的「概念」要排除：融资融券 / 沪股通 / 同花顺漂亮100 这类标签几乎每只票都有，
 *   涨幅代表的是宽基或通道而非题材，计进题材强度会把所有票拉平（实测 2026-11-05 数据确认存在）
 */

import { clamp, curve, round1 } from "./scoreMath.js";

/** 情绪分档（阈值即 UI 文案口径，改这里 UI 自动跟随） */
export const SENTIMENT_LEVELS = Object.freeze([
  { max: 25, label: "冰点", hint: "涨停稀少、炸板多，短线只做最强，宁可空仓" },
  { max: 40, label: "偏弱", hint: "赚钱效应差，追高容易吃面" },
  { max: 60, label: "中性", hint: "结构性行情，看题材和个股位置" },
  { max: 78, label: "回暖", hint: "封板率与连板高度都健康，可以做接力" },
  { max: 101, label: "高潮", hint: "情绪过热，注意分歧与监管风险，别在最高潮加仓" },
]);

/** 情绪分项权重（合计 100） */
export const SENTIMENT_WEIGHTS = Object.freeze({
  seal: 35, // 封板率
  limitUp: 25, // 涨停家数
  limitDown: 15, // 跌停家数（反向）
  breakRate: 15, // 炸板率（反向）
  board: 10, // 最高连板高度
});

/**
 * 通用概念黑名单（子串匹配）
 *
 * 这些「概念」是通道 / 指数成分 / 持仓风格标签，不是题材。实测 600519 返回的 8 个概念里
 * 有 5 个属于此类；若参与题材强度计算，白酒概念会被「沪股通 +1.2%」之类的宽基涨幅掩盖。
 */
export const GENERIC_SECTOR_KEYWORDS = Object.freeze([
  "融资融券",
  "沪股通",
  "深股通",
  "转融通",
  "转融券",
  "同花顺漂亮100",
  "MSCI",
  "标普",
  "富时罗素",
  "机构重仓",
  "基金重仓",
  "社保重仓",
  "QFII",
  "证金持股",
  "预盈预增",
  "预亏预减",
  "中证500",
  "中证1000",
  "上证50",
  "上证180",
  "沪深300",
  "创业板综",
  "深证成指",
]);

/** 数值或 null（0 与「缺失」必须能区分；`Number(null)` 是 0，所以要先挡掉空值） */
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 是否通用概念（不是题材） */
export function isGenericSector(name) {
  const s = String(name || "");
  if (!s) return false;
  return GENERIC_SECTOR_KEYWORDS.some((k) => s.includes(k));
}

/**
 * 市场情绪 → 0-100 分 + 标签 + 环境系数
 *
 * 分项都走分段线性插值（与 `paperScore` 同一套 `curve`），保证档位之间连续、可解释：
 * - 封板率 35 分：40% 归零，65% 得 22，85% 封顶
 * - 涨停家数 25 分：0 家 0 分，60 家 18 分，150 家封顶
 * - 跌停家数 15 分（反向）：0 家满分，30 家只剩 2，60 家归零
 * - 炸板率 15 分（反向）：10% 满分，45% 只剩 4，60% 归零
 * - 最高连板 10 分：3 板 5 分，5 板 9 分，7 板封顶
 *
 * 缺失处理：`limit_down` / `seal_rate` 拿不到时按**中性**给分并在 `missing` 里列出，
 * 绝不按「0 跌停」满分算——那会把「没数据」当成「情绪极好」。
 *
 * @param {object|null} stats `get_market_sentiment` 的返回
 * @returns {{ available: boolean, score: number, label: string, hint: string, factor: number,
 *             parts: object, missing: string[], sealRatePct: number|null, breakRatePct: number|null }}
 */
export function sentimentOf(stats) {
  if (!stats || typeof stats !== "object") {
    return {
      available: false,
      score: 0,
      label: "无数据",
      hint: "未取到当日情绪数据（需要同花顺 API Key）",
      factor: 1,
      parts: {},
      missing: ["all"],
      sealRatePct: null,
      breakRatePct: null,
    };
  }

  const missing = [];
  const limitUp = numOrNull(stats.limit_up) ?? 0;
  const openCount = numOrNull(stats.open_count) ?? 0;
  const touchedRaw = numOrNull(stats.touched);
  // 封板率基数字段缺失时用「涨停 + 炸板」兜底，这比直接当 0 更接近真实
  const touched = touchedRaw != null && touchedRaw > 0 ? touchedRaw : limitUp + openCount;

  const sealRaw = numOrNull(stats.seal_rate);
  const sealPct = sealRaw != null ? sealRaw * 100 : null;
  let sealScore;
  if (sealPct != null) {
    // 65% 只是「正常」，80% 以上才算强：控制点定太松会让普通交易日就报「高潮」
    sealScore = curve(sealPct, [
      [40, 0],
      [55, 8],
      [70, 18],
      [80, 24],
      [90, 35],
    ]);
  } else {
    missing.push("seal_rate");
    sealScore = SENTIMENT_WEIGHTS.seal * 0.5;
  }

  const limitUpScore = curve(limitUp, [
    [0, 0],
    [20, 4],
    [40, 9],
    [60, 14],
    [100, 19],
    [150, 25],
  ]);

  const limitDown = numOrNull(stats.limit_down);
  let limitDownScore;
  if (limitDown != null) {
    limitDownScore = curve(limitDown, [
      [0, 15],
      [5, 12],
      [15, 6],
      [30, 2],
      [60, 0],
    ]);
  } else {
    missing.push("limit_down");
    limitDownScore = SENTIMENT_WEIGHTS.limitDown * 0.55;
  }

  const breakRatePct = touched > 0 ? (openCount / touched) * 100 : null;
  let breakScore;
  if (breakRatePct != null) {
    breakScore = curve(breakRatePct, [
      [10, 14],
      [20, 11],
      [30, 7],
      [45, 3],
      [60, 0],
    ]);
  } else {
    breakScore = SENTIMENT_WEIGHTS.breakRate * 0.5;
  }

  const maxBoard = numOrNull(stats.max_board) ?? 0;
  const boardScore = curve(maxBoard, [
    [0, 0],
    [1, 1],
    [2, 3],
    [3, 5],
    [4, 7],
    [5, 9],
    [7, 10],
  ]);

  const score = round1(
    clamp(sealScore + limitUpScore + limitDownScore + breakScore + boardScore, 0, 100)
  );
  const level = SENTIMENT_LEVELS.find((l) => score < l.max) || SENTIMENT_LEVELS[0];

  // 环境系数：以 50 分为中性锚点（系数 1.0），0 分 0.90、100 分 1.10。
  // 乘系数而不是直接加减分，是为了让「个股强度」的排序不被情绪整体掩盖。
  const factor = Math.round(clamp(1 + (score - 50) / 500, 0.9, 1.1) * 100) / 100;

  return {
    available: true,
    score,
    label: level.label,
    hint: level.hint,
    factor,
    parts: {
      seal: round1(sealScore),
      limitUp: round1(limitUpScore),
      limitDown: round1(limitDownScore),
      breakRate: round1(breakScore),
      board: round1(boardScore),
    },
    missing,
    sealRatePct: sealPct != null ? round1(sealPct) : null,
    breakRatePct: breakRatePct != null ? round1(breakRatePct) : null,
  };
}

/**
 * 个股题材强度 → 加成 0-8
 *
 * 取该股**非通用板块**中当日涨幅最高的那个（题材看最强的一条线，不看平均），
 * 映射：跌 0 分、持平 0 分、+0.5% 得 2、+1.5% 得 4、+3% 得 6、+5% 以上封顶 8。
 * 不做负加成：板块走弱的信息已经由「追高 / 长上影」等风险项表达，重复扣分会双罚。
 *
 * @param {Array<{thscode:string,name:string,kind:string}>} sectors
 * @param {Map<string, number|null>|object} quoteMap thscode → 当日涨跌幅（百分数）
 * @returns {{ available: boolean, boost: number, best: object|null, reason: string }}
 */
export function sectorBoostOf(sectors, quoteMap) {
  const list = Array.isArray(sectors) ? sectors : [];
  if (!list.length) {
    return { available: false, boost: 0, best: null, reason: "无板块数据" };
  }
  const getQuote = (thscode) => {
    if (quoteMap instanceof Map) return numOrNull(quoteMap.get(thscode));
    if (quoteMap && typeof quoteMap === "object") return numOrNull(quoteMap[thscode]);
    return null;
  };

  const candidates = [];
  let genericOnly = true;
  for (const s of list) {
    if (!s || !s.thscode) continue;
    if (isGenericSector(s.name)) continue;
    genericOnly = false;
    const pct = getQuote(s.thscode);
    if (pct == null) continue;
    candidates.push({
      thscode: s.thscode,
      name: s.name || "",
      kind: s.kind || "",
      changePct: pct,
    });
  }

  if (genericOnly) {
    return { available: false, boost: 0, best: null, reason: "所属板块都是通用标签（非题材）" };
  }
  if (!candidates.length) {
    return { available: false, boost: 0, best: null, reason: "板块行情缺失" };
  }

  const best = candidates.reduce((a, b) => (b.changePct > a.changePct ? b : a));
  const boost = round1(
    curve(best.changePct, [
      [-5, 0],
      [0, 0],
      [0.5, 2],
      [1.5, 4],
      [3, 6],
      [5, 8],
      [8, 8],
    ])
  );
  const reason =
    boost > 0
      ? `${best.name} ${best.changePct >= 0 ? "+" : ""}${best.changePct.toFixed(2)}%`
      : `所属板块无明显强势（最强 ${best.name} ${best.changePct.toFixed(2)}%）`;
  return { available: true, boost: clamp(boost, 0, 8), best, reason };
}

/**
 * 情绪 → 一句话（UI 摘要）
 * 缺失字段必须写出来，否则用户会以为「没有跌停」而不是「没拿到跌停数据」。
 */
export function describeSentiment(s) {
  if (!s || !s.available) return "情绪数据不可用";
  const bits = [
    `封板率 ${s.sealRatePct != null ? s.sealRatePct.toFixed(0) + "%" : "—"}`,
    `炸板率 ${s.breakRatePct != null ? s.breakRatePct.toFixed(0) + "%" : "—"}`,
  ];
  if (s.missing?.length) bits.push(`缺 ${s.missing.join("/")}`);
  return `${s.score} 分 · ${s.label}（${bits.join("，")}）`;
}
