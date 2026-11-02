/**
 * paperScore — 模拟盘参考打分（0-100，含风险扣分）
 *
 * **定位（2026-11 起）：只做参考，不参与买卖。** 模拟盘改为手动交易后，买卖由用户决定，
 * 打分只在下单面板旁展示「这只票现在强不强、有没有风险」，不再驱动任何成交。
 * 但打分口径本身仍要保持连续、可解释、无前视——它仍是用户判断的输入之一。
 *
 * 历史背景：v1 的自动跑批曾是「8 条规则任一触发就买」（按 `active.length` 排序），
 * 那是二值判定——「勉强金叉」和「多指标共振」被当成同一件事，每日名额先被弱信号占满。
 * 打分把「强度」变成可排序的连续量，这也是它保留至今的原因。
 *
 * 口径（与 §7.19/§7.26/§7.35 一致，UI 必须如实标注）：
 * - 输入必须是**截至信号日**的 K 线切片，调用方负责防前视（本模块不做日期截断）
 * - 6 个因子满分 100：趋势 25 / 位置 20 / 动量 20 / 量能 15 / MACD 10 / RSI 10
 * - 每个因子用**分段线性**计分（不再是 3-4 个粗档位），避免大量同分只能按代码排序
 * - 在此基础上叠加**风险扣分**（追高 / 波动过大 / 放量滞涨 / 长上影，合计最多 -30），
 *   扣分后仍夹在 0-100。因子分只表达「强度」，扣分表达「这笔买入的赔率是否已经变差」
 * - 再叠加**战法共振加成**（趋势跟随 / 一进二 / 突破缩量 / 低吸放量，命中 ≥2 个 +3~+9）：
 *   单一战法命中属常态不加分；加成只奖励「多个独立战法同时成立」，不能替代因子分。
 *   「一夜持股」只做形态识别并计入 `patternHits`，但**不计入共振计数**（见 paperPatterns）
 * - 指标缺失（预热不足）一律按 0 分计，不做假值填充
 * - 打分只用于**排序与过滤**，不是收益预测；分数高低与未来涨跌没有因果关系
 *
 * 返回结构（`scoreBars`）：
 *   { enough, score, baseScore, parts, penalties, penalty,
 *     patterns, patternHits, patternBonus, bars, code, asOf, metrics }
 *   - `baseScore` = 6 因子之和（0-100）
 *   - `penalty`   = 风险扣分合计（0-30，正数表示被扣掉多少）
 *   - `patternBonus` = 战法共振加成（0-9，命中 ≥2 个战法才给）
 *   - `score`     = clamp(baseScore - penalty + patternBonus, 0, 100)：唯一参与排序与阈值判断的值
 *   - `metrics`   = 各判定用到的原始量（便于复盘「为什么扣分」，不做任何展示口径推断）
 *
 * 战法识别在 `paperPatterns.js`（趋势跟随 / 一进二 / 突破缩量 / 低吸放量 / 一夜持股）：
 * 命中 1 个属常态、不加分；命中 ≥2 个才叫「共振」，每多一个 +3、最多 +9。
 * 「一夜持股」是持有节奏（尾盘买、次日开盘卖，由用户手动下单），不计入共振加分。
 */

import { sma, macd } from "./indicators.js";
import { atrPctOf, clamp, curve, round1 } from "./scoreMath.js";
import { detectPatterns, hitPatterns, patternBonusOf } from "./paperPatterns.js";

/** 算分需要的最少 K 线根数（MA20 斜率要 25 根，MACD 要 35 根，ATR 要 15 根，取 60 留余量） */
export const MIN_SCORE_BARS = 60;

/** 打分窗口默认长度：只取最近 120 根算指标，既能收敛又不拖慢每日回放 */
export const SCORE_SPAN = 120;

/** 因子元数据（顺序即 UI 展示顺序；满分合计必须为 100） */
export const SCORE_FACTORS = Object.freeze([
  { id: "trend", name: "趋势", weight: 25, hint: "均线多头排列 + MA20 斜率（2%/5日 记满分）" },
  { id: "position", name: "位置", weight: 20, hint: "贴近 MA20 且处在 20 日区间上部（越追高越少分）" },
  { id: "momentum", name: "动量", weight: 20, hint: "20 日涨幅 8%~25% 满分，过热递减" },
  { id: "volume", name: "量能", weight: 15, hint: "当日量能相对 20 日均量（1.5~2.2 倍最佳）" },
  { id: "macd", name: "MACD", weight: 10, hint: "DIF 在 DEA 上方且有强度，红柱扩大加分" },
  { id: "rsi", name: "RSI", weight: 10, hint: "45~70 最健康，超买归零" },
]);

