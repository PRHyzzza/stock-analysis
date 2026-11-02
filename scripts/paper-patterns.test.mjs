/**
 * utils/paperPatterns.js 单测
 *
 * 为什么值得锁：战法命中会给总分加成，一旦识别口径漂移（比如把「放量突破」算成
 * 「缩量突破」、或把二板当首板），模拟盘就会以「看起来像战法」的方式持续买入错票，
 * 且没有任何报错——只有净值慢慢变差。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PATTERN_BONUS_MAX,
  PATTERN_HIT_FIT,
  PATTERNS,
  detectPatterns,
  hitPatterns,
  patternBonusOf,
} from "../src/utils/paperPatterns.js";

const D0 = Date.UTC(2026, 0, 1);

/** 用显式收盘价序列造 K 线（其余字段按简单规则推导，便于构造精确形态） */
function barsFromCloses(closes, opts = {}) {
  const { vols = null, highs = null, lows = null, opens = null, spread = 0.004 } = opts;
  return closes.map((c, i) => {
    const d = new Date(D0);
    d.setUTCDate(d.getUTCDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      open: opens ? opens[i] : i === 0 ? c : closes[i - 1],
      high: highs ? highs[i] : c * (1 + spread),
      low: lows ? lows[i] : c * (1 - spread),
      close: c,
      volume: vols ? vols[i] : 10000,
    };
  });
}

function byId(list, id) {
  return list.find((p) => p.id === id);
}

test("战法 — 元数据 5 项、id 唯一、命中门槛为 60", () => {
  assert.equal(PATTERNS.length, 5);
  assert.equal(new Set(PATTERNS.map((p) => p.id)).size, 5);
  assert.deepEqual(
    PATTERNS.map((p) => p.name),
    ["趋势跟随", "一进二", "突破缩量", "低吸放量", "一夜持股"]
  );
  assert.equal(PATTERN_HIT_FIT, 60);
  const overnight = PATTERNS.find((p) => p.id === "overnightHold");
  assert.equal(overnight.countsForResonance, false, "一夜持股是持有节奏，不参与共振计数");
});

test("战法 — K 线不足 25 根时全部不命中且不抛异常", () => {
  const out = detectPatterns(barsFromCloses(new Array(20).fill(10)), "600519");
  assert.equal(out.length, 5);
  for (const p of out) {
    assert.equal(p.fit, 0);
    assert.equal(p.hit, false);
  }
});

test("战法 — 单边上涨命中趋势跟随，单边下跌一个都不命中", () => {
  const up = Array.from({ length: 120 }, (_, i) => 10 * (1.005 ** i));
  const down = Array.from({ length: 120 }, (_, i) => 20 * (0.995 ** i));
  const upRes = detectPatterns(barsFromCloses(up), "600519");
  assert.equal(byId(upRes, "trendFollow").hit, true, "稳步上涨应命中趋势跟随");

  const downRes = detectPatterns(barsFromCloses(down), "600519");
  for (const p of downRes) {
    assert.equal(p.hit, false, `下跌段不该命中 ${p.name}`);
    assert.equal(p.fit, 0, `下跌段 ${p.name} 适配度应为 0`);
  }
});

test("战法 — 一进二：首板涨停命中，适配度随量能与位置变化", () => {
  const flat = new Array(60).fill(10);
  const closes = [...flat, 11];
  const highs = [...flat.map((c) => c + 0.04), 11];
  const lows = [...flat.map((c) => c - 0.04), 10.5];
  const opens = [...flat.map((c) => c), 10.6];
  const vols = [...flat.map(() => 10000), 20000];

  const res = byId(detectPatterns(barsFromCloses(closes, { highs, lows, opens, vols }), "600519"), "oneToTwo");
  assert.equal(res.hit, true, "首板涨停应命中一进二");
  assert.ok(res.fit >= 80, `量能健康的首板适配度应较高，实际 ${res.fit}`);
  assert.ok(res.evidence.some((e) => e.includes("首板")));
});

test("战法 — 一进二：一字板适配度低于非一字板（次日更难成交）", () => {
  const flat = new Array(60).fill(10);
  const build = (low) =>
    barsFromCloses([...flat, 11], {
      highs: [...flat.map((c) => c + 0.04), 11],
      lows: [...flat.map((c) => c - 0.04), low],
      opens: [...flat.map((c) => c), 10.6],
      vols: [...flat.map(() => 10000), 20000],
    });

  const normal = byId(detectPatterns(build(10.5), "600519"), "oneToTwo");
  const oneWord = byId(detectPatterns(build(11), "600519"), "oneToTwo");
  assert.ok(oneWord.fit < normal.fit, `一字板 ${oneWord.fit} 应低于非一字 ${normal.fit}`);
  assert.ok(oneWord.evidence.some((e) => e.includes("一字")));
});

