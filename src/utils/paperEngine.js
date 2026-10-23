/**
 * paperEngine — 模拟盘撮合与记账引擎（**纯函数**，无 Vue / 无 Tauri / 无 localStorage）
 *
 * 设计口径（与 PROJECT.md §7.19 的回测诚实性一致）：
 *
 * 1. **日线级、每日向前累积（daily forward）**
 *    D 日收盘后跑选股规则 → 生成 D+1 开盘执行的委托 → D+1 开盘价撮合。
 *    这是唯一无前视偏差的做法：日线信号在收盘后才确定，不可能当日收盘成交。
 *
 * 2. **与回测的口径差异（必须在 UI 披露）**
 *    `useSignalBacktest` 是「信号日收盘价买入、持有 N 日收盘卖出、**不计费用**」；
 *    本引擎是「信号日收盘出单、**次日开盘价 + 滑点**成交、**计全额费用**」。
 *    因此模拟盘收益天然低于回测面板，两者数字**不可直接比较**。
 *
 * 3. **费用全额计入**（`paperFees.js`），含最低佣金 5 元 —— 小资金高频时损耗显著，这是模拟盘的价值所在。
 *
 * 4. **A 股 T+1**：当日买入的股份当日不可卖。本引擎天然满足（卖出委托一律次日开盘成交），
 *    并在 `planExits` 里额外防御 `openDate === date` 的情况。
 *
 * 5. **缺失行情不用成本价冒充**（PROJECT.md §7.24）：净值计算时若某持仓无当日收盘价，
 *    退化为成本价算出「部分净值」，并在 `nav.missing` 里记下代码 + `partial: true`，由 UI 标注。
 */
import { DEFAULT_FEE_CONFIG, buyCost, sellProceeds } from "./paperFees.js";
import { scoreBars } from "./paperScore.js";
import {
  canFill,
  fillPrice,
  floorLot,
  floorSellLot,
  getLimitPrices,
} from "./paperRules.js";

/** 账户模型版本（localStorage 迁移用） */
export const ACCOUNT_VERSION = 1;

/** 默认配置 */
export const DEFAULT_CONFIG = Object.freeze({
  /** 初始资金（元） */
  initialCash: 100000,
  /** 固定持有期（交易日）；0 = 不按时间平仓，只靠止盈止损 */
  holdDays: 5,
  /** 最大同时持仓只数 */
  maxPositions: 5,
  /** 单票最大权重（%，相对当前总权益） */
  maxWeightPct: 25,
  /** 每笔买入预算占总权益比例（%） */
  perTradeCashPct: 20,
  /** 单向滑点（小数，0.001 = 0.1%） */
  slippage: 0.001,
  /** 止损（%，0 = 关闭），按收盘价判断 */
  stopLossPct: 8,
  /** 止盈（%，0 = 关闭），按收盘价判断 */
  takeProfitPct: 20,
  /** 入选最低分（0-100，见 paperScore.js）；低于此分数不买 */
  minScore: 60,
  /** 每日最多买入只数（1-5）；与剩余可用仓位取小 */
  maxPicks: 2,
  /** 首次运行补跑天数（0 = 只跑最新一个交易日，不做历史回测） */
  backfillDays: 0,
  /** 启用的规则 id 列表；空数组 = 全部规则（现在只用于「信号确认」，不再直接决定买入） */
  rules: [],
  /** 费率配置 */
  fees: { ...DEFAULT_FEE_CONFIG },
});

