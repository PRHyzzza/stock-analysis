<script setup>
/**
 * MoneyFlowModal.vue — 资金流向弹窗
 * 详情页"资金流向"按钮打开：当日主力净流入 + 分档明细 + T+0 信号 + 近 30 日历史柱状图。
 * 内容复用 MoneyFlowSection（原内嵌区块原样搬入弹窗，详情卡不再内嵌，解决超高问题）。
 */
import MoneyFlowSection from "./MoneyFlowSection.vue";

defineProps({
  show: { type: Boolean, default: false },
  stock: { type: Object, default: null },
  moneyFlow: { type: Object, default: null },
  moneyFlowLoading: { type: Boolean, default: false },
  moneyFlowHistory: { type: Array, default: null },
  moneyFlowHistoryLoading: { type: Boolean, default: false },
  /** T+0 信号摘要（父组件计算，与分时图标记共用一份信号数据） */
  t0Summary: { type: Object, default: null },
  /** 当前图表模式（仅分时模式显示 T+0 徽标） */
  chartMode: { type: String, default: "intraday" },
});

const emit = defineEmits(["close"]);
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-container">
        <!-- 头部 -->
        <div class="modal-header">
          <div class="modal-title-row">
            <span class="mf-icon">
              <svg width="18" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 16 6 9l3.5 3L14 3l5 13"/>
              </svg>
            </span>
            <span class="modal-title">资金流向</span>
            <span class="modal-badge" v-if="stock">{{ stock.name }} ({{ stock.code }})</span>
          </div>
          <button class="btn-close" @click="emit('close')">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body mf-body">
          <MoneyFlowSection
            :money-flow="moneyFlow"
            :money-flow-loading="moneyFlowLoading"
            :money-flow-history="moneyFlowHistory"
            :money-flow-history-loading="moneyFlowHistoryLoading"
            :t0-summary="t0Summary"
            :chart-mode="chartMode"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
@import "../assets/modal.css";
</style>

<style scoped>
.modal-container {
  width: 760px;
}

.modal-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mf-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--apricot-wash);
  color: var(--rust);
}

.modal-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--fog);
  padding: 2px 10px;
  border-radius: var(--radius-full);
}

.mf-body {
  padding: 24px;
  overflow-y: auto;
}
</style>
