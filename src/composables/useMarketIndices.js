import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

const INDEX_NAMES = {
  "000001": "上证",
  "399001": "深证",
  "399006": "创业板",
  "000300": "沪深300",
  "000688": "科创50",
  "000905": "中证500",
};

/**
 * 大盘指数实时行情
 */
export function useMarketIndices() {
  const indices = ref([
    { code: "000001", name: "上证", price: 0, change: 0, changePct: 0 },
    { code: "399001", name: "深证", price: 0, change: 0, changePct: 0 },
    { code: "399006", name: "创业板", price: 0, change: 0, changePct: 0 },
    { code: "000300", name: "沪深300", price: 0, change: 0, changePct: 0 },
    { code: "000688", name: "科创50", price: 0, change: 0, changePct: 0 },
    { code: "000905", name: "中证500", price: 0, change: 0, changePct: 0 },
  ]);
  const loading = ref(false);

  async function loadIndices() {
    loading.value = true;
    try {
      const result = await invoke("get_market_indices");
      if (result && Array.isArray(result)) {
        result.forEach((item) => {
          const idx = indices.value.findIndex((i) => i.code === item.code);
          if (idx !== -1) {
            indices.value[idx] = { ...indices.value[idx], ...item };
          }
        });
      }
    } catch (e) {
      console.error("获取指数失败:", e);
    } finally {
      loading.value = false;
    }
  }

  return { indices, loading, loadIndices };
}
