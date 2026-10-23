/**
 * utils/paperEngine.js + paperRules.js + paperFees.js 单测
 *
 * 为什么值得锁：
 * 模拟盘的核心正确性全在三个口径上 ——「次日开盘成交（无前视）」「全额费用」「A 股 T+1」。
 * 这三条任意一条写错，账户曲线就会系统性偏乐观，而用户看到的只是一条漂亮的净值线。
 * 本用例用固定的假 K 线把这三条钉死。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_FEE_CONFIG, calcFee, buyCost, sellProceeds } from "../src/utils/paperFees.js";
import {
  floorLot,
  floorSellLot,
  getLotRule,
  canFill,
  fillPrice,
  getLimitPrices,
} from "../src/utils/paperRules.js";
import {
  createAccount,
  normalizeConfig,
  stepDay,
  summarizeAccount,
  heldTradingDays,
  buildSignals,
} from "../src/utils/paperEngine.js";

// ── 费用 ──────────────────────────────────────────────
test("费用 — 佣金最低 5 元，印花税仅卖出，过户费双向", () => {
  const small = calcFee("buy", 1000);
  assert.equal(small.commission, 5, "千元买入佣金应被最低 5 元托底");
  assert.equal(small.stampTax, 0, "买入不收印花税");
  assert.equal(small.transferFee, 0.01);
  assert.equal(small.total, 5.01);

  const big = calcFee("sell", 100000);
  assert.equal(big.commission, 25, "10 万 × 万 2.5 = 25 元");
  assert.equal(big.stampTax, 50, "卖出印花税 0.05%");
  assert.equal(big.transferFee, 1);
  assert.equal(big.total, 76);
});

test("费用 — 买入现金支出 / 卖出净回款方向正确，同价往返必亏", () => {
  const b = buyCost(20000);
  assert.ok(b.cash > b.amount, "买入应额外付费用");
  assert.equal(b.cash, 20005.2);
  const s = sellProceeds(20000);
  assert.ok(s.cash < s.amount, "卖出应扣费用");
  assert.equal(s.cash, 19984.8);
  // 同价格买卖一次，净亏 20.4 元（佣金双向 + 印花税 + 过户费）——这正是模拟盘相对回测的价值
  assert.equal(Math.round((s.cash - b.cash) * 100) / 100, -20.4);
});

test("费用 — 免五账户（commissionMin=0）不托底", () => {
  const fee = calcFee("buy", 1000, { ...DEFAULT_FEE_CONFIG, commissionMin: 0 });
  assert.equal(fee.commission, 0.25);
});

// ── 最小下单单位 ──────────────────────────────────────
test("最小单位 — 主板/创业板 100 股整数倍", () => {
  assert.deepEqual(getLotRule("600519").minShares, 100);
  assert.equal(floorLot("600519", 1999), 1900);
  assert.equal(floorLot("300750", 250), 200);
  assert.equal(floorLot("600519", 99), 0, "不足 100 股不能买");
});

test("最小单位 — 科创板 200 股起、之后 1 股递增", () => {
  assert.equal(floorLot("688981", 150), 0);
  assert.equal(floorLot("688981", 200), 200);
  assert.equal(floorLot("688981", 253), 253);
});

test("最小单位 — 北交所 100 股起、之后 1 股递增", () => {
  assert.equal(floorLot("830799", 99), 0);
  assert.equal(floorLot("830799", 137), 137);
});

test("最小单位 — 卖出允许零股一次性清仓", () => {
  // 持仓 137 股（科创板/北交所零股），全卖要能卖掉
  assert.equal(floorSellLot("830799", 137, 137), 137);
  // 只卖一部分时必须是最小单位整数倍
  assert.equal(floorSellLot("600519", 150, 500), 100);
  assert.equal(floorSellLot("600519", 500, 500), 500);
});

// ── 涨跌停与撮合门槛 ──────────────────────────────────
test("涨跌停价 — 按板块幅度、四舍五入到分", () => {
  assert.deepEqual(getLimitPrices("600519", 10), { limitPct: 10, upper: 11, lower: 9 });
  assert.deepEqual(getLimitPrices("300750", 10), { limitPct: 20, upper: 12, lower: 8 });
  const bj = getLimitPrices("830799", 10);
  assert.equal(bj.upper, 13);
});

test("撮合门槛 — 一字涨停买不进、一字跌停卖不出、停牌不成交", () => {
  const prev = 10;
  const upLimit = 11;
  const hitUp = { open: upLimit, high: upLimit, low: upLimit, close: upLimit, volume: 100, prev_close: prev };
  assert.equal(canFill("buy", hitUp, "600519").ok, false);
  assert.equal(canFill("sell", hitUp, "600519").ok, true, "涨停仍可卖出");

  const hitDown = { open: 9, high: 9, low: 9, close: 9, volume: 100, prev_close: prev };
  assert.equal(canFill("sell", hitDown, "600519").ok, false);
  assert.equal(canFill("buy", hitDown, "600519").ok, true, "跌停仍可买入");

  assert.equal(canFill("buy", { ...hitUp, open: 10.3, high: 11, low: 10, volume: 0 }, "600519").ok, false, "成交量为 0 = 停牌");
  assert.equal(canFill("buy", { open: 0, high: 0, low: 0, volume: 100, prev_close: prev }, "600519").ok, false);
});

test("成交价 — 买入上滑、卖出下滑，且夹在当日区间内", () => {
  const buy = fillPrice("buy", 10, { slippage: 0.001, code: "600519", prevClose: 10, dayHigh: 10.5, dayLow: 9.8 });
  assert.equal(buy, 10.01);
  const sell = fillPrice("sell", 10, { slippage: 0.001, code: "600519", prevClose: 10, dayHigh: 10.5, dayLow: 9.8 });
  assert.equal(sell, 9.99);
  // 滑点后越过当日最高 → 被夹住
  const capped = fillPrice("buy", 10.49, { slippage: 0.01, code: "600519", prevClose: 10, dayHigh: 10.5, dayLow: 9.8 });
  assert.equal(capped, 10.5);
  // 零滑点 = 开盘价
  assert.equal(fillPrice("buy", 10, { slippage: 0, code: "600519", prevClose: 10 }), 10);
});

// ── 引擎：无前视 + T+1 + 止损 ─────────────────────────
/** 生成一段日 K（升序），prices 为每天的 (open, high, low, close) */
function makeBars(code, rows) {
  return rows.map((r) => ({
    date: r.date,
    open: r.open,
    high: r.high ?? Math.max(r.open, r.close) * 1.01,
    low: r.low ?? Math.min(r.open, r.close) * 0.99,
    close: r.close,
    volume: r.volume ?? 10000,
  }));
}

