/**
 * 日 K 线共享缓存 — 均线提醒 / 价格提醒复用同一份 5 分钟缓存，
 * 避免两个系统各自请求同一股票的日 K，也避免 30s 行情刷新触发高频 K 线请求。
 */
import { invoke } from "@tauri-apps/api/core";

const KLINE_CACHE_TTL = 5 * 60 * 1000; // 日 K 缓存 5 分钟
const KLINE_CACHE_MAX = 100;           // LRU 上限，防无界增长

// 模块级缓存（跨 composable 实例共享）：{ code: { data, fetchedAt } }
const cache = new Map();

/**
 * 获取日 K 线（5 分钟缓存，命中时零请求；缓存超上限时淘汰最早插入的条目）
 * @param {string} code 股票代码
 * @returns {Promise<Array|null>} K 线数组（失败返回 null）
 */
export async function fetchDayKlineCached(code) {
  const cached = cache.get(code);
  if (cached && Date.now() - cached.fetchedAt < KLINE_CACHE_TTL) {
    return cached.data;
  }
  try {
    const data = await invoke("get_stock_kline", { code, period: "day" });
    if (Array.isArray(data) && data.length > 0) {
      if (cache.size >= KLINE_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest != null) cache.delete(oldest);
      }
      cache.set(code, { data, fetchedAt: Date.now() });
      return data;
    }
  } catch (e) {
    console.error("获取日K失败:", code, e);
  }
  return null;
}

/**
 * 清除缓存（删除均线提醒配置等场景连带清理，防无界增长；不传 code 清空全部）
 * @param {string} [code]
 */
export function clearKlineCache(code) {
  if (code) {
    cache.delete(code);
  } else {
    cache.clear();
  }
}
