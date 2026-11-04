/**
 * paperRules — 模拟盘 A 股交易规则（纯函数）
 *
 * 只做「规则」，不做撮合与记账（撮合见 `paperEngine.js`，费用见 `paperFees.js`）。
 *
 * 口径约定（与 `utils/limit.js`、`utils/market.js` 对齐，不重复实现市场判定）：
 * - 涨跌停幅度**只**走 `getLimitPct(code)`（ST 与所属板块一致，不需要名称）
 * - 市场/板块判定**只**走 `inferMarket` / `isBJCode`（PROJECT.md §7.28）
 *
 * 最小购买单位（2026 现行规则）：
 *   主板 / 创业板（30）   —— 100 股整数倍
 *   科创板（68）          —— 200 股起，之后 1 股递增
 *   北交所（43/82/83/87/88/92）—— 100 股起，之后 1 股递增
 *   卖出零股             —— 不足 100 股的部分必须一次性卖出（不可拆）
 */
import { getLimitPct } from "./limit.js";
import { isBJCode, inferMarket } from "./market.js";

/** A 股最小价格变动单位（元）。港股无此约束，本项目模拟盘只做 A 股。 */
export const A_TICK = 0.01;

/** 保留 2 位（价格以分为最小单位） */
export function roundPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // 先取整到 tick 数，再回到「分」：直接 Math.round(n / 0.01) * 0.01 会留下
  // 10.200000000000001 这类浮点尾数，落进账本和成交价展示都很难看。
  const ticks = Math.round(n / A_TICK);
  return Math.round(ticks * A_TICK * 100) / 100;
}

/**
 * 该代码的最小下单单位描述
 * @param {string} code 股票代码
 * @returns {{ board: "SH"|"SZ"|"BJ"|"HK", minShares: number, stepShares: number, lotLabel: string }}
 */
export function getLotRule(code) {
  const market = inferMarket(code);
  const c = String(code ?? "").trim();

  if (market === "HK") {
    // 模拟盘只做 A 股；港股给一个保守值，避免调用方拿到 undefined
    return { board: "HK", minShares: 100, stepShares: 100, lotLabel: "100 股整数倍（港股口径未细分）" };
  }
  if (isBJCode(c)) {
    return { board: "BJ", minShares: 100, stepShares: 1, lotLabel: "100 股起，1 股递增" };
  }
  if (c.startsWith("68")) {
    return { board: "SH", minShares: 200, stepShares: 1, lotLabel: "200 股起，1 股递增（科创板）" };
  }
  return { board: market, minShares: 100, stepShares: 100, lotLabel: "100 股整数倍" };
}

/**
 * 把「想买的股数」规整成合法股数（向下取整到最小单位，不足起点返回 0）
 * @param {string} code
 * @param {number} shares 期望股数
 * @returns {number} 合法股数（可能为 0）
 */
export function floorLot(code, shares) {
  const n = Math.floor(Number(shares));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const { minShares, stepShares } = getLotRule(code);
  if (n < minShares) return 0;
  return minShares + Math.floor((n - minShares) / stepShares) * stepShares;
}

/**
 * 把「想卖的股数」规整成合法股数。
 * 卖出允许卖出全部持仓（含零股），否则必须是最小单位的整数倍。
 * @param {string} code
 * @param {number} shares 期望卖出股数
 * @param {number} holding 当前持仓股数
 * @returns {number} 合法卖出股数（可能为 0）
 */
export function floorSellLot(code, shares, holding) {
  const want = Math.floor(Number(shares));
  const have = Math.floor(Number(holding));
  if (!Number.isFinite(want) || want <= 0) return 0;
  if (!Number.isFinite(have) || have <= 0) return 0;
  const qty = Math.min(want, have);
  // 全部卖掉：允许零股一次性出清
  if (qty >= have) return have;
  const { minShares, stepShares } = getLotRule(code);
  if (qty < minShares) return 0;
  return minShares + Math.floor((qty - minShares) / stepShares) * stepShares;
}

/**
 * 涨跌停价（按昨收 × 幅度，四舍五入到分；A 股实务如此）
 * @param {string} code
 * @param {number} prevClose 前收盘价
 * @returns {{ limitPct: number, upper: number|null, lower: number|null }}
 *          港股 / 昨收无效时 upper/lower 为 null
 */
