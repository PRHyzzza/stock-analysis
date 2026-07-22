<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import TitleBar from "./components/TitleBar.vue";
import MarketHeader from "./components/MarketHeader.vue";
import StockList from "./components/StockList.vue";
import StockDetail from "./components/StockDetail.vue";
import IndustryModal from "./components/IndustryModal.vue";
import TechAnalysisModal from "./components/TechAnalysisModal.vue";
import AiAnalysisModal from "./components/AiAnalysisModal.vue";
import ChipDistribution from "./components/ChipDistribution.vue";
import PositionModal from "./components/PositionModal.vue";
import ProfileModal from "./components/ProfileModal.vue";
import SettingsModal from "./components/SettingsModal.vue";
import { useWatchlist } from "./composables/useWatchlist";
import { usePositions } from "./composables/usePositions";
import { useQuoteLoader } from "./composables/useQuoteLoader";
import { useIndustryData } from "./composables/useIndustryData";
import { useKlineData } from "./composables/useKlineData";
import { useMarketIndices } from "./composables/useMarketIndices";
import { useMoneyFlow } from "./composables/useMoneyFlow";
import { useIntradayData } from "./composables/useIntradayData";
import { useSectorMoneyFlow } from "./composables/useSectorMoneyFlow";
import { deleteStockMessages } from "./composables/aiMessageStore";
import { useUserProfileSingleton } from "./composables/useUserProfile";
import { useWatchlistNotifications } from "./composables/useWatchlistNotifications";
import { useSettings } from "./composables/useSettings";

// ---- 侧边栏视图切换 ----
const sidebarView = ref("watchlist");

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

// ---- 技术分析弹窗 ----
const showTechModal = ref(false);
function openTechModal() { showTechModal.value = true; }
function closeTechModal() { showTechModal.value = false; }

// ---- AI 分析弹窗 ----
const showAiModal = ref(false);
function openAiModal() {
  showAiModal.value = true;
  // 打开 AI 弹窗时立刻刷新所有持仓实时价格
  positions.value.forEach((pos) => {
    loadQuote({ code: pos.code }).then((quote) => {
      if (quote) updatePositionQuote(pos.code, quote);
    });
  });
  // 确保切换 AI 弹窗时数据已加载
  if (selectedStock.value && !klineData.value && !klineLoading.value) {
    loadKlineData(selectedStock.value);
    loadMoneyFlow(selectedStock.value);
    loadIndustryData(selectedStock.value);
  }
}
function closeAiModal() { showAiModal.value = false; }

// ---- 筹码峰弹窗 ----
const showChipModal = ref(false);
function openChipModal() { showChipModal.value = true; }
function closeChipModal() { showChipModal.value = false; }

// ---- 持仓弹窗 ----
const showPositionsModal = ref(false);
const { positions, addPosition, removePosition, updatePositionQuote } = usePositions();
const { loadProfile } = useUserProfileSingleton();

async function handleAddPosition(pos) {
  addPosition(pos);
  // 立即获取新增持仓的实时行情
  const quote = await loadQuote({ code: pos.code });
  if (quote) updatePositionQuote(pos.code, quote);
}

function openPositionsModal() { showPositionsModal.value = true; }
function closePositionsModal() { showPositionsModal.value = false; }

// ---- 画像弹窗 ----
const showProfileModal = ref(false);
function openProfileModal() { showProfileModal.value = true; }
function closeProfileModal() { showProfileModal.value = false; }

// ---- 设置弹窗 ----
const showSettingsModal = ref(false);
function openSettingsModal() { showSettingsModal.value = true; }
function closeSettingsModal() { showSettingsModal.value = false; }

const { indices, loadIndices } = useMarketIndices();
const { moneyFlow, moneyFlowLoading, loadMoneyFlow } = useMoneyFlow(selectedStock);
const { intradayData, intradayLoading, loadIntradayData } = useIntradayData();
const { sectorList, sectorLoading, sectorError, loadSectorMoneyFlow } = useSectorMoneyFlow();
const { checkAndNotify } = useWatchlistNotifications();
const { state: settings } = useSettings();

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
  loadIndustryData(stock);
  loadQuote(stock).then((quote) => {
    if (quote) updateWatchlistQuote(stock.code, quote);
  });
  loadKlineData(stock);
  loadIntradayData(stock);
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

/** 从自选移除时同步删除 AI 对话记录 */
function handleRemoveFromWatchlist(code) {
  removeFromWatchlist(code);
  deleteStockMessages(code);
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
    selectedStock.value ? loadIntradayData(selectedStock.value) : Promise.resolve(),
    selectedStock.value ? loadMoneyFlow(selectedStock.value) : Promise.resolve(),
  ]);
  refreshing.value = false;
}

// ESC 键关闭弹窗
function onKeydown(e) {
  if (e.key === "Escape") {
    closeIndustryModal();
    closeTechModal();
    closeAiModal();
    closeChipModal();
    closePositionsModal();
    closeSettingsModal();
  }
}

let indicesTimer;
let quotesTimer;
let klineTimer;