/** 数值兜底（不做假值填充，仅防 NaN 破坏状态机） */
function nz(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 配置规整（用户输入一律过一遍，避免负资金/负持有期把引擎弄坏）
 * @param {object} raw
 * @returns {object} 规整后的配置
 */
export function normalizeConfig(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const fees = { ...DEFAULT_FEE_CONFIG, ...(src.fees && typeof src.fees === "object" ? src.fees : {}) };
  return {
    initialCash: clampNumber(src.initialCash, 10000, 100000000, DEFAULT_CONFIG.initialCash),
    holdDays: Math.round(clampNumber(src.holdDays, 0, 250, DEFAULT_CONFIG.holdDays)),
    maxPositions: Math.round(clampNumber(src.maxPositions, 1, 50, DEFAULT_CONFIG.maxPositions)),
    maxWeightPct: clampNumber(src.maxWeightPct, 1, 100, DEFAULT_CONFIG.maxWeightPct),
    perTradeCashPct: clampNumber(src.perTradeCashPct, 1, 100, DEFAULT_CONFIG.perTradeCashPct),
    slippage: clampNumber(src.slippage, 0, 0.05, DEFAULT_CONFIG.slippage),
    stopLossPct: clampNumber(src.stopLossPct, 0, 100, DEFAULT_CONFIG.stopLossPct),
    takeProfitPct: clampNumber(src.takeProfitPct, 0, 1000, DEFAULT_CONFIG.takeProfitPct),
    minScore: Math.round(clampNumber(src.minScore, 0, 100, DEFAULT_CONFIG.minScore)),
    maxPicks: Math.round(clampNumber(src.maxPicks, 1, 5, DEFAULT_CONFIG.maxPicks)),
    backfillDays: Math.round(clampNumber(src.backfillDays, 0, 250, DEFAULT_CONFIG.backfillDays)),
    rules: Array.isArray(src.rules) ? src.rules.filter((r) => typeof r === "string") : [],
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
    /** 持仓：{ code, name, shares, costPrice, costAmount, openDate, openRules } */
    positions: [],
    /** 待次日开盘成交的委托：{ id, side, code, name, shares?, budget?, signalDate, rules, reason } */
    pending: [],
    /** 成交流水（只增不改） */
    trades: [],
    /** 每日运行日志 */
    runs: [],
    /** 每日净值曲线 */
    nav: [],
    /** 最后运行日期（YYYY-MM-DD，本地时区） */
    lastRunDate: null,
    /** 选股池：{ code, name, addedAt, source, query? } */
    pool: Array.isArray(meta.pool) ? meta.pool.filter((p) => p && p.code) : [],
  };
}

/** 深拷贝账户（引擎一律不改入参） */
function cloneAccount(acct) {
  return JSON.parse(JSON.stringify(acct));
}

/** 下一个流水 id */
function nextId(acct) {
  return `${acct.trades.length + acct.pending.length + 1}`;
}

/**
 * 取第 i 根 K 线，并补上 prev_close（撮合判断要用）
 * @param {Array} bars 日 K 数组（按日期升序）
 * @param {number} i
 */
function barAt(bars, i) {
  const b = bars[i];
  if (!b) return null;
  const prev = bars[i - 1];
  return {
    date: b.date,
    open: nz(b.open),
    high: nz(b.high),
    low: nz(b.low),
    close: nz(b.close),
    volume: nz(b.volume),
    prev_close: prev ? nz(prev.close) : null,
  };
}

/** 找到某日期的下标（找不到返回 -1） */
function indexOfDate(bars, date) {
  if (!Array.isArray(bars) || !date) return -1;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i]?.date === date) return i;
  }
  return -1;
}

/**
 * 持仓已持有的交易日数（openDate 之后、date 之前/当日的 K 线根数）
 * 若 openDate 在序列里找不到（本地 K 线被清理/补跑），退化为按日期字符串计数。
 */
export function heldTradingDays(bars, openDate, date) {
  if (!Array.isArray(bars) || !openDate || !date) return 0;
  const openIdx = indexOfDate(bars, openDate);
  const nowIdx = indexOfDate(bars, date);
  if (openIdx >= 0 && nowIdx >= 0) return Math.max(0, nowIdx - openIdx);
  return bars.filter((b) => b?.date > openDate && b?.date <= date).length;
}

/**
 * 池内选股：对每只票跑日线规则，返回「当日成立的规则」
 *
 * `analyze` 必须由调用方注入（`useSignalBacktest.js` 的 `analyzeBars`），
 * 这样引擎本身零依赖、可被 `node --test` 直接导入验证。
 *
 * @param {Object<string, Array>} barsByCode code → 日 K 数组（升序）
 * @param {object} [config] 账户配置（用 `rules` 过滤启用的规则；空 = 全部）
 * @param {(bars: Array, code: string) => object} analyze 规则分析函数（analyzeBars）
 * @returns {Object<string, { code, date, close, active: string[], names: string[], bars: number, reason?: string }>}
 */
