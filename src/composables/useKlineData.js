import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * K 线数据加载 + 周期切换
 */
export function useKlineData() {
  const klineData = ref(null);
  const klineLoading = ref(false);
  const klinePeriod = ref("day");
  // 请求序号：切换股票/周期时丢弃旧请求结果（竞态保护）
  let requestSeq = 0;

  async function loadKlineData(stock) {
    if (!stock) return;
    const seq = ++requestSeq;
    klineLoading.value = true;
    try {
      const data = await invoke("get_stock_kline", {
        code: stock.code,
        period: klinePeriod.value,
      });
      if (seq !== requestSeq) return; // 已被更新的请求取代，丢弃
      klineData.value = data;
    } catch (e) {
      if (seq !== requestSeq) return;
      console.error("获取 K 线数据失败:", e);
      klineData.value = null;
    } finally {
      if (seq === requestSeq) klineLoading.value = false;
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