const BARS_600519 = makeBars("600519", [
  { date: "2026-01-05", open: 10, close: 10 },
  { date: "2026-01-06", open: 10.0, close: 10.2 },
  { date: "2026-01-07", open: 10.3, close: 10.4 },
  { date: "2026-01-08", open: 10.4, close: 10.5 },
  { date: "2026-01-09", open: 10.6, close: 10.8 },
]);

/** 注入式假分析器：让 2026-01-05 收盘触发一条规则，之后不再触发 */
function fakeAnalyze(bars, code) {
  const asOf = bars[bars.length - 1]?.date || null;
  const active = asOf === "2026-01-05";
  return {
    bars: bars.length,
    enough: true,
    asOf,
    rules: [
      { id: "ma_golden", name: "均线金叉", hint: "", active, signalCount: active ? 1 : 0, barsAgo: 0, lastHitDate: asOf, evaluated: true, byPeriod: {} },
      { id: "vol_break", name: "放量突破", hint: "", active: false, signalCount: 0, barsAgo: null, lastHitDate: null, evaluated: true, byPeriod: {} },
    ],
  };
}

test("引擎 — 信号日收盘出单、次日开盘成交（无前视偏差）", () => {
  let acct = createAccount({ initialCash: 100000, holdDays: 0, stopLossPct: 0, takeProfitPct: 0, slippage: 0.001 });
  acct.pool = [{ code: "600519", name: "贵州茅台" }];
  const map = { "600519": BARS_600519 };

  // D1：无持仓无委托 → 只记净值 + 出买单
  let res = stepDay(acct, { date: "2026-01-05", barsByCode: map, analyze: fakeAnalyze });
  acct = res.account;
  assert.equal(res.report.filled.length, 0, "D1 不应有成交（当日收盘才知道信号）");
  assert.equal(res.report.entryOrders.length, 1, "D1 应挂出次日买单");
  assert.equal(acct.pending.length, 1);
  assert.equal(acct.pending[0].signalDate, "2026-01-05");

  // D2：按 D2 开盘价 10.00 × 1.001 成交
  res = stepDay(acct, { date: "2026-01-06", barsByCode: map, analyze: fakeAnalyze });
  acct = res.account;
  assert.equal(res.report.filled.length, 1);
  const buy = res.report.filled[0];
  assert.equal(buy.side, "buy");
  assert.equal(buy.price, 10.01, "买入价 = 次日开盘 10.00 + 0.1% 滑点");
  assert.equal(buy.shares, 1900);
  assert.ok(buy.feeTotal > 0, "必须计费用");
  assert.equal(acct.positions.length, 1);
  assert.equal(acct.positions[0].openDate, "2026-01-06");
  assert.equal(acct.cash, Math.round((100000 - (10.01 * 1900 + buy.feeTotal)) * 100) / 100);
});

