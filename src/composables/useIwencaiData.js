import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 在对象中查找包含指定关键词的 key
 * 用于动态匹配日期间缀字段，如 涨跌幅:前复权[20260623]
 * 注意：经过 Rust HashMap 序列化后 key 顺序不确定，
 * 当多个 key 匹配同一关键词时（如 涨跌幅:前复权 / 涨跌幅:前复权排名），
 * 优先返回不含"排名"的精确值字段，而非排名文本字段。
 */
function findKey(obj, keyword) {
  if (!obj) return null;
  const keys = Object.keys(obj);
  // 精确匹配优先
  if (keys.includes(keyword)) return keyword;
  // 模糊匹配：找出所有包含关键词的 key
  const matches = keys.filter(k => k.includes(keyword));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  // 多个匹配：优先选不含"排名"的（数值值 vs 排名文本）
  const noRank = matches.find(k => !k.includes("排名"));
  if (noRank) return noRank;
  return matches[0];
}

/**
 * 按关键词取值，自动匹配含日期后缀的字段
 */
function getVal(obj, keyword) {
  if (!obj) return null;
  const key = findKey(obj, keyword);
  return key ? obj[key] : null;
}

/**
 * 过滤不符合条件的股票（API 免费层未严格应用所有条件）
 * 只返回真正匹配非 ST、非北交所、非科创的股票
 */
function filterIwencaiStocks(stocks) {
  return stocks.filter((row) => {
    const code = String(row["股票代码"] || row["code"] || "");
    const name = String(row["股票简称"] || "");

    // 过滤北交所（代码以 8 开头）
    if (code.startsWith("8")) return false;

    // 过滤科创板（代码以 688 开头）
    if (code.startsWith("688")) return false;

    // 过滤 ST / *ST / 退市股
    if (name.includes("ST") || name.includes("*ST") || name.includes("退")) return false;

    return true;
  });
}

/**
 * 问财选股数据加载 composable
 * 通过 Tauri 后端 Rust 命令发起 HTTP 请求
 */
export function useIwencaiData() {
  const data = ref(null);
  const list = ref([]);
  const loading = ref(false);
  const error = ref(null);

  /** 通过 Rust 后端调用问财 API */
  async function loadData(
    query = "股本大于5亿小于10亿的股票，多头趋势，涨跌幅从高到低，市值大于50亿，非st，非北交所，非科创",
  ) {
    loading.value = true;
    error.value = null;
    try {
      const result = await invoke("get_iwencai_data", {
        query,
        page: 1,
        perpage: 100,
      });
      // 免费 API 层不会严格过滤所有条件，客户端再滤一遍
      const filtered = filterIwencaiStocks(result);
      list.value = filtered;
      data.value = { datas: filtered };
    } catch (e) {
      // 记录 Rust 后端错误
      const rustErr = e?.message || String(e) || "未知错误";
      console.error("Rust 后端 invoke 失败:", rustErr);
    } finally {
      loading.value = false;
    }
  }

  return { data, list, loading, error, loadData, getVal, findKey };
}
