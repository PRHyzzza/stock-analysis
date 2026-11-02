/**
 * utils/paperEngine.js + paperRules.js + paperFees.js 单测（手动模拟盘 v2）
 *
 * 为什么值得锁：手动盘的核心正确性全在这几条口径上 ——「按最新价 + 滑点成交」「全额费用」
 * 「A 股 T+1（含加仓）」「涨跌停不假装成交」「最小下单单位按板块」「缺价不写假净值」
 * 「FIFO 配对能复盘」。任意一条写错，账户曲线都会系统性偏乐观，而用户看到的只是一条漂亮的净值线。
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
  ACCOUNT_VERSION,
  applyOrder,
  createAccount,
  maxBuyShares,
  migrateAccount,
  normalizeConfig,
  previewOrder,
  recordNav,
  sellableShares,
  summarizeAccount,
  valuePositions,
} from "../src/utils/paperEngine.js";

const DAY1 = "2026-01-06";
const DAY2 = "2026-01-07";

/** 造一个下单请求（默认主板 10 元、昨收 10 元） */
function req(over = {}) {
  return {
    side: "buy",
    code: "600519",
    name: "贵州茅台",
    shares: 1000,
    date: DAY1,
    quote: { price: 10, prevClose: 10, high: 10.5, low: 9.8 },
    ...over,
  };
}

/** 直接买一笔并返回账户（测试数据准备用） */
function buyOnce(acct, over = {}) {
  const order = previewOrder(acct, req(over));
  assert.equal(order.ok, true, `准备数据时买入应成功：${order.reason}`);
  const res = applyOrder(acct, order, { date: over.date || DAY1, time: "10:00" });
  assert.ok(res.account, res.error);
  return res;
}

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
  assert.equal(Math.round((s.cash - b.cash) * 100) / 100, -20.4, "同价往返必须亏费用");
});

test("费用 — 免五账户（commissionMin=0）不托底", () => {
  const fee = calcFee("buy", 1000, { ...DEFAULT_FEE_CONFIG, commissionMin: 0 });
  assert.equal(fee.commission, 0.25);
});

// ── 最小下单单位 ──────────────────────────────────────
test("最小单位 — 主板/创业板 100 股整数倍", () => {
  assert.equal(getLotRule("600519").minShares, 100);
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
  assert.equal(floorSellLot("830799", 137, 137), 137);
  assert.equal(floorSellLot("600519", 150, 500), 100);
  assert.equal(floorSellLot("600519", 500, 500), 500);
});

// ── 涨跌停与成交价 ────────────────────────────────────
test("涨跌停价 — 按板块幅度、四舍五入到分", () => {
  assert.deepEqual(getLimitPrices("600519", 10), { limitPct: 10, upper: 11, lower: 9 });
  assert.deepEqual(getLimitPrices("300750", 10), { limitPct: 20, upper: 12, lower: 8 });
  assert.equal(getLimitPrices("830799", 10).upper, 13);
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
  assert.equal(fillPrice("buy", 10.49, { slippage: 0.01, code: "600519", prevClose: 10, dayHigh: 10.5, dayLow: 9.8 }), 10.5);
  assert.equal(fillPrice("buy", 10, { slippage: 0, code: "600519", prevClose: 10 }), 10);
});

// ── 手动下单：买入 ────────────────────────────────────
test("买入 — 按最新价 + 滑点成交，费用计入成本价", () => {
  const acct = createAccount({ initialCash: 100000 });
  const order = previewOrder(acct, req({ shares: 1000 }));
  assert.equal(order.ok, true);
  assert.equal(order.price, 10.01, "买入价 = 最新价 10 + 0.1% 滑点");
  assert.equal(order.shares, 1000);
  assert.equal(order.amount, 10010);
  assert.equal(order.feeTotal, 5.1, "佣金托底 5 + 过户费 0.1");
  assert.equal(order.cashDelta, -10015.1);

  const res = applyOrder(acct, order, { date: DAY1, time: "10:03" });
  const next = res.account;
  assert.equal(next.cash, 89984.9);
  assert.equal(next.positions.length, 1);
  assert.equal(next.positions[0].shares, 1000);
  assert.equal(next.positions[0].costPrice, 10.0151, "成本价必须含买入费用");
  assert.equal(next.trades.length, 1);
  assert.equal(next.trades[0].time, "10:03");
  assert.equal(next.trades[0].realized, null);
  assert.equal(next.version, ACCOUNT_VERSION);
});

