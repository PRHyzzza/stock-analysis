/**
 * 短线情绪与题材强度单测 — 覆盖 `src/utils/marketSentiment.js` 的三个纯函数。
 *
 * 背景：这两块是超短线唯一可用的「环境 + 题材」输入，算法错了不会报错，只会
 * 让分数悄悄失真。特别要守住两条：
 * 1. 数据缺失不能当「0 跌停 / 0 炸板」算（那会把没数据伪装成情绪极好）
 * 2. 融资融券 / 沪股通这类通用概念不能当题材（实测每只票都有，会把强度拉平）
 *
 * 跑法：pnpm test（= node --test "scripts/*.test.mjs"）
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  sentimentOf,
  sectorBoostOf,
  isGenericSector,
  describeSentiment,
} from "../src/utils/marketSentiment.js";

/** 2026-11-05 实测真实返回（涨停统计） */
function realStats(over = {}) {
  return {
    trade_date: "2026-11-05",
    seal_rate: 0.8125,
    limit_up: 65,
    touched: 80,
    open_count: 15,
    limit_down: 0,
    max_board: 4,
    ...over,
  };
}

test("情绪：实测口径下算出的分落在「回暖」档，系数略高于 1", () => {
  const s = sentimentOf(realStats());
  assert.equal(s.available, true);
  assert.ok(s.score >= 60 && s.score < 78, `实际 ${s.score}`);
  assert.equal(s.label, "回暖");
  assert.ok(s.factor > 1 && s.factor <= 1.06, `实际 ${s.factor}`);
  assert.deepEqual(s.missing, []);
  assert.equal(s.sealRatePct, 81.3);
  assert.equal(s.breakRatePct, 18.8);
});

test("情绪：冰点（涨停少、炸板多、有跌停）分数低且系数打折", () => {
  const s = sentimentOf({
    seal_rate: 0.35,
    limit_up: 8,
    touched: 40,
    open_count: 32,
    limit_down: 25,
    max_board: 1,
  });
  assert.ok(s.score < 25, `实际 ${s.score}`);
  assert.equal(s.label, "冰点");
  assert.ok(s.factor < 0.95, `实际 ${s.factor}`);
});

test("情绪：跌停数据缺失按中性处理并标注，不得当成 0 跌停", () => {
  const withZero = sentimentOf(realStats({ limit_down: 0 }));
  const unknown = sentimentOf(realStats({ limit_down: null }));
  assert.ok(unknown.missing.includes("limit_down"));
  // 未知的分数必须低于「0 跌停」：否则等于凭空给了满分
  assert.ok(unknown.score < withZero.score, `未知 ${unknown.score} 应低于 ${withZero.score}`);
  assert.match(describeSentiment(unknown), /缺 limit_down/);
});

test("情绪：封板率缺失时退到中性分，且炸板率仍可用", () => {
  const s = sentimentOf(realStats({ seal_rate: null }));
  assert.ok(s.missing.includes("seal_rate"));
  assert.equal(s.sealRatePct, null);
  // touched 存在 → 炸板率照样算
  assert.equal(s.breakRatePct, 18.8);
});

test("情绪：touched 缺失时用「涨停+炸板」兜底算炸板率", () => {
  const s = sentimentOf(realStats({ touched: null }));
  assert.equal(s.breakRatePct, round1(15 / 80 * 100));
});

test("情绪：无数据时返回不可用且系数为 1（不做任何调节）", () => {
  for (const v of [null, undefined, 0, "x"]) {
    const s = sentimentOf(v);
    if (s.available) continue;
    assert.equal(s.factor, 1);
    assert.equal(s.score, 0);
    assert.equal(s.label, "无数据");
  }
  assert.equal(sentimentOf(null).available, false);
});

test("情绪：分数恒在 0-100、系数恒在 0.90-1.10", () => {
  const cases = [
    { seal_rate: 1, limit_up: 400, touched: 400, open_count: 0, limit_down: 0, max_board: 20 },
    { seal_rate: 0, limit_up: 0, touched: 1, open_count: 1, limit_down: 500, max_board: 0 },
    { seal_rate: 0.6, limit_up: 50, touched: 80, open_count: 30, limit_down: 3, max_board: 6 },
  ];
  for (const c of cases) {
    const s = sentimentOf(c);
    assert.ok(s.score >= 0 && s.score <= 100, `score=${s.score}`);
    assert.ok(s.factor >= 0.9 && s.factor <= 1.1, `factor=${s.factor}`);
  }
});

test("通用概念识别：通道/指数/持仓类标签不算题材", () => {
  assert.equal(isGenericSector("融资融券"), true);
  assert.equal(isGenericSector("沪股通"), true);
  assert.equal(isGenericSector("同花顺漂亮100"), true);
  assert.equal(isGenericSector("白酒概念"), false);
  assert.equal(isGenericSector("工业金属"), false);
  assert.equal(isGenericSector(""), false);
});

test("题材强度：取非通用板块里最强的一条", () => {
  const sectors = [
    { thscode: "885520.TI", name: "沪股通", kind: "cn_concept" },
    { thscode: "885525.TI", name: "白酒概念", kind: "cn_concept" },
    { thscode: "881273.TI", name: "白酒", kind: "industry" },
  ];
  const quotes = new Map([
    ["885520.TI", 0.4],
    ["885525.TI", 2.1],
    ["881273.TI", 1.0],
  ]);
  const r = sectorBoostOf(sectors, quotes);
  assert.equal(r.available, true);
  // +2.1% 落在 [1.5, 3] 区间 → 4~6 之间
  assert.ok(r.boost > 4 && r.boost < 6, `实际 ${r.boost}`);
  assert.equal(r.best.name, "白酒概念");
});

test("题材强度：全是通用概念时不加成，并说明原因", () => {
  const r = sectorBoostOf(
    [
      { thscode: "885338.TI", name: "融资融券", kind: "cn_concept" },
      { thscode: "885520.TI", name: "沪股通", kind: "cn_concept" },
    ],
    new Map([["885338.TI", 5], ["885520.TI", 4]])
  );
  assert.equal(r.available, false);
  assert.equal(r.boost, 0);
  assert.match(r.reason, /通用标签/);
});

test("题材强度：板块全跌不加负分（风险项已单独扣）", () => {
  const r = sectorBoostOf(
    [{ thscode: "881168.TI", name: "工业金属", kind: "industry" }],
    new Map([["881168.TI", -3.2]])
  );
  assert.equal(r.available, true);
  assert.equal(r.boost, 0);
  assert.match(r.reason, /无明显强势/);
});

test("题材强度：板块涨幅缺失时不假装持平", () => {
  const r = sectorBoostOf(
    [{ thscode: "881168.TI", name: "工业金属", kind: "industry" }],
    new Map()
  );
  assert.equal(r.available, false);
  assert.match(r.reason, /行情缺失/);
});

test("题材强度：空板块列表返回不可用", () => {
  assert.equal(sectorBoostOf([], new Map()).available, false);
  assert.equal(sectorBoostOf(null, null).available, false);
});

function round1(v) {
  return Math.round(v * 10) / 10;
}
