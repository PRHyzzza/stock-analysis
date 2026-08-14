import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 主力资金流向（当日分档快照 + 近 N 日历史）
 * @param {import("vue").Ref} [selectedStockRef] - 可选，用于竞态保护
 */
export function useMoneyFlow(selectedStockRef) {
  const moneyFlow = ref(null);
  const moneyFlowLoading = ref(false);
  // 记录当前数据对应的股票代码，用于判断是否切换了股票
  let currentCode = null;
  // 最近一次请求的股票（未传 selectedStockRef 时也具备竞态保护）
  let lastRequested = null;

  /** 当前"应展示"的股票代码：有 ref 用 ref（随选中变化），无 ref 用最近请求 */
  function activeCode() {
    return selectedStockRef ? selectedStockRef.value?.code : lastRequested;
  }

  async function loadMoneyFlow(stock) {
    if (!stock) return;
    lastRequested = stock.code;

    // 切换股票时清除旧数据，避免显示上只股票的数据
    if (currentCode && currentCode !== stock.code) {
      moneyFlow.value = null;
    }

    moneyFlowLoading.value = true;
    try {
      const data = await invoke("get_stock_money_flow", { code: stock.code });
      // 竞态保护：如果调用期间用户切换了股票，则丢弃结果
      if (activeCode() !== stock.code) {
        return;
      }
      moneyFlow.value = data;
      currentCode = stock.code;
    } catch (e) {
      // 竞态保护：期间已切换股票则忽略错误
      if (activeCode() !== stock.code) {
        return;
      }
      // 出错时不清空 moneyFlow，保留上一次的有效数据
    } finally {
      if (activeCode() === stock.code) {
        moneyFlowLoading.value = false;
      }
    }
  }

  // ── 历史数据（近 N 日主力净流入，用于柱状图）──
  const moneyFlowHistory = ref(null);
  const moneyFlowHistoryLoading = ref(false);
  let currentHistoryCode = null;
  // 节流：同一股票 2 分钟内不重复拉取（日线级数据，盘中变化慢）
  let lastHistoryFetchAt = 0;
  const HISTORY_THROTTLE_MS = 120 * 1000;

  /**
   * 加载近 30 日资金流向历史
   * @param {Object} stock
   * @param {{ force?: boolean }} [opts] force=true 跳过节流（切股/手动刷新时用）
   */
  async function loadMoneyFlowHistory(stock, opts = {}) {
    if (!stock) return;
    lastRequested = stock.code;

    // 切换股票时清除旧历史，避免显示上只股票的图表
    if (currentHistoryCode && currentHistoryCode !== stock.code) {
      moneyFlowHistory.value = null;
    }

    // 节流：同一股票短时间内不重复请求（force 跳过）
    const now = Date.now();
    if (
      !opts.force &&
      currentHistoryCode === stock.code &&
      now - lastHistoryFetchAt < HISTORY_THROTTLE_MS
    ) {
      return;
    }
    currentHistoryCode = stock.code;
    lastHistoryFetchAt = now;

    moneyFlowHistoryLoading.value = true;
    try {
      const data = await invoke("get_stock_money_flow_history", {
        code: stock.code,
        limit: 30,
      });
      if (activeCode() !== stock.code) {
        return;
      }
      moneyFlowHistory.value = Array.isArray(data) && data.length > 0 ? data : null;
    } catch (e) {
      // 竞态保护：期间已切换股票则忽略错误
      if (activeCode() !== stock.code) {
        return;
      }
      // 出错时保留上一次的有效数据
    } finally {
      if (activeCode() === stock.code) {
        moneyFlowHistoryLoading.value = false;
      }
    }
  }

  return {
    moneyFlow,
    moneyFlowLoading,
    loadMoneyFlow,
    moneyFlowHistory,
    moneyFlowHistoryLoading,
    loadMoneyFlowHistory,
  };
}
