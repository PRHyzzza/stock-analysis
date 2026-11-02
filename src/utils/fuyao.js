/**
 * 同花顺 Fuyao 数据源的统一入口（前端侧）
 *
 * 目的：把「哪些命令需要带 API Key」收口到一处，避免每个调用点各写一遍
 * `localStorage.getItem("stock-analysis-fuyao-api-key")`。
 *
 * 数据源分工（与 PROJECT.md §7.37 一致）：
 * - Fuyao（需 Key）：标的检索、日/周/月 K 线、热榜、交易日历
 * - 腾讯（无需 Key）：实时行情、分时、分钟 K、指数；Fuyao 调用失败时上述三项也自动回退腾讯
 *
 * Key 与交易日历共用同一个 localStorage 键（`stock-analysis-fuyao-api-key`），
 * 在「设置 → AI」里填写；未配置时返回空串，Rust 侧会走腾讯，功能不中断。
 */

const API_KEY_STORAGE = "stock-analysis-fuyao-api-key";

/**
 * 读取同花顺 API Key（未配置返回空串）
 * @returns {string}
 */
export function getFuyaoKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

/**
 * 需要 Fuyao 的命令参数：把 apiKey 注入到命令参数里（空串表示走腾讯）
 * @param {object} [args]
 * @returns {object}
 */
export function withFuyaoKey(args = {}) {
  return { ...args, apiKey: getFuyaoKey() };
}