export function getLimitPrices(code, prevClose) {
  const pct = getLimitPct(code);
  const base = Number(prevClose);
  if (!pct || !Number.isFinite(base) || base <= 0) {
    return { limitPct: pct || 0, upper: null, lower: null };
  }
  return {
    limitPct: pct,
    upper: roundPrice(base * (1 + pct / 100)),
    lower: roundPrice(base * (1 - pct / 100)),
  };
}

/**
 * 是否可成交（剔除停牌 / 一字板 / 无报价）
 *
 * 判据（保守，宁可漏成交也不要假成交）：
 * - 价格缺失或 <= 0 → 停牌或数据异常 → 不可成交
 * - 成交量为 0 → 停牌（腾讯接口停牌股成交量恒为 0）
 * - 开盘即涨停且最高 = 最低 = 涨停（一字板）→ **买不进**
 * - 开盘即跌停且最高 = 最低 = 跌停（一字板）→ **卖不出**
 *
 * @param {"buy"|"sell"} side
 * @param {object} bar 当日 K 线/快照：{ open, high, low, close, volume, prev_close }
 * @param {string} code
 * @returns {{ ok: boolean, reason: string }}
 */
export function canFill(side, bar, code) {
  const b = bar || {};
  const price = Number(b.open ?? b.price ?? b.close);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: "无有效报价（疑似停牌）" };
  }
  const volume = Number(b.volume);
  if (Number.isFinite(volume) && volume <= 0) {
    return { ok: false, reason: "成交量 0（停牌）" };
  }

  const prevClose = Number(b.prev_close ?? b.prevClose);
  const { upper, lower } = getLimitPrices(code, prevClose);
  const high = Number(b.high);
  const low = Number(b.low);

  if (upper != null && Number.isFinite(high) && Number.isFinite(low)) {
    const oneWordUpper = high >= upper - A_TICK / 2 && low >= upper - A_TICK / 2;
    const oneWordLower = high <= lower + A_TICK / 2 && low <= lower + A_TICK / 2;
    if (side === "buy" && oneWordUpper) return { ok: false, reason: "一字涨停，买不进" };
    if (side === "sell" && oneWordLower) return { ok: false, reason: "一字跌停，卖不出" };
  }
  return { ok: true, reason: "" };
}

/**
 * 成交价：开盘价 + 单向滑点（买入上滑、卖出下滑）
 *
 * 为什么用开盘价：日线信号在收盘后才知道，只能在**次日开盘**执行，这是唯一无前视的做法。
 * 滑点默认 0.1%（可配 0），并按 tick 对齐、夹在涨跌停区间内。
 *
 * @param {"buy"|"sell"} side
 * @param {number} open 次日开盘价
 * @param {{ slippage?: number, code?: string, prevClose?: number, dayHigh?: number, dayLow?: number }} [opts]
 * @returns {number|null}
 */
export function fillPrice(side, open, opts = {}) {
  const base = Number(open);
  if (!Number.isFinite(base) || base <= 0) return null;
  const slip = Math.max(0, Number(opts.slippage) || 0);
  let p = side === "buy" ? base * (1 + slip) : base * (1 - slip);

  // 夹在当日价格区间内（不能比当日最低还低、不能比当日最高还高）
  const high = Number(opts.dayHigh);
  const low = Number(opts.dayLow);
  if (Number.isFinite(high) && high > 0) p = Math.min(p, high);
  if (Number.isFinite(low) && low > 0) p = Math.max(p, low);

  // 夹在涨跌停区间内
  if (opts.code != null) {
    const { upper, lower } = getLimitPrices(opts.code, opts.prevClose);
    if (upper != null) p = Math.min(p, upper);
    if (lower != null) p = Math.max(p, lower);
  }

  const rounded = roundPrice(p);
  return rounded != null && rounded > 0 ? rounded : null;
}

/**
 * 买入后是否受 T+1 限制（当日买入的股份当日不可卖）
 * 纯代数判断：只有当持仓的「可卖数量」被记录时才有意义，此处提供统一判据。
 * @param {string} buyDate 买入日期 YYYY-MM-DD
 * @param {string} sellDate 卖出日期 YYYY-MM-DD
 * @returns {boolean} true = 受 T+1 限制，不可卖
 */
export function blockedByT1(buyDate, sellDate) {
  if (!buyDate || !sellDate) return false;
  return String(buyDate) === String(sellDate);
}
