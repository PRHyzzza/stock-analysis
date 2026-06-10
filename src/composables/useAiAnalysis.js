import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "DEEPSEEK_API_KEY";

/**
 * 从 localStorage 读取 DeepSeek API 密钥
 */
function loadApiKey() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * 将 DeepSeek API 密钥保存到 localStorage
 */
function saveApiKey(key) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
    return true;
  } catch {
    return false;
  }
}

/**
 * AI 分析（调用 DeepSeek API）
 */
export function useAiAnalysis() {
  const aiLoading = ref(false);
  const aiResult = ref("");
  const aiError = ref("");
  const showAiModal = ref(false);
  const apiKey = ref(loadApiKey());
  const showApiKeyInput = ref(!apiKey.value);

  /** 保存密钥到本地缓存 */
  function handleSaveApiKey(key) {
    apiKey.value = key;
    saveApiKey(key);
    showApiKeyInput.value = false;
  }

  /** 清除已保存的密钥 */
  function handleClearApiKey() {
    apiKey.value = "";
    saveApiKey("");
    showApiKeyInput.value = true;
  }

  async function runAiAnalysis(stock, extraData = {}) {
    if (!stock) return;

    const key = apiKey.value || loadApiKey();
    if (!key) {
      aiError.value = "请先设置 DeepSeek API 密钥。\n点击上方「设置密钥」按钮进行配置。";
      showApiKeyInput.value = true;
      return;
    }

    aiLoading.value = true;
    aiError.value = "";
    aiResult.value = "";

    try {
      // 序列化复杂数据结构
      const {
        moneyFlow = null,
        klineData = null,
        industryData = null,
        industryName = "",
        indices = null,
      } = extraData;

      const text = await invoke("get_ai_analysis", {
        apiKey: key,
        stockCode: stock.code,
        stockName: stock.name,
        price: stock.price || 0,
        change: stock.change || 0,
        changePct: stock.changePct || 0,
        high: stock.high || 0,
        low: stock.low || 0,
        open: stock.open || 0,
        prevClose: stock.prevClose || 0,
        volume: stock.volume || 0,
        turnover: stock.turnover || 0,
        turnoverRate: stock.turnoverRate || 0,
        pe: stock.pe || 0,
        amplitude: stock.amplitude || 0,
        mainNetInflow: moneyFlow?.mainNetInflow ?? 0,
        mainNetPct: moneyFlow?.mainNetPct ?? 0,
        klineDataJson: JSON.stringify(klineData || []),
        industryName: industryName || "",
        industryDataJson: JSON.stringify(industryData || {}),
        marketIndicesJson: JSON.stringify(indices || []),
      });
      aiResult.value = text;
    } catch (err) {
      const message = typeof err === "string" ? err : err?.message || "AI 分析失败，请检查网络连接和 API 密钥配置";
      // 401/403 等鉴权错误时自动弹出密钥设置
      if (message.includes("401") || message.includes("403") || message.includes("Authentication") || message.includes("认证")) {
        showApiKeyInput.value = true;
      }
      aiError.value = message;
      console.error("AI 分析失败:", err);
    } finally {
      aiLoading.value = false;
    }
  }

  function cancelAiAnalysis() {
    aiLoading.value = false;
  }

  function openAiModal() {
    showAiModal.value = true;
  }

  function closeAiModal() {
    showAiModal.value = false;
  }

  return {
    aiLoading,
    aiResult,
    aiError,
    showAiModal,
    apiKey,
    showApiKeyInput,
    runAiAnalysis,
    cancelAiAnalysis,
    openAiModal,
    closeAiModal,
    handleSaveApiKey,
    handleClearApiKey,
  };
}
