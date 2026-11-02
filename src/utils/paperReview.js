/**
 * paperReview — 模拟盘复盘统计（**纯函数**，无 Vue / 无 Tauri / 无网络）
 *
 * 回答两个「用了才有意义」的问题：
 *   1. **隔夜缺口**：每笔买入持有过夜，次日开盘相对买入价是高开还是低开？
 *      这是「一夜持股」到底有没有正期望的唯一硬证据（日线 ATR 只能做风险代理）。
 *   2. **按持有期 / 按买入时战法的胜率与平均盈亏**：同一套战法在不同持有期表现可能完全相反，
 *      不拆开看就会被总和胜率骗。
 *
 * 口径（与 §7.35 一致）：
 * - 数据来源只有账户里已有的成交与 `matches`（FIFO 配对），不重新撮合、不猜价格
 * - 老成交没有 `matches`（v2 早期）时**不伪造持有天数**：单列为 `legacyCount` 并在 UI 提示
 * - 一笔配对可能同时命中多个战法（`meta.patterns`），归因取**首个战法**作主因，其余不重复计数；
 *   没有战法的归入「无战法」——它的表现恰恰是「凭感觉买」的基准线
 * - 平盘（pnl === 0）不进胜率分母（`decided = wins + losses`），与 §7.26 一致
 * - 样本 < 10 笔时 `enough = false`，UI 必须标「样本不足，仅供参考」
 */

/** 持有期分组（自然日，含两端） */
export const HOLD_BUCKETS = Object.freeze([
  { id: "d01", label: "0~1 天", min: 0, max: 1 },
  { id: "d23", label: "2~3 天", min: 2, max: 3 },
  { id: "d45", label: "4~5 天", min: 4, max: 5 },
  { id: "d610", label: "6~10 天", min: 6, max: 10 },
  { id: "d11", label: "11 天以上", min: 11, max: Number.POSITIVE_INFINITY },
]);

/** 买入时参考分的分组 */
export const SCORE_BUCKETS = Object.freeze([
  { id: "s80", label: "≥80 分", min: 80, max: Number.POSITIVE_INFINITY },
  { id: "s60", label: "60~79 分", min: 60, max: 79.999 },
  { id: "s0", label: "低于 60 分", min: Number.NEGATIVE_INFINITY, max: 59.999 },
  { id: "none", label: "未评分", min: null, max: null },
]);

function nz(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * 一组配对的统计（胜负、胜率、平均盈亏）
 * @param {Array<{pnl:number}>} rows
 */
export function statsOf(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && Number.isFinite(Number(r.pnl))) : [];
  const wins = list.filter((r) => Number(r.pnl) > 0).length;
  const losses = list.filter((r) => Number(r.pnl) < 0).length;
  const flats = list.filter((r) => Number(r.pnl) === 0).length;
  const decided = wins + losses;
  const total = list.reduce((s, r) => s + Number(r.pnl), 0);
  return {
    count: list.length,
    wins,
    losses,
    flats,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    totalPnl: round2(total),
    avgPnl: list.length ? round2(total / list.length) : null,
  };
}

/**
 * 从账户的成交里摊出全部平仓配对
 * @param {object} acct
 * @returns {Array} matches（带 code/name）
 */
export function collectMatches(acct) {
  const out = [];
  for (const t of acct?.trades || []) {
    if (t?.side !== "sell") continue;
    const list = Array.isArray(t.matches) ? t.matches : [];
    if (!list.length) continue;
    for (const m of list) {
      out.push({
        code: m.code || t.code || "",
        name: m.name || t.name || "",
        pnl: Number(m.pnl) || 0,
        holdDays: Number.isFinite(Number(m.holdDays)) ? Number(m.holdDays) : null,
        sellDate: m.sellDate || t.date || "",
        buyDate: m.buyDate || "",
        meta: m.meta || null,
      });
    }
  }
  return out;
}

