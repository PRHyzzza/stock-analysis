/**
 * paperFees — 模拟盘 A 股交易费用（纯函数）
 *
 * 口径来源与免责：
 * - 佣金：万 2.5（0.025%），**双向**，单笔最低 5 元。各券商差异大，是配置项而非硬编码。
 * - 印花税：2023-08-28 起由 0.1% 减半为 **0.05%**，**仅卖出**收取。
 * - 过户费：2022-04-29 起沪深统一 **0.001%**，**双向**（含北交所，简化为统一口径）。
 * - 规费（证管费 0.002% + 经手费 0.00341%）在多数券商已含在佣金内，此处**不重复收**。
 *
 * 为什么单独成文件：`useSignalBacktest` 的回测**不计费用**，模拟盘必须计。
 * 这是模拟盘与回测口径的核心差异，UI 必须并列披露（PROJECT.md §7.19 的口径诚实要求）。
 */

/** 默认费率（可在模拟盘配置里覆盖，落地为用户 localStorage 中的配置项） */
export const DEFAULT_FEE_CONFIG = Object.freeze({
  /** 佣金费率（小数，0.00025 = 万 2.5） */
  commissionRate: 0.00025,
  /** 单笔佣金最低（元） */
  commissionMin: 5,
  /** 印花税率（小数，仅卖出） */
  stampTaxRate: 0.0005,
  /** 过户费率（小数，双向） */
  transferFeeRate: 0.00001,
});

/**
 * 单笔费用明细
 * @param {"buy"|"sell"} side 方向
 * @param {number} amount 成交金额（元）= 价格 × 股数
 * @param {object} [config] 费率配置（缺省用 DEFAULT_FEE_CONFIG）
 * @returns {{ commission: number, stampTax: number, transferFee: number, total: number, rate: number }}
 *          `rate` = 总费用 / 成交金额（成交金额 <= 0 时为 0）
 */
export function calcFee(side, amount, config = DEFAULT_FEE_CONFIG) {
  const cfg = { ...DEFAULT_FEE_CONFIG, ...(config || {}) };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { commission: 0, stampTax: 0, transferFee: 0, total: 0, rate: 0 };
  }

  // 佣金：费率算出来不足最低额时按最低额收（「免五」账户把 commissionMin 设为 0 即可）
  const rawCommission = amt * Number(cfg.commissionRate || 0);
  const commission = Math.max(rawCommission, Number(cfg.commissionMin) || 0);

  // 印花税：只有卖出收
  const stampTax = side === "sell" ? amt * Number(cfg.stampTaxRate || 0) : 0;

  // 过户费：双向
  const transferFee = amt * Number(cfg.transferFeeRate || 0);

  const total = commission + stampTax + transferFee;
  return {
    commission: round2(commission),
    stampTax: round2(stampTax),
    transferFee: round2(transferFee),
    total: round2(total),
    rate: amt > 0 ? total / amt : 0,
  };
}

/** 保留 2 位（费用以分为最小单位，向下取整到分更保守，但这里四舍五入与券商账单一致） */
function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * 买入时的实际现金支出 = 成交金额 + 费用
 * @param {number} amount 成交金额（元）
 * @param {object} [config]
 */
export function buyCost(amount, config = DEFAULT_FEE_CONFIG) {
  const fee = calcFee("buy", amount, config);
  return { amount, fee, cash: round2(Number(amount) + fee.total) };
}

/**
 * 卖出时的实际现金收入 = 成交金额 - 费用
 * @param {number} amount 成交金额（元）
 * @param {object} [config]
 */
export function sellProceeds(amount, config = DEFAULT_FEE_CONFIG) {
  const fee = calcFee("sell", amount, config);
  return { amount, fee, cash: round2(Number(amount) - fee.total) };
}
