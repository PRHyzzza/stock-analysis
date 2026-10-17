/**
 * 格式化工具函数 — 供全项目复用
 *
 * 数值口径约定：
 * - 所有 `fmt*` 遇到缺失值（null/undefined/""/NaN/Infinity）统一回退 `--`，由组件负责三态展示
 * - `fmtMoney` 的输入单位为「万元」（Rust 端 `parse_money` 已把「亿/万」统一折算为万）
 */

/** 正数返回 "+"，零/负数返回 "" */
export function signChar(v) {
  return v > 0 ? "+" : "";
}

/** 安全数值转换：无法转成有限数时返回 null（禁止回退 0，避免把缺失当真实值） */
export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 金额格式化（带符号），输入单位：万元 */
export function fmtMoney(v) {
  const n = num(v);
  if (n === null) return "--";
  const abs = Math.abs(n);
  if (abs >= 10000) return (n / 10000).toFixed(2) + "亿";
  if (abs >= 1000) return (n / 1000).toFixed(2) + "千万";
  return n.toFixed(2) + "万";
}

/** 百分比格式化（带符号，缺失回退空串，兼容旧调用方的 `fmtPct(x) || "--"` 写法） */
export function fmtPct(v, digits = 2) {
  const n = num(v);
  if (n === null) return "";
  return (n > 0 ? "+" : "") + n.toFixed(digits) + "%";
}

/** 百分比格式化，缺失回退 `--` */
export function fmtPctOrDash(v, digits = 2) {
  const n = num(v);
  if (n === null) return "--";
  return (n > 0 ? "+" : "") + n.toFixed(digits) + "%";
}

/** 固定位数数值，缺失回退 `--` */
export function fmtNum(v, digits = 2) {
  const n = num(v);
  return n === null ? "--" : n.toFixed(digits);
}

/** 固定位数数值（带 + 号），缺失回退 `--` */
export function fmtSignedNum(v, digits = 2) {
  return signChar(num(v)) + fmtNum(v, digits);
}

/**
 * 涨跌方向 class（A 股习惯：涨红跌绿）；缺失返回 ""，0 归 flat
 * @returns {"up"|"down"|"flat"|""}
 */
export function trendClass(v) {
  const n = num(v);
  if (n === null) return "";
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}
