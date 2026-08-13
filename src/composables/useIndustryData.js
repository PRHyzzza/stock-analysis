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

  // 请求序号：快速切换股票时丢弃旧股票的慢响应，防止弹窗显示上一只股票的数据
  let requestSeq = 0;

  async function loadIndustryData(stock) {
    if (!stock) return;
    const seq = ++requestSeq;
    industryLoading.value = true;
    industryError.value = "";
    industryData.value = null;
    try {
      const data = await invoke("get_stock_industry", { code: stock.code });
      if (seq !== requestSeq) return; // 已被更新的请求取代，丢弃旧结果
      industryData.value = data;
    } catch (e) {
      if (seq !== requestSeq) return;
      industryError.value = String(e);
      console.error("获取行业数据失败:", e);
    } finally {
      if (seq === requestSeq) industryLoading.value = false;
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
