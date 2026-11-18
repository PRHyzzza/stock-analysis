/**
 * useSignalBacktest — 基于本地历史日 K 的信号回测与胜率统计
 *
 * 说明（重要）：现有 `useT0Signals` / `useVolumeSignals` / `useTrapSignals` 的规则全部依赖
 * **分时数据**（日内时间序列），而本地历史库只沉淀日 K 与行情快照，因此无法直接对它们回测。
 * 本模块只回测**日线级**规则（复用 useTechIndicators / useSupportResistance 的纯函数），
 * 日内信号要回测需另行落库分时数据（后续可扩展）。
 *
 * 规则分三组：超短线（1~3 日情绪/打板/形态）、趋势（均线与 MACD）、量价（量能与突破）。
 *
 * 统计口径：固定持有期（1/3/5/10/20/30 交易日），**非重叠交易**（持有期内不再开仓），
 * 单笔收益 = 持有期末收盘价 / 信号日收盘价 - 1；胜率 = 盈利笔数 /（盈利 + 亏损笔数），
 * 平盘（收益恰为 0）单列 `flats`、不进退分母。
 * 样本 < MIN_SAMPLE 时由 UI 标注「样本不足」，不下结论。
 *
 * 三条防误读的口径（UI 必须如实标注，PROJECT.md §7.19）：
 *   1. `winRateLower` —— 胜率的 Wilson 95% 置信下界。3 笔全胜的 100% 胜率下界只有 ~44%，
 *      用它排序/阅读才不会把小样本运气当成优势。
 *   2. `benchmark` —— 同一区间「不看信号、逐日买入并持有 N 日」的平均收益与胜率。
 *      `excess` = 规则平均收益 − 基准平均收益（百分点），回答「这个信号有没有超额」。
 *   3. `avgMfe` / `avgMae` —— 持有窗口内（入场后第 1 根 ~ 第 N 根）平均最大浮盈 / 平均最大浮亏，
 *      回答「超短线有没有足够的止盈空间、回撤有多深」，与最终收益相互独立。
 */
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getFuyaoKey } from "../utils/fuyao.js";
import { calcMACD, calcKDJ, calcRSI } from "./useTechIndicators.js";
import { calcSupportResistance } from "./useSupportResistance.js";
import { getLimitPct } from "../utils/limit.js";
import { sma } from "../utils/indicators.js";

/** 统计的持有期（交易日）—— 1/3 为超短线，5/10 为短线波段，20/30 为中线 */
export const HOLD_PERIODS = [1, 3, 5, 10, 20, 30];
/** 少于该笔数视为样本不足 */
export const MIN_SAMPLE = 10;
/** 低于该根数不做回测（MA20/量能均值等规则需要足够预热） */
const MIN_BARS = 60;
/** 回测起始下标：预留 60 根做指标与阻力位预热 */
const START_INDEX = 60;
/** Wilson 置信区间的 z 值（95%） */
const WILSON_Z = 1.96;

/** 规则分组（UI 按组筛选；顺序即表格内的默认分组顺序） */
export const RULE_GROUPS = [
  { id: "ultra", name: "超短线", hint: "1~3 个交易日的情绪/打板/形态类信号" },
  { id: "trend", name: "趋势", hint: "均线与 MACD 的趋势确认类信号" },
  { id: "volume", name: "量价", hint: "量能放大与关键位突破类信号" },
];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 把指标序列补齐到与 K 线等长（指标数组通常从第 period 根才开始有值） */
function alignToLength(series, length) {
  const out = new Array(length).fill(null);
  const offset = length - series.length;
  for (let i = 0; i < series.length; i++) {
    if (offset + i >= 0) out[offset + i] = series[i];
  }
  return out;
}

/** 一次性计算所有规则共用的指标，避免逐规则重复运算 */
function prepareIndicators(bars, code) {
  const closes = bars.map((b) => num(b.close));
  const volumes = bars.map((b) => num(b.volume));
  return {
    closes,
    macd: alignToLength(calcMACD(closes), closes.length),
    kdj: alignToLength(calcKDJ(bars), closes.length),
    rsi: alignToLength(calcRSI(closes, 14), closes.length),
    ma5: sma(closes, 5),
    ma10: sma(closes, 10),
    ma20: sma(closes, 20),
    volMa5: sma(volumes, 5),
    volMa20: sma(volumes, 20),
    // 回测按板块口径取涨跌停幅度（ST 与所属板块一致，无需名称）
    limitPct: getLimitPct(code),
  };
}