/** 重新设置所有定时器（设置变更时调用） */
function rescheduleTimers() {
  clearInterval(indicesTimer);
  clearInterval(quotesTimer);
  clearInterval(klineTimer);

  if (settings.indicesRefreshMs > 0) {
    indicesTimer = setInterval(loadIndices, settings.indicesRefreshMs);
  }
  if (settings.quotesRefreshMs > 0) {
    quotesTimer = setInterval(refreshAllQuotes, settings.quotesRefreshMs);
  }
  if (settings.klineRefreshMs > 0) {
    klineTimer = setInterval(() => {
      if (selectedStock.value) loadKlineData(selectedStock.value);
    }, settings.klineRefreshMs);
  }
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  // 加载用户画像
  loadProfile();
  // 加载指数行情
  loadIndices();
  // 加载板块资金流向
  loadSectorMoneyFlow();
  // 初始设置定时器
  rescheduleTimers();
  // 左侧所有自选股刷新实时数据
  refreshAllQuotes();
  // 右侧选中股票加载数据
  if (selectedStock.value) {
    loadIndustryData(selectedStock.value);
    loadKlineData(selectedStock.value);
    loadIntradayData(selectedStock.value);
    loadMoneyFlow(selectedStock.value);
  }
});

// 设置变更时自动重新调度定时器
watch(
  () => [settings.indicesRefreshMs, settings.quotesRefreshMs, settings.klineRefreshMs],
  () => { rescheduleTimers(); }
);

function refreshAllQuotes() {
  watchlist.value.forEach((stock) => {
    loadQuote(stock).then((quote) => {
      if (quote) {
        updateWatchlistQuote(stock.code, quote);
        checkAndNotify(quote, settings);
      }
    });
  });
  // 刷新持仓的实时行情
  positions.value.forEach((pos) => {
    loadQuote({ code: pos.code }).then((quote) => {
      if (quote) updatePositionQuote(pos.code, quote);
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
});
</script>

<template>
  <div class="app">
    <!-- 自定义标题栏 -->
    <TitleBar />

    <!-- 指数栏 -->
    <MarketHeader
      :indices="indices"
      :refreshing="refreshing"
      @refresh="handleManualRefresh"
      @open-positions="openPositionsModal"
      @open-profile="openProfileModal"
      @open-settings="openSettingsModal"
    />

    <!-- 主体区域: 左-列表 | 右-详情 -->
    <div class="main-layout">
      <!-- 左侧：自选股列表 / 热榜 -->
      <StockList
        :watchlist="watchlist"
        :filtered-watchlist="filteredWatchlist"
        :selected-stock="selectedStock"
        :search-query="searchQuery"
        :sidebar-view="sidebarView"
        :sector-list="sectorList"
        :sector-loading="sectorLoading"
        :sector-error="sectorError"
        @select-stock="selectStock"
        @remove="handleRemoveFromWatchlist"
        @add-stock="addStockFromSearch"
        @update:search-query="searchQuery = $event"
        @update:sidebar-view="sidebarView = $event"
        @sector-refresh="loadSectorMoneyFlow"
      />

      <!-- 右侧：详情面板 -->
      <StockDetail
        :selected-stock="selectedStock"
        :watchlist="watchlist"
        :kline-data="klineData"
        :kline-loading="klineLoading"
        :kline-period="klinePeriod"
        :intraday-data="intradayData"
        :intraday-loading="intradayLoading"
        :money-flow="moneyFlow"
        :money-flow-loading="moneyFlowLoading"
        :watchlist-markers="watchlistMarkers"
        @toggle-watchlist="toggleWatchlist"
        @change-kline-period="changeKlinePeriod"
        @open-industry-modal="onIndustryModalOpen"
        @open-tech-modal="openTechModal"
        @open-ai-modal="openAiModal"
        @open-chip-modal="openChipModal"
        @load-intraday="loadIntradayData(selectedStock)"
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

    <!-- 技术分析弹窗 -->
    <TechAnalysisModal
      :show="showTechModal"
      :kline-data="klineData"
      :stock-name="selectedStock?.name ?? ''"
      @close="closeTechModal"
    />

    <!-- AI 分析弹窗 -->
    <AiAnalysisModal
      :show="showAiModal"
      :selected-stock="selectedStock"
      :kline-data="klineData"
      :money-flow="moneyFlow"
      :industry-data="industryData"
      :indices="indices"
      :positions="positions"
      @close="closeAiModal"
    />

    <!-- 筹码峰弹窗 -->
    <ChipDistribution
      :show="showChipModal"
      :kline-data="klineData"
      :loading="klineLoading"
      @close="closeChipModal"
    />

    <!-- 持仓弹窗 -->
    <PositionModal
      :show="showPositionsModal"
      :positions="positions"
      @close="closePositionsModal"
      @add="handleAddPosition"
      @remove="removePosition"
    />

    <!-- 画像弹窗 -->
    <ProfileModal
      :show="showProfileModal"
      @close="closeProfileModal"
    />

    <!-- 设置弹窗 -->
    <SettingsModal
      :show="showSettingsModal"
      @close="closeSettingsModal"
    />
  </div>
</template>

<style scoped>
/* ===== Steep: 全局布局 ===== */
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}

/* ===== Steep: 主体布局 — 舒适间距 ===== */
.main-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 24px 32px;
  gap: 24px;
}
</style>
