/**
 * paperCalibration — 把 0-100 的「手工参考分」校准成**历史同档表现**
 *
 * 为什么需要：现在的 60 分门槛是拍出来的。72 分到底意味着什么？用户只看到「数字挺大」，
 * 既不知道历史上同样 72 分的票次日收正的概率，也不知道扣完费用还剩多少。
 * 本模块用本地历史日 K 做 walk-forward 回放，把分数映射成「样本数 + 胜率 + 中位收益」。
 *
 * 口径（与 §7.19 一致，UI 必须原样标注，禁止只显示胜率不显示样本）：
 * - **防前视**：第 i 根 K 线只喂 `bars[0..=i]`（且与线上一致，只取最近 200 根）算分；
 *   收益一律用 i 之后的真实行情
 * - **成交假设**：信号日收盘出分 → **次日开盘买入** → 第 H 个交易日收盘卖出
 *   （H=1 即「次日开盘买、次日收盘卖」；A 股 T+1 允许当日买次日卖）
 * - **非重叠采样**：取一个样本后跳过 H+1 个交易日。重叠样本会把同一段行情反复计数，
 *   让样本量看起来很大、置信度虚高
 * - **必须扣费**：模拟盘是全额费用（佣金万 2.5 双边最低 5 元 + 印花税卖出 0.05% + 过户费双向 0.001%），
 *   所以同时给「扣费后中位」。不扣费的胜率在超短周期里没有可比性
 * - **样本不足不下结论**：`n < MIN_SAMPLES` 标 `reliable: false`
 *
 * 这个模块只做统计，不预测、不参与成交。它回答的是「过去同样打分的票后来怎样了」，
 * 不是「这只票接下来会涨」。
 */

import { MIN_SCORE_BARS, scoreBars } from "./paperScore.js";

/** 校准用的分数桶（顺序即 UI 展示顺序；lo 含、hi 不含） */
export const CALIBRATION_BUCKETS = Object.freeze([
  { id: "lt60", label: "<60", lo: 0, hi: 60 },
  { id: "b60", label: "60–65", lo: 60, hi: 65 },
  { id: "b65", label: "65–70", lo: 65, hi: 70 },
  { id: "b70", label: "70–75", lo: 70, hi: 75 },
  { id: "b75", label: "75–80", lo: 75, hi: 80 },
  { id: "ge80", label: "≥80", lo: 80, hi: 101 },
]);

/**
 * 默认往返费用（%）
 * 佣金万 2.5 双边（最低 5 元，小仓位按 5 元折）≈ 0.05% + 印花税 0.05% + 过户费 0.002% ≈ 0.10%，
 * 这里取 0.16% 留出最低佣金的余量——小仓位单笔 5 元下限实际会更高。
 */
export const DEFAULT_FEE_PCT = 0.16;

/** 单桶最小可信样本数（低于此只显示数字，不下结论） */
export const MIN_SAMPLES = 30;

