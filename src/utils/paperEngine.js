/**
 * paperEngine — 手动模拟盘撮合与记账（**纯函数**，无 Vue / 无 Tauri / 无 localStorage）
 *
 * 运行模型（v2，与 v1 的「每日跑批」完全不同）：
 *   用户自己决定买卖 → 按**当前实时价 + 滑点**立即成交 → 记账（现金/持仓/流水/净值）。
 *   没有信号、没有委托队列、没有次日开盘撮合、没有自动平仓。
 *
 * 口径（与 PROJECT.md §7.35 一致）：
 * 1. **成交价 = 最新价 ± 滑点**，按 tick 对齐并夹在当日高低与涨跌停之间（`paperRules.fillPrice`）。
 *    「市价单」在真实交易里就是吃掉盘口，滑点是对这件事的最低限度补偿。
 * 2. **只在交易时段内允许下单**（由调用方用 `marketTime.getMarketStatus` 判定后传入），
 *    引擎自身不读时钟——纯函数才能被单测。
 * 3. **涨停不可买、跌停不可卖**：模拟盘宁可少成交，也不假装在涨停板上买到了。
 * 4. **A 股 T+1**：当日买入的股份当日不可卖出。这里按「锁定股数」精确记账——
 *    昨天买 500 股、今天再买 300 股，今天最多只能卖 500 股（旧版用 `openDate === date`
 *    直接判死，加仓后连老仓都卖不了，是错的）。
 * 5. **费用全额计入**（`paperFees.js` 唯一口径）：佣金万 2.5 最低 5 元、印花税仅卖出 0.05%、
 *    过户费双向 0.001%。同价往返必然亏损。
 * 6. **最小下单单位按板块**（`paperRules.getLotRule`）：主板/创业板 100 股整数倍，
 *    科创板 200 股起 1 股递增，北交所 100 股起 1 股递增；卖出允许零股一次性清仓。
 * 7. **缺价不用成本价冒充**（§7.24）：净值缺价时退化为成本价估值并标 `partial` + `missing`。
 * 8. 日期一律 `YYYY-MM-DD` 本地日期字符串，禁止 `toISOString()`（§7.13）。
 */
import { DEFAULT_FEE_CONFIG, buyCost, sellProceeds } from "./paperFees.js";
import { floorLot, floorSellLot, getLimitPrices, getLotRule } from "./paperRules.js";
import { fillPrice } from "./paperRules.js";

/** 账户模型版本（localStorage 迁移用）；v1 = 选股跑批，v2 = 手动交易 */
export const ACCOUNT_VERSION = 2;

/** 默认配置（只保留手动交易需要的项） */
export const DEFAULT_CONFIG = Object.freeze({
  /** 初始资金（元） */
  initialCash: 100000,
  /** 单向滑点（小数，0.001 = 0.1%） */
  slippage: 0.001,
  /** 费率配置 */
  fees: { ...DEFAULT_FEE_CONFIG },
});

