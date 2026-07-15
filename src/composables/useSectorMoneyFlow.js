import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 全部板块资金流向
 */
export function useSectorMoneyFlow() {
  const sectorList = ref([]);
  const sectorLoading = ref(false);
  const sectorError = ref("");

  async function loadSectorMoneyFlow() {
    sectorLoading.value = true;
    sectorError.value = "";
    try {
      const data = await invoke("get_sector_money_flow");
      sectorList.value = data;
    } catch (e) {
      sectorError.value = String(e);
      console.error("获取板块资金流向失败:", e);
    } finally {
      sectorLoading.value = false;
    }
  }

  return {
    sectorList,
    sectorLoading,
    sectorError,
    loadSectorMoneyFlow,
  };
}