test("买入 — 不改入参（引擎返回新对象）", () => {
  const acct = createAccount({ initialCash: 100000 });
  const order = previewOrder(acct, req());
  applyOrder(acct, order, { date: DAY1 });
  assert.equal(acct.positions.length, 0, "原账户不得被修改");
  assert.equal(acct.cash, 100000);
});

test("买入 — 股数按最小单位向下取整", () => {
  const acct = createAccount({ initialCash: 100000 });
  const order = previewOrder(acct, req({ shares: 150 }));
  assert.equal(order.ok, true);
  assert.equal(order.shares, 100, "150 股应规整为 100 股");

  const tooSmall = previewOrder(acct, req({ shares: 99 }));
  assert.equal(tooSmall.ok, false);
  assert.match(tooSmall.reason, /股数不合法/);
});

test("买入 — 资金不足时拒绝并给出可买上限", () => {
  const acct = createAccount({ initialCash: 5000 });
  const order = previewOrder(acct, req({ shares: 1000 }));
  assert.equal(order.ok, false);
  assert.match(order.reason, /最多可买|资金不足/);
  assert.ok(order.maxShares > 0 && order.maxShares < 1000, `可买上限应小于 1000，实际 ${order.maxShares}`);

  const max = maxBuyShares(acct, { code: "600519", price: 10.01 });
  assert.equal(max, order.maxShares, "maxBuyShares 与下单校验必须同源");
  const okOrder = previewOrder(acct, req({ shares: max }));
  assert.equal(okOrder.ok, true, "按上限买入应能成交");
  assert.ok(okOrder.cashDelta + acct.cash >= -1e-9);
});

test("买入 — 涨停不可买、停牌（无报价）不可买", () => {
  const acct = createAccount({ initialCash: 100000 });
  const atLimit = previewOrder(acct, req({ quote: { price: 11, prevClose: 10, high: 11, low: 11 } }));
  assert.equal(atLimit.ok, false);
  assert.match(atLimit.reason, /涨停/);

  const halted = previewOrder(acct, req({ quote: { price: 0, prevClose: 10 } }));
  assert.equal(halted.ok, false);
  assert.match(halted.reason, /行情无效/);
});

// ── 手动下单：卖出与 T+1 ───────────────────────────────
test("卖出 — 当日买入当日不可卖（T+1）", () => {
  const acct = createAccount({ initialCash: 100000 });
  const { account: holding } = buyOnce(acct);
  const sameDay = previewOrder(holding, req({ side: "sell", shares: 1000, date: DAY1 }));
  assert.equal(sameDay.ok, false);
  assert.match(sameDay.reason, /T\+1/);
});

test("卖出 — 次日卖出成功，已实现盈亏扣掉双边费用", () => {
  const acct = createAccount({ initialCash: 100000 });
  const { account: holding } = buyOnce(acct, { date: DAY1 });
  const order = previewOrder(holding, req({ side: "sell", shares: 1000, date: DAY2, quote: { price: 11, prevClose: 10, high: 11.2, low: 10.8 } }));
  assert.equal(order.ok, true);
  assert.equal(order.price, 10.99, "卖出价 = 11 - 0.1% 滑点（两位后 10.99）");
  assert.ok(Number.isFinite(order.realized));
  assert.ok(order.realized > 0, `价差为正时已实现应 > 0，实际 ${order.realized}`);

  const res = applyOrder(holding, order, { date: DAY2 });
  assert.equal(res.account.positions.length, 0, "清仓后持仓为空");
  assert.equal(res.account.trades.length, 2);
  assert.ok(res.account.cash > 100000, "整体应盈利");
});

