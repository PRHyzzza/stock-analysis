import { reactive, watch } from "vue";

const STORAGE_KEY = "stock-analysis-settings";

/** 默认设置 */
const DEFAULTS = {
  // ── 刷新间隔（毫秒）──
  indicesRefreshMs: 60000,   // 指数
  quotesRefreshMs: 30000,    // 行情
  klineRefreshMs: 120000,    // K线

  // ── 通知 ──
  notifyEnabled: true,
  notifyUp5: true,
  notifyUp7: true,
  notifyLimitUp: true,
  notifyDown5: true,
  notifyDown7: true,
  notifyLimitDown: true,
  notifyFastRise: true,
  notifyFastFall: true,
  notifyFastThreshold: 2,     // 快速变动阈值 (%)

  // ── K 线图表 ──
  klineMaPeriods: [5, 10, 20, 30],
  klineShow30DayHL: true,

  // ── AI ──
  aiModel: "deepseek-v4-flash",
  aiThinkingEnabled: true,
  aiReasoningEffort: "high",  // "low" | "high" | "max"
  aiWebSearchEnabled: true,   // 联网搜索（DuckDuckGo，免费）
};

/** 加载持久化设置 */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 单例实例 */
let _instance = null;

/**
 * 全局设置状态（单例 composable）
 *
 * 所有设置项均为响应式，修改后自动持久化到 localStorage。
 * 各组件通过 import { useSettings } 获取同一实例。
 */
export function useSettings() {
  if (_instance) return _instance;

  const state = reactive(load());

  // 自动持久化
  watch(
    () => ({ ...state }),
    (val) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
      } catch { /* ignore */ }
    },
    { deep: true }
  );

  /** 重置所有设置为默认值 */
  function resetAll() {
    Object.assign(state, DEFAULTS);
  }

  _instance = { state, resetAll };
  return _instance;
}
