/**
 * paperPatterns — 模拟盘「战法识别」纯函数层
 *
 * 只做识别与打分，不做撮合、不改账户：输出某只票在某一天的战法适配度，
 * 由 `paperScore.js` 汇总成「共振加分」，最终**只在下单面板的「参考打分」卡展示**。
 * 模拟盘已改为手动交易，战法与打分都不参与任何成交判定（§7.35）。
 *
 * 口径（与 §7.35 一致）：
 * - 全部只吃**截至信号日**的日 K（调用方负责截断，本模块不再二次切片）
 * - 适配度 0-100，`hit` = 硬条件成立且适配度 ≥ `PATTERN_HIT_FIT`(60)
 * - 硬条件不成立时 fit 一律 0（不靠软条件凑分）：
 *     一进二   —— D 日（信号日）必须是**首板涨停**（前一交易日未涨停）
 *     突破缩量 —— D 日收盘必须**创 20 日新高** 且量比 ≤0.95
 *     低吸放量 —— D 日必须处在**回调区间**（从 10 日高点回撤 3%~25%）且当日收阳
 *     趋势跟随 —— 必须**短期均线多头排列**
 *     一夜持股 —— 必须**当日收阳、收盘贴当日最高**、且**未涨停**（涨停尾盘买不进）
 * - 「一夜持股」只做识别、不做撮合：手动盘里「尾盘买、次日开盘卖」由用户自己下单，
 *   战法层只判断「今天收盘这个形态适不适合持股过夜」，不产生任何委托（§7.35）
 *
 * 为什么战法只做「加成」不做「门槛」：门槛会让「像某个战法」变成硬条件，
 * 弱市里参考分整月偏低、失去区分度；加成保留因子分的打分基础，只在多战法同时成立时给奖励。
 */
import { sma } from "./indicators.js";
import { atrPctOf, clamp, curve, round1 } from "./scoreMath.js";
import { getLimitPrices } from "./paperRules.js";

/** 战法命中门槛（适配度） */
export const PATTERN_HIT_FIT = 60;

/** 单战法清单（顺序即 UI 展示顺序） */
export const PATTERNS = Object.freeze([
  {
    id: "trendFollow",
    name: "趋势跟随",
    hint: "MA5>MA10>MA20 且 MA20 上翘，价格贴线上行",
    needs: "短期均线多头排列",
  },
  {
    id: "oneToTwo",
    name: "一进二",
    hint: "信号日首板涨停、非一字板、量能健康，博次日再板",
    needs: "首板涨停（前一交易日未涨停）",
  },
  {
    id: "breakoutVolume",
    name: "突破缩量",
    hint: "收盘创 20 日新高且量能收缩（抛压小）",
    needs: "收盘创 20 日新高 且 量比 ≤0.95",
  },
  {
    id: "dipVolume",
    name: "低吸放量",
    hint: "回调到均线附近后放量止跌收阳",
    needs: "从 10 日高点回撤 3%~25%",
  },
  {
    id: "overnightHold",
    name: "一夜持股",
    hint: "尾盘强势收阳（收盘贴当日最高）、温和上涨、量能健康，博次日开盘溢价",
    needs: "收阳 且 收盘位于当日振幅上部 且 未涨停",
    /**
     * 不参与共振加分：它描述的是「怎么拿」（尾盘买、次日开盘卖），不是「这票有多强」。
     * 计入共振会让任何温和上涨的票无差别 +3（趋势里的强势收盘太常见），
     * 加成也就失去了区分度。它照常显示、照常给适配度，只是不算共振项。
     */
    countsForResonance: false,
  },
]);

/** 战法共振加成的单档值与上限（命中 1 个不加成，2 个起才叫共振） */
export const PATTERN_BONUS_STEP = 3;
export const PATTERN_BONUS_MAX = 9;

/** 涨停价（A 股按板块幅度；港股/无效返回 null） */
function limitUpper(code, prevClose) {
  const { upper } = getLimitPrices(code, prevClose);
  return upper != null && upper > 0 ? upper : null;
}

/** 是否收在涨停（容忍半跳误差，与 paperRules 的判据一致） */
function atLimit(close, upper) {
  if (upper == null) return false;
  return Number(close) >= upper - 0.005;
}

