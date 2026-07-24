<script setup>
import { ref } from "vue";
import { signChar, fmtPct } from "../utils/format";
import { useStockSearch } from "../composables/useStockSearch.js";
import { usePositions } from "../composables/usePositions.js";
import ConfirmDialog from "./ConfirmDialog.vue";

const props = defineProps({
  show: { type: Boolean, default: false },
  positions: { type: Array, default: () => [] },
});

const emit = defineEmits(["close", "add", "remove"]);

// 盈亏计算（从 composable）
const { positionStats, totalProfit, totalCost, totalMarketValue, totalProfitPct } = usePositions();

const showForm = ref(false);
const editingCode = ref(null); // null = 新增, 非 null = 编辑对应 code
const form = ref({ code: "", name: "", buyPrice: "", quantity: "", buyDate: "" });
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

/** 高亮匹配文字 */
function highlightMatch(text, keyword) {
  if (!keyword || !keyword.trim()) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  return text.replace(re, '<mark class="search-highlight">$1</mark>');
}

function closeModal() {
  showForm.value = false;
  formError.value = "";
  clearStockSearch();
  emit("close");
}

function openAddForm() {
  editingCode.value = null;
  form.value = { code: "", name: "", buyPrice: "", quantity: "", buyDate: "" };
  formError.value = "";
  clearStockSearch();
  showForm.value = true;
}

function openEditForm(pos) {
  editingCode.value = pos.code;
  form.value = {
    code: pos.code || "",
    name: pos.name || "",
    buyPrice: pos.buyPrice != null ? String(pos.buyPrice) : "",
    quantity: pos.quantity != null ? String(pos.quantity) : "",
    buyDate: pos.buyDate || "",
  };
  formError.value = "";
  clearStockSearch();
  showForm.value = true;
}

function cancelForm() {
  editingCode.value = null;
  showForm.value = false;
  formError.value = "";
  clearStockSearch();
}

function submitForm() {
  const { code, name, buyPrice, quantity } = form.value;
  if (!code.trim()) { formError.value = "请搜索并选择股票"; return; }
  if (!name.trim()) { formError.value = "请搜索并选择股票"; return; }
  if (!buyPrice || Number(buyPrice) <= 0) { formError.value = "请输入有效的成本"; return; }
  if (!quantity || Number(quantity) <= 0) { formError.value = "请输入有效的持仓数量"; return; }
  formError.value = "";
  const payload = {
    code: code.trim(),
    name: name.trim(),
    buyPrice: Number(buyPrice),
    quantity: Number(quantity),
    buyDate: form.value.buyDate || undefined,
  };
  if (editingCode.value) {
    emit("edit", payload);
  } else {
    emit("add", payload);
  }
  editingCode.value = null;
  showForm.value = false;
  clearStockSearch();
}

const confirmState = ref({ show: false, code: "", name: "" });

function confirmRemove(code, name) {
  confirmState.value = { show: true, code, name };
}

function handleConfirmRemove() {
  emit("remove", confirmState.value.code);
  confirmState.value = { show: false, code: "", name: "" };
}

function handleCancelRemove() {
  confirmState.value = { show: false, code: "", name: "" };
}
</script>

