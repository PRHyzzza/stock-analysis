/**
 * 事件信号单测 — 覆盖 `src/utils/eventSignals.js`（纯函数）。
 *
 * 这块最容易错的是「晋级率的分母」：最近一个交易日的票还没有次日结果，
 * 如果把它们算成「没晋级」，晋级率会被系统性压低估（而数字看起来仍然合理，极难发现）。
 *
 * 跑法：pnpm test（= node --test "scripts/*.test.mjs"）
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_BUCKETS,
  MIN_PROMOTION_SAMPLES,
  auctionFlagsOf,
  describeAuction,
  describePromotion,
  promotionStats,
} from "../src/utils/eventSignals.js";

/** 构造一天的梯队 */
function day(date, stocks) {
  return { date, stocks };
}

test("晋级率：最近一日（无次日结果）不计入分母", () => {
  const days = [
    day("2026-11-05", [
      { code: "A", board_num: 2, seal_nextday: null },
      { code: "B", board_num: 2, seal_nextday: null },
    ]),
    day("2026-11-04", [
      { code: "C", board_num: 2, seal_nextday: true },
      { code: "D", board_num: 2, seal_nextday: false },
    ]),
  ];
  const st = promotionStats(days, { minSamples: 2 });
  const b2 = st.levels.find((b) => b.id === "b2");
  assert.equal(b2.samples, 2, "只有 11-04 的两只可判");
  assert.equal(b2.promoted, 1);
  assert.equal(b2.ratePct, 50);
  // 今日在板数仍然包含还没有结果的票
  assert.equal(b2.todayCount, 2);
  assert.equal(st.newestDate, "2026-11-05");
  assert.equal(st.oldestDate, "2026-11-04");
});

test("晋级率：按板位分档，5 板以上合并", () => {
  const days = [
    day("2026-11-04", [
      { code: "A", board_num: 2, seal_nextday: true },
      { code: "B", board_num: 3, seal_nextday: false },
      { code: "C", board_num: 4, seal_nextday: true },
      { code: "D", board_num: 6, seal_nextday: true },
      { code: "E", board_num: 9, seal_nextday: false },
    ]),
  ];
  const st = promotionStats(days, { minSamples: 1 });
  assert.equal(st.levels.find((b) => b.id === "b3").ratePct, 0);
  assert.equal(st.levels.find((b) => b.id === "b4").ratePct, 100);
  const b5 = st.levels.find((b) => b.id === "b5p");
  assert.equal(b5.samples, 2);
  assert.equal(b5.ratePct, 50);
});

test("晋级率：样本不足标 reliable=false，无样本给 null 而不是 0", () => {
  const days = [day("2026-11-04", [{ code: "A", board_num: 2, seal_nextday: true }])];
  const st = promotionStats(days);
  const b2 = st.levels.find((b) => b.id === "b2");
  assert.equal(b2.reliable, false);
  assert.equal(MIN_PROMOTION_SAMPLES, 10);
  const b4 = st.levels.find((b) => b.id === "b4");
  assert.equal(b4.samples, 0);
  assert.equal(b4.ratePct, null);
});

test("晋级率：空数据与非法入参不抛错", () => {
  for (const v of [[], null, undefined, [{}], [{ date: "2026-11-05" }]]) {
    const st = promotionStats(v);
    assert.equal(st.totalSamples, 0);
    assert.equal(st.levels.length, BOARD_BUCKETS.length);
    assert.match(describePromotion(st), /没有可统计/);
  }
});

test("晋级率：日期乱序输入也能识别最新日", () => {
  const days = [
    day("2026-11-03", [{ code: "A", board_num: 2, seal_nextday: false }]),
    day("2026-11-05", [{ code: "B", board_num: 2, seal_nextday: null }]),
    day("2026-11-04", [{ code: "C", board_num: 2, seal_nextday: true }]),
  ];
  const st = promotionStats(days, { minSamples: 1 });
  assert.equal(st.newestDate, "2026-11-05");
  assert.equal(st.levels.find((b) => b.id === "b2").todayCount, 1);
  assert.equal(st.levels.find((b) => b.id === "b2").samples, 2);
});

test("竞价归组：一只票多条异动时取涨幅绝对值最大的那条", () => {
  const items = [
    { code: "600000", name: "浦发银行", warn_name: "大单买入", bid_change_pct: 1.2, at: "09:20" },
    { code: "600000", name: "浦发银行", warn_name: "涨停试盘", bid_change_pct: 3.5, at: "09:25" },
    { code: "000001", name: "平安银行", warn_name: "竞价抢筹", bid_change_pct: -2.0, at: "09:21" },
  ];
  const map = auctionFlagsOf(items);
  assert.equal(map.size, 2);
  assert.equal(map.get("600000").primary.warn_name, "涨停试盘");
  assert.equal(map.get("600000").all.length, 2);
  assert.equal(map.get("000001").primary.warn_name, "竞价抢筹");
});

test("竞价文案：涨幅缺失显示 --，且涨幅必须带「竞价」限定", () => {
  assert.equal(describeAuction({ primary: { warn_name: "涨停试盘", bid_change_pct: null } }), "涨停试盘（竞价 --）");
  assert.equal(
    describeAuction({ primary: { warn_name: "涨停试盘", bid_change_pct: 3.2, at: "09:25" } }),
    "涨停试盘（竞价 +3.20%，09:25）"
  );
  assert.equal(describeAuction({ primary: { warn_name: "涨停试盘", bid_change_pct: -1.5 } }), "涨停试盘（竞价 -1.50%）");
  // 实测里「急速下跌」配正涨幅是真实存在的，文案必须能自洽
  assert.equal(
    describeAuction({ primary: { warn_name: "急速下跌", bid_change_pct: 1.78 } }),
    "急速下跌（竞价 +1.78%）"
  );
  assert.equal(describeAuction(null), "");
});

test("竞价归组：空入参与无代码项被忽略", () => {
  assert.equal(auctionFlagsOf(null).size, 0);
  assert.equal(auctionFlagsOf([{ name: "无代码" }, { code: "" }]).size, 0);
});
