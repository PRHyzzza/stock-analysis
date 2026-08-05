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

  /**
   * 批量加载多只股票实时行情（A 股走腾讯批量接口，一次请求多只）
   * @param {string[]} codes 股票代码数组
   * @returns {Promise<Array|null>} 行情数组（可能少于请求数，失败的股票自动跳过）
   */
  async function loadQuotesBatch(codes) {
    if (!codes || codes.length === 0) return [];
    try {
      return await invoke("get_stock_quotes_batch", { codes });
    } catch (e) {
      console.error("批量获取实时行情失败:", e);
      return null;
    }
  }

  return { loadQuote, loadQuotesBatch };
}
