import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 分时数据加载
 */
export function useIntradayData() {
  const intradayData = ref(null);
  const intradayLoading = ref(false);
  // 请求序号：切换股票时丢弃旧请求结果（竞态保护）
  let requestSeq = 0;

  async function loadIntradayData(stock) {
    if (!stock) return;
    const seq = ++requestSeq;
    intradayLoading.value = true;
    try {
      const data = await invoke("get_stock_intraday", {
        code: stock.code,
      });
      if (seq !== requestSeq) return; // 已被更新的请求取代，丢弃
      intradayData.value = data;
    } catch (e) {
      if (seq !== requestSeq) return;
      console.error("获取分时数据失败:", e);
      intradayData.value = null;
    } finally {
      if (seq === requestSeq) intradayLoading.value = false;
    }
  }

  return {
    intradayData,
    intradayLoading,
    loadIntradayData,
  };
}