export function buildSignals(barsByCode, config = {}, analyze) {
  const out = {};
  if (typeof analyze !== "function") return out; // 未注入则不出信号（宁可空仓，不假成交）
  const cfg = normalizeConfig(config);
  const enabled = cfg.rules;

  for (const [code, bars] of Object.entries(barsByCode || {})) {
    const list = Array.isArray(bars) ? bars : [];
    const res = analyze(list, code);
    const lastDate = res.asOf || list[list.length - 1]?.date || null;

    if (!res.enough) {
      out[code] = {
        code,
        date: lastDate,
        close: nz(list[list.length - 1]?.close) || null,
        active: [],
        names: [],
        bars: res.bars,
        score: 0,
        scoreParts: null,
        scoreEnough: false,
        reason: `日 K 仅 ${res.bars} 根，不足 60 根无法判定（可在回测面板同步更多历史）`,
      };
      continue;
    }

    const hit = res.rules.filter(
      (r) => r.active && (enabled.length === 0 || enabled.includes(r.id))
    );
    // 打分：对**已截断到 signalDate** 的 K 线算分（调用方负责截断，这里不再二次截取，
    // 以免与 buildSignals 的直接调用（单测/诊断脚本）产生两套口径）
    const scored = scoreBars(list, code);
    out[code] = {
      code,
      date: lastDate,
      close: nz(list[list.length - 1]?.close) || null,
      active: hit.map((r) => r.id),
      names: hit.map((r) => r.name),
      bars: res.bars,
      score: scored.score,
      scoreParts: scored.parts,
      scoreEnough: scored.enough,
      reason: hit.length ? "" : "今日无规则触发",
    };
  }
  return out;
}

/** 当前总权益（现金 + 持仓市值）。priceOf 返回 null 表示缺价，退化为成本价 */
function equityOf(acct, priceOf) {
  let mv = 0;
  const missing = [];
  for (const p of acct.positions) {
    const px = priceOf(p.code);
    if (px == null) {
      mv += p.costPrice * p.shares;
      missing.push(p.code);
    } else {
      mv += px * p.shares;
    }
  }
  return { equity: acct.cash + mv, marketValue: mv, missing };
}

/**
 * 生成卖出委托（止盈 / 止损 / 到期）
 * 依据 D 日**收盘价**判断，委托在 D+1 开盘成交。
 */
export function planExits(acct, { date, barsByCode }) {
  const cfg = acct.config;
  const orders = [];
  const held = new Set(acct.positions.map((p) => p.code));

  for (const pos of acct.positions) {
    if (pos.openDate === date) continue; // T+1 防御：当日买入当日不可卖
    if (acct.pending.some((o) => o.side === "sell" && o.code === pos.code)) continue;

    const bars = barsByCode?.[pos.code] || [];
    const idx = indexOfDate(bars, date);
    const close = idx >= 0 ? nz(bars[idx].close) : null;
    if (close == null || close <= 0) continue; // 无当日收盘价 → 不判断（保守）

    const days = heldTradingDays(bars, pos.openDate, date);
    const pnlPct = pos.costPrice > 0 ? ((close - pos.costPrice) / pos.costPrice) * 100 : 0;

    let reason = "";
    if (cfg.stopLossPct > 0 && pnlPct <= -cfg.stopLossPct) {
      reason = `止损：收盘 ${close.toFixed(2)} 较成本 ${pos.costPrice.toFixed(2)} 跌 ${pnlPct.toFixed(2)}%（阈值 -${cfg.stopLossPct}%）`;
    } else if (cfg.takeProfitPct > 0 && pnlPct >= cfg.takeProfitPct) {
      reason = `止盈：收盘 ${close.toFixed(2)} 较成本 ${pos.costPrice.toFixed(2)} 涨 ${pnlPct.toFixed(2)}%（阈值 +${cfg.takeProfitPct}%）`;
    } else if (cfg.holdDays > 0 && days >= cfg.holdDays) {
      reason = `持有期到：已持有 ${days} 个交易日（配置 ${cfg.holdDays} 日），按次日开盘卖出`;
    }

    if (!reason) continue;
    const shares = floorSellLot(pos.code, pos.shares, pos.shares);
    if (shares <= 0) continue;
    orders.push({
      id: nextId(acct) + `-${pos.code}-sell`,
      side: "sell",
      code: pos.code,
      name: pos.name,
      shares,
      signalDate: date,
      rules: [],
      reason,
    });
    held.delete(pos.code);
  }
  return orders;
}

