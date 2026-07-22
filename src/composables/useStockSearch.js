import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/**
 * 股票搜索逻辑（含防抖），与 StockList 解耦
 */
export function useStockSearch(getWatchlist) {
  const searchQuery = ref("");
  const searchResults = ref([]);
  const showResults = ref(false);
  const searching = ref(false);
  let debounceTimer = null;
  let blurTimer = null;

  function onSearchInput(e) {
    const val = e.target.value;
    searchQuery.value = val;

    if (debounceTimer) clearTimeout(debounceTimer);

    if (val.trim().length === 0) {
      searchResults.value = [];
      showResults.value = false;
      return;
    }

    debounceTimer = setTimeout(() => doSearch(val.trim()), 300);
  }

  async function doSearch(keyword) {
    searching.value = true;
    showResults.value = true;
    try {
      const results = await invoke("search_stocks", { keyword });
      // 已存在的自选股排在后面
      results.sort((a, b) => {
        const aIn = getWatchlist().some((s) => s.code === a.code) ? 1 : 0;
        const bIn = getWatchlist().some((s) => s.code === b.code) ? 1 : 0;
        return aIn - bIn;
      });
      searchResults.value = results;
    } catch (e) {
      console.error("搜索失败:", e);
      searchResults.value = [];
    } finally {
      searching.value = false;
    }
  }

  function clearSearch() {
    searchQuery.value = "";
    searchResults.value = [];
    showResults.value = false;
  }

  function onSearchBlur() {
    blurTimer = setTimeout(() => { showResults.value = false; }, 200);
  }

  function onSearchFocus() {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
    if (searchResults.value.length > 0) {
      showResults.value = true;
    }
  }

  return {
    searchQuery,
    searchResults,
    showResults,
    searching,
    onSearchInput,
    clearSearch,
    onSearchBlur,
    onSearchFocus,
  };
}