<template>
  <ConfirmDialog
    :show="confirmState.show"
    title="删除持仓"
    :message="`确定删除 ${confirmState.name}(${confirmState.code}) 的持仓记录吗？`"
    confirm-text="删除"
    cancel-text="取消"
    :danger="true"
    @confirm="handleConfirmRemove"
    @cancel="handleCancelRemove"
  />

  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container">
        <div class="modal-header">
          <div class="modal-header-left">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--rust)" stroke-width="1.5">
              <path d="M4 17V7l6-4 6 4v10" stroke-linejoin="round"/>
              <rect x="7" y="10" width="6" height="7" rx="0.5"/>
            </svg>
            <span class="modal-title">我的持仓</span>
          </div>
          <button class="modal-close" @click="closeModal">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- 汇总 -->
          <div v-if="positionStats.length > 0" class="position-summary">
            <div class="summary-item">
              <span class="summary-label">总成本</span>
              <span class="summary-value">{{ totalCost.toFixed(2) }}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">总市值</span>
              <span class="summary-value">{{ totalMarketValue.toFixed(2) }}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">总盈亏</span>
              <span class="summary-value" :class="totalProfit >= 0 ? 'up' : 'down'">
                {{ signChar(totalProfit) }}{{ totalProfit.toFixed(2) }}
              </span>
            </div>
            <div class="summary-item">
              <span class="summary-label">盈亏率</span>
              <span class="summary-value" :class="totalProfitPct >= 0 ? 'up' : 'down'">
                {{ fmtPct(totalProfitPct) }}
              </span>
            </div>
          </div>

          <!-- 持仓列表 -->
          <div v-if="positionStats.length === 0" class="position-empty">
            <span>暂无持仓记录</span>
            <span class="empty-hint">点击下方按钮添加</span>
          </div>

          <div v-else class="position-list">
            <div v-for="p in positionStats" :key="p.code" class="position-row" @click="openEditForm(p)" title="点击修改持仓">
              <div class="position-info">
                <span class="position-name">{{ p.name }}</span>
                <span class="position-code">{{ p.code }}</span>
                <span class="position-buy-date" v-if="p.buyDate">{{ p.buyDate }}</span>
              </div>
              <div class="position-meta">
                <span class="position-detail">成本 {{ (p.buyPrice || 0).toFixed(2) }}</span>
                <span class="position-detail">现价 {{ (p.currentPrice || 0).toFixed(2) }}</span>
                <span class="position-detail">{{ p.quantity || 0 }} 股</span>
              </div>
              <div class="position-profit" :class="p.profit >= 0 ? 'up' : 'down'">
                <span class="profit-amount">{{ signChar(p.profit) }}{{ p.profit.toFixed(2) }}</span>
                <span class="profit-pct">{{ fmtPct(p.profitPct) }}</span>
              </div>
              <button class="position-remove" @click.stop="confirmRemove(p.code, p.name)" title="删除持仓">✕</button>
            </div>
          </div>

          <!-- 添加表单 -->
          <div v-if="showForm" class="position-form">
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
              <button class="btn-form btn-form-submit" @click="submitForm">{{ editingCode ? '确认修改' : '确认添加' }}</button>
            </div>
          </div>

          <!-- 添加按钮 -->
          <button v-if="!showForm" class="btn-add-position" @click="openAddForm">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span>添加持仓</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
@import "../assets/modal.css";
</style>

<style scoped>

/* PositionModal 特有覆盖 */
.modal-overlay {
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
  animation: none;
}

.modal-container {
  width: 520px;
  max-height: 80vh;
  animation: none;
}

.modal-header {
  padding: 20px 24px;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.modal-close {
  border-radius: 8px;
}

.modal-body {
  overflow-y: auto;
  padding: 20px 24px;
  gap: 16px;
  display: flex;
  flex-direction: column;
}

/* ===== 汇总 ===== */
.position-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
}
.summary-item:last-child { border-right: none; }

.summary-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.summary-value {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.summary-value.up { color: var(--red); }
.summary-value.down { color: var(--green); }

/* ===== 空状态 ===== */
.position-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0;
  color: var(--text-muted);
  font-size: 14px;
  gap: 6px;
}
.empty-hint {
  font-size: 12px;
  opacity: 0.6;
}

/* ===== 持仓列表 ===== */
.position-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.position-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--fog);
  gap: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.position-row:hover {
  background: var(--border);
}

.position-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.position-name {
  font-size: 14px;
  font-weight: 600;
}

.position-code {
  font-size: 11px;
  color: var(--text-muted);
}

.position-buy-date {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}

.position-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.position-detail {
  font-size: 11px;
  color: var(--text-secondary);
}

.position-profit {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 88px;
}

.profit-amount {
  font-size: 14px;
  font-weight: 700;
}

.profit-pct {
  font-size: 11px;
  font-weight: 600;
}

.position-profit.up { color: var(--red); }
.position-profit.down { color: var(--green); }

.position-remove {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
}
.position-remove:hover {
  background: rgba(231, 76, 60, 0.1);
  color: var(--red);
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

/* ===== 添加按钮 ===== */
.btn-add-position {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-add-position:hover {
  border-color: var(--rust);
  color: var(--rust);
  background: rgba(93, 42, 26, 0.04);
}
</style>