/** 前一日收盘 → 当日收盘涨跌幅（%） */
function dayChangePct(bars, i) {
  if (i < 1) return null;
  const prev = num(bars[i - 1]?.close);
  const cur = num(bars[i]?.close);
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

/**
 * 是否「收盘封涨停」：涨幅达到涨停幅度（留 3% 容差覆盖四舍五入）且收盘价贴着当日最高价。
 * 未封板（冲高回落）不算——那是「逼近涨停」规则的事。
 */
function isLimitUpBar(bars, i, limitPct) {
  if (!(limitPct > 0)) return false; // 港股无涨跌停
  const chg = dayChangePct(bars, i);
  if (chg == null) return false;
  const close = num(bars[i].close);
  const high = num(bars[i].high);
  if (close <= 0 || high <= 0) return false;
  return chg >= limitPct * 0.97 && close >= high * 0.9995;
}

/** 第 i 根是否收阴（收盘 < 开盘） */
function isBearBar(bars, i) {
  return num(bars[i]?.close) < num(bars[i]?.open);
}

/** 日线级规则集（每条规则只判断「第 i 根 K 线是否触发」） */
export const RULES = [
  // ---------------------------------------------------------------- 超短线
  {
    id: "limit_up_first",
    group: "ultra",
    name: "首板涨停",
    hint: "收盘封涨停、且前一日未涨停（情绪启动首日）",
    detect: (i, bars, ind) =>
      isLimitUpBar(bars, i, ind.limitPct) && !isLimitUpBar(bars, i - 1, ind.limitPct),
  },
  {
    id: "limit_up_second",
    group: "ultra",
    name: "连板（二板及以上）",
    hint: "今日与昨日均收盘封涨停，接力情绪延续",
    detect: (i, bars, ind) =>
      isLimitUpBar(bars, i, ind.limitPct) && isLimitUpBar(bars, i - 1, ind.limitPct),
  },
  {
    id: "gap_up",
    group: "ultra",
    name: "跳空高开缺口",
    hint: "最低价高于昨日最高价 0.5% 以上且收涨 >1%（缺口未回补）",
    detect: (i, bars) => {
      if (i < 1) return false;
      const low = num(bars[i].low);
      const prevHigh = num(bars[i - 1].high);
      if (low <= 0 || prevHigh <= 0) return false;
      const chg = dayChangePct(bars, i);
      if (chg == null) return false;
      return low > prevHigh * 1.005 && chg > 1;
    },
  },
  {
    id: "hammer_shadow",
    group: "ultra",
    name: "长下影锤子线",
    hint: "下影线 ≥ 全幅 50% 且实体 ≤ 全幅 35%（下方有承接）",
    detect: (i, bars) => {
      const high = num(bars[i].high);
      const low = num(bars[i].low);
      const open = num(bars[i].open);
      const close = num(bars[i].close);
      const range = high - low;
      if (range <= 0 || open <= 0 || close <= 0) return false;
      const body = Math.abs(close - open);
      const lower = Math.min(open, close) - low;
      return lower >= range * 0.5 && body <= range * 0.35;
    },
  },
  {
    id: "bullish_engulf",
    group: "ultra",
    name: "阳包阴反包",
    hint: "前一根收阴，今日收阳且实体完全吞没前一根实体",
    detect: (i, bars) => {
      if (i < 1) return false;
      const prev = bars[i - 1];
      if (!isBearBar(bars, i - 1)) return false;
      const open = num(bars[i].open);
      const close = num(bars[i].close);
      if (close <= open) return false;
      return open <= num(prev.close) && close >= num(prev.open);
    },
  },
  {
    id: "shrink_pullback_ma5",
    group: "ultra",
    name: "缩量回踩 MA5",
    hint: "最低价触及 MA5、收盘不破 MA5×0.985，量 ≤ 0.8×5 日均量，MA5 未走平下弯",
    detect: (i, bars, ind) => {
      if (i < 2) return false;
      const { ma5, ma10, volMa5 } = ind;
      if (ma5[i] == null || ma5[i - 1] == null || volMa5[i - 1] == null) return false;
      const low = num(bars[i].low);
      const close = num(bars[i].close);
      const vol = num(bars[i].volume);
      if (low <= 0 || close <= 0) return false;
      const touched = low <= ma5[i] && num(bars[i].high) >= ma5[i];
      return (
        touched &&
        close >= ma5[i] * 0.985 &&
        ma5[i] >= ma5[i - 1] &&
        (ma10[i] == null || ma5[i] > ma10[i]) &&
        vol > 0 &&
        vol <= 0.8 * volMa5[i - 1]
      );
    },
  },
  {
    id: "high_5d_break",
    group: "ultra",
    name: "5 日新高突破",
    hint: "收盘价高于前 5 根的最高价（超短突破口径）",
    detect: (i, bars) => {
      if (i < 5) return false;
      const close = num(bars[i].close);
      if (close <= 0) return false;
      let maxHigh = 0;
      for (let j = i - 5; j < i; j++) maxHigh = Math.max(maxHigh, num(bars[j].high));
      return maxHigh > 0 && close > maxHigh;
    },
  },
  {
    id: "three_down_then_up",
    group: "ultra",
    name: "三连阴后首阳",
    hint: "连续 3 根收阴后今日收阳且收盘高于昨收（超跌反抽）",
    detect: (i, bars) => {
      if (i < 4) return false;
      for (let j = i - 3; j < i; j++) if (!isBearBar(bars, j)) return false;
      return !isBearBar(bars, i) && num(bars[i].close) > num(bars[i - 1].close);
    },
  },
  {
    id: "near_limit_up",
    group: "ultra",
    name: "逼近涨停",
    hint: "涨幅 ≥ 涨停幅度的 70% 但未封板（港股无涨跌停，不适用）",
    detect: (i, bars, ind) => {
      if (!ind.limitPct) return false;
      const chg = dayChangePct(bars, i);
      if (chg == null) return false;
      return chg >= ind.limitPct * 0.7;
    },
  },

  // ---------------------------------------------------------------- 趋势
  {
    id: "ma_cross",
    group: "trend",
    name: "MA5 上穿 MA10",
    hint: "短均线金叉，趋势转折的最基础信号",
    detect: (i, bars, ind) => {
      const { ma5, ma10 } = ind;
      if (ma5[i - 1] == null || ma10[i - 1] == null || ma5[i] == null || ma10[i] == null) return false;
      return ma5[i - 1] <= ma10[i - 1] && ma5[i] > ma10[i];
    },
  },
  {
    id: "ma5_cross_ma20",
    group: "trend",
    name: "MA5 上穿 MA20",
    hint: "中期均线金叉，比 MA5×MA10 更稳、更慢",
    detect: (i, bars, ind) => {
      const { ma5, ma20 } = ind;
      if (ma5[i - 1] == null || ma20[i - 1] == null || ma5[i] == null || ma20[i] == null) return false;
      return ma5[i - 1] <= ma20[i - 1] && ma5[i] > ma20[i];
    },
  },
  {
    id: "ma_stack",
    group: "trend",
    name: "多头排列成立",
    hint: "MA5 > MA10 > MA20 首次形成",
    detect: (i, bars, ind) => {
      const { ma5, ma10, ma20 } = ind;
      if (ma5[i - 1] == null || ma10[i - 1] == null || ma20[i - 1] == null) return false;
      if (ma5[i] == null || ma10[i] == null || ma20[i] == null) return false;
      const now = ma5[i] > ma10[i] && ma10[i] > ma20[i];
      const prev = ma5[i - 1] > ma10[i - 1] && ma10[i - 1] > ma20[i - 1];
      return now && !prev;
    },
  },
  {
    id: "macd_cross",
    group: "trend",
    name: "MACD 金叉",
    hint: "DIF 上穿 DEA",
    detect: (i, bars, ind) => {
      const a = ind.macd[i - 1];
      const b = ind.macd[i];
      if (!a || !b) return false;
      return a.dif <= a.dea && b.dif > b.dea;
    },
  },
  {
    id: "macd_zero_cross",
    group: "trend",
    name: "MACD 零轴上方金叉",
    hint: "DIF 上穿 DEA 且 DIF > 0（强势区金叉，比普通金叉少而精）",
    detect: (i, bars, ind) => {
      const a = ind.macd[i - 1];
      const b = ind.macd[i];
      if (!a || !b) return false;
      return a.dif <= a.dea && b.dif > b.dea && b.dif > 0;
    },
  },
  {
    id: "kdj_low_cross",
    group: "trend",
    name: "KDJ 低位金叉",
    hint: "K 上穿 D 且 K < 30（超卖区反弹）",
    detect: (i, bars, ind) => {
      const a = ind.kdj[i - 1];
      const b = ind.kdj[i];
      if (!a || !b) return false;
      return a.k <= a.d && b.k > b.d && b.k < 30;
    },
  },
  {
    id: "rsi_recover",
    group: "trend",
    name: "RSI14 上穿 30",
    hint: "超卖区回升",
    detect: (i, bars, ind) => {
      const prev = ind.rsi[i - 1];
      const cur = ind.rsi[i];
      if (prev == null || cur == null) return false;
      return prev <= 30 && cur > 30;
    },
  },
  {
    id: "break_resistance",
    group: "trend",
    name: "突破前高阻力位",
    hint: "收盘价上破近 60 日波段高点/斐波那契阻力",
    detect: (i, bars) => {
      if (i < START_INDEX + 1) return false;
      // 只用信号日之前的数据，避免用到未来信息
      const { resistance } = calcSupportResistance(bars.slice(i - 60, i));
      if (!resistance.length) return false;
      const nearest = Math.min(...resistance.map((r) => num(r.price)));
      if (!(nearest > 0)) return false;
      const prevClose = num(bars[i - 1].close);
      return prevClose <= nearest && num(bars[i].close) > nearest;
    },
  },

  // ---------------------------------------------------------------- 量价
  {
    id: "volume_surge",
    group: "volume",
    name: "放量上涨",
    hint: "成交量 ≥ 1.8× 前 20 日均量 且 涨幅 > 2%",
    detect: (i, bars, ind) => {
      const vm = ind.volMa20[i - 1];
      if (vm == null || vm <= 0) return false;
      const chg = dayChangePct(bars, i);
      if (chg == null) return false;
      return num(bars[i].volume) >= 1.8 * vm && chg > 2;
    },
  },
  {
    id: "volume_stair",
    group: "volume",
    name: "连续三日放量",
    hint: "成交量逐日递增、当日 ≥ 1.2× 前 5 日均量，且累计收涨 > 2%",
    detect: (i, bars, ind) => {
      if (i < 4) return false;
      const v0 = num(bars[i - 2].volume);
      const v1 = num(bars[i - 1].volume);
      const v2 = num(bars[i].volume);
      if (!(v0 > 0 && v1 > v0 && v2 > v1)) return false;
      const vm5 = ind.volMa5[i - 1];
      if (vm5 == null || vm5 <= 0 || v2 < 1.2 * vm5) return false;
      const base = num(bars[i - 3].close);
      if (base <= 0) return false;
      return ((num(bars[i].close) - base) / base) * 100 > 2;
    },
  },
];

/**
 * 胜率的 Wilson 95% 置信下界（%）。
 * 样本少时下界会显著低于点估计，避免「3 笔全胜 = 100% 胜率」被当成优势。
 * @returns {number|null} 无有效样本时返回 null
 */
export function wilsonLower(wins, decided) {
  if (!decided || decided <= 0 || wins < 0) return null;
  const p = wins / decided;
  const n = decided;
  const z2 = WILSON_Z * WILSON_Z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = WILSON_Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, ((centre - margin) / denom) * 100);
}

