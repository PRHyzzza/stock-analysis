/**
 * 打分校准单测 — 覆盖 `src/utils/paperCalibration.js`（纯函数）。
 *
 * 这块最容易错、也最伤人的地方是**前视**：一旦算分时看到了未来的 K 线，
 * 校准出来的胜率会漂亮得离谱，而用户完全无从察觉。所以第一条测试就是
 * 「改掉未来数据，历史分数必须一动不动」。
 *
 * 跑法：pnpm test（= node --test "scripts/*.test.mjs"）
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CALIBRATION_BUCKETS,
  DEFAULT_FEE_PCT,
  MIN_SAMPLES,
  benchRet20At,
  buildSamples,
  bucketOf,
  calibrateScore,
  isMonotonic,
  median,
  summarizeBuckets,
  summarizeCalibration,
} from "../src/utils/paperCalibration.js";

/** 造一段带波动的日 K（升序，日期连续） */
function makeBars(n, { start = 10, drift = 0.002, wave = 0.01 } = {}) {
  const out = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2025, 0, 1));
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const open = price;
    const close = price * (1 + drift + Math.sin(i / 3) * wave);
    price = close;
    out.push({
      date: iso,
      open,
      high: Math.max(open, close) * 1.004,
      low: Math.min(open, close) * 0.996,
      close,
      volume: 10000 + (i % 7) * 500,
    });
  }
  return out;
}

test("防前视：改掉未来 K 线后，此前所有样本的分数必须完全不变", () => {
  const bars = makeBars(240);
  const base = buildSamples(bars, { horizon: 1 });
  assert.ok(base.length > 20, `样本太少：${base.length}`);

  // 把第 160 根之后的价格整体乘 2（未来的剧烈变化）
  const mutated = bars.map((b, i) =>
    i > 160 ? { ...b, open: b.open * 2, high: b.high * 2, low: b.low * 2, close: b.close * 2 } : b
  );
  const after = buildSamples(mutated, { horizon: 1 });

  const byDate = new Map(after.map((s) => [s.date, s.score]));
  let checked = 0;
  for (const s of base) {
    const idx = bars.findIndex((b) => b.date === s.date);
    if (idx > 155) continue; // 只比「未来没被改」的部分
    assert.equal(byDate.get(s.date), s.score, `${s.date} 的分数被未来数据影响了`);
    checked += 1;
  }
  assert.ok(checked > 20, `比对样本不足：${checked}`);
});

test("非重叠采样：样本数不超过 总根数 /(horizon+1)", () => {
  const bars = makeBars(400);
  for (const horizon of [1, 2, 3]) {
    const samples = buildSamples(bars, { horizon });
    const step = horizon + 1;
    assert.ok(
      samples.length <= Math.ceil(bars.length / step),
      `h=${horizon} 样本 ${samples.length} 超过上限 ${Math.ceil(bars.length / step)}`
    );
    // 日期必须严格递增且间隔 ≥ step 天（跳过中间交易日）
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i].date > samples[i - 1].date, "样本日期必须递增");
    }
    const gap = bars.findIndex((b) => b.date === samples[1].date) -
      bars.findIndex((b) => b.date === samples[0].date);
    assert.ok(gap >= step, `h=${horizon} 间隔 ${gap} 应 ≥ ${step}`);
  }
});

test("成交假设：次日开盘买入、H 日收盘卖出", () => {
  const bars = makeBars(80);
  const samples = buildSamples(bars, { horizon: 1, span: 60 });
  const first = samples[0];
  // 按日期反查信号日下标，不依赖「第一个样本从第几根开始」的实现细节
  const idx = bars.findIndex((b) => b.date === first.date);
  assert.ok(idx >= 59, `信号日 ${idx} 早于 60 根预热`);
  const entry = bars[idx + 1].open;
  const exit = bars[idx + 1].close;
  assert.equal(first.retPct, Math.round((exit / entry - 1) * 100 * 100) / 100);
});

