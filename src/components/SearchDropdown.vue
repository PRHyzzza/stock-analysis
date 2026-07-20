<script setup>
/**
 * 股票搜索下拉组件（从 StockList.vue 拆分）
 */
defineProps({
  searchQuery: { type: String, default: "" },
  searchResults: { type: Array, default: () => [] },
  showResults: { type: Boolean, default: false },
  searching: { type: Boolean, default: false },
  watchlist: { type: Array, default: () => [] },
});

const emit = defineEmits(["input", "focus", "blur", "add-stock"]);
</script>

<template>
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
      @input="emit('input', $event)"
      @focus="emit('focus')"
      @blur="emit('blur')"
    />
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
          @mousedown.prevent="emit('add-stock', result)"
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
</template>

<style scoped>
/* ===== 搜索栏（与 StockList.vue 拆分前完全一致） ===== */
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

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