/**
 * FIFO 归因汇总：总览 + 按持有期 + 按买入时战法 + 按买入时参考分
 * @param {object} acct
 */
export function summarizeMatches(acct) {
  const matches = collectMatches(acct);
  const legacySells = (acct?.trades || []).filter(
    (t) => t?.side === "sell" && !(Array.isArray(t.matches) && t.matches.length)
  ).length;

  const byHold = HOLD_BUCKETS.map((b) => {
    const rows = matches.filter((m) => m.holdDays != null && m.holdDays >= b.min && m.holdDays <= b.max);
    return { id: b.id, label: b.label, ...statsOf(rows) };
  });

  const patternMap = new Map();
  for (const m of matches) {
    const name = Array.isArray(m.meta?.patterns) && m.meta.patterns.length ? m.meta.patterns[0] : "无战法";
    if (!patternMap.has(name)) patternMap.set(name, []);
    patternMap.get(name).push(m);
  }
  const byPattern = Array.from(patternMap.entries())
    .map(([name, rows]) => ({ name, ...statsOf(rows) }))
    .sort((a, b) => b.count - a.count);

  const byScore = SCORE_BUCKETS.map((b) => {
    const rows = matches.filter((m) => {
      const s = Number(m.meta?.score);
      if (!Number.isFinite(s)) return b.id === "none";
      return b.min != null && s >= b.min && s <= b.max;
    });
    return { id: b.id, label: b.label, ...statsOf(rows) };
  });

  const overall = statsOf(matches);
  return {
    ...overall,
    enough: overall.count >= 10,
    legacySells,
    byHold,
    byPattern,
    byScore,
    matches,
  };
}

/**
 * 隔夜缺口：买入日之后第一根 K 线的开盘价相对买入价
 *
 * @param {Array} trades 账户成交流水
 * @param {Object<string, Array>} barsByCode code → 日 K（升序）
 * @returns {{
 *   samples: Array<{ code, name, buyDate, buyPrice, nextDate, nextOpen, gapPct }>,
 *   count: number, missing: string[],
 *   meanGap: number|null, medianGap: number|null, positiveRate: number|null,
 *   upCount: number, downCount: number, enough: boolean
 * }}
 */
export function overnightGaps(trades, barsByCode) {
  const map = barsByCode && typeof barsByCode === "object" ? barsByCode : {};
  const samples = [];
  const missing = [];

  for (const t of Array.isArray(trades) ? trades : []) {
    if (t?.side !== "buy") continue;
    const bars = map[t.code];
    if (!Array.isArray(bars) || !bars.length) {
      missing.push(t.code);
      continue;
    }
    const next = bars.find((b) => b && b.date > t.date);
    const buyPrice = Number(t.price);
    const nextOpen = Number(next?.open);
    if (!next || !(buyPrice > 0) || !(nextOpen > 0)) {
      missing.push(t.code);
      continue;
    }
    samples.push({
      code: t.code,
      name: t.name || "",
      buyDate: t.date,
      buyPrice: round2(buyPrice),
      nextDate: next.date,
      nextOpen: round2(nextOpen),
      gapPct: round2(((nextOpen - buyPrice) / buyPrice) * 100),
    });
  }

  const gaps = samples.map((s) => s.gapPct).sort((a, b) => a - b);
  const upCount = gaps.filter((g) => g > 0).length;
  const downCount = gaps.filter((g) => g < 0).length;
  const median = gaps.length
    ? gaps.length % 2
      ? gaps[(gaps.length - 1) / 2]
      : round2((gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2)
    : null;

  return {
    samples,
    count: samples.length,
    missing: Array.from(new Set(missing)),
    meanGap: gaps.length ? round2(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
    medianGap: median,
    positiveRate: gaps.length ? (upCount / gaps.length) * 100 : null,
    upCount,
    downCount,
    enough: gaps.length >= 10,
  };
}