function round1(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function round2(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** 中位数（偶数个取中间两数平均；空数组返回 null，不用 0 冒充） */
export function median(values) {
  const list = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  const v = list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  return round2(v);
}

/**
 * 基准指数在 `date` 当天的 20 日涨幅（%）
 *
 * **防前视**：只取日期 ≤ `date` 的 K 线。基准与个股交易日可能不完全对齐
 * （停牌、指数多出的交易日），所以用「最后一根不晚于信号日」的 K 线，往前数 20 根。
 *
 * @param {Array<{date:string, close:number}>} benchBars 基准日 K（升序或降序都接受）
 * @param {string} date 信号日 YYYY-MM-DD
 * @returns {number|null} 不足 21 根返回 null（调用方回退到绝对涨幅）
 */
export function benchRet20At(benchBars, date) {
  const list = (Array.isArray(benchBars) ? benchBars : []).filter(
    (b) => b && Number(b.close) > 0 && b.date
  );
  if (list.length < 21) return null;
  // 统一成升序：外部数据源两种顺序都见过，这里不假设
  const asc =
    String(list[0].date) <= String(list[list.length - 1].date) ? list : list.slice().reverse();

  let idx = -1;
  for (let i = 0; i < asc.length; i++) {
    if (String(asc[i].date) <= String(date)) idx = i;
    else break;
  }
  if (idx < 20) return null;
  const now = Number(asc[idx].close);
  const prev = Number(asc[idx - 20].close);
  if (!(prev > 0) || !(now > 0)) return null;
  return ((now / prev) - 1) * 100;
}

/**
 * 对一只票的历史 K 线做 walk-forward 采样
 *
 * @param {Array<{date,open,high,low,close,volume}>} bars 升序日 K（建议 ≥120 根）
 * @param {{ horizon?: number, feePct?: number, span?: number, code?: string,
 *           benchBars?: Array }} [opts]
 *   horizon 持有交易日数（1 = 次日开盘买、次日收盘卖）；span 每次算分喂多少根（与线上一致 = 200）；
 *   benchBars 基准指数日 K，给了就按相对强度算动量（不给则回退绝对涨幅，与旧口径一致）
 * @returns {Array<{ date: string, score: number, retPct: number, retAfterFeePct: number }>}
 */
export function buildSamples(bars, opts = {}) {
  const horizon = Math.max(1, Math.round(Number(opts.horizon) || 1));
  const feePct = Number.isFinite(Number(opts.feePct)) ? Number(opts.feePct) : DEFAULT_FEE_PCT;
  const span = Math.max(MIN_SCORE_BARS, Math.round(Number(opts.span) || 200));
  const code = String(opts.code || "");
  const benchBars = Array.isArray(opts.benchBars) && opts.benchBars.length ? opts.benchBars : null;

  const list = (Array.isArray(bars) ? bars : []).filter((b) => b && Number(b.close) > 0);
  const n = list.length;
  const out = [];
  // 非重叠：一个样本占用「信号日 + 买入日 + H 个持有日」
  const step = horizon + 1;

  for (let i = MIN_SCORE_BARS - 1; i < n; i += step) {
    const entryBar = list[i + 1];
    const exitBar = list[i + horizon];
    if (!entryBar || !exitBar) break;
    const entry = Number(entryBar.open) > 0 ? Number(entryBar.open) : Number(entryBar.close);
    const exit = Number(exitBar.close);
    if (!(entry > 0) || !(exit > 0)) continue;

    // 只喂截止信号日的 K 线，且与 loadScore 同口径（最近 200 根）—— 保证「历史分」就是当时能看见的分
    const context = {};
    if (benchBars) {
      const benchRet20Pct = benchRet20At(benchBars, list[i].date);
      if (benchRet20Pct != null) context.benchRet20Pct = benchRet20Pct;
    }
    const res = scoreBars(list.slice(Math.max(0, i + 1 - span), i + 1), code, context);
    if (!res.enough) continue;

    const retPct = ((exit / entry) - 1) * 100;
    out.push({
      date: list[i].date || "",
      score: res.score,
      retPct: round2(retPct),
      retAfterFeePct: round2(retPct - feePct),
    });
  }
  return out;
}

/** 分数落在哪个桶（越界返回最后一个/第一个可容纳的桶） */
export function bucketOf(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  return CALIBRATION_BUCKETS.find((b) => s >= b.lo && s < b.hi) || null;
}

/**
 * 分桶统计
 *
 * 胜率口径：`wins / (wins + losses)`，**平盘（收益恰为 0）不进分母**（与 §7.26 一致）；
 * 全是平盘时返回 null 而不是 0 或 100。
 *
 * @param {Array} samples `buildSamples` 的合并结果
 * @param {{ minSamples?: number, feePct?: number }} [opts]
 */
export function summarizeBuckets(samples, opts = {}) {
  const minSamples = Number(opts.minSamples) || MIN_SAMPLES;
  const feePct = Number.isFinite(Number(opts.feePct)) ? Number(opts.feePct) : DEFAULT_FEE_PCT;
  const list = Array.isArray(samples) ? samples : [];

  const acc = CALIBRATION_BUCKETS.map((b) => ({
    ...b,
    n: 0,
    wins: 0,
    flats: 0,
    losses: 0,
    rets: [],
    afterFee: [],
  }));

  for (const s of list) {
    const score = Number(s?.score);
    if (!Number.isFinite(score)) continue;
    const row = acc.find((r) => score >= r.lo && score < r.hi);
    if (!row) continue;
    const ret = Number(s.retPct);
    if (!Number.isFinite(ret)) continue;
    row.n += 1;
    if (ret > 0) row.wins += 1;
    else if (ret === 0) row.flats += 1;
    else row.losses += 1;
    row.rets.push(ret);
    const after = Number(s.retAfterFeePct);
    row.afterFee.push(Number.isFinite(after) ? after : ret - feePct);
  }

  return acc.map((r) => {
    const decided = r.wins + r.losses;
    return {
      id: r.id,
      label: r.label,
      lo: r.lo,
      hi: r.hi,
      n: r.n,
      wins: r.wins,
      flats: r.flats,
      losses: r.losses,
      winRatePct: decided > 0 ? round1((r.wins / decided) * 100) : null,
      medianRetPct: median(r.rets),
      medianAfterFeePct: median(r.afterFee),
      reliable: r.n >= minSamples,
    };
  });
}

/**
 * 胜率是否随分数单调上升（允许 ±tolerance 个百分点抖动）
 *
 * 为什么重要：如果不单调，说明「分数越高越好」这个前提在这批样本上不成立，
 * UI 必须如实写出来，而不是继续用「高分更靠谱」暗示用户。
 *
 * @returns {boolean|null} 样本不足 3 个桶时返回 null（不下结论）
 */
export function isMonotonic(buckets, tolerance = 2) {
  const rows = (Array.isArray(buckets) ? buckets : []).filter(
    (b) => b && b.n > 0 && b.winRatePct != null
  );
  if (rows.length < 3) return null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].winRatePct < rows[i - 1].winRatePct - tolerance) return false;
  }
  return true;
}

