/**
 * 股票代码 → 市场 的唯一判定入口（前端）
 *
 * 规则（与 `src-tauri/src/helpers.rs` 的 `is_shanghai` / `is_hk_stock` 保持一致）：
 * - 5 位纯数字           → HK（港股）
 * - 43/82/83/87/88/92 开头 → BJ（北交所）
 * - 6/900 开头           → SH（沪市主板/科创板/沪 B）
 * - 其余                 → SZ（深市主板/创业板/深 B）
 *
 * 不要在组件里重写这套前缀判断（此前在 App.vue / GlobalAiModal.vue / limit.js 等处重复了 6 份）。
 */

/** 港股：5 位纯数字（允许 hk 前缀或 .HK 后缀） */
export function isHKCode(code) {
  const c = String(code ?? "").trim().toUpperCase();
  return /^(HK)?\d{5}(\.HK)?$/.test(c);
}

/** 北交所：43/82/83/87/88/92 开头 */
export function isBJCode(code) {
  const c = String(code ?? "").trim();
  return /^(43|82|83|87|88|92)\d{4}$/.test(c);
}

/**
 * 判定市场
 * @param {string} code 股票代码（裸码，允许 .SH/.SZ/.BJ/.HK 后缀或 sh/sz/bj 前缀）
 * @returns {"SH"|"SZ"|"BJ"|"HK"}
 */
export function inferMarket(code) {
  let c = String(code ?? "").trim().toUpperCase();
  // 剥离 .SH / .SZ / .BJ / .HK 后缀
  const dot = c.indexOf(".");
  if (dot > 0) c = c.slice(0, dot);
  // 剥离 sh/sz/bj/hk 前缀
  if (/^(SH|SZ|BJ|HK)\d{5,6}$/.test(c)) c = c.slice(2);
  if (c === "") return "SZ";
  if (/^\d{5}$/.test(c)) return "HK";
  if (/^(43|82|83|87|88|92)/.test(c)) return "BJ";
  if (/^(6|900)/.test(c)) return "SH";
  return "SZ";
}

/** 是否为 A 股（沪深北）裸码 */
export function isACode(code) {
  const m = inferMarket(code);
  return m === "SH" || m === "SZ" || m === "BJ";
}
