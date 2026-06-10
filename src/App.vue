<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import StockList from "./components/StockList.vue";
import StockDetail from "./components/StockDetail.vue";
import IndustryModal from "./components/IndustryModal.vue";
import AiAnalysisModal from "./components/AiAnalysisModal.vue";
import TechAnalysisModal from "./components/TechAnalysisModal.vue";
import { useWatchlist } from "./composables/useWatchlist";
import { useQuoteLoader } from "./composables/useQuoteLoader";
import { useIndustryData } from "./composables/useIndustryData";
import { useKlineData } from "./composables/useKlineData";
import { useAiAnalysis } from "./composables/useAiAnalysis";
import { useMarketIndices } from "./composables/useMarketIndices";
import { useMoneyFlow } from "./composables/useMoneyFlow";

// ---- Composable state & actions ----
const {
  watchlist, searchQuery, selectedStock, filteredWatchlist,
  selectStock: rawSelectStock,
  isInWatchlist, toggleWatchlist, addToWatchlist, removeFromWatchlist, updateWatchlistQuote,
} = useWatchlist();

const { loadQuote } = useQuoteLoader();

const {
  industryData, industryLoading, industryError, showIndustryModal,
  loadIndustryData, openIndustryModal, closeIndustryModal,
} = useIndustryData();

const {
  klineData, klineLoading, klinePeriod,
  loadKlineData, changeKlinePeriod: rawChangePeriod,
} = useKlineData();

const {
  aiLoading, aiResult, aiError, showAiModal,
  apiKey, showApiKeyInput,
  runAiAnalysis: rawRunAi, cancelAiAnalysis,
  openAiModal, closeAiModal,
  handleSaveApiKey, handleClearApiKey,
} = useAiAnalysis();

// ---- 技术分析弹窗 ----
const showTechModal = ref(false);
function openTechModal() { showTechModal.value = true; }
function closeTechModal() { showTechModal.value = false; }

const { indices, loadIndices } = useMarketIndices();
const { moneyFlow, moneyFlowLoading, loadMoneyFlow } = useMoneyFlow(selectedStock);

// 计算当前选中股票的"加入自选"标记
const watchlistMarkers = computed(() => {
  if (!selectedStock.value?.addedAt || !klineData.value) return [];
  const addedDate = selectedStock.value.addedAt;
  // 检查 kline 数据中是否有该日期
  const exists = klineData.value.some((item) => item.date === addedDate);
  if (!exists) return [];
  return [
    {
      time: addedDate,
      position: "belowBar",
      color: "#f0b429",
      shape: "arrowUp",
      text: "加入自选",
    },
  ];
});

// ---- Orchestration wrappers ----

function selectStock(stock) {
  rawSelectStock(stock);
  aiResult.value = "";
  aiError.value = "";
  loadIndustryData(stock);
  loadQuote(stock).then((quote) => {
    if (quote) updateWatchlistQuote(stock.code, quote);
  });
  loadKlineData(stock);
  loadMoneyFlow(stock);
}

function changeKlinePeriod(period) {
  rawChangePeriod(period);
  loadKlineData(selectedStock.value);
}

function onIndustryModalOpen() {
  openIndustryModal();
  if (!industryData.value && !industryLoading.value && selectedStock.value) {
    loadIndustryData(selectedStock.value);
  }
}

function onRunAiAnalysis() {
  // Use a fresh ref to trigger reactivity
  aiResult.value = "";
  aiError.value = "";
  rawRunAi(selectedStock.value, {
    moneyFlow: moneyFlow.value,
    klineData: klineData.value,
    industryData: industryData.value,
    industryName: industryData.value?.industryName ?? "",
    indices: indices.value,
  });
}

function onRemoveFromWatchlist(code) {
  removeFromWatchlist(code);
  if (!selectedStock.value) {
    aiResult.value = "";
    aiError.value = "";
    cancelAiAnalysis();
  }
}

/** 从搜索结果添加自选 */
function addStockFromSearch(result) {
  if (isInWatchlist(result.code)) return;
  const stock = {
    code: result.code,
    name: result.name,
    price: 0,
    change: 0,
    changePct: 0,
    open: 0,
    high: 0,
    low: 0,
    prevClose: 0,
    volume: 0,
    turnover: 0,
    turnoverRate: 0,
    pe: 0,
    amplitude: 0,
  };
  addToWatchlist(stock);
  // 选中新添加的股票
  selectStock(stock);
}

// 手动全部刷新
const refreshing = ref(false);
async function handleManualRefresh() {
  refreshing.value = true;
  await Promise.all([
    loadIndices(),
    refreshAllQuotes(),
    selectedStock.value ? loadKlineData(selectedStock.value) : Promise.resolve(),
    selectedStock.value ? loadIndustryData(selectedStock.value) : Promise.resolve(),
    selectedStock.value ? loadMoneyFlow(selectedStock.value) : Promise.resolve(),
  ]);
  refreshing.value = false;
}

// ESC 键关闭弹窗
function onKeydown(e) {
  if (e.key === "Escape") {
    closeIndustryModal();
    closeAiModal();
    closeTechModal();
    cancelAiAnalysis();
  }
}

