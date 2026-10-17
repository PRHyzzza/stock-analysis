import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 行业数据加载 + 弹窗状态
 */
export function useIndustryData() {
  const industryData = ref(null);
  const industryLoading = ref(false);
  const industryError = ref("");
  const industryStale = ref(false);
  const showIndustryModal = ref(false);

  // 请求序号：快速切换股票时丢弃旧股票的慢响应，防止弹窗显示上一只股票的数据
  let requestSeq = 0;
  // 当前数据所属股票：换标的才清空，刷新失败保留旧数据（§7.16）
  let lastCode = "";

  async function loadIndustryData(stock) {
    if (!stock) return;
    const seq = ++requestSeq;
    industryLoading.value = true;
    industryError.value = "";
    if (stock.code !== lastCode) {
      industryData.value = null;
      lastCode = stock.code;
    }
    industryStale.value = false;
    try {
      const data = await invoke("get_stock_industry", { code: stock.code });
      if (seq !== requestSeq) return; // 已被更新的请求取代，丢弃旧结果
      industryData.value = data;
    } catch (e) {
      if (seq !== requestSeq) return;
      industryStale.value = true; // 保留旧数据并标注过期
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
    industryStale,
    showIndustryModal,
    loadIndustryData,
    openIndustryModal,
    closeIndustryModal,
  };
}