function nz(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * 配置规整（用户输入一律过一遍）
 * @param {object} [raw]
 */
export function normalizeConfig(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const fees = { ...DEFAULT_FEE_CONFIG, ...(src.fees && typeof src.fees === "object" ? src.fees : {}) };
  return {
    initialCash: clampNumber(src.initialCash, 10000, 100000000, DEFAULT_CONFIG.initialCash),
    slippage: clampNumber(src.slippage, 0, 0.05, DEFAULT_CONFIG.slippage),
    fees: {
      commissionRate: clampNumber(fees.commissionRate, 0, 0.01, DEFAULT_FEE_CONFIG.commissionRate),
      commissionMin: clampNumber(fees.commissionMin, 0, 100, DEFAULT_FEE_CONFIG.commissionMin),
      stampTaxRate: clampNumber(fees.stampTaxRate, 0, 0.01, DEFAULT_FEE_CONFIG.stampTaxRate),
      transferFeeRate: clampNumber(fees.transferFeeRate, 0, 0.01, DEFAULT_FEE_CONFIG.transferFeeRate),
    },
  };
}

/**
 * 新建账户
 * @param {object} [config]
 * @param {{ pool?: Array, createdAt?: string }} [meta]
 */
export function createAccount(config = {}, meta = {}) {
  const cfg = normalizeConfig(config);
  return {
    version: ACCOUNT_VERSION,
    createdAt: meta.createdAt || null,
    config: cfg,
    /** 可用现金（元） */
    cash: cfg.initialCash,
    /** 持仓：{ code, name, shares, costPrice, costAmount, openDate, lockedDate, lockedShares } */
    positions: [],
    /** 成交流水（只增不改） */
    trades: [],
    /** 每日净值（同一日期只保留一条） */
    nav: [],
    /** 自选池：{ code, name, addedAt, source } */
    pool: Array.isArray(meta.pool) ? meta.pool.filter((p) => p && p.code) : [],
  };
}

/** 深拷贝账户（引擎一律不改入参） */
function cloneAccount(acct) {
  return JSON.parse(JSON.stringify(acct));
}

/**
 * 每日净值：现金 + 持仓市值（缺价退化为成本价并标记）
 * @param {object} acct
 * @param {(code: string) => number|null} priceOf
 */
function equityOf(acct, priceOf) {
  let mv = 0;
  const missing = [];
  for (const p of acct.positions || []) {
    const px = priceOf(p.code);
    if (px == null) {
      mv += nz(p.costPrice) * nz(p.shares);
      missing.push(p.code);
    } else {
      mv += px * nz(p.shares);
    }
  }
  return { equity: acct.cash + mv, marketValue: mv, missing };
}

/**
 * 账户迁移（v1「选股跑批」→ v2「手动交易」）
 *
 * 保留：现金、持仓、成交流水、净值曲线、自选池、初始资金/滑点/费率。
 * 丢弃：`pending`（未成交委托）、`runs`（每日跑批日志）、`lastRunDate`——
 *   这些在手动盘里没有意义，留着只会让 UI 与统计口径出现两套语义。
 *
 * @param {object} raw localStorage 里读到的原始对象
 * @returns {object|null} 迁移后的账户；结构不认识返回 null
 */
export function migrateAccount(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (raw.version === ACCOUNT_VERSION) {
    const acct = { ...raw };
    for (const key of ["positions", "trades", "nav", "pool"]) {
      if (!Array.isArray(acct[key])) acct[key] = [];
    }
    acct.config = normalizeConfig(acct.config);
    acct.cash = nz(acct.cash, acct.config.initialCash);
    // 早期 v2 账户没有批次：用持仓整体补一个，保证 FIFO 配对可用
    acct.positions = acct.positions
      .filter((p) => p && p.code)
      .map((p) => ({ ...p, lots: normalizeLots(p) }));
    return acct;
  }

  if (raw.version === 1) {
    const cfg = normalizeConfig(raw.config);
    const acct = {
      version: ACCOUNT_VERSION,
      createdAt: raw.createdAt || null,
      config: cfg,
      cash: nz(raw.cash, cfg.initialCash),
      positions: (Array.isArray(raw.positions) ? raw.positions : []).map((p) => ({
        code: String(p?.code ?? ""),
        name: String(p?.name ?? ""),
        shares: Math.floor(nz(p?.shares)),
        costPrice: nz(p?.costPrice),
        costAmount: nz(p?.costAmount, nz(p?.costPrice) * nz(p?.shares)),
        openDate: p?.openDate || null,
        lockedDate: null,
        lockedShares: 0,
        lots: normalizeLots({ ...p, openDate: p?.openDate || null }),
      })),
      trades: Array.isArray(raw.trades) ? raw.trades : [],
      nav: Array.isArray(raw.nav) ? raw.nav : [],
      pool: Array.isArray(raw.pool) ? raw.pool.filter((p) => p && p.code) : [],
      /** 迁移标记：UI 可据此提示「已从旧版账户切换为手动交易」 */
      migratedFrom: 1,
    };
    return acct;
  }

  return null;
}

/**
 * 最大可买股数（含费用、按最小下单单位规整）
 * @param {object} acct
 * @param {{ code: string, price: number }} opts
 * @returns {number}
 */
export function maxBuyShares(acct, { code, price }) {
  const p = Number(price);
  const cash = nz(acct?.cash);
  if (!(p > 0) || cash <= 0) return 0;
  const fees = acct?.config?.fees || DEFAULT_FEE_CONFIG;
  let shares = floorLot(code, cash / p);
  let guard = 0;
  while (shares > 0 && guard++ < 200) {
    const cost = buyCost(round2(p * shares), fees);
    if (cost.cash <= cash) return shares;
    const cheaper = floorLot(code, shares - 1);
    if (cheaper === shares) break;
    shares = cheaper;
  }
  return 0;
}

/** 持仓可卖股数（扣除当日买入被 T+1 锁定的部分） */
export function sellableShares(pos, date) {
  const total = Math.floor(nz(pos?.shares));
  if (total <= 0) return 0;
  const locked = pos?.lockedDate && pos.lockedDate === date ? Math.floor(nz(pos.lockedShares)) : 0;
  return Math.max(0, total - locked);
}

/**
 * 归一化持仓批次（FIFO）
 *
 * 老账户（v1/v2 早期）没有 `lots`，用持仓整体补一个批次（日期取 `openDate`）——
 * 这样 FIFO 配对不会因为「没有批次」而退化成按加权成本算，历史交易的持有天数仍可追溯。
 */
export function normalizeLots(pos) {
  if (Array.isArray(pos?.lots) && pos.lots.length) {
    return pos.lots
      .filter((l) => l && nz(l.shares) > 0)
      .map((l) => ({
        date: String(l.date ?? ""),
        shares: Math.floor(nz(l.shares)),
        costPerShare: nz(l.costPerShare, nz(pos.costPrice)),
        meta: l.meta || null,
      }));
  }
  const shares = Math.floor(nz(pos?.shares));
  if (shares <= 0) return [];
  return [
    {
      date: String(pos?.openDate ?? ""),
      shares,
      costPerShare: nz(pos?.costPrice),
      meta: null,
    },
  ];
}

/** 两个 YYYY-MM-DD 之间相差的自然日（无法解析返回 null） */
function daysBetween(from, to) {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** 批次成本合计 */
function lotsCost(lots) {
  return round2((lots || []).reduce((s, l) => s + nz(l.costPerShare) * nz(l.shares), 0));
}

/**
 * 按 FIFO 消耗批次，算出每段的平仓盈亏（**纯函数**，不改入参）
 *
 * 卖出费用按股数平摊进 `proceedsPerShare`（净回款/股），因此每段盈亏都是「净额对净额」，
 * 不会出现「买入算费用、卖出不算」的半截口径。
 *
 * @param {Array} lots normalizeLots 的结果
 * @param {{ shares: number, sellDate: string, proceedsPerShare: number }} req
 * @returns {{ matches: Array, remaining: Array, realized: number }}
 */
export function consumeLots(lots, { shares, sellDate, proceedsPerShare }) {
  let need = Math.floor(nz(shares));
  const matches = [];
  const remaining = [];
  let realized = 0;
  const src = (Array.isArray(lots) ? lots : []).filter((l) => l && nz(l.shares) > 0);
  for (const lot of src) {
    if (need <= 0) {
      remaining.push({ ...lot });
      continue;
    }
    const take = Math.min(need, lot.shares);
    const pnl = round2((nz(proceedsPerShare) - nz(lot.costPerShare)) * take);
    matches.push({
      code: "",
      shares: take,
      buyDate: lot.date,
      buyPrice: round2(nz(lot.costPerShare)),
      sellDate: String(sellDate ?? ""),
      sellPrice: round2(nz(proceedsPerShare)),
      pnl,
      holdDays: daysBetween(lot.date, sellDate),
      meta: lot.meta || null,
    });
    realized += pnl;
    need -= take;
    if (lot.shares - take > 0) remaining.push({ ...lot, shares: lot.shares - take });
  }
  return { matches, remaining, realized: round2(realized) };
}

/**
 * 下单预校验（**不下单**）：把行情与账户约束折算成「能不能成交、成交多少、花多少钱」
 *
 * @param {object} acct
 * @param {{
 *   side: "buy"|"sell",
 *   code: string,
 *   name?: string,
 *   quote: { price: number, prevClose?: number, high?: number, low?: number },
 *   shares: number,
 *   date: string,
 * }} req
 * @returns {{
 *   ok: boolean, reason: string, side: string, code: string, name: string,
 *   price: number, shares: number, amount: number,
 *   fee: object, feeTotal: number, cashDelta: number, realized: number|null, maxShares: number
 * }}
 */
export function previewOrder(acct, req = {}) {
  const side = req.side === "sell" ? "sell" : "buy";
  const code = String(req.code ?? "").trim();
  const date = String(req.date ?? "");
  const cfg = acct?.config || normalizeConfig({});
  const quote = req.quote || {};
  const fail = (reason, extra = {}) => ({
    ok: false,
    reason,
    side,
    code,
    name: String(req.name ?? quote.name ?? ""),
    price: 0,
    shares: 0,
    amount: 0,
    fee: { commission: 0, stampTax: 0, transferFee: 0, total: 0, rate: 0 },
    feeTotal: 0,
    cashDelta: 0,
    realized: null,
    matches: [],
    meta: null,
    maxShares: 0,
    ...extra,
  });

  if (!/^\d{6}$/.test(code)) return fail("请输入 6 位 A 股代码（模拟盘只做 A 股）");
  if (!(Number(quote.price) > 0)) return fail("行情无效（停牌或未取到报价），暂不能下单");
  // 成交量 0 = 当日停牌：腾讯对停牌股仍可能返回昨收价，只判 price 会「买到一只没成交的票」
  const vol = quote.volume == null ? null : Number(quote.volume);
  if (vol != null && Number.isFinite(vol) && vol <= 0) {
    return fail("该标的当前成交量为 0（疑似停牌），今日无法成交");
  }

  const price = fillPrice(side, quote.price, {
    slippage: cfg.slippage,
    code,
    prevClose: quote.prevClose,
    dayHigh: quote.high,
    dayLow: quote.low,
  });
  if (price == null) return fail("成交价无效，暂不能下单");

  // 涨跌停：模拟盘不假装在板上成交
  const { upper, lower } = getLimitPrices(code, quote.prevClose);
  if (side === "buy" && upper != null && Number(quote.price) >= upper - 0.005) {
    return fail(`已涨停（${upper.toFixed(2)}），涨停板买不进`);
  }
  if (side === "sell" && lower != null && Number(quote.price) <= lower + 0.005) {
    return fail(`已跌停（${lower.toFixed(2)}），跌停板卖不出`);
  }

  if (side === "buy") {
    const want = floorLot(code, nz(req.shares));
    const lot = getLotRule(code);
    if (want <= 0) return fail(`股数不合法：${lot.lotLabel}`);

    const amount = round2(price * want);
    const cost = buyCost(amount, cfg.fees);
    if (cost.cash > nz(acct.cash) + 1e-9) {
      const max = maxBuyShares(acct, { code, price });
      return fail(max > 0 ? `可用资金不足，最多可买 ${max} 股` : "可用资金不足一个最小下单单位", {
        maxShares: max,
      });
    }
    return {
      ok: true,
      reason: "",
      side,
      code,
      name: String(req.name ?? quote.name ?? ""),
      price,
      shares: want,
      amount,
      fee: cost.fee,
      feeTotal: cost.fee.total,
      cashDelta: -cost.cash,
      realized: null,
      matches: [],
      meta: req.meta || null,
      maxShares: want,
    };
  }

  const pos = (acct?.positions || []).find((p) => p.code === code);
  if (!pos) return fail("没有该标的的持仓");
  const sellable = sellableShares(pos, date);
  if (sellable <= 0) return fail("T+1：今日买入的股份今日不可卖出");

  const want = floorSellLot(code, nz(req.shares), sellable);
  if (want <= 0) return fail(`可卖 ${sellable} 股，卖出股数需符合最小单位`, { maxShares: sellable });

  const amount = round2(price * want);
  const proceeds = sellProceeds(amount, cfg.fees);
  // 卖出费用按股数平摊到每股，FIFO 每段都是「净回款 vs 含费成本」的同口径比较
  const proceedsPerShare = want > 0 ? proceeds.cash / want : 0;
  const fifo = consumeLots(normalizeLots(pos), { shares: want, sellDate: date, proceedsPerShare });
  const realized = fifo.matches.length
    ? fifo.realized
    : round2(proceeds.cash - round2(nz(pos.costAmount) * (want / Math.max(1, nz(pos.shares)))));
  return {
    ok: true,
    reason: "",
    side,
    code,
    name: String(req.name ?? pos.name ?? ""),
    price,
    shares: want,
    amount,
    fee: proceeds.fee,
    feeTotal: proceeds.fee.total,
    cashDelta: proceeds.cash,
    realized,
    matches: fifo.matches,
    meta: null,
    maxShares: sellable,
  };
}

/**
 * 执行下单（订单必须来自 `previewOrder` 且 `ok === true`）
 *
 * @param {object} acct
 * @param {object} order previewOrder 的返回值
 * @param {{ date: string, time?: string }} meta
 * @returns {{ account: object|null, trade: object|null, error: string }}
 */
export function applyOrder(acct, order, { date, time = "" } = {}) {
  if (!order || !order.ok) return { account: null, trade: null, error: order?.reason || "订单无效" };
  const next = cloneAccount(acct);
  const d = String(date ?? "");
  if (!d) return { account: null, trade: null, error: "缺少交易日期" };

  const id = `T${(next.trades?.length || 0) + 1}`;
  const base = {
    id,
    date: d,
    time: String(time || ""),
    code: order.code,
    name: order.name || "",
    side: order.side,
    price: order.price,
    shares: order.shares,
    amount: order.amount,
    fee: order.fee,
    feeTotal: order.feeTotal,
    cashDelta: order.cashDelta,
    realized: order.realized ?? null,
    /** 平仓配对明细（FIFO，仅卖出有）：[{ shares, buyDate, buyPrice, sellDate, sellPrice, pnl, holdDays, meta }] */
    matches: [],
    /** 下单时附带的参考信息（分数/命中战法），仅买入有，用于复盘归因 */
    meta: order.meta || null,
  };

  if (order.side === "buy") {
    if (order.cashDelta + nz(next.cash) < -1e-9) {
      return { account: null, trade: null, error: "可用资金不足" };
    }
    next.cash = round2(next.cash + order.cashDelta);

    const actualCost = Math.abs(order.cashDelta); // 成交金额 + 费用
    const costPerShare = order.shares > 0 ? actualCost / order.shares : 0;
    const existing = (next.positions || []).find((p) => p.code === order.code);
    if (existing) {
      const lots = [...normalizeLots(existing), { date: d, shares: order.shares, costPerShare, meta: order.meta || null }];
      existing.lots = lots;
      existing.shares += order.shares;
      existing.costAmount = lotsCost(lots);
      existing.costPrice = Math.round((existing.costAmount / existing.shares) * 10000) / 10000;
      if (existing.lockedDate === d) existing.lockedShares = nz(existing.lockedShares) + order.shares;
      else {
        existing.lockedDate = d;
        existing.lockedShares = order.shares;
      }
      if (!existing.name && order.name) existing.name = order.name;
    } else {
      next.positions.push({
        code: order.code,
        name: order.name || "",
        shares: order.shares,
        costPrice: Math.round(costPerShare * 10000) / 10000,
        costAmount: actualCost,
        openDate: d,
        lockedDate: d,
        lockedShares: order.shares,
        lots: [{ date: d, shares: order.shares, costPerShare, meta: order.meta || null }],
      });
    }
  } else {
    const pos = (next.positions || []).find((p) => p.code === order.code);
    if (!pos) return { account: null, trade: null, error: "没有该标的的持仓" };
    if (sellableShares(pos, d) < order.shares) return { account: null, trade: null, error: "可卖股数不足（T+1）" };

    next.cash = round2(next.cash + order.cashDelta);
    // FIFO 消耗批次：每段都留下「买入日 / 持有天数 / 盈亏」，复盘才能按持有期与战法归因
    const proceedsPerShare = order.shares > 0 ? order.cashDelta / order.shares : 0;
    const fifo = consumeLots(normalizeLots(pos), {
      shares: order.shares,
      sellDate: d,
      proceedsPerShare,
    });
    pos.lots = fifo.remaining;
    pos.shares -= order.shares;
    pos.costAmount = lotsCost(fifo.remaining);
    pos.costPrice = pos.shares > 0 ? Math.round((pos.costAmount / pos.shares) * 10000) / 10000 : 0;
    if (fifo.matches.length) {
      base.matches = fifo.matches.map((m) => ({ ...m, code: order.code, name: order.name || pos.name || "" }));
      base.realized = fifo.realized;
    }
    if (pos.shares <= 0) {
      next.positions = next.positions.filter((p) => p.code !== order.code);
    }
  }

  next.trades = [...(next.trades || []), base];
  return { account: next, trade: base, error: "" };
}

/**
 * 记录当日净值（同一日期覆盖）
 * @param {object} acct
 * @param {{ date: string, prices: Object<string, number> }} ctx
 */
export function recordNav(acct, { date, prices, at = "" } = {}) {
  const next = cloneAccount(acct);
  const map = prices && typeof prices === "object" ? prices : {};
  const priceOf = (code) => {
    const p = Number(map[code]);
    return Number.isFinite(p) && p > 0 ? p : null;
  };
  const { equity, marketValue, missing } = equityOf(next, priceOf);
  const nav = {
    date: String(date ?? ""),
    /** 记录时刻 HH:mm：用于判断「今天是否已经记过收盘点」 */
    at: String(at || ""),
    equity: round2(equity),
    cash: round2(next.cash),
    marketValue: round2(marketValue),
    positionCount: (next.positions || []).length,
    missing,
    partial: missing.length > 0,
  };
  if (!nav.date) return { account: next, nav: null };
  const existing = (next.nav || []).findIndex((r) => r.date === nav.date);
  if (existing >= 0) next.nav[existing] = nav;
  else next.nav = [...(next.nav || []), nav];
  // 只保留最近 800 个交易日，避免 localStorage 膨胀
  if (next.nav.length > 800) next.nav = next.nav.slice(-800);
  return { account: next, nav };
}

/**
 * 持仓逐只估值（UI 用；纯计算，不改账户）
 * @param {object} acct
 * @param {Object<string, number>} prices code → 最新价
 * @returns {{ rows: Array, marketValue: number, missing: string[] }}
 */
export function valuePositions(acct, prices = {}) {
  const rows = [];
  let mv = 0;
  const missing = [];
  for (const p of acct?.positions || []) {
    const px = Number(prices?.[p.code]);
    const hasPrice = Number.isFinite(px) && px > 0;
    if (!hasPrice) missing.push(p.code);
    const cost = nz(p.costPrice) * nz(p.shares);
    const value = hasPrice ? px * nz(p.shares) : cost;
    mv += value;
    rows.push({
      ...p,
      price: hasPrice ? px : null,
      marketValue: round2(value),
      costAmount: round2(cost),
      pnl: round2(value - cost),
      pnlPct: cost > 0 ? round2(((value - cost) / cost) * 100) : null,
    });
  }
  return { rows, marketValue: round2(mv), missing };
}

/**
 * 账户绩效汇总（纯函数，UI 共用）
 *
 * - 总收益 = 最新净值 / 初始资金 - 1
 * - 最大回撤按净值峰值
 * - 胜率只统计**已平仓**的卖出记录（`realized != null`），平盘不进分母
 * - 样本 < 10 笔时 `enough = false`，UI 必须标「样本不足，仅供参考」
 */
export function summarizeAccount(acct) {
  const cfg = acct?.config || normalizeConfig({});
  const navs = Array.isArray(acct?.nav) ? acct.nav.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  const last = navs[navs.length - 1] || null;
  const equity = last ? last.equity : cfg.initialCash;
  const totalReturn = cfg.initialCash > 0 ? ((equity - cfg.initialCash) / cfg.initialCash) * 100 : null;

  let peak = cfg.initialCash;
  let maxDd = 0;
  for (const r of navs) {
    if (r.equity > peak) peak = r.equity;
    const dd = peak > 0 ? ((peak - r.equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const closed = (acct?.trades || []).filter((t) => t.side === "sell" && Number.isFinite(Number(t.realized)));
  const wins = closed.filter((t) => Number(t.realized) > 0).length;
  const losses = closed.filter((t) => Number(t.realized) < 0).length;
  const decided = wins + losses;

  const feeTotal = (acct?.trades || []).reduce((s, t) => s + nz(t.feeTotal), 0);
  const realizedTotal = closed.reduce((s, t) => s + nz(t.realized), 0);

  return {
    initialCash: cfg.initialCash,
    equity,
    cash: acct?.cash ?? cfg.initialCash,
    marketValue: last ? last.marketValue : 0,
    totalReturn,
    maxDrawdown: maxDd,
    navDays: navs.length,
    tradeCount: (acct?.trades || []).length,
    closedCount: closed.length,
    winCount: wins,
    lossCount: losses,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    feeTotal: round2(feeTotal),
    realizedTotal: round2(realizedTotal),
    enough: closed.length >= 10,
    lastDate: last ? last.date : null,
    partial: !!last?.partial,
    missing: last?.missing || [],
  };
}

/** 单日收益（概览卡片用） */
export function dayChange(acct) {
  const navs = Array.isArray(acct?.nav) ? acct.nav : [];
  if (navs.length < 2) return { delta: null, pct: null };
  const cur = navs[navs.length - 1];
  const prev = navs[navs.length - 2];
  if (!prev || !(prev.equity > 0)) return { delta: null, pct: null };
  const delta = cur.equity - prev.equity;
  return { delta: round2(delta), pct: (delta / prev.equity) * 100 };
}

/** 供 UI 复用的规则辅助（避免组件各自实现手数/涨跌停口径） */
export { floorLot, floorSellLot, getLimitPrices, getLotRule };
