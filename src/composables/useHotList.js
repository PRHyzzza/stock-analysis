import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 热榜数据加载
 */
export function useHotList() {
  const hotList = ref([]);
  const hotLoading = ref(false);
  const hotError = ref("");

  async function loadHotList() {
    hotLoading.value = true;
    hotError.value = "";
    try {
      const data = await invoke("get_hot_list");
      hotList.value = data.stock_list || [];
    } catch (e) {
      hotError.value = String(e);
      console.error("获取热榜数据失败:", e);
    } finally {
      hotLoading.value = false;
    }
  }

  return {
    hotList,
    hotLoading,
    hotError,
    loadHotList,
  };
}
