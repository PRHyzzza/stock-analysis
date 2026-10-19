import { reactive, watch } from "vue";

const STORAGE_KEY = "stock-analysis-settings";

/** 默认设置 */
const DEFAULTS = {
  // ── 刷新间隔（毫秒）──
  indicesRefreshMs: 60000,   // 指数
  quotesRefreshMs: 30000,    // 行情
  klineRefreshMs: 120000,    // K线
  intradayRefreshMs: 60000,  // 分时

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
  priceAlertsEnabled: true,   // 自定义价格/条件提醒

  // ── K 线图表 ──
  klineMaPeriods: [5, 10, 20, 30],
  klineShow30DayHL: true,

  // ── AI ──
  aiModel: "deepseek-v4-flash",
  aiThinkingEnabled: true,
  aiReasoningEffort: "high",  // "low" | "high" | "max"
  aiWebSearchEnabled: true,   // 联网搜索（东方财富新闻库，免费）
};

/**
 * 校验并修正外部可写存储（localStorage 可能被旧版本、手工编辑或其它窗口写坏）
 *
 * 不做校验的后果：`quotesRefreshMs: "abc"` 会让 setInterval 拿到非法间隔（退化为 0ms 忙轮询），
 * `klineMaPeriods` 非数组会让图表计算抛错。这里以 DEFAULTS 为 schema，类型不符一律回退默认值。
 */
function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const val = raw[key];
    if (val === undefined || val === null) continue;
    if (Array.isArray(def)) {
      if (Array.isArray(val)) {
        const nums = val.map(Number).filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length > 0) out[key] = nums;
      }
      continue;
    }
    if (typeof def === "number") {
      const n = Number(val);
      // 刷新间隔合法区间：[0, 1h]；0 表示关闭该轮询
      if (Number.isFinite(n) && n >= 0 && n <= 60 * 60 * 1000) out[key] = n;
      continue;
    }
    if (typeof def === "boolean") {
      if (typeof val === "boolean") out[key] = val;
      continue;
    }
    if (typeof def === "string") {
      if (typeof val === "string" && val !== "") out[key] = val;
      continue;
    }
  }
  return out;
}

/** 加载持久化设置 */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return sanitize(JSON.parse(raw));
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

  /** 重置所有设置为默认值（深拷贝，避免污染 DEFAULTS 引用） */
  function resetAll() {
    Object.assign(state, JSON.parse(JSON.stringify(DEFAULTS)));
  }

  _instance = { state, resetAll };
  return _instance;
}