/**
 * 生成买入委托（池内打分达标 → 按分数排序取前 N → 次日开盘成交）
 *
 * 与旧版的差别（这是用户「莫名其妙的回测」的直接病根）：
 * - 旧版：`active.length > 0` 即买入，按触发规则条数排序 → 门槛形同虚设，每日名额先被弱信号占满
 * - 新版：先卡 `cfg.minScore`，再按分数降序（同分按代码稳定排序），每日最多 `cfg.maxPicks` 只
 *
 * 规则触发退化为「信号确认」而非「入选条件」：仍允许用 `cfg.rules` 过滤，
 * 但**没有规则触发也能凭分数入选**——打分本身已是多指标合成，再要求规则命中会重复过滤。
 */
export function planEntries(acct, { date, barsByCode, signals }) {
  const cfg = acct.config;
  const orders = [];
  const pendingBuy = new Set(acct.pending.filter((o) => o.side === "buy").map((o) => o.code));
  const held = new Set(acct.positions.map((p) => p.code));
  const { equity } = equityOf(acct, (code) => {
    const bars = barsByCode?.[code] || [];
    const idx = indexOfDate(bars, date);
    return idx >= 0 ? nz(bars[idx].close) || null : null;
  });

  // 候选：打分达标、未持仓、未在途
  const candidates = [];
  for (const item of Object.values(signals || {})) {
    if (!item) continue;
    if (held.has(item.code) || pendingBuy.has(item.code)) continue;
    // K 线不足 60 根时 scoreBars 返回 0 分（不假填充），因此只有把 minScore 调到 0
    // 才会买「算不出分」的票；默认 60 分时这类票自然被挡在外面。
    if (!(Number(item.score) >= cfg.minScore)) continue;
    candidates.push(item);
  }
  // 分数高者优先；同分按代码稳定排序，保证逐日回放可复现
  candidates.sort((a, b) => {
    const d = Number(b.score) - Number(a.score);
    if (d !== 0) return d;
    return String(a.code).localeCompare(String(b.code));
  });

  const slots = Math.max(0, cfg.maxPositions - held.size - pendingBuy.size);
  const picks = Math.min(slots, cfg.maxPicks, candidates.length);
  const budget = Math.min(
    (equity * cfg.perTradeCashPct) / 100,
    (equity * cfg.maxWeightPct) / 100,
    acct.cash
  );

  for (const c of candidates.slice(0, picks)) {
    if (budget < 100) break;
    const ruleText = c.active?.length ? `，规则确认 ${c.active.length} 条` : "";
    orders.push({
      id: nextId(acct) + `-${c.code}-buy`,
      side: "buy",
      code: c.code,
      name: c.name || "",
      budget: Math.round(budget * 100) / 100,
      signalDate: date,
      rules: c.active || [],
      score: Number(c.score) || 0,
      reason: `打分 ${Number(c.score) || 0} 分（阈值 ${cfg.minScore}）${ruleText}，次日开盘买入`,
    });
  }
  return orders;
}

/**
 * 撮合：把上一交易日生成的委托按 D 日开盘价成交
 *
 * @param {object} acct 账户（不会被修改，返回的是新对象）
 * @param {{ date: string, barsByCode: Object }} ctx
 * @returns {{ account: object, filled: Array, skipped: Array }}
 */
