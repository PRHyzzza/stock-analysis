<script setup>
/**
 * PositionForm.vue — 持仓添加/编辑表单
 * 股票搜索（useStockSearch）+ 成本/数量/买入日期 + 校验，独立于持仓弹窗。
 * 通过 v-if 挂载时以 initial 初始化，提交后 emit("submit")，父组件决定新增还是编辑。
 */
import { ref, computed } from "vue";
import { useStockSearch } from "../composables/useStockSearch.js";

const props = defineProps({
  /** null = 新增；对象 = 编辑（{ code, name, buyPrice, quantity, buyDate }） */
  initial: { type: Object, default: null },
});

const emit = defineEmits(["submit", "cancel"]);

/** 是否编辑模式 */
const editing = computed(() => !!props.initial);

const form = ref({
  code: props.initial?.code || "",
  name: props.initial?.name || "",
  buyPrice: props.initial?.buyPrice != null ? String(props.initial.buyPrice) : "",
  quantity: props.initial?.quantity != null ? String(props.initial.quantity) : "",
  buyDate: props.initial?.buyDate || "",
});
const formError = ref("");

// 股票搜索
const {
  searchQuery: stockSearchQuery,
  searchResults,
  showResults,
  searching,
  onSearchInput,
  clearSearch: clearStockSearch,
  onSearchBlur,
  onSearchFocus,
} = useStockSearch(() => []);

const highlightedIndex = ref(-1);

function selectSearchResult(result) {
  form.value.code = result.code;
  form.value.name = result.name;
  clearStockSearch();
  highlightedIndex.value = -1;
}

function onSearchKeydown(e) {
  if (!showResults.value || searchResults.value.length === 0) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlightedIndex.value = Math.min(highlightedIndex.value + 1, searchResults.value.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0);
  } else if (e.key === "Enter" && highlightedIndex.value >= 0) {
    e.preventDefault();
    selectSearchResult(searchResults.value[highlightedIndex.value]);
  } else if (e.key === "Escape") {
    clearStockSearch();
    highlightedIndex.value = -1;
  }
}

/** 高亮匹配文字（先转义 HTML——股票名称来自外部搜索 API，不可信——再高亮） */
function highlightMatch(text, keyword) {
  const safeText = String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!keyword || !keyword.trim()) return safeText;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  return safeText.replace(re, '<mark class="search-highlight">$1</mark>');
}

function cancelForm() {
  clearStockSearch();
  emit("cancel");
}

function submitForm() {
  const { code, name, buyPrice, quantity } = form.value;
  if (!code.trim()) { formError.value = "请搜索并选择股票"; return; }
  if (!name.trim()) { formError.value = "请搜索并选择股票"; return; }
  // Number.isFinite 校验：输入 "e"/"-" 等时 Number() 为 NaN，
  // 原 !buyPrice || Number(buyPrice)<=0 对 NaN 校验失效会提交 NaN 进持仓
  const bp = Number(buyPrice);
  const qty = Number(quantity);
  if (!Number.isFinite(bp) || bp <= 0) { formError.value = "请输入有效的成本"; return; }
  if (!Number.isFinite(qty) || qty <= 0) { formError.value = "请输入有效的持仓数量"; return; }
  formError.value = "";
  clearStockSearch();
  emit("submit", {
    code: code.trim(),
    name: name.trim(),
    buyPrice: bp,
    quantity: qty,
    buyDate: form.value.buyDate || undefined,
  });
}
</script>

