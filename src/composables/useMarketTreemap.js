import { ref, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 大盘云图数据（行业树 + 实时行情，Rust 端合并）
 * 参考 52etf.site：行业 → 细分行业 → 个股 三层结构，8 秒轮询
 */
export function useMarketTreemap(refreshMs = 8000) {
  const data = ref(null);
  const loading = ref(false);
  const error = ref("");

  let timer = null;
  let fetching = false;

  async function load() {
    if (fetching) return; // 防重入
    fetching = true;
    loading.value = true;
    try {
      data.value = await invoke("get_market_treemap");
      error.value = "";
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
      fetching = false;
    }
  }

  function start() {
    stop();
    load();
    if (refreshMs > 0) timer = setInterval(load, refreshMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  onUnmounted(stop);

  return { data, loading, error, load, start, stop };
}