export function settlePending(acct, { date, barsByCode }) {
  const next = cloneAccount(acct);
  const cfg = next.config;
  const filled = [];
  const skipped = [];
  const keep = [];

  for (const order of next.pending) {
    const bars = barsByCode?.[order.code] || [];
    const idx = indexOfDate(bars, date);
    if (idx < 0) {
      // 当日无 K 线：可能是停牌、也可能是补跑时该票当日休市 → 顺延一次，超过 3 个交易日作废
      const age = next.runs.filter((r) => r.date > order.signalDate).length;
      if (age >= 3) {
        skipped.push({ code: order.code, side: order.side, reason: "连续 3 个交易日无行情，委托作废" });
      } else {
        keep.push(order);
      }
      continue;
    }
    const bar = barAt(bars, idx);

    const gate = canFill(order.side, bar, order.code);
    if (!gate.ok) {
      skipped.push({ code: order.code, side: order.side, reason: gate.reason });
      continue; // 无法成交 → 作废（不追单，模拟盘宁可少成交也不假成交）
    }

    const price = fillPrice(order.side, bar.open, {
      slippage: cfg.slippage,
      code: order.code,
      prevClose: bar.prev_close,
      dayHigh: bar.high,
      dayLow: bar.low,
    });
    if (price == null) {
      skipped.push({ code: order.code, side: order.side, reason: "开盘价无效，无法撮合" });
      continue;
    }

    if (order.side === "buy") {
      // 预算按实际成交价重算股数（价格越高于预期，买得越少）
      const slotCash = Math.min(nz(order.budget), next.cash);
      // 先按「费用后仍需 <= 现金」反解，再规整到合法股数
      const guessShares = floorLot(order.code, slotCash / price);
      let shares = guessShares;
      while (shares > 0) {
        const cost = buyCost(price * shares, cfg.fees);
        if (cost.cash <= next.cash) break;
        // 减一个最小单位
        const cheaper = floorLot(order.code, shares - 1);
        if (cheaper === shares) break;
        shares = cheaper;
      }
      if (shares <= 0) {
        skipped.push({ code: order.code, side: "buy", reason: "资金不足一个最小下单单位" });
        continue;
      }
      const amount = Math.round(price * shares * 100) / 100;
      const cost = buyCost(amount, cfg.fees);
      if (cost.cash > next.cash) {
        skipped.push({ code: order.code, side: "buy", reason: "资金不足" });
        continue;
      }
      next.cash = Math.round((next.cash - cost.cash) * 100) / 100;

      const existing = next.positions.find((p) => p.code === order.code);
      if (existing) {
        const totalShares = existing.shares + shares;
        const totalCost = existing.costAmount + cost.cash;
        existing.shares = totalShares;
        existing.costAmount = Math.round(totalCost * 100) / 100;
        existing.costPrice = Math.round((totalCost / totalShares) * 10000) / 10000;
      } else {
        next.positions.push({
          code: order.code,
          name: order.name || "",
          shares,
          costPrice: Math.round((cost.cash / shares) * 10000) / 10000,
          costAmount: cost.cash,
          openDate: date,
          openRules: order.rules || [],
        });
      }

      const trade = {
        id: `T${next.trades.length + 1}`,
        date,
        code: order.code,
        name: order.name || "",
        side: "buy",
        price,
        shares,
        amount,
        fee: cost.fee,
        feeTotal: cost.fee.total,
        cashDelta: -cost.cash,
        rules: order.rules || [],
        score: Number(order.score) || 0,
        reason: order.reason || "",
        signalDate: order.signalDate,
        realized: null,
      };
      next.trades.push(trade);
      filled.push(trade);
    } else {
      const pos = next.positions.find((p) => p.code === order.code);
      if (!pos) {
        skipped.push({ code: order.code, side: "sell", reason: "无持仓（可能已被其他委托卖出）" });
        continue;
      }
      const shares = floorSellLot(order.code, order.shares, pos.shares);
      if (shares <= 0) {
        skipped.push({ code: order.code, side: "sell", reason: "可卖股数不足最小单位" });
        continue;
      }
      const amount = Math.round(price * shares * 100) / 100;
      const proceeds = sellProceeds(amount, cfg.fees);
      next.cash = Math.round((next.cash + proceeds.cash) * 100) / 100;

      // 已实现盈亏 = 净回款 - 按比例分摊的成本（含买入费用）
      const costBasis = Math.round((pos.costAmount * (shares / pos.shares)) * 100) / 100;
      const realized = Math.round((proceeds.cash - costBasis) * 100) / 100;

      pos.shares -= shares;
      pos.costAmount = Math.round((pos.costAmount - costBasis) * 100) / 100;
      if (pos.shares <= 0) {
        next.positions = next.positions.filter((p) => p.code !== pos.code);
      }

      const trade = {
        id: `T${next.trades.length + 1}`,
        date,
        code: order.code,
        name: order.name || pos.name || "",
        side: "sell",
        price,
        shares,
        amount,
        fee: proceeds.fee,
        feeTotal: proceeds.fee.total,
        cashDelta: proceeds.cash,
        rules: [],
        reason: order.reason || "",
        signalDate: order.signalDate,
        realized,
      };
      next.trades.push(trade);
      filled.push(trade);
    }
  }

  next.pending = keep;
  return { account: next, filled, skipped };
}

