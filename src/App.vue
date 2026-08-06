<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import TitleBar from "./components/TitleBar.vue";
import MarketHeader from "./components/MarketHeader.vue";
import StockList from "./components/StockList.vue";
import StockDetail from "./components/StockDetail.vue";
import MiniMode from "./components/MiniMode.vue";
import IndustryModal from "./components/IndustryModal.vue";
import TechAnalysisModal from "./components/TechAnalysisModal.vue";
import AiAnalysisModal from "./components/AiAnalysisModal.vue";
import GlobalAiModal from "./components/GlobalAiModal.vue";
import ChipDistribution from "./components/ChipDistribution.vue";
import PositionModal from "./components/PositionModal.vue";
import ProfileModal from "./components/ProfileModal.vue";
import SettingsModal from "./components/SettingsModal.vue";
import IwencaiWindow from "./components/IwencaiWindow.vue";
import { useWatchlist } from "./composables/useWatchlist";
import { usePositions } from "./composables/usePositions";
import { useQuoteLoader } from "./composables/useQuoteLoader";
import { useIndustryData } from "./composables/useIndustryData";
import { useKlineData } from "./composables/useKlineData";
import { useMarketIndices } from "./composables/useMarketIndices";
import { useMoneyFlow } from "./composables/useMoneyFlow";
import { useIntradayData } from "./composables/useIntradayData";
import { deleteStockMessages } from "./composables/aiMessageStore";
import { useUserProfileSingleton } from "./composables/useUserProfile";
import { useWatchlistNotifications } from "./composables/useWatchlistNotifications";
import { useSettings } from "./composables/useSettings";

// ---- 侧边栏视图切换 ----
const sidebarView = ref("watchlist");

// ---- 迷你置顶模式（盯盘小窗）----
// 迷你窗口以 ?mini=1 参数加载同一前端，渲染精简自选股列表
const isMiniMode = new URLSearchParams(window.location.search).has("mini");
// 问财选股窗口以 ?iwencai=1 参数加载同一前端，渲染独立选股界面
const isIwencaiMode = new URLSearchParams(window.location.search).has("iwencai");
const appWindow = getCurrentWindow();

/** 打开/聚焦迷你盯盘小窗 */
async function openMiniWindow() {
  // getByLabel 是 async 方法，必须 await（否则拿到的是 Promise）
  const existing = await WebviewWindow.getByLabel("mini");
  if (existing) {
    existing.setFocus();
    return;
  }
  await new WebviewWindow("mini", {
    url: `${window.location.origin}${window.location.pathname}?mini=1`,
    title: "盯盘小窗",
    width: 280,
    height: 300,
    decorations: false,
    alwaysOnTop: true,
    resizable: true,
  });
}

/** 打开/聚焦问财选股窗口 */
async function openIwencaiWindow() {
  const existing = await WebviewWindow.getByLabel("iwencai");
  if (existing) {
    existing.setFocus();
    return;
  }
  await new WebviewWindow("iwencai", {
    url: `${window.location.origin}${window.location.pathname}?iwencai=1`,
    title: "问财选股",
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
  });
}

// 自选列表组件引用（Ctrl+K 聚焦搜索框用）
const stockListRef = ref(null);

/** 注册全局快捷键：Ctrl+K 搜索 / Ctrl+N 打开全局 AI */
async function setupGlobalShortcuts() {
  if (isMiniMode || isIwencaiMode) return; // 子窗口不注册
  try {
    await register("CommandOrControl+K", () => {
      stockListRef.value?.focusSearch();
    });
    await register("CommandOrControl+N", () => {
      openGlobalAiModal();
    });
  } catch {
    /* 快捷键被占用或平台不支持时静默降级 */
  }
}

async function teardownGlobalShortcuts() {
  try {
    await unregister("CommandOrControl+K");
    await unregister("CommandOrControl+N");
  } catch {
    /* ignore */
  }
}