/** 统一的空结果（硬条件不成立时用，evidence 写清为什么不成立） */
function empty(id, name, reason) {
  return { id, name, fit: 0, hit: false, evidence: reason ? [reason] : [] };
}

/**
 * 趋势跟随
 * 排列 40 + MA20 斜率 25 + 位置 20 + 强度 15
 */
function detectTrendFollow(ctx) {
  const { closes, ma5, ma10, ma20, i, code } = ctx;
  const meta = PATTERNS[0];
  if (ma20[i] == null || i < 25) return empty(meta.id, meta.name, "K 线不足以计算均线");

  const aligned = ma5[i] > ma10[i] && ma10[i] > ma20[i];
  if (!aligned) return empty(meta.id, meta.name, "均线未形成多头排列");

  let fit = 0;
  const ev = [];
  fit += 20; // MA5 > MA10
  fit += 20; // MA10 > MA20
  ev.push("MA5>MA10>MA20");

  const slopePct = ma20[i - 5] > 0 ? ((ma20[i] / ma20[i - 5]) - 1) * 100 : 0;
  fit += 25 * clamp(slopePct / 1.5, 0, 1);
  ev.push(`MA20 五日 ${slopePct >= 0 ? "+" : ""}${slopePct.toFixed(2)}%`);

  const dev = ((closes[i] / ma20[i]) - 1) * 100;
  fit += curve(dev, [
    [-10, 0],
    [0, 16],
    [5, 20],
    [10, 14],
    [18, 2],
    [25, 0],
  ]);
  ev.push(`偏离 MA20 ${dev >= 0 ? "+" : ""}${dev.toFixed(1)}%`);

  const ret20 = i >= 20 && closes[i - 20] > 0 ? (closes[i] / closes[i - 20] - 1) * 100 : 0;
  fit += curve(ret20, [
    [0, 0],
    [5, 10],
    [10, 15],
    [30, 15],
    [45, 6],
    [60, 0],
  ]);
  ev.push(`20 日涨幅 ${ret20.toFixed(1)}%`);

  const f = round1(clamp(fit, 0, 100));
  return {
    id: meta.id,
    name: meta.name,
    fit: f,
    hit: f >= PATTERN_HIT_FIT && slopePct > 0,
    evidence: ev,
    code,
  };
}

/**
 * 一进二
 * 硬条件：信号日（D）涨停 且 D-1 未涨停（首板）
 * 基础 40 + 量能 25 + 非一字 15 + 位置 20
 *
 * 注意：引擎在 D 日收盘出单、D+1 开盘买入，所以「信号日首板 → 次日博二板」的语义是吻合的；
 * 若次日一字涨停买不进，`paperRules.canFill` 会记 skipped，不会假成交。
 */
function detectOneToTwo(ctx) {
  const { closes, lows, vols, volMa20, i, code } = ctx;
  const meta = PATTERNS[1];
  if (i < 2) return empty(meta.id, meta.name, "K 线不足");

  // D 日涨停：需要 D-1 收盘作为昨收
  const dPrevClose = closes[i - 1];
  const dUpper = limitUpper(code, dPrevClose);
  if (!atLimit(closes[i], dUpper)) return empty(meta.id, meta.name, "信号日未涨停");

  // 首板：D-1 不能也是涨停
  const d1PrevClose = closes[i - 2];
  const d1Upper = limitUpper(code, d1PrevClose);
  if (atLimit(closes[i - 1], d1Upper)) return empty(meta.id, meta.name, "前一日已涨停（非首板）");

  let fit = 40;
  const ev = ["首板涨停"];

  const vr = volMa20[i] > 0 ? vols[i] / volMa20[i] : null;
  fit += vr == null
    ? 12
    : curve(vr, [
        [1.0, 5],
        [1.5, 20],
        [2.5, 25],
        [4, 10],
        [6, 0],
      ]);
  if (vr != null) ev.push(`量比 ${vr.toFixed(2)}`);

  // 一字板（最低价即涨停）→ 次日大概率也买不进，识别上降权但不判死
  const oneWord = dUpper != null && Number(lows[i]) >= dUpper - 0.005;
  fit += oneWord ? 0 : 15;
  ev.push(oneWord ? "一字板（次日难成交）" : "非一字板");

  const ret5 = i >= 6 && closes[i - 6] > 0 ? (closes[i] / closes[i - 6] - 1) * 100 : null;
  fit += ret5 == null
    ? 10
    : curve(ret5, [
        [0, 12],
        [15, 20],
        [30, 14],
        [45, 4],
        [60, 0],
      ]);
  if (ret5 != null) ev.push(`5 日涨幅 ${ret5.toFixed(1)}%`);

  const f = round1(clamp(fit, 0, 100));
  return { id: meta.id, name: meta.name, fit: f, hit: f >= PATTERN_HIT_FIT, evidence: ev, code };
}