/** 单笔交易的统计汇总 */
function summarize(trades) {
  const n = trades.length;
  if (n === 0) {
    return {
      trades: 0,
      decided: 0,
      flats: 0,
      winRate: null,
      winRateLower: null,
      expectancy: null,
      avgRet: null,
      avgWin: null,
      avgLoss: null,
      avgMfe: null,
      avgMae: null,
      best: null,
      worst: null,
      maxDrawdown: null,
      totalReturn: null,
    };
  }

  let wins = 0;
  let losses = 0;
  let flats = 0;
  let sum = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let best = -Infinity;
  let worst = Infinity;
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let mfeSum = 0;
  let mfeCount = 0;
  let maeSum = 0;
  let maeCount = 0;

  for (const t of trades) {
    const r = num(t.ret);
    sum += r;
    if (r > 0) {
      wins += 1;
      grossWin += r;
    } else if (r < 0) {
      losses += 1;
      grossLoss += r;
    } else {
      flats += 1; // 平盘：不进退分母（否则 4 胜 4 负 2 平会被摊成 40%）
    }
    if (r > best) best = r;
    if (r < worst) worst = r;
    if (t.mfe != null) {
      mfeSum += t.mfe;
      mfeCount += 1;
    }
    if (t.mae != null) {
      maeSum += t.mae;
      maeCount += 1;
    }
    equity *= 1 + r / 100;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const decided = wins + losses;
  return {
    trades: n,
    decided, // 真正参与胜率计算的笔数（= 胜 + 负，不含平盘）
    flats,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    winRateLower: wilsonLower(wins, decided),
    avgRet: sum / n,
    expectancy: sum / n,
    avgWin: wins ? grossWin / wins : null,
    avgLoss: losses ? grossLoss / losses : null,
    avgMfe: mfeCount ? mfeSum / mfeCount : null,
    avgMae: maeCount ? maeSum / maeCount : null,
    best,
    worst,
    maxDrawdown: maxDd,
    totalReturn: (equity - 1) * 100,
  };
}

/**
 * 基准：不看任何信号，逐日买入并持有 hold 个交易日的平均收益与胜率。
 * 用来判断规则是不是「只是搭了大盘/该股自身趋势的顺风车」。
 * @param {Array} bars 日 K（升序）
 * @param {number} hold 持有交易日数
 * @param {number} [startIndex] 起始下标：回测口径下传 START_INDEX，与规则触发区间对齐
 *   （否则基准会多算预热段那几十笔，两侧窗口不一致，超额失去可比性）
 */
export function benchmarkFor(bars, hold, startIndex = 0) {
  const closes = bars.map((b) => num(b.close));
  const from = Math.max(0, Math.min(startIndex, closes.length - 1));
  const rets = [];
  for (let i = from; i + hold < closes.length; i++) {
    if (closes[i] > 0) rets.push(((closes[i + hold] - closes[i]) / closes[i]) * 100);
  }
  if (!rets.length) return { samples: 0, avgRet: null, winRate: null };
  const sum = rets.reduce((a, b) => a + b, 0);
  const wins = rets.filter((r) => r > 0).length;
  const decided = rets.filter((r) => r !== 0).length;
  return {
    samples: rets.length,
    avgRet: sum / rets.length,
    winRate: decided ? (wins / decided) * 100 : null,
  };
}

/** 非重叠交易 + 固定持有期统计（含持有窗口内的最大浮盈/浮亏） */
function backtestRule(hits, bars, hold) {
  const closes = bars.map((b) => num(b.close));
  const trades = [];
  let i = 0;
  while (i < hits.length) {
    if (hits[i] && i + hold < closes.length) {
      const entry = closes[i];
      if (entry > 0) {
        // 入场在信号日收盘，故浮盈/浮亏只看入场之后（i+1 ~ i+hold），
        // 否则信号日自身的振幅会被算成持仓期波动
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i + 1; j <= i + hold; j++) {
          hi = Math.max(hi, num(bars[j].high));
          lo = Math.min(lo, num(bars[j].low));
        }
        trades.push({
          ret: ((closes[i + hold] - entry) / entry) * 100,
          mfe: hi > 0 ? ((hi - entry) / entry) * 100 : null,
          mae: lo > 0 ? ((lo - entry) / entry) * 100 : null,
        });
        i += hold; // 持有期内不再开仓
        continue;
      }
    }
    i += 1;
  }
  return summarize(trades);
}

