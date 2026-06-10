import { invoke } from "@tauri-apps/api/core";

/**
 * 实时行情加载
 */
export function useQuoteLoader() {
  async function loadQuote(stock) {
    if (!stock) return null;
    try {
      return await invoke("get_stock_quote", { code: stock.code });
    } catch (e) {
      console.error("获取实时行情失败:", e);
      return null;
    }
  }

  return { loadQuote };
}