test("卖出 — 部分卖出按比例结转成本，剩余持仓成本不变价", () => {
  const acct = createAccount({ initialCash: 100000 });
  const { account: holding } = buyOnce(acct, { shares: 1000 });
  const before = holding.positions[0];
  const order = previewOrder(holding, req({ side: "sell", shares: 400, date: DAY2, quote: { price: 12, prevClose: 11, high: 12.3, low: 11.8 } }));
  assert.equal(order.ok, true);
  const res = applyOrder(holding, order, { date: DAY2 });
  const pos = res.account.positions[0];
  assert.equal(pos.shares, 600);
  assert.equal(pos.costAmount, Math.round((before.costAmount * 0.6) * 100) / 100, "成本按 40% 结转");
  assert.equal(pos.costPrice, before.costPrice, "剩余持仓的成本价不应变化");
});

test("卖出 — 无持仓 / 跌停 / 超量卖出都被拒绝", () => {
  const acct = createAccount({ initialCash: 100000 });
  const noPos = previewOrder(acct, req({ side: "sell", shares: 100, date: DAY2 }));
  assert.equal(noPos.ok, false);
  assert.match(noPos.reason, /没有该标的的持仓/);

  const { account: holding } = buyOnce(acct, { shares: 500 });
  const atLimitDown = previewOrder(holding, req({ side: "sell", shares: 500, date: DAY2, quote: { price: 9, prevClose: 10, high: 9.1, low: 9 } }));
  assert.equal(atLimitDown.ok, false);
  assert.match(atLimitDown.reason, /跌停/);

  const tooMany = previewOrder(holding, req({ side: "sell", shares: 900, date: DAY2, quote: { price: 10, prevClose: 10, high: 10.2, low: 9.9 } }));
  assert.equal(tooMany.ok, true);
  assert.equal(tooMany.shares, 500, "超量卖出按可卖股数收敛");
});

test("T+1 — 加仓后当日只能卖昨仓，不锁死老仓", () => {
  const acct = createAccount({ initialCash: 200000 });
  const { account: d1 } = buyOnce(acct, { shares: 500, date: DAY1 });
  const { account: d2 } = buyOnce(d1, { shares: 300, date: DAY2 });

  const pos = d2.positions.find((p) => p.code === "600519");
  assert.equal(pos.shares, 800);
  assert.equal(pos.lockedDate, DAY2);
  assert.equal(pos.lockedShares, 300);
  assert.equal(sellableShares(pos, DAY2), 500, "当日买入的 300 股被锁，昨仓 500 股可卖");
  assert.equal(sellableShares(pos, "2026-01-08"), 800, "次日全部可卖");

  const order = previewOrder(d2, req({ side: "sell", shares: 800, date: DAY2, quote: { price: 10, prevClose: 10, high: 10.2, low: 9.9 } }));
  assert.equal(order.ok, true);
  assert.equal(order.shares, 500, "最多只能卖 500 股");
});

test("卖出 — 北交所零股可一次性清仓", () => {
  const acct = createAccount({ initialCash: 100000 });
  const order = previewOrder(acct, req({ code: "830799", shares: 137, quote: { price: 10, prevClose: 10, high: 10.2, low: 9.9 } }));
  assert.equal(order.ok, true);
  assert.equal(order.shares, 137);
  const { account: holding } = buyOnce(acct, { code: "830799", shares: 137, quote: { price: 10, prevClose: 10, high: 10.2, low: 9.9 } });
  assert.equal(holding.positions[0].shares, 137);

  const sellAll = previewOrder(holding, req({ side: "sell", code: "830799", shares: 137, date: DAY2, quote: { price: 10, prevClose: 10, high: 10.2, low: 9.9 } }));
  assert.equal(sellAll.ok, true);
  assert.equal(sellAll.shares, 137, "零股必须能一次卖光");
});

// ── 净值 ──────────────────────────────────────────────
test("净值 — 缺价不用成本价冒充，标 partial 并记 missing", () => {
  const acct = createAccount({ initialCash: 100000 });
  const { account: holding } = buyOnce(acct, { shares: 1000 });
  const res = recordNav(holding, { date: DAY1, prices: {} });
  assert.equal(res.nav.partial, true);
  assert.deepEqual(res.nav.missing, ["600519"]);
  assert.ok(res.nav.marketValue > 0, "缺价时按成本价估值，但必须标记 partial");
});