test("引擎 — 当日买入当日不可卖（A 股 T+1）", () => {
  let acct = createAccount({ initialCash: 100000, holdDays: 1, stopLossPct: 0, takeProfitPct: 0 });
  acct.pool = [{ code: "600519", name: "贵州茅台" }];
  const map = { "600519": BARS_600519 };
  acct = stepDay(acct, { date: "2026-01-05", barsByCode: map, analyze: fakeAnalyze }).account;
  const r2 = stepDay(acct, { date: "2026-01-06", barsByCode: map, analyze: fakeAnalyze });
  // holdDays=1：D2 收盘时该持仓持有 0 个交易日，不应挂卖单
  assert.equal(r2.report.exitOrders.length, 0, "T+1：买入当日不挂卖单");
  assert.ok(!r2.account.pending.some((o) => o.side === "sell"));
});

test("引擎 — 持有期到点：收盘判断、次日开盘卖出，并算出已实现盈亏", () => {
  let acct = createAccount({ initialCash: 100000, holdDays: 2, stopLossPct: 0, takeProfitPct: 0, slippage: 0 });
  acct.pool = [{ code: "600519", name: "贵州茅台" }];
  const map = { "600519": BARS_600519 };

  acct = stepDay(acct, { date: "2026-01-05", barsByCode: map, analyze: fakeAnalyze }).account;
  acct = stepDay(acct, { date: "2026-01-06", barsByCode: map, analyze: fakeAnalyze }).account; // 买入
  acct = stepDay(acct, { date: "2026-01-07", barsByCode: map, analyze: fakeAnalyze }).account;
  const r4 = stepDay(acct, { date: "2026-01-08", barsByCode: map, analyze: fakeAnalyze }); // 持有 2 日 → 挂卖单
  acct = r4.account;
  assert.equal(r4.report.exitOrders.length, 1, "持有满 2 个交易日应挂卖单");
  assert.match(r4.report.exitOrders[0].reason, /持有期到/);

  const r5 = stepDay(acct, { date: "2026-01-09", barsByCode: map, analyze: fakeAnalyze });
  acct = r5.account;
  assert.equal(r5.report.filled.length, 1);
  const sell = r5.report.filled[0];
  assert.equal(sell.side, "sell");
  assert.equal(sell.price, 10.6, "卖出价 = 次日开盘 10.60（零滑点）");
  assert.ok(Number.isFinite(sell.realized), "卖出必须落已实现盈亏");
  assert.equal(acct.positions.length, 0, "清仓后持仓应为空");
  // 费用 + 滑点必然吃掉一点收益，但本轮价差为正 → 已实现盈亏应为正
  assert.ok(sell.realized > 0);
});

test("引擎 — 止损按收盘价判断并挂次日卖单", () => {
  const bars = makeBars("600519", [
    { date: "2026-02-02", open: 10, close: 10 },
    { date: "2026-02-03", open: 10, close: 10 },
    { date: "2026-02-04", open: 9.1, close: 9.0 }, // 较成本 10.0 跌 10% → 触发 -8% 止损
    { date: "2026-02-05", open: 8.9, close: 8.9 },
  ]);
  const analyze = (list) => {
    const asOf = list[list.length - 1]?.date || null;
    const active = asOf === "2026-02-02";
    return {
      bars: list.length,
      enough: true,
      asOf,
      rules: [{ id: "ma_golden", name: "均线金叉", active, signalCount: 0, barsAgo: 0, lastHitDate: asOf, evaluated: true, byPeriod: {} }],
    };
  };
  let acct = createAccount({ initialCash: 100000, holdDays: 0, stopLossPct: 8, takeProfitPct: 0, slippage: 0 });
  acct.pool = [{ code: "600519", name: "贵州茅台" }];
  const map = { "600519": bars };

  acct = stepDay(acct, { date: "2026-02-02", barsByCode: map, analyze }).account;
  acct = stepDay(acct, { date: "2026-02-03", barsByCode: map, analyze }).account; // 开盘 10.00 买入
  // 成本价含买入费用：20000 元成交 + 5.2 元费用，2000 股 → 10.0026
  assert.equal(acct.positions[0].shares, 2000);
  assert.equal(acct.positions[0].costPrice, 10.0026, "成本价必须含买入费用");
  const r3 = stepDay(acct, { date: "2026-02-04", barsByCode: map, analyze });
  assert.equal(r3.report.exitOrders.length, 1);
  assert.match(r3.report.exitOrders[0].reason, /止损/);
});

