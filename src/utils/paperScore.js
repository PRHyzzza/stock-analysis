/**
 * paperScore — 模拟盘选股的连续打分（0-100）
 *
 * 为什么需要它：原引擎是「8 条规则任一触发就买」（`paperEngine.js` 的 `planEntries`
 * 按 `active.length` 排序），这是二值判定——「勉强金叉」和「多指标共振」被当成同一件事，
 * 每日买入名额先被弱信号占满。打分把「强度」变成可排序的连续量。
 *
 * 口径（与 §7.19/§7.26 一致，UI 必须如实标注）：
 * - 输入必须是**截至信号日**的 K 线切片，调用方负责防前视（本模块不做日期截断）
 * - 6 个因子满分 100：趋势 25 / 位置 20 / 动量 20 / 量能 15 / MACD 10 / RSI 10
 * - 指标缺失（预热不足）一律按 0 分计，不做假值填充
 * - 打分只用于**排序与过滤**，不是收益预测；分数高低与未来涨跌没有因果关系
 */

import { sma, macd } from "./indicators.js";

/** 算分需要的最少 K 线根数（MA20 斜率要 25 根，MACD 要 35 根，取 60 留余量） */
export const MIN_SCORE_BARS = 60;

/** 打分窗口默认长度：只取最近 120 根算指标，既能收敛又不拖慢每日回放 */
export const SCORE_SPAN = 120;

/** 因子元数据（顺序即 UI 展示顺序；满分合计必须为 100） */
export const SCORE_FACTORS = Object.freeze([
  { id: "trend", name: "趋势", weight: 25, hint: "均线多头排列 + MA20 向上" },
  { id: "position", name: "位置", weight: 20, hint: "贴近 MA20 且处在 20 日区间上部（追高扣分）" },
  { id: "momentum", name: "动量", weight: 20, hint: "20 日涨幅适中最好，过热递减" },
  { id: "volume", name: "量能", weight: 15, hint: "当日量能相对 20 日均量" },
  { id: "macd", name: "MACD", weight: 10, hint: "DIF 在 DEA 上方且红柱扩大" },
  { id: "rsi", name: "RSI", weight: 10, hint: "45~70 最健康，超买归零" },
]);

/** 默认打分参数 */
export const DEFAULT_SCORE_CONFIG = Object.freeze({
  /** 入选最低分（0-100）；低于此分数不买 */
  minScore: 60,
  /** 每日最多买入只数（1-5）；与 maxPositions 取小 */
  maxPicks: 2,
});

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 打分参数规整（用户输入一律过一遍）
 * @param {object} [raw]
 * @returns {{ minScore: number, maxPicks: number }}
 */
export function normalizeScoreConfig(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    minScore: Math.round(clampNumber(src.minScore, 0, 100, DEFAULT_SCORE_CONFIG.minScore)),
    maxPicks: Math.round(clampNumber(src.maxPicks, 1, 5, DEFAULT_SCORE_CONFIG.maxPicks)),
  };
}

/** RSI（Wilder 平滑）；不足 period+1 根处为 null */
function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const up = d > 0 ? d : 0;
    const dn = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + up) / period;
    loss = (loss * (period - 1) + dn) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** 趋势分（满分 25） */
function scoreTrend(ma5, ma10, ma20, i) {
  let s = 0;
  if (ma5[i] != null && ma10[i] != null && ma5[i] > ma10[i]) s += 8;
  if (ma10[i] != null && ma20[i] != null && ma10[i] > ma20[i]) s += 9;
  if (ma20[i] != null && i >= 5 && ma20[i - 5] != null && ma20[i] > ma20[i - 5]) s += 8;
  return s;
}

/** 位置分（满分 20） */
function scorePosition(closes, ma20, i) {
  let s = 0;
  const c = closes[i];
  const base = ma20[i];
  if (base != null && base > 0) {
    const dev = ((c - base) / base) * 100;
    if (dev > 0 && dev < 15) s += 10;
    else if (dev >= 15) s += 3; // 偏离过大 → 追高，只给底分
  }
  const from = Math.max(0, i - 19);
  const win = closes.slice(from, i + 1);
  if (win.length) {
    const hi = Math.max(...win);
    const lo = Math.min(...win);
    const rng = hi > lo ? (c - lo) / (hi - lo) : 0;
    if (rng > 0.6) s += 10;
    else if (rng > 0.3) s += 5;
  }
  return s;
}