// ---- Composable state & actions ----
const {
  watchlist, searchQuery, selectedStock, filteredWatchlist,
  selectStock: rawSelectStock,
  isInWatchlist, toggleWatchlist, addToWatchlist, removeFromWatchlist, updateWatchlistQuote,
} = useWatchlist();

const { loadQuote, loadQuotesBatch } = useQuoteLoader();

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

// ---- 全局 AI 弹窗 ----
const showGlobalAiModal = ref(false);
function openGlobalAiModal() { showGlobalAiModal.value = true; }
function closeGlobalAiModal() { showGlobalAiModal.value = false; }

// ---- 问财选股（独立窗口 ?iwencai=1）----

/** 问财窗口选中股票 → 主窗口联动选中并加载全部数据 */
function selectIwencaiStock(stock) {
  const full = {
    code: stock.code,
    name: stock.name || stock.code,
    market: stock.market,
    price: 0, change: 0, changePct: 0,
    open: 0, high: 0, low: 0, prevClose: 0,
    volume: 0, turnover: 0, turnoverRate: 0, pe: 0, amplitude: 0,
  };
  selectStock(full);
}

// ---- 筹码峰弹窗 ----
const showChipModal = ref(false);
function openChipModal() { showChipModal.value = true; }
function closeChipModal() { showChipModal.value = false; }

// ---- 持仓弹窗 ----
const showPositionsModal = ref(false);
const { positions, addPosition, removePosition, updatePositionQuote, setFxRate } = usePositions();
const { loadProfile } = useUserProfileSingleton();

async function handleAddPosition(pos) {
  addPosition(pos);
  // 立即获取新增持仓的实时行情
  const quote = await loadQuote({ code: pos.code });
  if (quote) updatePositionQuote(pos.code, quote);
}

async function handleEditPosition(pos) {
  addPosition(pos);
  // 立即刷新修改后持仓的实时行情
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
    market: result.market || (result.code.length === 5 ? "HK" : (result.code.startsWith("6") ? "SH" : "SZ")),
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
    closeGlobalAiModal();
    closeChipModal();
    closePositionsModal();
    closeSettingsModal();
  }
}

let indicesTimer;
let quotesTimer;
let klineTimer;
let intradayTimer;

/** 重新设置所有定时器（设置变更时调用） */
function rescheduleTimers() {
  if (isMiniMode || isIwencaiMode) return; // 子窗口自带独立刷新逻辑
  clearInterval(indicesTimer);
  clearInterval(quotesTimer);
  clearInterval(klineTimer);
  clearInterval(intradayTimer);

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
  if (settings.intradayRefreshMs > 0) {
    intradayTimer = setInterval(() => {
      if (selectedStock.value) loadIntradayData(selectedStock.value);
    }, settings.intradayRefreshMs);
  }
}

let unlistenMiniSelect = null;
let unlistenIwencaiSelect = null;
let unlistenIwencaiAdd = null;