/**
 * 风险扣分元数据（`penalty` 字段为**扣掉的分数**，恒为正数）
 *
 * 为什么在因子分之外再扣：因子分回答「这票强不强」，扣分回答「现在买它是否已经吃亏」。
 * 两者混在一个因子里会让「强势但已透支」的票看起来和「强势且刚启动」的一样好。
 */
export const SCORE_RISK_FACTORS = Object.freeze([
  { id: "chase", name: "追高", max: 10, hint: "偏离 MA20 超 12% 或 5 日涨幅超 10%" },
  { id: "volatility", name: "波动过大", max: 8, hint: "ATR14 占价格超 5%" },
  { id: "volumeStall", name: "放量滞涨", max: 6, hint: "量比放大但当日涨幅小甚至收跌" },
  { id: "upperShadow", name: "长上影", max: 6, hint: "上影线占振幅过半且冲高回落超 1.5%" },
]);

/** 风险扣分合计上限（防止四项叠加把分数打成负数，掩盖因子之间的差异） */
export const MAX_PENALTY = 30;

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

/** 趋势分（满分 25）：排列 17 分（8+9）+ MA20 斜率 8 分（2%/5 日封顶） */
function scoreTrend(ma5, ma10, ma20, i) {
  let s = 0;
  if (ma5[i] != null && ma10[i] != null && ma5[i] > ma10[i]) s += 8;
  if (ma10[i] != null && ma20[i] != null && ma10[i] > ma20[i]) s += 9;
  if (ma20[i] != null && i >= 5 && ma20[i - 5] != null && ma20[i - 5] > 0) {
    const slopePct = ((ma20[i] / ma20[i - 5]) - 1) * 100;
    s += 8 * clamp(slopePct / 2, 0, 1);
  }
  return s;
}

/** 位置分（满分 20）：MA20 偏离 10 分 + 20 日区间位置 10 分 */
function scorePosition(closes, ma20, i) {
  let s = 0;
  const c = closes[i];
  const base = ma20[i];
  if (base != null && base > 0) {
    const dev = ((c - base) / base) * 100;
    // 贴线（1%~6%）最好；负偏离（跌回均线下方）递减；偏离 25% 以上归零
    s += curve(dev, [
      [-15, 0],
      [-5, 2],
      [-1, 6],
      [1, 10],
      [6, 10],
      [10, 9],
      [15, 4],
      [25, 0],
    ]);
  }
  const from = Math.max(0, i - 19);
  const win = closes.slice(from, i + 1);
  if (win.length) {
    const hi = Math.max(...win);
    const lo = Math.min(...win);
    const rng = hi > lo ? (c - lo) / (hi - lo) : 0;
    // 区间下部（rng < 0.2）不给分：趋势股的买点不该在箱体底部
    s += 10 * clamp((rng - 0.2) / 0.4, 0, 1);
  }
  return s;
}

/** 动量分（满分 20）：20 日涨幅 8%~25% 满分，过热与下跌递减 */
function scoreMomentum(closes, i) {
  if (i < 20) return 0;
  const base = closes[i - 20];
  if (!(base > 0)) return 0;
  const ret = (closes[i] / base - 1) * 100;
  return curve(ret, [
    [-15, 0],
    [0, 2],
    [3, 10],
    [8, 20],
    [25, 20],
    [40, 14],
    [60, 6],
    [80, 2],
  ]);
}

/** 量能分（满分 15）：1.5~2.2 倍最佳，缩量与天量都递减 */
function scoreVolume(vols, volMa20, i) {
  const m = volMa20[i];
  if (m == null || !(m > 0)) return 0;
  const ratio = vols[i] / m;
  return curve(ratio, [
    [0.3, 0],
    [0.6, 3],
    [1.0, 8],
    [1.5, 15],
    [2.2, 15],
    [3.5, 10],
    [5, 5],
    [8, 0],
  ]);
}

/**
 * MACD 分（满分 10）：多头柱体强度 6 分 + 柱体扩张 4 分
 *
 * 强度用「柱体占价格百分比」归一，避免高价股天然柱体大而占优。
 * 0.4% 记满（真实行情里已属强）。柱体在 0 附近横盘（极度平稳的趋势）只拿基础 3 分。
 */
function scoreMacd(dif, dea, i, close) {
  if (i < 1 || !(close > 0)) return 0;
  const h = (k) => Number(dif[k]) - Number(dea[k]);
  const hist = h(i);
  const prev = h(i - 1);
  if (!Number.isFinite(hist)) return 0;

  const histPct = (hist / close) * 100;
  let s = 0;
  if (hist > 0) s += 3 + 3 * clamp(histPct / 0.4, 0, 1);

  if (Number.isFinite(prev)) {
    const prevPct = (prev / close) * 100;
    const delta = histPct - prevPct;
    const denom = Math.max(Math.abs(prevPct), 0.05);
    s += 4 * clamp(delta / denom, 0, 1);
  }
  return s;
}