test("战法 — 一进二：连续涨停（二板）不算首板", () => {
  const flat = new Array(60).fill(10);
  const closes = [...flat, 11, 12.1];
  const highs = [...flat.map((c) => c + 0.04), 11, 12.1];
  const lows = [...flat.map((c) => c - 0.04), 10.5, 11.6];

  const res = byId(detectPatterns(barsFromCloses(closes, { highs, lows }), "600519"), "oneToTwo");
  assert.equal(res.fit, 0, "二板不是一进二");
  assert.equal(res.hit, false);
  assert.ok(res.evidence.some((e) => e.includes("非首板")));
});

test("战法 — 突破缩量：缩量创新高命中，放量创新高不命中", () => {
  const range = new Array(60).fill(9.9);
  const closes = [...range, 10.5];
  const highs = [...range.map((c) => c + 0.1), 10.55]; // 前高 10.0
  const lows = [...range.map((c) => c - 0.1), 9.95];
  const opens = [...range.map((c) => c), 10.0];

  const quiet = barsFromCloses(closes, {
    highs,
    lows,
    opens,
    vols: [...range.map(() => 10000), 7000],
  });
  const loud = barsFromCloses(closes, {
    highs,
    lows,
    opens,
    vols: [...range.map(() => 10000), 16000],
  });

  const hit = byId(detectPatterns(quiet, "600519"), "breakoutVolume");
  assert.equal(hit.hit, true, "缩量突破应命中");
  assert.ok(hit.fit >= 60);

  const miss = byId(detectPatterns(loud, "600519"), "breakoutVolume");
  assert.equal(miss.fit, 0, "放量突破不算缩量突破");
  assert.ok(miss.evidence.some((e) => e.includes("未缩量")));
});

test("战法 — 突破缩量：未创新高时不命中", () => {
  const closes = [...new Array(60).fill(9.9), 9.85];
  const res = byId(detectPatterns(barsFromCloses(closes), "600519"), "breakoutVolume");
  assert.equal(res.fit, 0);
  assert.ok(res.evidence.some((e) => e.includes("未创")));
});

test("战法 — 低吸放量：回调后放量收阳命中，创新高或收阴不命中", () => {
  const up = Array.from({ length: 50 }, (_, i) => 10 + i * 0.04);
  const peak = up[up.length - 1];
  const closes = [...up, peak * 0.961, peak * 0.936, peak * 0.924, peak * 0.936];
  const opens = [...up, peak, peak * 0.961, peak * 0.936, peak * 0.924];
  const highs = [...up.map((c) => c * 1.01), peak * 0.966, peak * 0.945, peak * 0.928, peak * 0.945];
  const lows = [...up.map((c) => c * 0.99), peak * 0.953, peak * 0.932, peak * 0.916, peak * 0.924];
  const vols = [...up.map(() => 10000), 10000, 12000, 15000, 30000];

  const res = byId(
    detectPatterns(barsFromCloses(closes, { vols, opens, highs, lows }), "600519"),
    "dipVolume"
  );
  assert.equal(res.hit, true, `回调放量收阳应命中，实际 fit=${res.fit} ${JSON.stringify(res.evidence)}`);

  const noDip = byId(detectPatterns(barsFromCloses(up), "600519"), "dipVolume");
  assert.equal(noDip.fit, 0, "创新高时不属于低吸");

  // 同样回调但当日收阴 → 硬条件不成立（不能把「还在下跌」当成低吸）
  const falling = [...up, peak * 0.961, peak * 0.936, peak * 0.924, peak * 0.91];
  const fallingOpens = [...up, peak, peak * 0.961, peak * 0.936, peak * 0.924];
  const yin = byId(
    detectPatterns(barsFromCloses(falling, { opens: fallingOpens, vols }), "600519"),
    "dipVolume"
  );
  assert.equal(yin.fit, 0, "收阴不应命中低吸");
  assert.equal(yin.hit, false);
});

