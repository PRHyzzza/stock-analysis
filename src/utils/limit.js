import { isHKCode, isBJCode } from "./market.js";

/**
 * 涨跌停幅度工具 — 按板块判断涨跌停幅度（%）
 *
 * 规则（2026-07-06 新规）：主板 ±10% | 创业板(30) / 科创板(68) ±20% | 北交所(43/82/83/87/88/92) ±30%
 *       ST/*ST：涨跌幅限制与所属板块一致（主板 ST 同样是 ±10%，**不再是 ±5%**）
 *       港股（5 位代码）无涨跌停
 *
 * 注意：ST 与普通股口径相同，因此本模块**不需要**股票名称，只按代码判板块。
 * 若将来规则再次分化（例如主板 ST 恢复 ±5%），必须同时改
 * `src/composables/aiContext.js` 的 MARKET_RULES 与 `PROJECT.md` §7.30。
 */

/**
 * 获取涨停幅度（%）
 * @param {string} code 股票代码
 * @returns {number} 涨跌停幅度百分比；港股返回 0（无涨跌停限制）
 */
export function getLimitPct(code) {
  if (!code) return 10;
  // 港股：5 位数字代码，无涨跌停
  if (isHKCode(code)) return 0;
  // 北交所 ±30%
  if (isBJCode(code)) return 30;
  // 创业板 ±20%
  if (code.startsWith("30")) return 20;
  // 科创板 ±20%
  if (code.startsWith("68")) return 20;
  // 主板 ±10%（含 ST/*ST）
  return 10;
}

/**
 * 涨停触发阈值（通知用，留 0.5% 容差）
 * @param {string} code 股票代码
 * @returns {number} 阈值百分比；港股返回 0（不适用）
 */
export function getLimitThreshold(code) {
  const pct = getLimitPct(code);
  return pct === 0 ? 0 : pct - 0.5;
}