test("净值 — 有价时按市价，同日期覆盖不重复落点", () => {
  const acct = createAccount({ initialCash: 100000 });
  const { account: holding } = buyOnce(acct, { shares: 1000 });
  const r1 = recordNav(holding, { date: DAY1, prices: { "600519": 10.5 }, at: "10:30" });
  assert.equal(r1.nav.at, "10:30", "净值点要带记录时刻，用于判断当日是否已记收盘点");
  assert.equal(r1.nav.equity, Math.round((r1.nav.cash + 10500) * 100) / 100);
  assert.equal(r1.nav.partial, false);

  const r2 = recordNav(r1.account, { date: DAY1, prices: { "600519": 11 } });
  assert.equal(r2.account.nav.length, 1, "同一日期只保留一条净值");
  assert.equal(r2.nav.equity, Math.round((r2.nav.cash + 11000) * 100) / 100);
});

test("持仓估值 — 有价按市价、缺价按成本，浮盈口径一致", () => {
  const acct = createAccount({ initialCash: 100000 });
  const { account: holding } = buyOnce(acct, { shares: 1000 });
  const v = valuePositions(holding, { "600519": 11 });
  assert.equal(v.rows[0].marketValue, 11000);
  assert.equal(v.marketValue, 11000);
  assert.ok(v.rows[0].pnl > 0);
  assert.equal(v.missing.length, 0);

  const noPrice = valuePositions(holding, {});
  assert.deepEqual(noPrice.missing, ["600519"]);
  assert.equal(noPrice.rows[0].price, null);
});

// ── 迁移与汇总 ────────────────────────────────────────
test("迁移 — v1（选股跑批）账户转 v2：保留资金/持仓/成交/净值/自选，丢弃 pending 与 runs", () => {
  const v1 = {
    version: 1,
    createdAt: "2026-01-01",
    config: { initialCash: 100000, holdDays: 5, minScore: 60, slippage: 0.002, fees: { commissionMin: 0 } },
    cash: 50000,
    positions: [{ code: "600519", name: "贵州茅台", shares: 1000, costPrice: 10, costAmount: 10000, openDate: "2026-01-05", openRules: ["ma_golden"] }],
    pending: [{ id: "1", side: "buy", code: "000001" }],
    trades: [{ id: "T1", side: "buy", realized: null, feeTotal: 5 }],
    runs: [{ date: "2026-01-05", scored: 3 }],
    nav: [{ date: "2026-01-05", equity: 51000 }],
    pool: [{ code: "600519", name: "贵州茅台" }],
    lastRunDate: "2026-01-05",
  };
  const acct = migrateAccount(v1);
  assert.ok(acct, "v1 账户必须能迁移，不能被静默丢弃");
  assert.equal(acct.version, ACCOUNT_VERSION);
  assert.equal(acct.cash, 50000);
  assert.equal(acct.positions.length, 1);
  assert.equal(acct.positions[0].shares, 1000);
  assert.equal(acct.positions[0].lockedShares, 0);
  assert.equal(acct.positions[0].lots.length, 1, "迁移要给老持仓补一个批次");
  assert.equal(acct.trades.length, 1);
  assert.equal(acct.nav.length, 1);
  assert.equal(acct.pool.length, 1);
  assert.equal(acct.migratedFrom, 1);
  assert.equal("pending" in acct, false, "pending 必须丢弃（新模型没有委托队列）");
  assert.equal("runs" in acct, false, "runs 必须丢弃");
  assert.equal("lastRunDate" in acct, false);
  assert.equal(acct.config.slippage, 0.002, "滑点等仍有效的配置应保留");
  assert.equal("minScore" in acct.config, false, "选股参数不再保留");
});

test("迁移 — v2 账户原样读取，结构缺损补齐", () => {
  const acct = migrateAccount({ version: 2, cash: 1000, config: {}, positions: null });
  assert.equal(acct.cash, 1000);
  assert.deepEqual(acct.positions, []);
  assert.deepEqual(acct.trades, []);
  assert.equal(migrateAccount({ version: 99 }), null, "未知版本返回 null（交调用方新建）");
  assert.equal(migrateAccount(null), null);
});

test("配置 — 非法输入被夹到合法区间，旧字段被丢弃", () => {
  const cfg = normalizeConfig({ initialCash: -5, slippage: 9, holdDays: 3, minScore: 60 });
  assert.equal(cfg.initialCash, 10000);
  assert.equal(cfg.slippage, 0.05);
  assert.equal("holdDays" in cfg, false, "手动盘不再有持有期配置");
  assert.equal("minScore" in cfg, false);
});

