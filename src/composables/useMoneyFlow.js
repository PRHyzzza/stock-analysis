import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 主力资金流向（当日分档快照 + 近 N 日历史）
 * @param {import("vue").Ref} [selectedStockRef] - 可选，用于竞态保护
 *
 * 竞态与失败语义（PROJECT.md §7.2 / §7.16）：
 * - 每个 loader 独立维护请求序号，只接受「最后一次发起」的结果；快照与历史互不作废
 * - 请求失败不清空已有数据，只置 stale 供 DataFreshness 标注
 */
export function useMoneyFlow(selectedStockRef) {
  const moneyFlow = ref(null);
  const moneyFlowLoading = ref(false);
  /** 当前展示的 moneyFlow 是否为旧数据（刷新失败） */
  const moneyFlowStale = ref(false);
  const moneyFlowError = ref("");
  // 记录当前数据对应的股票代码，用于判断是否切换了股票
  let currentCode = null;
  // 最近一次请求的股票（未传 selectedStockRef 时也具备竞态保护）
  let lastRequested = null;
  // 快照与历史各自独立的请求序号
  let quoteSeq = 0;
  let historySeq = 0;

  /** 当前"应展示"的股票代码：有 ref 用 ref（随选中变化），无 ref 用最近请求 */
  function activeCode() {
    return selectedStockRef ? selectedStockRef.value?.code : lastRequested;
  }

  async function loadMoneyFlow(stock) {
    if (!stock) return;
    lastRequested = stock.code;
    const seq = ++quoteSeq;

    // 切换股票时清除旧数据，避免显示上只股票的数据
    if (currentCode && currentCode !== stock.code) {
      moneyFlow.value = null;
      moneyFlowStale.value = false;
    }

    moneyFlowLoading.value = true;
    try {
      const data = await invoke("get_stock_money_flow", { code: stock.code });
      // 竞态保护：仅接受最后一次发起且未被切股的结果
      if (seq !== quoteSeq || activeCode() !== stock.code) {
        return;
      }
      moneyFlow.value = data;
      moneyFlowStale.value = false;
      moneyFlowError.value = "";
      currentCode = stock.code;
    } catch (e) {
      if (seq !== quoteSeq || activeCode() !== stock.code) {
        return;
      }
      // 出错时不清空 moneyFlow，保留上一次的有效数据并标记 stale
      moneyFlowStale.value = moneyFlow.value != null;
      moneyFlowError.value = String(e?.message || e || "资金流加载失败");
      console.warn("[useMoneyFlow] loadMoneyFlow failed:", e);
    } finally {
      if (seq === quoteSeq) {
        moneyFlowLoading.value = false;
      }
    }
  }

  // ── 历史数据（近 N 日主力净流入，用于柱状图）──
  const moneyFlowHistory = ref(null);
  const moneyFlowHistoryLoading = ref(false);
  const moneyFlowHistoryStale = ref(false);
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
    // 注意：这里不写 lastRequested，否则会把快照请求的竞态标记作废

    // 切换股票时清除旧历史，避免显示上只股票的图表
    if (currentHistoryCode && currentHistoryCode !== stock.code) {
      moneyFlowHistory.value = null;
      moneyFlowHistoryStale.value = false;
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
    const seq = ++historySeq;

    moneyFlowHistoryLoading.value = true;
    try {
      const data = await invoke("get_stock_money_flow_history", {
        code: stock.code,
        limit: 30,
      });
      if (seq !== historySeq) {
        return;
      }
      // 空结果视为本次请求成功但无数据（不覆盖旧数据的 stale 语义）
      moneyFlowHistory.value = Array.isArray(data) && data.length > 0 ? data : null;
      moneyFlowHistoryStale.value = false;
    } catch (e) {
      if (seq !== historySeq) {
        return;
      }
      // 出错时保留上一次的有效数据，并标记 stale
      moneyFlowHistoryStale.value = moneyFlowHistory.value != null;
      console.warn("[useMoneyFlow] loadMoneyFlowHistory failed:", e);
    } finally {
      if (seq === historySeq) {
        moneyFlowHistoryLoading.value = false;
      }
    }
  }

  return {
    moneyFlow,
    moneyFlowLoading,
    moneyFlowStale,
    moneyFlowError,
    loadMoneyFlow,
    moneyFlowHistory,
    moneyFlowHistoryLoading,
    moneyFlowHistoryStale,
    loadMoneyFlowHistory,
  };
}