<template>
  <div class="position-form">
    <!-- 股票搜索 -->
    <div class="stock-search-wrap">
      <div class="search-input-row">
        <span class="search-icon">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </span>
        <input
          :value="stockSearchQuery"
          type="text"
          placeholder="搜索股票代码或名称..."
          class="form-input search-stock-input"
          @input="onSearchInput"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
          @keydown="onSearchKeydown"
        />
      </div>
      <!-- 搜索结果下拉 -->
      <div v-if="showResults" class="search-dropdown">
        <div v-if="searching" class="search-dropdown-item search-dropdown-hint">
          <span class="search-spinner"></span>
          <span>搜索中...</span>
        </div>
        <template v-else-if="searchResults.length > 0">
          <div
            v-for="(result, idx) in searchResults"
            :key="result.market + result.code"
            class="search-dropdown-item"
            :class="{ highlighted: idx === highlightedIndex }"
            @mousedown.prevent="selectSearchResult(result)"
            @mouseenter="highlightedIndex = idx"
          >
            <div class="search-result-left">
              <span class="search-result-name" v-html="highlightMatch(result.name, stockSearchQuery)"></span>
              <span class="search-result-code" v-html="highlightMatch(result.code, stockSearchQuery)"></span>
            </div>
            <span class="search-result-market">{{ result.market }}</span>
          </div>
        </template>
        <div v-else-if="stockSearchQuery.trim() && !searching" class="search-dropdown-item search-dropdown-hint">
          未找到匹配的股票
        </div>
      </div>
    </div>
    <!-- 已选股票显示 -->
    <div v-if="form.code" class="selected-stock-badge">
      <span class="selected-stock-name">{{ form.name }}</span>
      <span class="selected-stock-code">{{ form.code }}</span>
      <button class="selected-stock-clear" @click="form.code = ''; form.name = ''">✕</button>
    </div>
    <div class="form-row">
      <input v-model="form.buyPrice" type="number" step="0.01" placeholder="成本" class="form-input" />
      <input v-model="form.quantity" type="number" step="1" placeholder="数量 (股)" class="form-input" />
    </div>
    <div class="form-row">
      <input v-model="form.buyDate" type="date" placeholder="买入日期" class="form-input" />
    </div>
    <div v-if="formError" class="form-error">{{ formError }}</div>
    <div class="form-actions">
      <button class="btn-form btn-form-cancel" @click="cancelForm">取消</button>
      <button class="btn-form btn-form-submit" @click="submitForm">{{ editing ? '确认修改' : '确认添加' }}</button>
    </div>
  </div>
</template>

<style scoped>
/* ===== 添加表单 ===== */
.position-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 12px;
  background: var(--fog);
  border: 1px solid var(--border);
}

/* ===== 股票搜索 ===== */
.stock-search-wrap {
  position: relative;
}

.search-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-icon {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  flex-shrink: 0;
}

.search-stock-input {
  flex: 1;
}

/* 搜索下拉 */
.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  max-height: 360px;
  overflow-y: auto;
  z-index: 10;
}

.search-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.1s;
}
.search-dropdown-item:hover,
.search-dropdown-item.highlighted {
  background: var(--fog);
}

.search-dropdown-hint {
  color: var(--text-muted);
  cursor: default;
  font-size: 13px;
  justify-content: center;
}

.search-result-left {
  display: flex;
  flex-direction: column;
}

.search-result-name {
  font-size: 13px;
  font-weight: 600;
}

.search-result-code {
  font-size: 11px;
  color: var(--text-muted);
}

.search-result-market {
  font-size: 11px;
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--fog);
}

/* 搜索匹配高亮 */
:deep(.search-highlight) {
  background: rgba(251, 225, 209, 0.6);
  color: var(--rust);
  border-radius: 2px;
  padding: 0 1px;
}

.search-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--text-muted);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-right: 6px;
}

/* 已选股票徽标 */
.selected-stock-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--card-bg);
  border: 1px solid var(--border);
}

.selected-stock-name {
  font-size: 13px;
  font-weight: 600;
}

.selected-stock-code {
  font-size: 11px;
  color: var(--text-muted);
}

.selected-stock-clear {
  margin-left: auto;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.selected-stock-clear:hover {
  background: rgba(231, 76, 60, 0.1);
  color: var(--red);
}

/* ===== 表单字段 ===== */
.form-row {
  display: flex;
  gap: 10px;
}

.form-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  background: var(--card-bg);
  color: var(--text-primary);
  transition: border-color 0.15s;
}
.form-input:focus {
  outline: none;
  border-color: var(--ink);
}

.form-error {
  font-size: 12px;
  color: var(--red);
}

.form-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.btn-form {
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-form-cancel {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.btn-form-cancel:hover {
  border-color: var(--ink);
  color: var(--ink);
}

.btn-form-submit {
  background: var(--rust);
  color: #fff;
}
.btn-form-submit:hover {
  background: #4a2215;
}
</style>
