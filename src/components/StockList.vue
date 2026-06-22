<script setup>
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import HotList from "./HotList.vue";

const props = defineProps({
  watchlist: { type: Array, required: true },
  filteredWatchlist: { type: Array, required: true },
  selectedStock: { type: Object, default: null },
  searchQuery: { type: String, default: "" },
  sidebarView: { type: String, default: "watchlist" },
});

const emit = defineEmits(["select-stock", "remove", "update:searchQuery", "add-stock", "update:sidebarView"]);

function switchTab(view) {
  emit("update:sidebarView", view);
}

const searchResults = ref([]);
const showResults = ref(false);
const searching = ref(false);
let debounceTimer = null;

function onSearchInput(e) {
  const val = e.target.value;
  emit("update:searchQuery", val);

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
      const aIn = props.watchlist.some((s) => s.code === a.code) ? 1 : 0;
      const bIn = props.watchlist.some((s) => s.code === b.code) ? 1 : 0;
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

function addStock(result) {
  emit("add-stock", result);
  emit("update:searchQuery", "");
  searchResults.value = [];
  showResults.value = false;
}

function selectStock(stock) {
  emit("select-stock", stock);
}

function removeStock(code) {
  emit("remove", code);
}

function onSearchBlur() {
  setTimeout(() => { showResults.value = false; }, 200);
}

function onSearchFocus() {
  if (searchResults.value.length > 0) {
    showResults.value = true;
  }
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
    </div>

    <!-- 自选股视图 -->
    <template v-if="sidebarView === 'watchlist'">
      <div class="search-bar">
          <span class="search-icon">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
          </span>
        <input
          :value="searchQuery"
          type="text"
          placeholder="搜索添加自选股..."
          class="search-input"
          @input="onSearchInput"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
        />
        <!-- 搜索建议下拉 -->
        <div v-if="showResults" class="search-dropdown">
          <div v-if="searching" class="search-dropdown-item search-dropdown-hint">
            <span class="search-spinner"></span>
            <span>搜索中...</span>
          </div>
          <template v-else-if="searchResults.length > 0">
            <div
              v-for="result in searchResults"
              :key="result.market + result.code"
              class="search-dropdown-item"
              :class="{ 'already-in': watchlist.some(s => s.code === result.code) }"
              @mousedown.prevent="addStock(result)"
            >
              <div class="search-result-left">
                <span class="search-result-name">{{ result.name }}</span>
                <span class="search-result-code">{{ result.code }}</span>
              </div>
              <div class="search-result-right">
                <span class="search-result-market">{{ result.market }}</span>
                <span v-if="watchlist.some(s => s.code === result.code)" class="search-result-hint">已自选</span>
                <span v-else class="search-result-add">+ 添加</span>
              </div>
            </div>
          </template>
          <div v-else-if="searchQuery.trim() && !searching" class="search-dropdown-item search-dropdown-hint">
            未找到匹配的股票
          </div>
        </div>
      </div>

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

.search-bar {
  position: relative;
}

/* Steep: 搜索框 — 大圆角 16px */
.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  opacity: 0.35;
}

.search-input {
  width: 100%;
  padding: 11px 16px 11px 42px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-family: inherit;
  letter-spacing: -0.009em;
  background: var(--card-bg);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-input::placeholder {
  color: var(--dove);
}

.search-input:focus {
  border-color: var(--ink);
  box-shadow: 0 0 0 2px rgba(23, 25, 28, 0.06);
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

/* ===== Steep: 搜索建议下拉 ===== */
.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 6px;
  background: var(--card-bg);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-dropdown);
  z-index: 100;
  max-height: 280px;
  overflow-y: auto;
}

.search-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.1s;
}

.search-dropdown-item:hover {
  background: var(--fog);
}

.search-dropdown-item.already-in {
  opacity: 0.55;
}

.search-dropdown-item + .search-dropdown-item {
  border-top: 1px solid var(--border-light);
}

.search-dropdown-hint {
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 13px;
  cursor: default;
}

.search-result-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-result-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.search-result-code {
  font-size: 11px;
  color: var(--text-muted);
}

.search-result-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-result-market {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--border);
  padding: 2px 6px;
  border-radius: 4px;
}

.search-result-hint {
  font-size: 11px;
  color: var(--green);
  font-weight: 500;
}

/* Steep: add button — Rust 替代蓝色 */
.search-result-add {
  font-size: 12px;
  font-weight: 600;
  color: var(--rust);
}

.search-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--text-muted);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
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