/** RSI 分（满分 10）：45~70 最健康 */
function scoreRsi(rsi, i) {
  const v = rsi[i];
  if (v == null) return 0;
  return curve(v, [
    [0, 0],
    [25, 0],
    [35, 6],
    [45, 10],
    [70, 10],
    [75, 6],
    [82, 1],
    [95, 0],
  ]);
}

/**
 * 风险扣分（四项，各自独立封顶，合计不超过 MAX_PENALTY）
 *
 * 全部基于**当日及之前**数据，与因子分同源，不引入额外的前视。
 */
function riskPenalties({ closes, opens, highs, lows, vols, i, ma20, volMa20 }) {
  const close = Number(closes[i]);
  const prevClose = Number(closes[i - 1]);
  const high = Number(highs[i]);
  const low = Number(lows[i]);
  const open = Number(opens[i]);

  const out = { chase: 0, volatility: 0, volumeStall: 0, upperShadow: 0 };

  // ① 追高：偏离 MA20 过大 或 5 日涨幅过大（两者取大者，不重复扣）
  const base = ma20[i];
  const dev20 = base > 0 ? ((close / base) - 1) * 100 : null;
  const ret5 = i >= 5 && closes[i - 5] > 0 ? (close / closes[i - 5] - 1) * 100 : null;
  // 偏离 12% 起扣，每多 1% 扣 0.8；5 日涨 10% 起扣，每多 1% 扣 0.6
  const chaseByDev = dev20 != null ? clamp((dev20 - 12) * 0.8, 0, 10) : 0;
  const chaseByRet = ret5 != null ? clamp((ret5 - 10) * 0.6, 0, 10) : 0;
  out.chase = Math.min(10, Math.max(chaseByDev, chaseByRet));

  // ② 波动过大：ATR14 占价格超 5% 起扣（1.5 倍系数），封顶 8
  const atrPct = atrPctOf(highs, lows, closes, i);
  out.volatility = atrPct != null ? clamp((atrPct - 5) * 1.5, 0, 8) : 0;

  // ③ 放量滞涨：量比高但价格没跟上（放量下跌扣得最重）
  const vm = volMa20[i];
  const volRatio = vm > 0 ? Number(vols[i]) / vm : null;
  const dayRet = prevClose > 0 ? (close / prevClose - 1) * 100 : null;
  if (volRatio != null && dayRet != null) {
    if (volRatio >= 2 && dayRet <= 0.5) out.volumeStall = 6;
    else if (volRatio >= 1.5 && dayRet <= 0) out.volumeStall = 4;
    else if (volRatio >= 2.5 && dayRet <= 2) out.volumeStall = 3;
  }

  // ④ 长上影：上影线占振幅过半且冲高回落超 1.5%（≥3% 时扣满）
  const range = high - low;
  if (range > 0 && Number.isFinite(high) && Number.isFinite(close)) {
    const upperFrac = (high - Math.max(open, close)) / range;
    const upperPct = close > 0 ? ((high - close) / close) * 100 : 0;
    if (upperFrac > 0.5 && upperPct > 1.5) {
      const fade = clamp((upperPct - 1.5) / 1.5, 0, 1);
      out.upperShadow = clamp((upperFrac - 0.5) * 12 * fade, 0, 6);
    }
  }

  for (const f of SCORE_RISK_FACTORS) out[f.id] = round1(clamp(out[f.id], 0, f.max));
  return out;
}

/**
 * 对一段 K 线（截至信号日）打分
 *
 * @param {Array<{date:string, open:number, high:number, low:number, close:number, volume:number}>} bars
 *   必须是**升序且截止到信号日**的数组（调用方负责防前视）
 * @param {string} [code] 股票代码（保留位，当前打分不区分板块）
 * @returns {{ enough: boolean, score: number, baseScore: number,
 *             parts: Object<string, number>, penalties: Object<string, number>,
 *             penalty: number, bars: number, code: string, asOf: string|null,
 *             metrics: object|null }}
 */