/**
 * 汇总一次校准（UI 直接用这个结果渲染）
 *
 * @param {Array} samples 合并后的样本
 * @param {{ horizon?: number, feePct?: number, minSamples?: number, codes?: number }} [opts]
 */
export function summarizeCalibration(samples, opts = {}) {
  const horizon = Math.max(1, Math.round(Number(opts.horizon) || 1));
  const feePct = Number.isFinite(Number(opts.feePct)) ? Number(opts.feePct) : DEFAULT_FEE_PCT;
  const buckets = summarizeBuckets(samples, opts);
  const total = buckets.reduce((s, b) => s + b.n, 0);
  return {
    total,
    horizon,
    feePct,
    minSamples: Number(opts.minSamples) || MIN_SAMPLES,
    codes: Number(opts.codes) || 0,
    buckets,
    monotonic: isMonotonic(buckets),
    // 口径必须随结果一起返回：UI 与导出都靠这段文字说明「这数字到底是什么」
    basis: `信号日收盘出分 → 次日开盘买入 → 第 ${horizon} 个交易日收盘卖出；非重叠采样；已扣往返费用 ${feePct}%`,
  };
}

/** 取某分数的历史同档表现（UI 在单只票上展示用） */
export function calibrateScore(score, buckets) {
  const b = bucketOf(score);
  if (!b) return null;
  const row = (Array.isArray(buckets) ? buckets : []).find((x) => x.id === b.id);
  if (!row) return null;
  return {
    ...row,
    // 样本不足时给一句可直接显示的话，避免 UI 各写一套判断
    verdict: !row.n
      ? "该分数段无历史样本"
      : !row.reliable
        ? `样本 ${row.n} 条，不足 ${MIN_SAMPLES}，仅供参考`
        : `历史同档 ${row.n} 次：收正 ${row.winRatePct}%，中位 ${row.medianAfterFeePct}%（扣费后）`,
  };
}