/**
 * 对日 K 数组跑全部规则的持有期统计（纯函数，便于独立验证）
 * @param {Array<{date:string,open:number,high:number,low:number,close:number,volume:number}>} bars 日 K（按日期升序）
 * @param {string} code 股票代码（用于判断涨跌停幅度）
 */
export function analyzeBars(bars, code) {
  const list = Array.isArray(bars) ? bars.filter((b) => b && Number(b.close) > 0) : [];
  if (list.length < MIN_BARS) {
    return {
      bars: list.length,
      enough: false,
      from: null,
      to: null,
      asOf: null,
      rules: [],
      periods: HOLD_PERIODS,
      benchmark: {},
    };
  }

  const ind = prepareIndicators(list, code);
  const start = Math.min(START_INDEX, list.length - 1);

  const last = list.length - 1;

  // 基准只需算一次（不依赖信号），窗口与规则触发区间对齐（都从 start 起）
  const benchmark = {};
  for (const hold of HOLD_PERIODS) benchmark[hold] = benchmarkFor(list, hold, start);

  const rules = RULES.map((rule) => {
    const hits = new Array(list.length).fill(false);
    let hitCount = 0;
    let lastHit = -1;
    for (let i = Math.max(start, 1); i < list.length; i++) {
      let ok = false;
      try {
        ok = rule.detect(i, list, ind);
      } catch {
        ok = false; // 单条规则异常不应中断整体回测
      }
      if (ok) {
        hits[i] = true;
        hitCount += 1;
        lastHit = i;
      }
    }
    const byPeriod = {};
    for (const hold of HOLD_PERIODS) {
      const stat = backtestRule(hits, list, hold);
      const bench = benchmark[hold];
      // 超额：规则平均收益 − 同期「买入并持有」基准（百分点）；任一侧缺值时为 null
      stat.excess =
        stat.avgRet != null && bench.avgRet != null ? stat.avgRet - bench.avgRet : null;
      stat.excessWin =
        stat.winRate != null && bench.winRate != null ? stat.winRate - bench.winRate : null;
      byPeriod[hold] = stat;
    }

    // ---- 当前状态：最后一根 K 线上是否触发 + 距今天数 ----
    let active = false;
    try {
      active = rule.detect(last, list, ind) === true;
    } catch {
      active = false;
    }
    const barsAgo = lastHit < 0 ? null : last - lastHit;

    return {
      id: rule.id,
      name: rule.name,
      hint: rule.hint,
      group: rule.group,
      signalCount: hitCount,
      byPeriod,
      // 当前状态（面板「现在」一栏用；与历史统计相互独立）
      active,
      barsAgo,
      lastHitDate: lastHit < 0 ? null : list[lastHit]?.date || null,
      // 该规则是否在当前这根 K 线上真正参与过判定（未参与则不能断言「未触发」）
      evaluated: last >= Math.max(start, 1),
    };
  });

  return {
    bars: list.length,
    enough: true,
    from: list[0]?.date || null,
    to: list[list.length - 1]?.date || null,
    asOf: list[last]?.date || null,
    periods: HOLD_PERIODS,
    benchmark,
    rules,
  };
}

