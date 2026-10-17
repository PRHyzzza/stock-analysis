/**
 * 刷新间隔的可见性降频（单一真源）
 *
 * 规则（PROJECT.md §7.15）：窗口不可见时必须降频；隐藏信号来自
 *   - `document.visibilitychange`（最小化/切后台）
 *   - Rust 侧 `main-window-hidden` / `main-window-shown`（点关闭按钮 hide）
 * 由 `src/App.vue` 调用 `setWindowHidden()` 上报，其余组件只读：
 *   - `effectiveInterval(ms)`：拿到当前应使用的间隔
 *   - `onIntervalModeChange(fn)`：可见性变化时重建定时器（返回注销函数）
 *
 * 之所以放在 utils 而不是 props：轮询点分散在 StockList → HotList、MiniMode 等深层组件，
 * 逐层透传 props 易漏；这里由 App.vue 单一入口上报，组件订阅即可，口径不会分叉。
 */

/** 不可见时的放大幅度（与原 App.vue 的 HIDDEN_REFRESH_FACTOR 保持一致） */
export const HIDDEN_REFRESH_FACTOR = 4;

let hidden = false;
const listeners = new Set();

/** App.vue 专用：上报主窗口可见性 */
export function setWindowHidden(v) {
  const next = !!v;
  if (hidden === next) return;
  hidden = next;
  // 通知订阅者重建定时器（异常不阻断其它订阅者）
  for (const fn of Array.from(listeners)) {
    try {
      fn(hidden);
    } catch (e) {
      console.warn("[refreshInterval] reschedule listener failed:", e);
    }
  }
}

/** 当前窗口是否被视为不可见 */
export function isWindowHidden() {
  return hidden;
}

/** 定时器实际使用的间隔（不可见时放宽） */
export function effectiveInterval(ms) {
  return hidden ? ms * HIDDEN_REFRESH_FACTOR : ms;
}

/**
 * 订阅可见性变化（用于重建 setInterval）
 * @param {(hidden: boolean) => void} fn
 * @returns {() => void} 注销函数
 */
export function onIntervalModeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
