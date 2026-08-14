<script setup>
import { ref } from "vue";
import { signChar, fmtPct } from "../utils/format";
import { usePositions } from "../composables/usePositions.js";
import ConfirmDialog from "./ConfirmDialog.vue";
import PositionForm from "./PositionForm.vue";

const props = defineProps({
  show: { type: Boolean, default: false },
  positions: { type: Array, default: () => [] },
});

const emit = defineEmits(["close", "add", "edit", "remove"]);

// 盈亏计算（从 composable）
const { positionStats, totalProfit, totalCost, totalMarketValue, totalProfitPct, hasHK, fxRate } = usePositions();

/** 表单开关：挂载时以 formInitial 初始化（null = 新增，对象 = 编辑） */
const formOpen = ref(false);
const formInitial = ref(null);

function closeModal() {
  formOpen.value = false;
  emit("close");
}

function openAddForm() {
  formInitial.value = null;
  formOpen.value = true;
}

function openEditForm(pos) {
  formInitial.value = {
    code: pos.code || "",
    name: pos.name || "",
    buyPrice: pos.buyPrice,
    quantity: pos.quantity,
    buyDate: pos.buyDate || "",
  };
  formOpen.value = true;
}

function handleFormSubmit(payload) {
  const isEdit = !!formInitial.value;
  formOpen.value = false;
  if (isEdit) {
    emit("edit", payload);
  } else {
    emit("add", payload);
  }
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
              <span class="summary-value">¥{{ totalCost.toFixed(2) }}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">总市值</span>
              <span class="summary-value">¥{{ totalMarketValue.toFixed(2) }}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">总盈亏</span>
              <span class="summary-value" :class="totalProfit >= 0 ? 'up' : 'down'">
                {{ signChar(totalProfit) }}¥{{ Math.abs(totalProfit).toFixed(2) }}
              </span>
            </div>
            <div class="summary-item">
              <span class="summary-label">盈亏率</span>
              <span class="summary-value" :class="totalProfitPct >= 0 ? 'up' : 'down'">
                {{ fmtPct(totalProfitPct) }}
              </span>
            </div>
          </div>
          <div v-if="hasHK" class="fx-rate-note">
            * 港股已按 1 港元 ≈ {{ fxRate.toFixed(4) }} 人民币换算
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
                <span class="position-detail">成本 {{ p.currency }}{{ (p.buyPrice || 0).toFixed(2) }}</span>
                <span class="position-detail">现价 {{ p.currency }}{{ (p.currentPrice || 0).toFixed(2) }}</span>
                <span class="position-detail">{{ p.quantity || 0 }} 股</span>
              </div>
              <div class="position-profit" :class="p.profit >= 0 ? 'up' : 'down'">
                <span class="profit-amount">{{ signChar(p.profit) }}{{ p.currency }}{{ Math.abs(p.profit).toFixed(2) }}</span>
                <span class="profit-pct">{{ fmtPct(p.profitPct) }}</span>
              </div>
              <button class="position-remove" @click.stop="confirmRemove(p.code, p.name)" title="删除持仓">✕</button>
            </div>
          </div>

          <!-- 添加/编辑表单（挂载时按 formInitial 初始化） -->
          <PositionForm
            v-if="formOpen"
            :initial="formInitial"
            @submit="handleFormSubmit"
            @cancel="formOpen = false"
          />

          <!-- 添加按钮 -->
          <button v-if="!formOpen" class="btn-add-position" @click="openAddForm">
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

/* 汇率换算提示 */
.fx-rate-note {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  margin-top: -8px;
}

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
