<script setup>
import HotList from "./HotList.vue";
import SearchDropdown from "./SearchDropdown.vue";
import { ref, computed } from "vue";
import { useStockSearch } from "../composables/useStockSearch.js";
import { usePositions } from "../composables/usePositions.js";

const { positions } = usePositions();

/** 持仓代码集合，用于标记自选列表中的持仓股 */
const heldCodes = computed(() => new Set(positions.value.map((p) => p.code)));

const props = defineProps({
  watchlist: { type: Array, required: true },
  filteredWatchlist: { type: Array, required: true },
  selectedStock: { type: Object, default: null },
  searchQuery: { type: String, default: "" },
  sidebarView: { type: String, default: "watchlist" },
});

const emit = defineEmits([
  "select-stock", "remove", "update:searchQuery", "add-stock",
  "update:sidebarView",
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

// 供父组件（全局快捷键 Ctrl+K）聚焦搜索框
const searchDropdownRef = ref(null);
defineExpose({ focusSearch: () => searchDropdownRef.value?.focus() });
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
      <SearchDropdown
        ref="searchDropdownRef"
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
            role="button"
            tabindex="0"
            :class="{ active: selectedStock?.code === stock.code }"
            @click="selectStock(stock)"
            @keydown.enter.prevent="selectStock(stock)"
            @keydown.space.prevent="selectStock(stock)"
          >
            <div class="item-left">
              <span class="item-name" :class="{ 'has-position': heldCodes.has(stock.code) }">{{ stock.name }}</span>
              <span v-if="heldCodes.has(stock.code)" class="position-badge" title="持仓中">持</span>
              <span class="item-code">{{ stock.code }}</span>
              <span v-if="stock.market === 'HK' || stock.code?.length === 5" class="market-badge-sm market-hk">HK</span>
            </div>
            <div class="item-right">
              <span class="item-price" :class="stock.change >= 0 ? 'up' : 'down'">
                {{ (stock.market === 'HK' || stock.code?.length === 5) ? 'HK$' : '¥' }}{{ stock.price.toFixed(2) }}
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
  width: clamp(260px, 26vw, 370px);
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}

/* 窗口较小时进一步压缩侧边栏 */
@media (max-width: 1200px) {
  .sidebar {
    width: clamp(220px, 30vw, 300px);
    min-width: 220px;
  }
  .stock-item {
    padding: 10px 14px;
  }
  .list-header {
    padding: 14px 16px 10px;
  }
  .item-left {
    gap: 6px;
  }
  .item-name {
    font-size: 13px;
  }
  .item-price {
    font-size: 13px;
    min-width: 58px;
  }
  .item-change {
    font-size: 11px;
    padding: 2px 6px;
    min-width: 44px;
  }
  .item-right {
    gap: 5px;
  }
  /* 窄窗口下删除按钮默认隐藏，悬停时显示 */
  .item-remove {
    width: 22px;
    height: 22px;
    opacity: 0;
  }
  .stock-item:hover .item-remove {
    opacity: 1;
  }
  /* 窄窗口：隐藏代码与价格，仅保留名称+涨幅 */
  .item-right {
    gap: 4px;
  }
  /* 窄窗口：隐藏代码与价格，仅保留名称+涨幅 */
  .item-code,
  .market-badge-sm,
  .item-price {
    display: none;
  }
  .item-change {
    margin-left: auto;
    min-width: 44px;
  }
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
  transition: all var(--transition-base);
  letter-spacing: -0.009em;
}
.sidebar-tab:active {
  transform: scale(0.985);
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
  transition: background var(--transition-fast);
  position: relative;
}

.stock-item:hover {
  background: var(--hover-bg);
}

.stock-item.active {
  background: var(--apricot-wash);
}

.stock-item.active:hover {
  background: #f9d7c2;
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

/* 键盘聚焦行：焦点环内缩，避免被列表 overflow 裁掉 */
.stock-item:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
  background: var(--hover-bg);
}

.stock-item + .stock-item {
  border-top: 1px solid var(--border-light);
}

.item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  min-width: 0;
}

.item-name {
  font-size: 14px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 持仓股：名称琥珀高亮 */
.item-name.has-position {
  color: var(--warn-ink);
}

/* 持仓角标 */
.position-badge {
  font-size: 10px;
  font-weight: 700;
  color: var(--warn-ink);
  background: var(--warn-bg);
  border-radius: var(--radius-xs);
  padding: 1px 5px;
  line-height: 1;
  flex-shrink: 0;
}

.item-code {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
  flex-shrink: 0;
}

.market-badge-sm {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  line-height: 1;
}
.market-badge-sm.market-hk {
  color: var(--warn-ink);
  background: var(--warn-bg);
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
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--dove);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  flex-shrink: 0;
  /* 默认隐形，悬停/键盘聚焦行时显现，减少列表视觉噪音 */
  opacity: 0;
}

.stock-item:hover .item-remove,
.stock-item:focus-within .item-remove,
.item-remove:focus-visible {
  opacity: 1;
  color: var(--slate);
  background: var(--fog);
}

.item-remove:hover {
  color: var(--red) !important;
  background: var(--red-bg) !important;
}

.empty-state {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

</style>