test("扣费：retAfterFee 恒等于 retPct 减费用", () => {
  const samples = buildSamples(makeBars(200), { horizon: 1, feePct: 0.2 });
  for (const s of samples) {
    assert.equal(s.retAfterFeePct, Math.round((s.retPct - 0.2) * 100) / 100);
  }
  const custom = buildSamples(makeBars(200), { horizon: 1, feePct: 0 });
  const fee0 = custom[0];
  assert.equal(fee0.retAfterFeePct, fee0.retPct);
});

test("边界：K 线不足 60 根不产生样本", () => {
  assert.deepEqual(buildSamples([]), []);
  assert.deepEqual(buildSamples(null), []);
  assert.deepEqual(buildSamples(makeBars(59)), []);
  assert.ok(buildSamples(makeBars(61)).length >= 1);
});

test("边界：末尾不够持有期时丢弃，不用最后一根兜底", () => {
  const bars = makeBars(100);
  // horizon=3 时，最后 3 根不可能凑出完整持有期
  const samples = buildSamples(bars, { horizon: 3 });
  const lastDate = bars[bars.length - 4].date;
  for (const s of samples) assert.ok(s.date <= lastDate, `${s.date} 超出可计算范围`);
});

test("分桶：区间左闭右开，越界不给样本", () => {
  assert.equal(bucketOf(59.9).id, "lt60");
  assert.equal(bucketOf(60).id, "b60");
  assert.equal(bucketOf(65).id, "b65");
  assert.equal(bucketOf(79.99).id, "b75");
  assert.equal(bucketOf(80).id, "ge80");
  assert.equal(bucketOf(100).id, "ge80");
  assert.equal(bucketOf(NaN), null);
});

test("统计：平盘不进胜负分母，全平盘时胜率为 null", () => {
  const rows = summarizeBuckets(
    [
      { score: 70, retPct: 2, retAfterFeePct: 1.84 },
      { score: 71, retPct: -1, retAfterFeePct: -1.16 },
      { score: 72, retPct: 0, retAfterFeePct: -0.16 },
    ],
    { minSamples: 3 }
  );
  const row = rows.find((r) => r.id === "b70");
  assert.equal(row.n, 3);
  assert.equal(row.flats, 1);
  assert.equal(row.winRatePct, 50, "平盘不能进分母，1胜1负应为 50%");
  assert.equal(row.reliable, true);

  const allFlat = summarizeBuckets([{ score: 70, retPct: 0 }], { minSamples: 1 });
  assert.equal(allFlat.find((r) => r.id === "b70").winRatePct, null);
});

test("统计：中位数与扣费后中位数分别计算", () => {
  const rows = summarizeBuckets(
    [
      { score: 66, retPct: 1, retAfterFeePct: 0.84 },
      { score: 66, retPct: 3, retAfterFeePct: 2.84 },
      { score: 66, retPct: -5, retAfterFeePct: -5.16 },
    ],
    { minSamples: 3 }
  );
  const row = rows.find((r) => r.id === "b65");
  assert.equal(row.medianRetPct, 1);
  assert.equal(row.medianAfterFeePct, 0.84);
});

test("统计：样本不足时 reliable=false（禁止据此下结论）", () => {
  const rows = summarizeBuckets([{ score: 66, retPct: 1, retAfterFeePct: 0.84 }]);
  const row = rows.find((r) => r.id === "b65");
  assert.equal(row.reliable, false);
  assert.equal(MIN_SAMPLES, 30);
  const c = calibrateScore(66, rows);
  assert.equal(c.reliable, false);
  assert.match(c.verdict, /不足 30/);
});

test("统计：空桶胜率与中位数为 null，不写 0", () => {
  const rows = summarizeBuckets([]);
  for (const r of rows) {
    assert.equal(r.n, 0);
    assert.equal(r.winRatePct, null);
    assert.equal(r.medianRetPct, null);
  }
  assert.equal(rows.length, CALIBRATION_BUCKETS.length);
});

test("中位数：偶数个取中间两数平均，空数组返回 null", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, 1]), 1);
});