/** 动量分（满分 20）：20 日涨幅 5%~25% 最健康 */
function scoreMomentum(closes, i) {
  if (i < 20) return 0;
  const base = closes[i - 20];
  if (!(base > 0)) return 0;
  const ret = (closes[i] / base - 1) * 100;
  if (ret >= 5 && ret <= 25) return 20;
  if (ret > 25 && ret <= 45) return 12;
  if (ret > 0 && ret < 5) return 10;
  if (ret > 45) return 4;
  return 0;
}

/** 量能分（满分 15） */
function scoreVolume(vols, volMa20, i) {
  const m = volMa20[i];
  if (m == null || !(m > 0)) return 0;
  const ratio = vols[i] / m;
  if (ratio >= 1.5) return 15;
  if (ratio >= 1.1) return 11;
  if (ratio >= 0.8) return 7;
  return 2;
}

/** MACD 分（满分 10） */
function scoreMacd(ind, i) {
  if (i < 1) return 0;
  const { dif, dea } = ind;
  if (!Number.isFinite(dif[i]) || !Number.isFinite(dea[i])) return 0;
  let s = 0;
  if (dif[i] > dea[i]) s += 6;
  const now = dif[i] - dea[i];
  const prev = dif[i - 1] - dea[i - 1];
  if (Number.isFinite(prev) && now > prev) s += 4;
  return s;
}

/** RSI 分（满分 10）：45~70 最健康 */
function scoreRsi(rsi, i) {
  const v = rsi[i];
  if (v == null) return 0;
  if (v >= 45 && v <= 70) return 10;
  if (v > 70 && v <= 80) return 4;
  if (v > 80) return 0;
  if (v >= 35) return 5;
  return 2;
}

/**
 * 对一段 K 线（截至信号日）打分
 *
 * @param {Array<{date:string, open:number, high:number, low:number, close:number, volume:number}>} bars
 *   必须是**升序且截止到信号日**的数组（调用方负责防前视）
 * @param {string} [code] 股票代码（保留位，当前打分不区分板块）
 * @returns {{ enough: boolean, score: number, parts: Object<string, number>, bars: number }}
 */
export function scoreBars(bars, code = "") {
  const list = Array.isArray(bars) ? bars : [];
  const clean = list.filter((b) => b && Number(b.close) > 0);
  const n = clean.length;
  if (n < MIN_SCORE_BARS) {
    return {
      enough: false,
      score: 0,
      parts: { trend: 0, position: 0, momentum: 0, volume: 0, macd: 0, rsi: 0 },
      bars: n,
      code,
    };
  }

  const closes = clean.map((b) => Number(b.close) || 0);
  const vols = clean.map((b) => Number(b.volume) || 0);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const volMa20 = sma(vols, 20);
  const ind = macd(closes);
  const rsi = rsiSeries(closes, 14);

  const i = n - 1;
  const parts = {
    trend: scoreTrend(ma5, ma10, ma20, i),
    position: scorePosition(closes, ma20, i),
    momentum: scoreMomentum(closes, i),
    volume: scoreVolume(vols, volMa20, i),
    macd: scoreMacd(ind, i),
    rsi: scoreRsi(rsi, i),
  };
  const score = Object.values(parts).reduce((s, v) => s + v, 0);

  return { enough: true, score, parts, bars: n, code, asOf: clean[i]?.date || null };
}

/**
 * 取某只票在 `date` 当日的打分窗口（只含该日及之前，防前视）
 *
 * @param {Array} bars 完整日 K（升序）
 * @param {string} date 信号日
 * @param {number} [span] 窗口上限根数
 * @returns {Array} 截止该日的 K 线切片（最多 span 根）
 */
export function scoreWindow(bars, date, span = SCORE_SPAN) {
  const list = Array.isArray(bars) ? bars : [];
  let end = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].date <= date) end = i;
    else break;
  }
  if (end < 0) return [];
  const from = Math.max(0, end - span + 1);
  return list.slice(from, end + 1);
}

/** 把分数翻译成一句话（UI / 运行日志用） */
export function describeScore(res) {
  if (!res || !res.enough) return "K 线不足，无法打分";
  const parts = res.parts || {};
  const detail = SCORE_FACTORS.map((f) => `${f.name}${parts[f.id] ?? 0}`).join(" ");
  return `${res.score} 分（${detail}）`;
}