test("引擎 — 缺当日收盘价的持仓不用成本价冒充，标 partial 并记 missing", () => {
  let acct = createAccount({ initialCash: 100000, holdDays: 0 });
  acct.pool = [{ code: "600519", name: "贵州茅台" }];
  const map = { "600519": BARS_600519 };
  acct = stepDay(acct, { date: "2026-01-05", barsByCode: map, analyze: fakeAnalyze }).account;
  acct = stepDay(acct, { date: "2026-01-06", barsByCode: map, analyze: fakeAnalyze }).account;
  assert.equal(acct.positions.length, 1);

  // 2026-01-09 这根 K 线不在 map 里 → 该持仓缺价
  const res = stepDay(acct, { date: "2026-01-07", barsByCode: {}, analyze: fakeAnalyze });
  const nav = res.report.nav;
  assert.equal(nav.missing.length, 1);
  assert.equal(nav.missing[0], "600519");
  assert.equal(nav.partial, true);
  // 退化为成本价估值：市值仍 > 0，但被标记为 partial
  assert.ok(nav.marketValue > 0);
});

test("引擎 — 未注入 analyze 时不出信号（宁可空仓不假成交）", () => {
  const acct = createAccount({ initialCash: 50000 });
  acct.pool = [{ code: "600519", name: "贵州茅台" }];
  const res = stepDay(acct, { date: "2026-01-05", barsByCode: { "600519": BARS_600519 } });
  assert.equal(res.report.entryOrders.length, 0);
  assert.equal(res.account.pending.length, 0);
  assert.equal(buildSignals({ "600519": BARS_600519 }, {}, undefined)["600519"], undefined);
});

// ── 配置与汇总 ────────────────────────────────────────
test("配置 — 非法输入被夹到合法区间", () => {
  const cfg = normalizeConfig({ initialCash: -5, holdDays: -3, maxPositions: 999, slippage: 9, stopLossPct: -1 });
  assert.equal(cfg.initialCash, 10000, "初始资金下限 1 万");
  assert.equal(cfg.holdDays, 0);
  assert.equal(cfg.maxPositions, 50);
  assert.equal(cfg.slippage, 0.05);
  assert.equal(cfg.stopLossPct, 0);
});

test("汇总 — 胜率分母只算已平仓，样本不足打 enough=false", () => {
  const acct = createAccount({ initialCash: 100000 });
  acct.trades = [
    { side: "buy", realized: null, feeTotal: 5, cashDelta: -10005 },
    { side: "sell", realized: 200, feeTotal: 10, cashDelta: 10200 },
    { side: "sell", realized: -80, feeTotal: 10, cashDelta: 9920 },
    { side: "sell", realized: 0, feeTotal: 10, cashDelta: 10000 }, // 平盘不计入分母
  ];
  acct.nav = [
    { date: "2026-01-05", equity: 100000, cash: 100000, marketValue: 0, positionCount: 0, missing: [], partial: false },
    { date: "2026-01-06", equity: 110000, cash: 100000, marketValue: 10000, positionCount: 1, missing: [], partial: false },
    { date: "2026-01-07", equity: 99000, cash: 99000, marketValue: 0, positionCount: 0, missing: [], partial: false },
  ];
  const s = summarizeAccount(acct);
  assert.equal(s.winCount, 1);
  assert.equal(s.lossCount, 1);
  assert.equal(s.winRate, 50, "平盘不进分母");
  assert.equal(s.enough, false, "3 笔平仓 < 10 笔 → 样本不足");
  // 峰值 110000 → 回撤到 99000 = 10%
  assert.equal(s.maxDrawdown, 10);
  assert.equal(s.totalReturn, -1);
  assert.equal(s.feeTotal, 35);
});

test("持有交易日数 — 按 K 线序号算，找不到开仓日时按日期字符串兜底", () => {
  const bars = BARS_600519;
  assert.equal(heldTradingDays(bars, "2026-01-06", "2026-01-08"), 2);
  assert.equal(heldTradingDays(bars, "2025-12-30", "2026-01-08"), 4, "开仓日不在序列里时按日期区间兜底");
});
