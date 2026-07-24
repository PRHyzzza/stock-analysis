/**
 * createDataFetcher — 数据加载工厂函数
 *
 * 消除重复的 ref + invoke + loading/error 样板代码。
 * 适用于大多数 "传入 stock code → 调用 Tauri command" 的数据加载场景。
 *
 * 用法：
 *   const fetcher = createDataFetcher("get_stock_kline");
 *   await fetcher.load(stock.code);
 *   // fetcher.data, fetcher.loading, fetcher.error 自动更新
 *
 * 高级用法 — 自定义参数映射：
 *   const fetcher = createDataFetcher("get_stock_kline", {
 *     mapParams: (code) => ({ code, period: "week" }),
 *   });
 */

import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * @param {string} commandName — Tauri 后端命令名
 * @param {Object} [options]
 * @param {Function} [options.mapParams] — 将入参映射为 invoke 参数，默认 (code) => ({ code })
 * @param {Function} [options.raceGuard] — 竞态保护：返回 true 表示丢弃结果
 * @param {boolean} [options.clearOnSwitch] — 切换目标时是否清空旧数据
 * @returns {{ data, loading, error, load, reset }}
 */
export function createDataFetcher(commandName, options = {}) {
  const { mapParams, raceGuard, clearOnSwitch = true } = options;

  const data = ref(null);
  const loading = ref(false);
  const error = ref("");
  let lastTarget = null; // 记录上次请求目标（用于 clearOnSwitch）

  /**
   * 加载数据
   * @param {string} [target] — 目标标识（如股票代码），用于 clearOnSwitch 和竞态保护
   * @param  {...any} extraArgs — 额外参数传给 mapParams
   */
  async function load(target, ...extraArgs) {
    if (target == null) return;

    // 切换目标时清除旧数据
    if (clearOnSwitch && lastTarget && lastTarget !== target) {
      data.value = null;
      error.value = "";
    }

    loading.value = true;
    error.value = "";

    try {
      const params = mapParams ? mapParams(target, ...extraArgs) : { code: target };
      const result = await invoke(commandName, params);

      // 竞态保护
      if (raceGuard && raceGuard(target)) return;

      data.value = result;
      lastTarget = target;
    } catch (e) {
      if (raceGuard && raceGuard(target)) return;
      error.value = String(e);
      data.value = null;
    } finally {
      if (!raceGuard || !raceGuard(target)) {
        loading.value = false;
      }
    }
  }

  /** 重置所有状态 */
  function reset() {
    data.value = null;
    loading.value = false;
    error.value = "";
    lastTarget = null;
  }

  return { data, loading, error, load, reset };
}
