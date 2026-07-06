import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 分时数据加载
 */
export function useIntradayData() {
  const intradayData = ref(null);
  const intradayLoading = ref(false);

  async function loadIntradayData(stock) {
    if (!stock) return;
    intradayLoading.value = true;
    try {
      const data = await invoke("get_stock_intraday", {
        code: stock.code,
      });
      intradayData.value = data;
    } catch (e) {
      console.error("获取分时数据失败:", e);
      intradayData.value = null;
    } finally {
      intradayLoading.value = false;
    }
  }

  return {
    intradayData,
    intradayLoading,
    loadIntradayData,
  };
}
