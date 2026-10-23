/**
 * utils/paperScore.js 单测
 *
 * 为什么值得锁：打分取代了「规则触发即买」成为买入的唯一门槛。它一旦偏了
 * （比如不足 60 根也给出高分、或窗口截断失败导致读到未来 K 线），
 * 模拟盘会以「看起来很合理」的方式系统性买错票，且不会有任何报错。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCORE_CONFIG,
  MIN_SCORE_BARS,
  SCORE_FACTORS,
  describeScore,
  normalizeScoreConfig,
  scoreBars,
  scoreWindow,
} from "../src/utils/paperScore.js";

/** 造一段单边上涨的日 K（每天 +0.5%，量能平稳） */
function rampBars(n, { start = 10, step = 0.005, vol = 10000 } = {}) {
  const out = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 0, 1));
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const open = price;
    price = price * (1 + step);
    out.push({ date: iso, open, high: price * 1.002, low: open * 0.998, close: price, volume: vol });
  }
  return out;
}

/** 造一段单边下跌的日 K */
function fallBars(n, { start = 20, step = 0.005 } = {}) {
  return rampBars(n, { start, step: -step });
}

test("打分 — 因子权重合计 100", () => {
  const total = SCORE_FACTORS.reduce((s, f) => s + f.weight, 0);
  assert.equal(total, 100, "因子满分必须合计 100，否则分数不再是百分制");
});

test("打分 — K 线不足 60 根时不打分（不假填充）", () => {
  const bars = rampBars(MIN_SCORE_BARS - 1);
  const res = scoreBars(bars, "600519");
  assert.equal(res.enough, false);
  assert.equal(res.score, 0);
  assert.equal(res.parts.trend, 0);
  assert.equal(res.parts.rsi, 0);
});

test("打分 — 单边上涨趋势得分显著高于单边下跌", () => {
  const up = scoreBars(rampBars(120), "600519");
  const down = scoreBars(fallBars(120), "600519");
  assert.equal(up.enough, true);
  assert.equal(down.enough, true);
  assert.ok(up.score > 50, `上涨段应拿到高分，实际 ${up.score}`);
  assert.ok(down.score < up.score, `下跌段应低分，实际 ${down.score} vs ${up.score}`);
  assert.ok(up.score >= 0 && up.score <= 100, "分数必须落在 0-100");
});

test("打分 — 分数介于 0 与 100 之间且各分项不超权重", () => {
  for (const bars of [rampBars(120), fallBars(120), rampBars(80, { step: 0 })]) {
    const res = scoreBars(bars);
    assert.ok(res.score >= 0 && res.score <= 100);
    for (const f of SCORE_FACTORS) {
      const v = res.parts[f.id] ?? 0;
      assert.ok(v >= 0 && v <= f.weight, `${f.id} 分项 ${v} 超出权重 ${f.weight}`);
    }
  }
});

test("打分 — RSI 超买扣分（同一趋势，末端急拉后分数下降）", () => {
  const base = rampBars(120, { step: 0.003 });
  const hot = base.map((b) => ({ ...b }));
  // 最后 6 根改成垂直拉升 → RSI 冲到 80 以上
  let p = hot[hot.length - 7].close;
  for (let i = hot.length - 6; i < hot.length; i++) {
    p = p * 1.09;
    hot[i] = { ...hot[i], open: p * 0.99, high: p * 1.005, low: p * 0.985, close: p };
  }
  const normal = scoreBars(base);
  const overheated = scoreBars(hot);
  assert.ok(overheated.parts.rsi <= normal.parts.rsi, "超买时 RSI 分项不应更高");
});

test("打分窗口 — 只取 signalDate 及之前的 K 线（防前视）", () => {
  const bars = rampBars(120);
  const signalDate = bars[99].date;
  const win = scoreWindow(bars, signalDate);
  assert.ok(win.length > 0, "窗口不应为空");
  assert.equal(win[win.length - 1].date, signalDate, "窗口末端必须正好是信号日");
  assert.ok(
    win.every((b) => b.date <= signalDate),
    "窗口内不得出现信号日之后的 K 线（否则就是前视偏差）"
  );
});

test("打分窗口 — 日期早于全部 K 线时返回空数组", () => {
  const bars = rampBars(120);
  assert.deepEqual(scoreWindow(bars, "2020-01-01"), []);
});

test("打分窗口 — 窗口长度受 span 限制，只取最近 span 根", () => {
  const bars = rampBars(300);
  const win = scoreWindow(bars, bars[bars.length - 1].date, 120);
  assert.equal(win.length, 120);
});

test("配置 — minScore 夹到 0-100，maxPicks 夹到 1-5", () => {
  const c = normalizeScoreConfig({ minScore: 999, maxPicks: 99 });
  assert.equal(c.minScore, 100);
  assert.equal(c.maxPicks, 5);

  const d = normalizeScoreConfig({ minScore: -20, maxPicks: -3 });
  assert.equal(d.minScore, 0);
  assert.equal(d.maxPicks, 1);

  const e = normalizeScoreConfig({});
  assert.equal(e.minScore, DEFAULT_SCORE_CONFIG.minScore);
  assert.equal(e.maxPicks, DEFAULT_SCORE_CONFIG.maxPicks);

  const f = normalizeScoreConfig(null);
  assert.equal(f.minScore, DEFAULT_SCORE_CONFIG.minScore, "null 输入退回默认值");
});

test("描述 — 不足 60 根时文案明确说明无法打分", () => {
  const text = describeScore({ enough: false });
  assert.match(text, /不足/);
});

test("描述 — 达标时带分项拆解", () => {
  const text = describeScore(scoreBars(rampBars(120)));
  assert.match(text, /分/);
  assert.match(text, /趋势/);
});