/**
 * 突破缩量
 * 硬条件：收盘 > 前 20 日最高价（用 high，比收盘价更严格）
 * 基础 45 + 量能 40 + 突破幅度 15
 */
function detectBreakoutVolume(ctx) {
  const { closes, highs, vols, volMa20, i, code } = ctx;
  const meta = PATTERNS[2];
  if (i < 21) return empty(meta.id, meta.name, "K 线不足 21 根");

  const from = i - 20;
  let priorHigh = 0;
  for (let k = from; k < i; k++) {
    const h = Number(highs[k]);
    if (Number.isFinite(h) && h > priorHigh) priorHigh = h;
  }
  if (!(priorHigh > 0)) return empty(meta.id, meta.name, "前 20 日无有效高点");
  if (closes[i] <= priorHigh) return empty(meta.id, meta.name, "未创 20 日新高");

  const fitBase = 45;
  const ev = [`突破前高 ${priorHigh.toFixed(2)}`];

  const vr = volMa20[i] > 0 ? vols[i] / volMa20[i] : null;
  // 硬条件之二：必须是**缩量**（量比 ≤0.95）。没有量能参照或放量突破都不算这个战法，
  // 否则「放量突破」也会被算成「缩量突破」，战法名字就名不副实了
  if (vr == null) return empty(meta.id, meta.name, "无量能参照，无法判断是否缩量");
  if (vr > 0.95) return empty(meta.id, meta.name, `量比 ${vr.toFixed(2)}，未缩量`);

  const volScore = curve(vr, [
    [0.3, 8],
    [0.6, 30],
    [0.85, 40],
    [0.95, 30],
  ]);
  ev.push(`量比 ${vr.toFixed(2)}（缩量）`);

  const bp = ((closes[i] / priorHigh) - 1) * 100;
  const bpScore = curve(bp, [
    [0, 15],
    [3, 15],
    [8, 6],
    [15, 0],
  ]);
  ev.push(`突破幅度 ${bp.toFixed(1)}%`);

  const f = round1(clamp(fitBase + volScore + bpScore, 0, 100));
  return { id: meta.id, name: meta.name, fit: f, hit: f >= PATTERN_HIT_FIT, evidence: ev, code };
}

/**
 * 低吸放量
 * 硬条件：处于回调区间（从 10 日最高价回撤 3%~25%）
 * 回撤 30 + 放量 25 + 止跌 25 + 均线位置 20
 */
function detectDipVolume(ctx) {
  const { closes, opens, highs, ma20, vols, volMa20, i, code } = ctx;
  const meta = PATTERNS[3];
  if (i < 20) return empty(meta.id, meta.name, "K 线不足 20 根");

  let high10 = 0;
  for (let k = Math.max(0, i - 9); k <= i; k++) {
    const h = Number(highs[k]);
    if (Number.isFinite(h) && h > high10) high10 = h;
  }
  if (!(high10 > 0)) return empty(meta.id, meta.name, "近 10 日无有效高点");

  const dd = ((high10 - closes[i]) / high10) * 100;
  if (dd < 3 || dd > 25) return empty(meta.id, meta.name, `回撤 ${dd.toFixed(1)}% 不在 3%~25% 区间`);
  // 硬条件之二：当日必须收阳。下跌途中「还没止跌」的阴线不算低吸信号，
  // 否则单边下跌段会持续拿到 20 多分的部分适配度（虽然不命中，但语义已经错了）
  if (!(closes[i] > opens[i])) return empty(meta.id, meta.name, "当日未收阳，不构成低吸信号");

  let fit = curve(dd, [
    [3, 0],
    [6, 20],
    [10, 30],
    [16, 28],
    [25, 6],
  ]);
  const ev = [`距 10 日高点 -${dd.toFixed(1)}%`];

  const vr = volMa20[i] > 0 ? vols[i] / volMa20[i] : null;
  fit += vr == null
    ? 8
    : curve(vr, [
        [0.7, 0],
        [1.3, 16],
        [2, 25],
        [3, 12],
        [5, 0],
      ]);
  if (vr != null) ev.push(`量比 ${vr.toFixed(2)}`);

  const prevClose = closes[i - 1];
  const up = prevClose > 0 && closes[i] >= prevClose;
  fit += up ? 25 : 12;
  ev.push(up ? "放量收阳" : "收阳但未收复昨收");

  const dev = ma20[i] > 0 ? ((closes[i] / ma20[i]) - 1) * 100 : null;
  fit += dev == null
    ? 0
    : curve(dev, [
        [-12, 0],
        [-5, 8],
        [0, 18],
        [5, 20],
        [10, 10],
        [18, 0],
      ]);
  if (dev != null) ev.push(`偏离 MA20 ${dev >= 0 ? "+" : ""}${dev.toFixed(1)}%`);

  const f = round1(clamp(fit, 0, 100));
  return { id: meta.id, name: meta.name, fit: f, hit: f >= PATTERN_HIT_FIT, evidence: ev, code };
}