/** 读取本地历史 K 线（失败返回空数组：库未初始化 / 无数据都属于正常情况） */
async function readLocal(code) {
  try {
    const bars = await invoke("get_kline_history", { code, period: "day", limit: 2000 });
    return Array.isArray(bars) ? bars : [];
  } catch {
    return [];
  }
}

export function useSignalBacktest() {
  const loading = ref(false);
  const syncing = ref(false);
  const error = ref("");
  const data = ref(null);
  const stats = ref(null);

  /** 请求序号：切换股票时并发 load，旧响应（含数据/错误/syncing）一律丢弃 */
  let loadSeq = 0;

  /**
   * 读取本地历史并回测；本地样本不足或 forceNetwork 时先补齐远端 K 线（Rust 端自动落库）
   * @param {string} code 股票代码
   * @param {{forceNetwork?: boolean}} [options]
   */
  async function load(code, options = {}) {
    if (!code) return;
    const mySeq = ++loadSeq;
    loading.value = true;
    error.value = "";
    try {
      let bars = await readLocal(code);
      if (mySeq !== loadSeq) return;
      if (options.forceNetwork || bars.length < MIN_BARS) {
        syncing.value = true;
        try {
          // 该命令落库为旁路，返回远端全量 K 线（含比本地更早的历史）
          const remote = await invoke("get_stock_kline", { code, period: "day", apiKey: getFuyaoKey() });
          if (mySeq !== loadSeq) return;
          if (Array.isArray(remote) && remote.length > bars.length) bars = remote;
        } catch (e) {
          if (mySeq !== loadSeq) return;
          // 远端失败时仍可用于已有本地数据；本地也空才向外抛
          if (bars.length === 0) throw e;
        } finally {
          if (mySeq === loadSeq) syncing.value = false;
        }
      }
      if (mySeq !== loadSeq) return;
      data.value = analyzeBars(bars, code);
    } catch (e) {
      if (mySeq !== loadSeq) return;
      error.value = String(e?.message || e);
      // §7.16 刷新失败保留旧 data（上一只股票的结果）并置错误态；
      // 清空会让面板闪空、也失去可对照的旧结果
    } finally {
      if (mySeq === loadSeq) loading.value = false;
    }
  }

  /** 读取本地库概况（失败静默为 null，弹窗仅隐藏概况区） */
  async function loadStats() {
    try {
      stats.value = await invoke("get_db_stats");
    } catch {
      stats.value = null;
    }
  }

  return { loading, syncing, error, data, stats, load, loadStats };
}
