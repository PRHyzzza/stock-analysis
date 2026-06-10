import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 行业数据加载 + 弹窗状态
 */
export function useIndustryData() {
  const industryData = ref(null);
  const industryLoading = ref(false);
  const industryError = ref("");
  const showIndustryModal = ref(false);

  async function loadIndustryData(stock) {
    if (!stock) return;
    industryLoading.value = true;
    industryError.value = "";
    industryData.value = null;
    try {
      const data = await invoke("get_stock_industry", { code: stock.code });
      industryData.value = data;
    } catch (e) {
      industryError.value = String(e);
      console.error("获取行业数据失败:", e);
    } finally {
      industryLoading.value = false;
    }
  }

  function openIndustryModal() {
    showIndustryModal.value = true;
  }

  function closeIndustryModal() {
    showIndustryModal.value = false;
  }

  return {
    industryData,
    industryLoading,
    industryError,
    showIndustryModal,
    loadIndustryData,
    openIndustryModal,
    closeIndustryModal,
  };
}
