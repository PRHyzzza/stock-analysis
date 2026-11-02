/**
 * utils/paperReview.js 单测
 *
 * 为什么值得锁：复盘统计一旦口径错了，用户会据此改掉本来正确的做法。
 * 尤其是「平盘不进胜率分母」「老成交不伪造持有天数」「战法归因只取主因」这三条，
 * 写错都会让胜率看起来比真实情况好。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectMatches,
  overnightGaps,
  statsOf,
  summarizeMatches,
} from "../src/utils/paperReview.js";

test("统计 — 平盘不进胜率分母，全平盘时胜率为 null", () => {
  const s = statsOf([{ pnl: 10 }, { pnl: -5 }, { pnl: 0 }]);
  assert.equal(s.count, 3);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.flats, 1);
  assert.equal(s.winRate, 50, "胜率 = 胜 ÷（胜 + 负）");
  assert.equal(s.totalPnl, 5);
  assert.equal(s.avgPnl, Math.round((5 / 3) * 100) / 100);

  const allFlat = statsOf([{ pnl: 0 }, { pnl: 0 }]);
  assert.equal(allFlat.winRate, null, "全平盘时不得返回 0 或 100");

  const empty = statsOf([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.winRate, null);
  assert.equal(empty.avgPnl, null);
});

/** 构造一份带 matches 的账户 */
function account() {
  return {
    trades: [
      { side: "buy", date: "2026-01-05", code: "600519", name: "A", price: 10, meta: { score: 82, patterns: ["趋势跟随"] } },
      {
        side: "sell",
        date: "2026-01-08",
        code: "600519",
        name: "A",
        matches: [
          { pnl: 100, holdDays: 3, buyDate: "2026-01-05", meta: { score: 82, patterns: ["趋势跟随"] } },
          { pnl: -50, holdDays: 3, buyDate: "2026-01-05", meta: { score: 82, patterns: ["趋势跟随"] } },
        ],
      },
      {
        side: "sell",
        date: "2026-01-09",
        code: "600519",
        name: "A",
        matches: [{ pnl: 0, holdDays: 1, buyDate: "2026-01-08", meta: { score: 55, patterns: [] } }],
      },
      // v2 早期的卖出没有 matches：不得伪造持有天数
      { side: "sell", date: "2026-01-10", code: "000001", name: "B", realized: 30 },
    ],
  };
}

test("配对 — 只收集带 matches 的卖出，老成交单列 legacySells", () => {
  const matches = collectMatches(account());
  assert.equal(matches.length, 3);
  assert.equal(matches[0].code, "600519");

  const sum = summarizeMatches(account());
  assert.equal(sum.count, 3);
  assert.equal(sum.legacySells, 1, "没有 matches 的卖出要单独计数，不能并进胜率");
  assert.equal(sum.winRate, 50);
  assert.equal(sum.totalPnl, 50);
  assert.equal(sum.enough, false, "3 笔 < 10 笔 → 样本不足");
});

test("归因 — 按持有期分桶，边界值落在低一档", () => {
  const sum = summarizeMatches(account());
  const d01 = sum.byHold.find((b) => b.id === "d01");
  const d23 = sum.byHold.find((b) => b.id === "d23");
  assert.equal(d01.count, 1, "持有 1 天归入 0~1 天");
  assert.equal(d01.flats, 1);
  assert.equal(d23.count, 2, "持有 3 天归入 2~3 天");
  assert.equal(d23.winRate, 50);
  assert.equal(sum.byHold.find((b) => b.id === "d45").count, 0);
});

test("归因 — 战法取买入时首个战法作主因，无战法单列", () => {
  const sum = summarizeMatches(account());
  const trend = sum.byPattern.find((p) => p.name === "趋势跟随");
  const none = sum.byPattern.find((p) => p.name === "无战法");
  assert.equal(trend.count, 2);
  assert.equal(trend.winRate, 50);
  assert.equal(none.count, 1);
  assert.equal(sum.byPattern.length, 2, "一笔配对只能落在一个战法桶里（不重复计数）");
  assert.equal(sum.byPattern.reduce((s, p) => s + p.count, 0), sum.count);
});

test("归因 — 按买入时参考分分桶", () => {
  const sum = summarizeMatches(account());
  const s80 = sum.byScore.find((b) => b.id === "s80");
  const s0 = sum.byScore.find((b) => b.id === "s0");
  assert.equal(s80.count, 2, "82 分归入 ≥80");
  assert.equal(s0.count, 1, "55 分归入低于 60");
  assert.equal(sum.byScore.find((b) => b.id === "none").count, 0);
});

// ── 隔夜缺口 ──────────────────────────────────────────
const BARS = [
  { date: "2026-01-05", open: 10.0, high: 10.2, low: 9.9, close: 10.1 },
  { date: "2026-01-06", open: 10.5, high: 10.8, low: 10.4, close: 10.6 },
  { date: "2026-01-07", open: 10.2, high: 10.3, low: 10.0, close: 10.1 },
  { date: "2026-01-08", open: 9.8, high: 9.9, low: 9.5, close: 9.6 },
];

test("隔夜缺口 — 取买入日之后第一根 K 线的开盘价", () => {
  const trades = [
    { side: "buy", date: "2026-01-05", code: "600519", price: 10.0, name: "A" },
    { side: "buy", date: "2026-01-07", code: "600519", price: 10.1, name: "A" },
    { side: "sell", date: "2026-01-08", code: "600519", price: 9.9, name: "A" },
  ];
  const res = overnightGaps(trades, { "600519": BARS });
  assert.equal(res.count, 2, "只统计买入，卖出不参与");
  assert.equal(res.samples[0].nextDate, "2026-01-06");
  assert.equal(res.samples[0].gapPct, 5, "10.5 / 10.0 - 1 = +5%");
  assert.equal(res.samples[1].gapPct, -2.97, "9.8 / 10.1 - 1 ≈ -2.97%");
  assert.equal(res.upCount, 1);
  assert.equal(res.downCount, 1);
  assert.equal(res.positiveRate, 50);
  assert.equal(res.meanGap, Math.round(((5 + -2.97) / 2) * 100) / 100);
  assert.equal(res.enough, false, "2 个样本 → 样本不足");
});

test("隔夜缺口 — 没有 K 线的代码计入 missing，不猜价格", () => {
  const trades = [{ side: "buy", date: "2026-01-05", code: "000001", price: 10 }];
  const res = overnightGaps(trades, {});
  assert.equal(res.count, 0);
  assert.deepEqual(res.missing, ["000001"]);
  assert.equal(res.meanGap, null);
  assert.equal(res.positiveRate, null);
  assert.equal(res.medianGap, null);
});

test("隔夜缺口 — 中位数按奇偶正确计算", () => {
  const bars = [
    { date: "2026-01-05", open: 10, close: 10 },
    { date: "2026-01-06", open: 11, close: 11 },
    { date: "2026-01-07", open: 9, close: 9 },
    { date: "2026-01-08", open: 10.2, close: 10.2 },
  ];
  const two = overnightGaps(
    [
      { side: "buy", date: "2026-01-05", code: "600519", price: 10 },
      { side: "buy", date: "2026-01-06", code: "600519", price: 10 },
    ],
    { "600519": bars }
  );
  assert.equal(two.medianGap, 0, "偶数个样本取中间两值均值");

  const one = overnightGaps([{ side: "buy", date: "2026-01-05", code: "600519", price: 10 }], { "600519": bars });
  assert.equal(one.medianGap, 10, "奇数个样本直接取中位");
});