test("汇总 — 胜率分母只算已平仓，样本不足打 enough=false", () => {
  const acct = createAccount({ initialCash: 100000 });
  acct.trades = [
    { side: "buy", realized: null, feeTotal: 5, cashDelta: -10005 },
    { side: "sell", realized: 200, feeTotal: 10, cashDelta: 10200 },
    { side: "sell", realized: -80, feeTotal: 10, cashDelta: 9920 },
    { side: "sell", realized: 0, feeTotal: 10, cashDelta: 10000 },
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
  assert.equal(s.maxDrawdown, 10);
  assert.equal(s.totalReturn, -1);
  assert.equal(s.feeTotal, 35);
});

// ── 停牌闸门与 FIFO 配对 ──────────────────────────────
test("买入 — 成交量为 0（停牌）拒单，缺失成交量时不拦", () => {
  const acct = createAccount({ initialCash: 100000 });
  const halted = previewOrder(
    acct,
    req({ quote: { price: 10, prevClose: 10, high: 10.5, low: 9.8, volume: 0 } })
  );
  assert.equal(halted.ok, false);
  assert.match(halted.reason, /停牌|成交量/);

  const noVolume = previewOrder(acct, req({ quote: { price: 10, prevClose: 10, high: 10.5, low: 9.8 } }));
  assert.equal(noVolume.ok, true, "行情里没有成交量字段时不应误判停牌");
});

test("FIFO — 三批买入后卖出，按先买先出配对并记录持有天数与买入时战法", () => {
  const acct = createAccount({ initialCash: 100000, slippage: 0 });
  const d1 = "2026-01-06";
  const d2 = "2026-01-08";
  const d3 = "2026-01-09";
  const d4 = "2026-01-10";
  const buy = (a, date, price, prev, meta) =>
    applyOrder(
      a,
      previewOrder(a, req({ shares: 100, date, quote: { price, prevClose: prev, high: price * 1.02, low: price * 0.99 }, meta })),
      { date }
    ).account;

  let holding = buy(acct, d1, 10, 10, { score: 82, patterns: ["趋势跟随"] });
  holding = buy(holding, d2, 12, 12, { score: 61, patterns: [] });
  holding = buy(holding, d3, 11, 11, null);

  assert.equal(holding.positions[0].lots.length, 3, "三次买入应留下三个批次");
  assert.equal(holding.trades[0].meta.score, 82, "买入交易要带上参考分，供复盘归因");
  // 150 股不是主板合法单位会被取整成 100；200 股正好跨前两个批次
  const sellOrder = previewOrder(holding, req({ side: "sell", shares: 200, date: d4, quote: { price: 13, prevClose: 12, high: 13.2, low: 12.1 } }));
  assert.equal(sellOrder.ok, true);
  assert.equal(sellOrder.shares, 200);
  assert.equal(sellOrder.matches.length, 2, "跨两个批次卖出应生成两段配对");

  const res = applyOrder(holding, sellOrder, { date: d4 });
  const trade = res.trade;
  assert.equal(trade.matches.length, 2);
  assert.equal(trade.matches[0].shares, 100, "第一段来自第一批");
  assert.equal(trade.matches[0].buyDate, d1);
  assert.equal(trade.matches[0].holdDays, 4, "01-06 → 01-10 = 4 个自然日");
  assert.equal(trade.matches[1].buyDate, d2);
  assert.equal(trade.matches[1].holdDays, 2);
  assert.deepEqual(trade.matches[0].meta.patterns, ["趋势跟随"], "配对要继承买入时的战法");
  assert.equal(trade.realized, Math.round((trade.matches[0].pnl + trade.matches[1].pnl) * 100) / 100);

  const pos = res.account.positions[0];
  assert.equal(pos.shares, 100, "卖掉 200 后应只剩第三批");
  assert.equal(pos.lots.length, 1);
  assert.equal(pos.lots[0].date, d3, "剩余批次必须是最后买入的那批");
  assert.ok(pos.costPrice > 11, "剩余成本含买入费用，应高于成交价");
});