test("单调性：胜率随分数上升 → true；出现明显倒挂 → false；桶太少 → null", () => {
  const mk = (pairs) =>
    pairs.map(([id, n, winRatePct]) => ({ id, n, winRatePct, label: id, lo: 0, hi: 100 }));
  assert.equal(isMonotonic(mk([["a", 40, 40], ["b", 40, 50], ["c", 40, 60]])), true);
  assert.equal(isMonotonic(mk([["a", 40, 60], ["b", 40, 50], ["c", 40, 70]])), false);
  // 抖动在容差内不算倒挂
  assert.equal(isMonotonic(mk([["a", 40, 50], ["b", 40, 49], ["c", 40, 70]])), true);
  assert.equal(isMonotonic(mk([["a", 40, 50], ["b", 40, 60]])), null);
});

test("汇总：口径文案必须带持有期与费用，总样本 = 各桶之和", () => {
  const sum = summarizeCalibration(
    [
      { score: 70, retPct: 1, retAfterFeePct: 0.84 },
      { score: 82, retPct: -2, retAfterFeePct: -2.16 },
    ],
    { horizon: 2, feePct: 0.16, codes: 3 }
  );
  assert.equal(sum.total, 2);
  assert.equal(sum.horizon, 2);
  assert.equal(sum.feePct, 0.16);
  assert.equal(sum.codes, 3);
  assert.match(sum.basis, /第 2 个交易日收盘卖出/);
  assert.match(sum.basis, /非重叠/);
  assert.match(sum.basis, /0\.16%/);
  assert.equal(sum.buckets.reduce((s, b) => s + b.n, 0), sum.total);
  assert.equal(DEFAULT_FEE_PCT, 0.16);
});

test("汇总：真实样本量下不给假单调结论", () => {
  const samples = buildSamples(makeBars(300), { horizon: 1 });
  const sum = summarizeCalibration(samples, { horizon: 1 });
  // 单只票 300 根 → 每桶样本远不足 30，monotonic 要么 null 要么 false，绝不能凭空 true
  if (sum.monotonic === true) {
    const reliableRows = sum.buckets.filter((b) => b.reliable);
    assert.ok(reliableRows.length >= 3, "只有 ≥3 个可信桶才允许下单调结论");
  }
});

test("基准涨幅对齐：只用 ≤ 信号日的 K 线（防前视）", () => {
  const bench = makeBars(80);
  const date = bench[40].date;
  const got = benchRet20At(bench, date);
  const want = (bench[40].close / bench[20].close - 1) * 100;
  assert.ok(Math.abs(got - want) < 1e-9, `got=${got} want=${want}`);

  // 把信号日之后的价格改掉，结果必须一模一样
  const mutated = bench.map((b, i) => (i > 40 ? { ...b, close: b.close * 3 } : b));
  assert.equal(benchRet20At(mutated, date), got);

  // 不足 21 根 / 非法入参
  assert.equal(benchRet20At(bench.slice(0, 20), date), null);
  assert.equal(benchRet20At(null, date), null);
  // 信号日早于第 21 根时也没有 20 日涨幅
  assert.equal(benchRet20At(bench, bench[10].date), null);
});

test("基准：传入 benchBars 不改变采样点，只改变分数", () => {
  const bars = makeBars(240, { drift: 0.001 });
  const bench = makeBars(240, { drift: 0.004 });
  const a = buildSamples(bars, { horizon: 1 });
  const b = buildSamples(bars, { horizon: 1, benchBars: bench });
  assert.equal(a.length, b.length);
  assert.deepEqual(a.map((s) => s.date), b.map((s) => s.date), "采样点必须完全一致");
  const avg = (list) => list.reduce((s, x) => s + x.score, 0) / list.length;
  assert.ok(
    avg(b) <= avg(a) + 1,
    `基准更强（超额更小）时平均分不应更高：无基准 ${avg(a).toFixed(1)} / 有基准 ${avg(b).toFixed(1)}`
  );
});