/**
 * 一夜持股
 * 硬条件：当日收阳 且 收盘位于当日振幅上部（≥65%） 且 未涨停
 * 尾盘强度 30 + 量能 20 + 趋势不破 20 + 位置安全 20 + 隔夜风险 10
 *
 * 为什么要求「未涨停」：涨停板上尾盘买不进（与引擎的涨跌停口径一致），
 * 且次日溢价完全取决于封单强弱，日线无法判断——宁可判不命中，也不给一个买不到的信号。
 * 「位置安全」与「隔夜风险」是隔夜战法的特有项：隔夜最怕的是「高位追进去、第二天低开」。
 */
function detectOvernightHold(ctx) {
  const { closes, opens, highs, lows, vols, volMa20, ma5, ma10, ma20, i, code } = ctx;
  const meta = PATTERNS[4];
  if (i < 20) return empty(meta.id, meta.name, "K 线不足 20 根");

  const close = Number(closes[i]);
  const open = Number(opens[i]);
  const high = Number(highs[i]);
  const low = Number(lows[i]);
  const prevClose = Number(closes[i - 1]);

  if (!(close > open)) return empty(meta.id, meta.name, "当日未收阳，尾盘不构成持股条件");

  const range = high - low;
  const posInRange = range > 0 ? (close - low) / range : 1;
  if (posInRange < 0.65) {
    return empty(meta.id, meta.name, `收盘在当日振幅 ${(posInRange * 100).toFixed(0)}% 处，尾盘不够强`);
  }

  // 涨停检查必须排在「涨幅过大」之前：涨停的原因是「买不进」，不是「追高」
  const upper = limitUpper(code, prevClose);
  if (atLimit(close, upper)) return empty(meta.id, meta.name, "已涨停：尾盘买不进，次日溢价不可判");

  const dayRet = prevClose > 0 ? ((close / prevClose) - 1) * 100 : 0;
  if (dayRet > 6) return empty(meta.id, meta.name, `当日涨 ${dayRet.toFixed(1)}%，隔夜追高风险过大`);

  const ev = [`收盘在振幅 ${(posInRange * 100).toFixed(0)}%`, `当日 ${dayRet >= 0 ? "+" : ""}${dayRet.toFixed(1)}%`];

  // 尾盘强度 30：收盘越贴最高越好（18）+ 当日涨幅温和最好（12）
  let fit = 18 * clamp((posInRange - 0.65) / 0.3, 0, 1);
  fit += curve(dayRet, [
    [-1, 0],
    [0, 6],
    [1.5, 12],
    [3, 12],
    [5, 8],
    [6, 4],
  ]);

  // 量能 20：1.0~2.2 倍最健康（缩量说明没人接力，天量怕是出货）
  const vr = volMa20[i] > 0 ? vols[i] / volMa20[i] : null;
  fit += vr == null
    ? 8
    : curve(vr, [
        [0.6, 2],
        [1.0, 12],
        [1.5, 20],
        [2.2, 16],
        [3.5, 6],
        [5, 0],
      ]);
  if (vr != null) ev.push(`量比 ${vr.toFixed(2)}`);

  // 趋势不破 20：站上 MA5 12 分 + MA5 在 MA10 上方 8 分
  if (ma5[i] != null && close >= ma5[i]) fit += 12;
  if (ma5[i] != null && ma10[i] != null && ma5[i] > ma10[i]) fit += 8;
  if (ma5[i] != null) ev.push(close >= ma5[i] ? "站上 MA5" : "跌破 MA5");

  // 位置安全 20：贴近或其他小幅偏离 MA20 最好，追高递减
  const dev = ma20[i] > 0 ? ((close / ma20[i]) - 1) * 100 : null;
  fit += dev == null
    ? 0
    : curve(dev, [
        [-8, 0],
        [-3, 10],
        [0, 18],
        [5, 20],
        [10, 12],
        [18, 0],
      ]);
  if (dev != null) ev.push(`偏离 MA20 ${dev >= 0 ? "+" : ""}${dev.toFixed(1)}%`);

  // 隔夜风险 10：ATR14 占价格越低，跳空风险越小
  const atr = atrPctOf(highs, lows, closes, i);
  fit += atr == null
    ? 4
    : curve(atr, [
        [1.5, 10],
        [3, 8],
        [5, 4],
        [8, 0],
      ]);
  if (atr != null) ev.push(`ATR ${atr.toFixed(1)}%`);

  const f = round1(clamp(fit, 0, 100));
  return { id: meta.id, name: meta.name, fit: f, hit: f >= PATTERN_HIT_FIT, evidence: ev, code };
}

