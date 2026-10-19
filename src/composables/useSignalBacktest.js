/**
 * useSignalBacktest — 基于本地历史日 K 的信号回测与胜率统计
 *
 * 说明（重要）：现有 `useT0Signals` / `useVolumeSignals` / `useTrapSignals` 的规则全部依赖
 * **分时数据**（日内时间序列），而本地历史库只沉淀日 K 与行情快照，因此无法直接对它们回测。
 * 本模块只回测**日线级**规则（复用 useTechIndicators / useSupportResistance 的纯函数），
 * 日内信号要回测需另行落库分时数据（后续可扩展）。
 *
 * 统计口径：固定持有期（1/3/5/10 交易日），**非重叠交易**（持有期内不再开仓），
 * 单笔收益 = 持有期末收盘价 / 信号日收盘价 - 1；胜率 = 盈利笔数 /（盈利 + 亏损笔数），
 * 平盘（收益恰为 0）单列 `flats`、不进退分母。
 * 样本 < MIN_SAMPLE 时由 UI 标注「样本不足」，不下结论。
 */
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { calcMACD, calcKDJ, calcRSI } from "./useTechIndicators.js";
import { calcSupportResistance } from "./useSupportResistance.js";
import { getLimitPct } from "../utils/limit.js";

/** 统计的持有期（交易日） */
export const HOLD_PERIODS = [1, 3, 5, 10];
/** 少于该笔数视为样本不足 */
export const MIN_SAMPLE = 10;
/** 低于该根数不做回测（MA20/量能均值等规则需要足够预热） */
const MIN_BARS = 60;
/** 回测起始下标：预留 60 根做指标与阻力位预热 */
const START_INDEX = 60;

/** 简单移动平均序列（不足周期处为 null） */
function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    sum += Number.isFinite(v) ? v : 0;
    if (i >= period) {
      const drop = Number(values[i - period]);
      sum -= Number.isFinite(drop) ? drop : 0;
    }
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

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
  const closes = bars.map((b) => Number(b.close) || 0);
  return {
    closes,
    macd: alignToLength(calcMACD(closes), closes.length),
    kdj: alignToLength(calcKDJ(bars), closes.length),
    rsi: alignToLength(calcRSI(closes, 14), closes.length),
    ma5: smaSeries(closes, 5),
    ma10: smaSeries(closes, 10),
    ma20: smaSeries(closes, 20),
    volMa20: smaSeries(bars.map((b) => Number(b.volume) || 0), 20),
    // 回测按板块口径取涨跌停幅度（ST 与所属板块一致，无需名称）
    limitPct: getLimitPct(code),
  };
}

/** 前一日收盘 → 当日收盘涨跌幅（%） */
function dayChangePct(bars, i) {
  if (i < 1) return null;
  const prev = Number(bars[i - 1]?.close) || 0;
  const cur = Number(bars[i]?.close) || 0;
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** 日线级规则集（每条规则只判断「第 i 根 K 线是否触发」） */
const RULES = [
  {
    id: "ma_cross",
    name: "MA5 上穿 MA10",
    hint: "短均线金叉，趋势转折的最基础信号",
    detect: (i, bars, ind) => {
      const { ma5, ma10 } = ind;
      if (ma5[i - 1] == null || ma10[i - 1] == null || ma5[i] == null || ma10[i] == null) return false;
      return ma5[i - 1] <= ma10[i - 1] && ma5[i] > ma10[i];
    },
  },
  {
    id: "ma_stack",
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
    id: "kdj_low_cross",
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
    name: "突破前高阻力位",
    hint: "收盘价上破近 60 日波段高点/斐波那契阻力",
    detect: (i, bars) => {
      if (i < START_INDEX + 1) return false;
      // 只用信号日之前的数据，避免用到未来信息
      const { resistance } = calcSupportResistance(bars.slice(i - 60, i));
      if (!resistance.length) return false;
      const nearest = Math.min(...resistance.map((r) => Number(r.price) || 0));
      if (!(nearest > 0)) return false;
      const prevClose = Number(bars[i - 1].close) || 0;
      return prevClose <= nearest && (Number(bars[i].close) || 0) > nearest;
    },
  },
  {
    id: "volume_surge",
    name: "放量上涨",
    hint: "成交量 ≥ 1.8× 前 20 日均量 且 涨幅 > 2%",
    detect: (i, bars, ind) => {
      const vm = ind.volMa20[i - 1];
      if (vm == null || vm <= 0) return false;
      const chg = dayChangePct(bars, i);
      if (chg == null) return false;
      return (Number(bars[i].volume) || 0) >= 1.8 * vm && chg > 2;
    },
  },
  {
    id: "near_limit_up",
    name: "逼近涨停",
    hint: "涨幅 ≥ 涨停幅度的 70%（港股无涨跌停，不适用）",
    detect: (i, bars, ind) => {
      if (!ind.limitPct) return false;
      const chg = dayChangePct(bars, i);
      if (chg == null) return false;
      return chg >= ind.limitPct * 0.7;
    },
  },
];

/** 单笔交易的统计汇总 */
function summarize(returns) {
  const n = returns.length;
  if (n === 0) {
    return {
      trades: 0,
      decided: 0,
      flats: 0,
      winRate: null,
      expectancy: null,
      avgRet: null,
      avgWin: null,
      avgLoss: null,
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

  for (const r of returns) {
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
    avgRet: sum / n,
    expectancy: sum / n,
    avgWin: wins ? grossWin / wins : null,
    avgLoss: losses ? grossLoss / losses : null,
    best,
    worst,
    maxDrawdown: maxDd,
    totalReturn: (equity - 1) * 100,
  };
}

/** 非重叠交易 + 固定持有期统计 */
function backtestRule(hits, closes, hold) {
  const returns = [];
  let i = 0;
  while (i < hits.length) {
    if (hits[i] && i + hold < closes.length) {
      const entry = closes[i];
      const exit = closes[i + hold];
      if (entry > 0) {
        returns.push(((exit - entry) / entry) * 100);
        i += hold; // 持有期内不再开仓
        continue;
      }
    }
    i += 1;
  }
  return summarize(returns);
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
    };
  }

  const ind = prepareIndicators(list, code);
  const start = Math.min(START_INDEX, list.length - 1);

  const last = list.length - 1;

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
      byPeriod[hold] = backtestRule(hits, ind.closes, hold);
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
          const remote = await invoke("get_stock_kline", { code, period: "day" });
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
