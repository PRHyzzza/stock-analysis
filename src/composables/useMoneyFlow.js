import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 主力资金流向
 * @param {import("vue").Ref} [selectedStockRef] - 可选，用于竞态保护
 */
export function useMoneyFlow(selectedStockRef) {
  const moneyFlow = ref(null);
  const moneyFlowLoading = ref(false);
  // 记录当前数据对应的股票代码，用于判断是否切换了股票
  let currentCode = null;

  async function loadMoneyFlow(stock) {
    if (!stock) return;

    // 切换股票时清除旧数据，避免显示上只股票的数据
    if (currentCode && currentCode !== stock.code) {
      moneyFlow.value = null;
    }

    moneyFlowLoading.value = true;
    try {
      const data = await invoke("get_stock_money_flow", { code: stock.code });
      // 竞态保护：如果调用期间用户切换了股票，则丢弃结果
      if (selectedStockRef && selectedStockRef.value?.code !== stock.code) {
        return;
      }
      moneyFlow.value = data;
      currentCode = stock.code;
    } catch (e) {
      if (selectedStockRef && selectedStockRef.value?.code !== stock.code) {
        return;
      }
      // 出错时不清空 moneyFlow，保留上一次的有效数据
    } finally {
      if (!selectedStockRef || selectedStockRef.value?.code === stock.code) {
        moneyFlowLoading.value = false;
      }
    }
  }

  return {
    moneyFlow,
    moneyFlowLoading,
    loadMoneyFlow,
  };
}
