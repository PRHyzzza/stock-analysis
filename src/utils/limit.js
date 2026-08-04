/**
 * 涨跌停幅度工具 — 按板块判断涨停幅度（%）
 *
 * 规则：主板 ±10% | 创业板(30) / 科创板(68) ±20% | 北交所(43/82/83/87/88/92) ±30%
 *       ST 股与所属板块一致 | 港股（5 位代码）无涨跌停
 */

/**
 * 获取涨停幅度（%）
 * @param {string} code 股票代码
 * @returns {number} 涨停幅度百分比；港股返回 0（无涨跌停限制）
 */
export function getLimitPct(code) {
  if (!code) return 10;
  // 港股：5 位数字代码，无涨跌停
  if (/^\d{5}$/.test(code)) return 0;
  // 北交所 ±30%
  if (/^(43|82|83|87|88|92)/.test(code)) return 30;
  // 创业板 ±20%
  if (code.startsWith("30")) return 20;
  // 科创板 ±20%
  if (code.startsWith("68")) return 20;
  // 主板 ±10%
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
