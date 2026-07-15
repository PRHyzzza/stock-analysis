/**
 * 格式化工具函数 — 供全项目复用
 */

/** 正数返回 "+"，零/负数返回 "" */
export function signChar(v) {
  return v > 0 ? "+" : "";
}

/** 金额格式化：万元 → 万/亿 */
export function formatAmount(wy) {
  if (wy == null) return "0";
  const abs = Math.abs(wy);
  if (abs >= 10000) return (wy / 10000).toFixed(2) + "亿";
  return wy.toFixed(0) + "万";
}

/** 金额格式化（带符号），用于 StockDetail meta 展示 */
export function fmtMoney(v) {
  if (v == null) return "--";
  const abs = Math.abs(v);
  if (abs >= 10000) return (v / 10000).toFixed(2) + "亿";
  if (abs >= 1000) return (v / 1000).toFixed(2) + "千万";
  return v.toFixed(2) + "万";
}

/** 百分比格式化 */
export function fmtPct(v) {
  if (v == null) return "";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

// ---- CSS class 辅助 ----

/** 涨跌幅颜色 class */
export function pctClass(val) {
  if (val > 0) return "up";
  if (val < 0) return "down";
  return "";
}

/** 资金净流入颜色 class */
export function inflowClass(val) {
  if (val > 0) return "inflow-up";
  if (val < 0) return "inflow-down";
  return "inflow-zero";
}