let indicesTimer;
let quotesTimer;
let klineTimer;

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  // 加载指数行情（每 60 秒）
  loadIndices();
  indicesTimer = setInterval(loadIndices, 60000);
  // 左侧所有自选股刷新实时数据（每 30 秒）
  refreshAllQuotes();
  quotesTimer = setInterval(refreshAllQuotes, 30000);
  // 右侧选中股票定时刷新 K 线（每 120 秒）
  if (selectedStock.value) {
    loadIndustryData(selectedStock.value);
    loadKlineData(selectedStock.value);
    loadMoneyFlow(selectedStock.value);
  }
  klineTimer = setInterval(() => {
    if (selectedStock.value) loadKlineData(selectedStock.value);
  }, 120000);
});

function refreshAllQuotes() {
  watchlist.value.forEach((stock) => {
    loadQuote(stock).then((quote) => {
      if (quote) updateWatchlistQuote(stock.code, quote);
    });
  });
  // 同时刷新当前选中股票的资金流向
  if (selectedStock.value) {
    loadMoneyFlow(selectedStock.value);
  }
}

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
  clearInterval(indicesTimer);
  clearInterval(quotesTimer);
  clearInterval(klineTimer);
  cancelAiAnalysis();
});
</script>

<template>
  <div class="app">
    <!-- 顶栏 -->
    <header class="header">
      <div class="header-left">
      </div>
      <div class="header-center">
        <div class="market-indices">
          <template v-for="(idx, i) in indices" :key="idx.code">
            <span v-if="i > 0" class="index-divider"></span>
            <span class="index-item">
              <span class="index-name">{{ idx.name }}</span>
              <span class="index-value" :class="idx.change >= 0 ? 'up' : 'down'">
                {{ idx.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
              </span>
              <span class="index-change" :class="idx.change >= 0 ? 'up' : 'down'">
                {{ idx.changePct > 0 ? '+' : '' }}{{ idx.changePct.toFixed(2) }}%
              </span>
            </span>
          </template>
        </div>
      </div>
      <div class="header-right">
        <button class="btn-refresh" :class="{ loading: refreshing }" @click="handleManualRefresh" :disabled="refreshing">
          <svg class="refresh-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 8a6 6 0 0 1 10.47-4M14 8a6 6 0 0 1-10.47 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M13.5 2v4h-4M2.5 14v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ refreshing ? '刷新中...' : '刷新' }}</span>
        </button>
      </div>
    </header>

    <!-- 主体区域: 左-列表 | 右-详情 -->
    <div class="main-layout">
      <!-- 左侧：自选股列表 -->
      <StockList
        :watchlist="watchlist"
        :filtered-watchlist="filteredWatchlist"
        :selected-stock="selectedStock"
        :search-query="searchQuery"
        @select-stock="selectStock"
        @remove="removeFromWatchlist"
        @add-stock="addStockFromSearch"
        @update:search-query="searchQuery = $event"
      />

      <!-- 右侧：详情面板 -->
      <StockDetail
        :selected-stock="selectedStock"
        :watchlist="watchlist"
        :kline-data="klineData"
        :kline-loading="klineLoading"
        :kline-period="klinePeriod"
        :money-flow="moneyFlow"
        :money-flow-loading="moneyFlowLoading"
        :watchlist-markers="watchlistMarkers"
        @toggle-watchlist="toggleWatchlist"
        @change-kline-period="changeKlinePeriod"
        @open-industry-modal="onIndustryModalOpen"
        @open-ai-modal="openAiModal"
        @open-tech-modal="openTechModal"
      />
    </div>

    <!-- 行业分析弹窗 -->
    <IndustryModal
      :show="showIndustryModal"
      :loading="industryLoading"
      :error="industryError"
      :data="industryData"
      :selected-stock="selectedStock"
      @close="closeIndustryModal"
      @retry="industryData ? null : loadIndustryData(selectedStock)"
    />

    <!-- AI 分析弹窗 -->
    <AiAnalysisModal
      :show="showAiModal"
      :loading="aiLoading"
      :result="aiResult"
      :error="aiError"
      :api-key="apiKey"
      :show-api-key-input="showApiKeyInput"
      @close="closeAiModal"
      @run-analysis="onRunAiAnalysis"
      @save-api-key="handleSaveApiKey"
      @clear-api-key="handleClearApiKey"
    />

    <!-- 技术分析弹窗 -->
    <TechAnalysisModal
      :show="showTechModal"
      :kline-data="klineData"
      :stock-name="selectedStock?.name ?? ''"
      @close="closeTechModal"
    />
  </div>
</template>

<style scoped>
/* ===== 全局布局 ===== */
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}

/* ===== 顶栏 ===== */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
  height: 60px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  position: relative;
}

.header-left {
  min-width: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-refresh:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
  background: #f8f9fb;
}
.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-refresh.loading .refresh-icon {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.header-center {
  display: flex;
  align-items: center;
  margin-left: 32px;
}

.market-indices {
  display: flex;
  align-items: center;
  gap: 20px;
}

.index-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.index-name {
  color: var(--text-secondary);
  font-weight: 500;
}

.index-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.index-change {
  font-weight: 500;
  font-size: 12px;
}

.index-change.up,
.index-value.up { color: var(--red); }

.index-change.down,
.index-value.down { color: var(--green); }

.index-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}

/* ===== 主体：左右布局 ===== */
.main-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 20px 32px;
  gap: 24px;
}
</style>
