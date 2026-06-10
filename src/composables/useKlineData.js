import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * K 线数据加载 + 周期切换
 */
export function useKlineData() {
  const klineData = ref(null);
  const klineLoading = ref(false);
  const klinePeriod = ref("day");

  async function loadKlineData(stock) {
    if (!stock) return;
    klineLoading.value = true;
    try {
      const data = await invoke("get_stock_kline", {
        code: stock.code,
        period: klinePeriod.value,
      });
      klineData.value = data;
    } catch (e) {
      console.error("获取 K 线数据失败:", e);
      klineData.value = null;
    } finally {
      klineLoading.value = false;
    }
  }

  function changeKlinePeriod(period) {
    klinePeriod.value = period;
  }

  return {
    klineData,
    klineLoading,
    klinePeriod,
    loadKlineData,
    changeKlinePeriod,
  };
}
