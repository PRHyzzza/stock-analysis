/**
 * 格式化工具函数 — 供全项目复用
 */

/** 正数返回 "+"，零/负数返回 "" */
export function signChar(v) {
  return v > 0 ? "+" : "";
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