export function scoreBars(bars, code = "") {
  const list = Array.isArray(bars) ? bars : [];
  const clean = list.filter((b) => b && Number(b.close) > 0);
  const n = clean.length;
  if (n < MIN_SCORE_BARS) {
    return {
      enough: false,
      score: 0,
      baseScore: 0,
      parts: { trend: 0, position: 0, momentum: 0, volume: 0, macd: 0, rsi: 0 },
      penalties: { chase: 0, volatility: 0, volumeStall: 0, upperShadow: 0 },
      penalty: 0,
      patterns: [],
      patternHits: [],
      patternBonus: 0,
      bars: n,
      code,
      asOf: null,
      metrics: null,
    };
  }

  const closes = clean.map((b) => Number(b.close) || 0);
  const opens = clean.map((b) => Number(b.open) || Number(b.close) || 0);
  const highs = clean.map((b) => Number(b.high) || Number(b.close) || 0);
  const lows = clean.map((b) => Number(b.low) || Number(b.close) || 0);
  const vols = clean.map((b) => Number(b.volume) || 0);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const volMa20 = sma(vols, 20);
  const ind = macd(closes);
  const rsi = rsiSeries(closes, 14);

  const i = n - 1;
  const parts = {
    trend: round1(scoreTrend(ma5, ma10, ma20, i)),
    position: round1(scorePosition(closes, ma20, i)),
    momentum: round1(scoreMomentum(closes, i)),
    volume: round1(scoreVolume(vols, volMa20, i)),
    macd: round1(scoreMacd(ind.dif, ind.dea, i, closes[i])),
    rsi: round1(scoreRsi(rsi, i)),
  };
  // 分项封顶：插值控制点已保证不超权重，这里再兜一次，防止将来改控制点时越界
  for (const f of SCORE_FACTORS) parts[f.id] = round1(clamp(parts[f.id], 0, f.weight));

  const baseScore = round1(Object.values(parts).reduce((s, v) => s + v, 0));

  const penalties = riskPenalties({ closes, opens, highs, lows, vols, i, ma20, volMa20 });
  const penalty = round1(
    Math.min(
      MAX_PENALTY,
      Object.values(penalties).reduce((s, v) => s + v, 0)
    )
  );

  // 战法识别：与因子分同源（同一份截断后的 K 线），命中 ≥2 个才给共振加成
  const patterns = detectPatterns(clean, code);
  const patternBonus = patternBonusOf(patterns);

  return {
    enough: true,
    score: round1(clamp(baseScore - penalty + patternBonus, 0, 100)),
    baseScore,
    parts,
    penalties,
    penalty,
    patterns,
    patternHits: hitPatterns(patterns).map((p) => p.name),
    patternBonus,
    bars: n,
    code,
    asOf: clean[i]?.date || null,
    metrics: {
      close: closes[i],
      ma20: ma20[i] ?? null,
      dev20Pct: ma20[i] > 0 ? round1(((closes[i] / ma20[i]) - 1) * 100) : null,
      ret5Pct: i >= 5 && closes[i - 5] > 0 ? round1((closes[i] / closes[i - 5] - 1) * 100) : null,
      ret20Pct: i >= 20 && closes[i - 20] > 0 ? round1((closes[i] / closes[i - 20] - 1) * 100) : null,
      volRatio: volMa20[i] > 0 ? round1((vols[i] / volMa20[i]) * 100) / 100 : null,
      atrPct: atrPctOf(highs, lows, closes, i) == null ? null : round1(atrPctOf(highs, lows, closes, i)),
      rsi: rsi[i] == null ? null : round1(rsi[i]),
      dayRetPct: closes[i - 1] > 0 ? round1((closes[i] / closes[i - 1] - 1) * 100) : null,
    },
  };
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

/**
 * 把分数翻译成一句话（UI / 运行日志用）
 * 有扣分时**必须**写出来，否则用户会以为「这票就是弱」，而不是「强但已被扣到门槛下」。
 */
export function describeScore(res) {
  if (!res || !res.enough) return "K 线不足，无法打分";
  const parts = res.parts || {};
  const detail = SCORE_FACTORS.map((f) => `${f.name}${parts[f.id] ?? 0}`).join(" ");
  const penalty = Number(res.penalty) || 0;
  const bonus = Number(res.patternBonus) || 0;
  const hits = Array.isArray(res.patternHits) ? res.patternHits : [];
  const tail = [];
  if (bonus > 0) tail.push(`战法共振 +${bonus}（${hits.join("、")}）`);
  if (penalty > 0) {
    const hit = SCORE_RISK_FACTORS.filter((f) => Number(res.penalties?.[f.id]) > 0)
      .map((f) => `${f.name} -${res.penalties[f.id]}`)
      .join("、");
    tail.push(`风险扣 ${penalty}：${hit}`);
  }
  return tail.length ? `${res.score} 分（${detail}；${tail.join("；")}）` : `${res.score} 分（${detail}）`;
}