onMounted(() => {
  if (isMiniMode || isIwencaiMode) return; // 子窗口不执行主窗口逻辑（自带独立刷新）

  document.addEventListener("keydown", onKeydown);
  // 全局快捷键（Ctrl+K 搜索 / Ctrl+N 全局 AI）
  setupGlobalShortcuts();
  // 迷你窗口选中股票 → 主窗口联动
  listen("mini-select-stock", (e) => {
    const stock = watchlist.value.find((s) => s.code === e.payload?.code);
    if (stock) {
      selectStock(stock);
      appWindow.setFocus();
    }
  }).then((fn) => { unlistenMiniSelect = fn; });
  // 问财选股窗口选中股票 → 主窗口联动
  listen("iwencai-select-stock", (e) => {
    if (e.payload?.code) {
      selectIwencaiStock(e.payload);
      appWindow.setFocus();
    }
  }).then((fn) => { unlistenIwencaiSelect = fn; });
  // 问财窗口「加入自选」→ 主窗口自选列表追加并刷新行情
  listen("iwencai-add-watchlist", (e) => {
    const p = e.payload;
    if (p?.code) {
      addToWatchlist({
        code: p.code,
        market: p.market || "SH",
        name: p.name || p.code,
        price: 0, change: 0, changePct: 0,
      });
      refreshAllQuotes();
    }
  }).then((fn) => { unlistenIwencaiAdd = fn; });
  // 拉取港元兑人民币汇率
  invoke("get_fx_rate").then((rate) => setFxRate(rate)).catch(() => {});
  // 加载用户画像
  loadProfile();
  // 加载指数行情
  loadIndices();
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

// 设置变更时自动重新调度定时器（含分时刷新间隔）
watch(
  () => [settings.indicesRefreshMs, settings.quotesRefreshMs, settings.klineRefreshMs, settings.intradayRefreshMs],
  () => { rescheduleTimers(); }
);

async function refreshAllQuotes() {
  // 自选股批量刷新（A 股一次请求，大幅减少 HTTP 请求数）
  const codes = watchlist.value.map((s) => s.code);
  if (codes.length > 0) {
    const quotes = await loadQuotesBatch(codes);
    if (quotes) {
      const quoteMap = new Map(quotes.map((q) => [q.code, q]));
      watchlist.value.forEach((stock) => {
        const quote = quoteMap.get(stock.code);
        if (quote) {
          updateWatchlistQuote(stock.code, quote);
          checkAndNotify(quote, settings);
        }
      });
    }
  }
  // 刷新持仓的实时行情（含港股，批量接口内部处理）
  const posCodes = positions.value.map((p) => p.code);
  if (posCodes.length > 0) {
    const quotes = await loadQuotesBatch(posCodes);
    if (quotes) {
      quotes.forEach((quote) => updatePositionQuote(quote.code, quote));
    }
  }
  // 同时刷新当前选中股票的资金流向
  if (selectedStock.value) {
    loadMoneyFlow(selectedStock.value);
  }
}

onUnmounted(() => {
  if (isMiniMode || isIwencaiMode) return;
  document.removeEventListener("keydown", onKeydown);
  teardownGlobalShortcuts();
  if (unlistenMiniSelect) unlistenMiniSelect();
  if (unlistenIwencaiSelect) unlistenIwencaiSelect();
  if (unlistenIwencaiAdd) unlistenIwencaiAdd();
  clearInterval(indicesTimer);
  clearInterval(quotesTimer);
  clearInterval(klineTimer);
  clearInterval(intradayTimer);
});
</script>

<template>
  <!-- 迷你盯盘小窗（?mini=1 参数加载） -->
  <MiniMode v-if="isMiniMode" />

  <!-- 问财选股窗口（?iwencai=1 参数加载） -->
  <IwencaiWindow v-else-if="isIwencaiMode" />

  <div v-else class="app">
    <!-- 自定义标题栏 -->
    <TitleBar @open-mini="openMiniWindow" />

    <!-- 指数栏 -->
    <MarketHeader
      :indices="indices"
      :refreshing="refreshing"
      @refresh="handleManualRefresh"
      @open-positions="openPositionsModal"
      @open-profile="openProfileModal"
      @open-settings="openSettingsModal"
      @open-global-ai="openGlobalAiModal"
      @open-iwencai="openIwencaiWindow"
    />

    <!-- 主体区域: 左-列表 | 右-详情 -->
    <div class="main-layout">
      <!-- 左侧：自选股列表 / 热榜 -->
      <StockList
        ref="stockListRef"
        :watchlist="watchlist"
        :filtered-watchlist="filteredWatchlist"
        :selected-stock="selectedStock"
        :search-query="searchQuery"
        :sidebar-view="sidebarView"
        @select-stock="selectStock"
        @remove="handleRemoveFromWatchlist"
        @add-stock="addStockFromSearch"
        @update:search-query="searchQuery = $event"
        @update:sidebar-view="sidebarView = $event"
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

    <!-- 全局 AI 助手弹窗 -->
    <GlobalAiModal
      :show="showGlobalAiModal"
      :indices="indices"
      :positions="positions"
      @close="closeGlobalAiModal"
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
      @edit="handleEditPosition"
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