/**
 * 计算并追加当日净值（用 D 日收盘价）
 * @returns {{ account: object, nav: object }}
 */
export function recordNav(acct, { date, barsByCode }) {
  const next = cloneAccount(acct);
  const priceOf = (code) => {
    const bars = barsByCode?.[code] || [];
    const idx = indexOfDate(bars, date);
    if (idx >= 0) {
      const c = nz(bars[idx].close);
      return c > 0 ? c : null;
    }
    return null;
  };
  const { equity, marketValue, missing } = equityOf(next, priceOf);
  const nav = {
    date,
    equity: Math.round(equity * 100) / 100,
    cash: Math.round(next.cash * 100) / 100,
    marketValue: Math.round(marketValue * 100) / 100,
    positionCount: next.positions.length,
    missing,
    partial: missing.length > 0,
  };
  const existing = next.nav.findIndex((r) => r.date === date);
  if (existing >= 0) next.nav[existing] = nav;
  else next.nav.push(nav);
  return { account: next, nav };
}

/** 截取到指定日期（含）为止的 K 线，避免规则看到「未来」数据 */
function sliceToDate(bars, date) {
  if (!Array.isArray(bars)) return [];
  const out = [];
  for (const b of bars) {
    if (!b || !b.date) continue;
    if (b.date <= date) out.push(b);
    else break;
  }
  return out;
}

/**
 * 每日一步（向前累积的核心）：撮合昨日委托 → 记净值 → 生成次日委托
 *
 * 顺序很重要：**先撮合（用今日开盘）→ 再记净值（用今日收盘）→ 最后按今日收盘出信号**。
 *
 * 防前视：跑规则前把 K 线截到 `date` 当天为止。否则补跑历史时规则会看到未来 K 线，
 * 整条净值曲线都会骗人（这是本引擎最容易犯且最难发现的错）。
 *
 * @param {object} acct 账户
 * @param {{ date: string, barsByCode: Object<string, Array>, analyze?: Function }} ctx
 * @returns {{ account: object, report: object }}
 */