test("战法 — 一夜持股：尾盘强势收阳命中，涨停/长上影/收阴都不算", () => {
  const base = Array.from({ length: 60 }, (_, i) => 10 * (1.002 ** i));
  const prev = base[base.length - 1];
  const build = (patch) =>
    barsFromCloses([...base, patch.close], {
      opens: [...base, patch.open],
      highs: [...base.map((c) => c * 1.004), patch.high],
      lows: [...base.map((c) => c * 0.996), patch.low],
      vols: [...base.map(() => 10000), patch.vol ?? 15000],
    });

  const strong = byId(
    detectPatterns(
      build({ open: prev, close: prev * 1.035, high: prev * 1.04, low: prev * 0.995 }),
      "600519"
    ),
    "overnightHold"
  );
  assert.equal(strong.hit, true, `尾盘强势应收阳命中，实际 fit=${strong.fit} ${JSON.stringify(strong.evidence)}`);
  assert.ok(strong.evidence.some((e) => e.includes("收盘在振幅")));

  // 涨停：尾盘买不进，直接判不命中
  const limitUp = byId(
    detectPatterns(
      build({ open: prev * 1.03, close: prev * 1.1, high: prev * 1.1, low: prev * 1.02 }),
      "600519"
    ),
    "overnightHold"
  );
  assert.equal(limitUp.hit, false, "涨停不应命中一夜持股");
  assert.ok(limitUp.evidence.some((e) => e.includes("涨停")));

  // 长上影：收盘被压回振幅下部
  const shadow = byId(
    detectPatterns(
      build({ open: prev, close: prev * 1.005, high: prev * 1.06, low: prev * 0.995 }),
      "600519"
    ),
    "overnightHold"
  );
  assert.equal(shadow.fit, 0, "收盘在振幅下部不应命中");
  assert.ok(shadow.evidence.some((e) => e.includes("尾盘不够强")));

  // 收阴
  const yin = byId(
    detectPatterns(
      build({ open: prev * 1.02, close: prev * 1.005, high: prev * 1.03, low: prev * 1.0 }),
      "600519"
    ),
    "overnightHold"
  );
  assert.equal(yin.fit, 0, "收阴不应命中");

  // 单日大涨 7%：隔夜追高风险
  const tooHot = byId(
    detectPatterns(
      build({ open: prev * 1.01, close: prev * 1.07, high: prev * 1.07, low: prev * 1.0 }),
      "600519"
    ),
    "overnightHold"
  );
  assert.equal(tooHot.fit, 0, "单日涨超 6% 不应命中");
  assert.ok(tooHot.evidence.some((e) => e.includes("追高")));
});

test("战法 — 所有适配度落在 0-100，且 hit 与门槛一致", () => {
  const up = Array.from({ length: 120 }, (_, i) => 10 * (1.005 ** i));
  const down = Array.from({ length: 120 }, (_, i) => 20 * (0.995 ** i));
  const flat = new Array(120).fill(10);
  for (const closes of [up, down, flat]) {
    for (const p of detectPatterns(barsFromCloses(closes), "600519")) {
      assert.ok(p.fit >= 0 && p.fit <= 100, `${p.name} 适配度越界: ${p.fit}`);
      assert.equal(p.hit, p.fit >= PATTERN_HIT_FIT, `${p.name} hit 与门槛不一致`);
    }
  }
});

test("战法 — 共振加成：单个命中不加分，2/3/4 个依次 +3/+6/+9 且封顶", () => {
  const mk = (n) =>
    PATTERNS.map((p, i) => ({ id: p.id, name: p.name, fit: i < n ? 80 : 0, hit: i < n }));
  for (const n of [0, 1]) assert.equal(patternBonusOf(mk(n)), 0, `命中 ${n} 个不应加成`);
  assert.equal(patternBonusOf(mk(2)), 3);
  assert.equal(patternBonusOf(mk(3)), 6);
  assert.equal(patternBonusOf(mk(4)), PATTERN_BONUS_MAX);
  assert.equal(hitPatterns(mk(2)).length, 2);
});

test("战法 — 一夜持股不算共振项（只按其他战法计数）", () => {
  const mk = (ids) =>
    PATTERNS.map((p) => ({ id: p.id, name: p.name, fit: ids.includes(p.id) ? 80 : 0, hit: ids.includes(p.id) }));
  assert.equal(patternBonusOf(mk(["overnightHold", "trendFollow"])), 0, "一夜持股不参与共振，剩 1 个不加成");
  assert.equal(patternBonusOf(mk(["overnightHold", "trendFollow", "dipVolume"])), 3, "只数参与共振的两个");
});
