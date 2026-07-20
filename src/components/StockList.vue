<script setup>
import HotList from "./HotList.vue";
import SectorMoneyFlow from "./SectorMoneyFlow.vue";
import SearchDropdown from "./SearchDropdown.vue";
import { useStockSearch } from "../composables/useStockSearch.js";

const props = defineProps({
  watchlist: { type: Array, required: true },
  filteredWatchlist: { type: Array, required: true },
  selectedStock: { type: Object, default: null },
  searchQuery: { type: String, default: "" },
  sidebarView: { type: String, default: "watchlist" },
  sectorList: { type: Array, default: () => [] },
  sectorLoading: { type: Boolean, default: false },
  sectorError: { type: String, default: "" },
});

const emit = defineEmits([
  "select-stock", "remove", "update:searchQuery", "add-stock",
  "update:sidebarView", "sector-refresh",
]);

const {
  searchQuery,
  searchResults,
  showResults,
  searching,
  onSearchInput,
  clearSearch,
  onSearchBlur,
  onSearchFocus,
} = useStockSearch(() => props.watchlist);

function switchTab(view) {
  emit("update:sidebarView", view);
}

// 同步本地 searchQuery 到父组件
function handleSearchInput(e) {
  onSearchInput(e);
  emit("update:searchQuery", searchQuery.value);
}

function addStock(result) {
  emit("add-stock", result);
  clearSearch();
  emit("update:searchQuery", "");
}

function selectStock(stock) {
  emit("select-stock", stock);
}

function removeStock(code) {
  emit("remove", code);
}
</script>

<template>
  <aside class="sidebar">
    <!-- 顶部 Tab 切换 -->
    <div class="sidebar-tabs">
      <button
        class="sidebar-tab"
        :class="{ active: sidebarView === 'watchlist' }"
        @click="switchTab('watchlist')"
      >
        自选股
      </button>
      <button
        class="sidebar-tab"
        :class="{ active: sidebarView === 'hotlist' }"
        @click="switchTab('hotlist')"
      >
        热榜
      </button>
      <button
        class="sidebar-tab"
        :class="{ active: sidebarView === 'sectorflow' }"
        @click="switchTab('sectorflow')"
      >
        板块
      </button>
    </div>

    <!-- 自选股视图 -->
    <template v-if="sidebarView === 'watchlist'">
      <SearchDropdown
        :search-query="searchQuery"
        :search-results="searchResults"
        :show-results="showResults"
        :searching="searching"
        :watchlist="watchlist"
        @input="handleSearchInput"
        @focus="onSearchFocus"
        @blur="onSearchBlur"
        @add-stock="addStock"
      />

      <div class="watchlist-section">
        <div class="list-header">
          <span class="list-title">自选股</span>
          <span class="list-count">{{ filteredWatchlist.length }} 只</span>
        </div>
        <div class="stock-list">
          <div
            v-for="stock in filteredWatchlist"
            :key="stock.code"
            class="stock-item"
            :class="{ active: selectedStock?.code === stock.code }"
            @click="selectStock(stock)"
          >
            <div class="item-left">
              <span class="item-name">{{ stock.name }}</span>
              <span class="item-code">{{ stock.code }}</span>
            </div>
            <div class="item-right">
              <span class="item-price" :class="stock.change >= 0 ? 'up' : 'down'">
                ¥{{ stock.price.toFixed(2) }}
              </span>
              <span class="item-change" :class="stock.change >= 0 ? 'up' : 'down'">
                {{ stock.changePct > 0 ? '+' : '' }}{{ stock.changePct.toFixed(2) }}%
              </span>
              <button
                class="item-remove"
                title="删除自选"
                @click.stop="removeStock(stock.code)"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
          <div v-if="filteredWatchlist.length === 0" class="empty-state">
            未找到匹配的股票
          </div>
        </div>
      </div>
    </template>

    <!-- 热榜视图 -->
    <HotList
      v-if="sidebarView === 'hotlist'"
      :watchlist="watchlist"
      @select-stock="(stock) => emit('select-stock', stock)"
      @remove-stock="(code) => emit('remove', code)"
    />

    <!-- 板块资金视图 -->
    <SectorMoneyFlow
      v-if="sidebarView === 'sectorflow'"
      :sector-list="sectorList"
      :loading="sectorLoading"
      :error="sectorError"
      @refresh="emit('sector-refresh')"
    />
  </aside>
</template>

<style scoped>
/* ===== Steep: 侧边栏 ===== */
.sidebar {
  width: 370px;
  min-width: 370px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}

/* Steep Tab: 无底色胶囊切换 */
.sidebar-tabs {
  display: flex;
  gap: 4px;
  background: var(--fog);
  border-radius: var(--radius-full);
  padding: 3px;
}
.sidebar-tab {
  flex: 1;
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  background: transparent;
  color: var(--text-muted);
  transition: all 0.2s;
  letter-spacing: -0.009em;
}
.sidebar-tab.active {
  background: var(--card-bg);
  color: var(--ink);
  box-shadow: 0 0 0 1px rgba(23, 25, 28, 0.04), 0 2px 6px rgba(23, 25, 28, 0.06);
}
.sidebar-tab:hover:not(.active) {
  color: var(--text-secondary);
}

/* Steep: 自选股卡片 — 24px 圆角 */
.watchlist-section {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 12px;
  border-bottom: 1px solid var(--border-light);
}

.list-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.009em;
}

.list-count {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.stock-list {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex: 1;
}

.stock-item {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  padding: 12px 22px;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
}

.stock-item:hover {
  background: var(--fog);
}

.stock-item.active {
  background: var(--apricot-wash);
}

.stock-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  background: var(--rust);
  border-radius: 0 2px 2px 0;
}

.stock-item + .stock-item {
  border-top: 1px solid var(--border-light);
}

.item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.item-name {
  font-size: 14px;
  font-weight: 600;
}

.item-code {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}

.item-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 中国 A 股标准：红涨绿跌 */
.item-price {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 72px;
  text-align: right;
}

.item-price.up { color: var(--red); }
.item-price.down { color: var(--green); }

.item-change {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 4px;
  min-width: 52px;
  text-align: center;
}

.item-change.up {
  color: var(--red);
  background: var(--red-bg);
}

.item-change.down {
  color: var(--green);
  background: var(--green-bg);
}

.item-remove {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #c8ced8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
}

.stock-item:hover .item-remove {
  color: var(--slate);
  background: var(--fog);
}

.item-remove:hover {
  color: var(--red) !important;
  background: var(--red-bg) !important;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 13px;
}

/* ===== 侧边栏 Tab 切换 ===== */
.sidebar-tabs {
  display: flex;
  background: var(--card-bg);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
}

.sidebar-tab {
  flex: 1;
  padding: 10px 0;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
}

.sidebar-tab:first-child {
  border-radius: var(--radius) 0 0 var(--radius);
}

.sidebar-tab:last-child {
  border-radius: 0 var(--radius) var(--radius) 0;
}

.sidebar-tab.active {
  color: var(--text-primary);
  background: #f0f2f8;
}

.sidebar-tab:hover:not(.active) {
  color: var(--text-secondary);
  background: #f8f9fc;
}

</style>