export function stepDay(acct, { date, barsByCode, analyze }) {
  const map = barsByCode && typeof barsByCode === "object" ? barsByCode : {};

  // 1) 撮合（昨日收盘后生成的委托，今日开盘成交）
  const settled = settlePending(acct, { date, barsByCode: map });
  let next = settled.account;

  // 2) 记净值（今日收盘）
  const navRes = recordNav(next, { date, barsByCode: map });
  next = navRes.account;

  // 3) 选股 + 出单（今日收盘后 → 次日开盘成交）
  const truncated = {};
  for (const [code, bars] of Object.entries(map)) truncated[code] = sliceToDate(bars, date);
  const signals = buildSignals(truncated, next.config, analyze);
  const poolCodes = new Set(next.pool.map((p) => p.code));
  // 池外的持仓仍需管（用户可能已把该票移出池）→ 卖出照算，买入只看池内
  const poolSignals = {};
  for (const [code, sig] of Object.entries(signals)) {
    if (poolCodes.size === 0 || poolCodes.has(code)) {
      poolSignals[code] = { ...sig, name: next.pool.find((p) => p.code === code)?.name || "" };
    }
  }
  const exits = planExits(next, { date, barsByCode: map });
  const entries = planEntries(next, { date, barsByCode: map, signals: poolSignals });

  next.pending = [...next.pending, ...exits, ...entries];
  next.lastRunDate = date;

  const report = {
    date,
    filled: settled.filled,
    skipped: settled.skipped || [],
    scanned: Object.keys(poolSignals).length,
    signalCodes: Object.values(poolSignals).filter((s) => s.active?.length).map((s) => s.code),
    /** 当日打分最高的一批（供 UI / 运行日志展示「为什么买/没买」） */
    scores: Object.values(poolSignals)
      .filter((s) => s.scoreEnough)
      .map((s) => ({ code: s.code, score: Number(s.score) || 0 }))
      .sort((a, b) => b.score - a.score || String(a.code).localeCompare(String(b.code)))
      .slice(0, 10),
    exitOrders: exits,
    entryOrders: entries,
    nav: navRes.nav,
    equity: navRes.nav.equity,
  };

  next.runs.push({
    date,
    scanned: report.scanned,
    signalCodes: report.signalCodes,
    scored: report.scores.length,
    /** 当日打分前 10（供 UI 展示「为什么买 / 为什么没买」） */
    scores: report.scores,
    picked: entries.map((o) => ({ code: o.code, score: o.score })),
    filledCount: settled.filled.length,
    exitCount: exits.length,
    entryCount: entries.length,
    equity: navRes.nav.equity,
    partial: navRes.nav.partial,
    skipped: report.skipped,
  });
  // 只保留最近 400 条运行日志，避免 localStorage 膨胀
  if (next.runs.length > 400) next.runs = next.runs.slice(-400);

  return { account: next, report };
}

/**
 * 账户绩效汇总（纯函数，UI 与提示词共用）
 *
 * 口径：
 * - 总收益 = 最新净值 / 初始资金 - 1
 * - 最大回撤按净值曲线峰值计算
 * - 胜率只统计**已平仓**的卖出记录（`realized != null`），平盘不计入分母
 * - 样本 < 10 笔时 `enough = false`，UI 必须标「样本不足，仅供参考」（§7.19/§7.26）
 *
 * @param {object} acct
 * @returns {object}
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
    feeTotal: Math.round(feeTotal * 100) / 100,
    realizedTotal: Math.round(realizedTotal * 100) / 100,
    /** 样本不足标记（UI 必须据此标注） */
    enough: closed.length >= 10,
    lastDate: last ? last.date : null,
    partial: !!last?.partial,
    missing: last?.missing || [],
  };
}

/**
 * 单日收益（用于 UI 概览卡片）
 * @param {object} acct
 * @returns {{ delta: number|null, pct: number|null }}
 */
export function dayChange(acct) {
  const navs = Array.isArray(acct?.nav) ? acct.nav : [];
  if (navs.length < 2) return { delta: null, pct: null };
  const cur = navs[navs.length - 1];
  const prev = navs[navs.length - 2];
  if (!prev || !(prev.equity > 0)) return { delta: null, pct: null };
  const delta = cur.equity - prev.equity;
  return { delta: Math.round(delta * 100) / 100, pct: (delta / prev.equity) * 100 };
}

/**
 * 计算某只票在给定日期之后的下一个交易日（用于「补跑」场景的提示，不做真实日历依赖）
 * @param {Array} bars 日 K
 * @param {string} date
 */
export function nextBarDate(bars, date) {
  if (!Array.isArray(bars)) return null;
  const hit = bars.find((b) => b?.date > date);
  return hit ? hit.date : null;
}

export { getLimitPrices };