/**
 * 识别全部战法
 *
 * @param {Array<{date:string, open:number, high:number, low:number, close:number, volume:number}>} bars
 *   升序、且**已截断到信号日**的日 K（调用方负责防前视）
 * @param {string} [code] 股票代码（涨停幅度按板块判定，走 `utils/limit.js`）
 * @returns {Array<{ id:string, name:string, fit:number, hit:boolean, evidence:string[], code?:string }>}
 */
export function detectPatterns(bars, code = "") {
  const clean = (Array.isArray(bars) ? bars : []).filter((b) => b && Number(b.close) > 0);
  if (clean.length < 25) {
    return PATTERNS.map((p) => empty(p.id, p.name, "K 线不足以识别战法"));
  }

  const closes = clean.map((b) => Number(b.close) || 0);
  const opens = clean.map((b) => Number(b.open) || Number(b.close) || 0);
  const highs = clean.map((b) => Number(b.high) || Number(b.close) || 0);
  const lows = clean.map((b) => Number(b.low) || Number(b.close) || 0);
  const vols = clean.map((b) => Number(b.volume) || 0);

  const ctx = {
    code: String(code ?? ""),
    i: clean.length - 1,
    closes,
    opens,
    highs,
    lows,
    vols,
    ma5: sma(closes, 5),
    ma10: sma(closes, 10),
    ma20: sma(closes, 20),
    volMa20: sma(vols, 20),
  };

  return [detectTrendFollow, detectOneToTwo, detectBreakoutVolume, detectDipVolume, detectOvernightHold].map((fn) => {
    try {
      return fn(ctx);
    } catch (e) {
      // 单只票的战法识别异常不能拖垮整轮跑批
      return empty("", "", "识别异常");
    }
  });
}

/**
 * 命中的战法（供引擎/UI 直接取用）
 * @param {Array} patterns detectPatterns 的结果
 * @returns {Array} 命中项
 */
export function hitPatterns(patterns) {
  return (Array.isArray(patterns) ? patterns : []).filter((p) => p && p.hit);
}

/**
 * 战法共振加成：命中 1 个不加成（单一战法属常态），2 个起每多一个 +3，最多 +9
 *
 * 「一夜持股」不计入（`countsForResonance: false`）：它描述持有节奏而非选股强度，
 * 算进来会让每个「趋势里的强势收盘」都无差别 +3，加成失去区分度。
 *
 * @param {Array} patterns
 * @returns {number}
 */
export function patternBonusOf(patterns) {
  const counting = new Set(
    PATTERNS.filter((p) => p.countsForResonance !== false).map((p) => p.id)
  );
  const n = hitPatterns(patterns).filter((p) => counting.has(p.id)).length;
  if (n < 2) return 0;
  return Math.min(PATTERN_BONUS_MAX, PATTERN_BONUS_STEP * (n - 1));
}
