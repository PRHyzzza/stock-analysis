import { ref, computed, watch } from "vue";

const STORAGE_KEY = "stock-analysis-watchlist";

/** 默认股票池 */
const DEFAULT_STOCKS = [
  { code: "300750", name: "宁德时代", price: 256.80, change: -3.12, changePct: -1.20 },
];

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_STOCKS;
}

/**
 * 自选股状态管理（含 localStorage 持久化）
 */
export function useWatchlist() {
  const watchlist = ref(loadWatchlist());
  const searchQuery = ref("");
  const selectedStock = ref(watchlist.value[0] || null);

  // 持久化
  watch(watchlist, (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
  }, { deep: true });

  const filteredWatchlist = computed(() => {
    if (!searchQuery.value.trim()) return watchlist.value;
    const q = searchQuery.value.trim().toUpperCase();
    return watchlist.value.filter(
      (s) => s.code.includes(q) || s.name.includes(q)
    );
  });

  function selectStock(stock) {
    selectedStock.value = stock;
    searchQuery.value = "";
  }

  function isInWatchlist(code) {
    return watchlist.value.some((s) => s.code === code);
  }

  function addToWatchlist(stock) {
    if (!stock || isInWatchlist(stock.code)) return;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    watchlist.value = [...watchlist.value, { ...stock, addedAt: `${y}-${m}-${d}` }];
  }

  function removeFromWatchlist(code) {
    watchlist.value = watchlist.value.filter((s) => s.code !== code);
    if (selectedStock.value?.code === code) {
      selectedStock.value = watchlist.value[0] || null;
    }
  }

  function toggleWatchlist(stock) {
    if (isInWatchlist(stock.code)) {
      removeFromWatchlist(stock.code);
    } else {
      addToWatchlist(stock);
    }
  }

  /** 更新列表中某只股票的实时数据 */
  function updateWatchlistQuote(code, quoteData) {
    const idx = watchlist.value.findIndex((s) => s.code === code);
    if (idx !== -1) {
      watchlist.value[idx] = { ...watchlist.value[idx], ...quoteData };
      watchlist.value = [...watchlist.value];
    }
    if (selectedStock.value?.code === code) {
      selectedStock.value = { ...selectedStock.value, ...quoteData };
    }
  }

  return {
    watchlist,
    searchQuery,
    selectedStock,
    filteredWatchlist,
    selectStock,
    isInWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    toggleWatchlist,
    updateWatchlistQuote,
  };
}
