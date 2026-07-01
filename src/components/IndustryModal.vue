<script setup>
import { signChar } from "../utils/format";

const props = defineProps({
  show: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  data: { type: Object, default: null },
  selectedStock: { type: Object, default: null },
});

const emit = defineEmits(["close", "retry"]);

function closeModal() {
  emit("close");
}

function retryLoad() {
  emit("retry");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container">
        <div class="modal-header">
          <div class="modal-header-left">
            <span class="industry-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--rust)" stroke-width="1.5">
              <rect x="3" y="10" width="4" height="7" rx="0.5"/>
              <rect x="8" y="7" width="4" height="10" rx="0.5"/>
              <rect x="13" y="4" width="4" height="13" rx="0.5"/>
            </svg>
          </span>
            <span class="modal-title">{{ data?.industry_name || '行业分析' }}</span>
            <span class="industry-badge">行业</span>
          </div>
          <button class="modal-close" @click="closeModal">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div v-if="loading" class="modal-loading">
            <span class="kline-icon">⟳</span>
            <span>加载行业数据中...</span>
          </div>
          <div v-else-if="error" class="modal-loading" style="cursor:pointer" @click="retryLoad">
            <span class="kline-icon">!</span>
            <span>加载失败，点击重试</span>
          </div>
          <template v-else-if="data">
            <div v-if="data.market_performance?.length" class="industry-subsection">
              <div class="sub-title">市场表现</div>
              <div class="perf-grid">
                <div class="perf-item">
                  <span class="perf-label">今日</span>
                  <span class="perf-value" :class="(selectedStock?.changePct ?? 0) >= 0 ? 'up' : 'down'">
                    {{ signChar(selectedStock?.changePct ?? 0) }}{{ (selectedStock?.changePct ?? 0).toFixed(2) }}%
                  </span>
                </div>
                <div
                  v-for="perf in data.market_performance"
                  :key="perf.time_type"
                  class="perf-item"
                >
                  <span class="perf-label">{{ ['','近1月','近3月','近6月','今年以来'][perf.time_type] || '' }}</span>
                  <span class="perf-value" :class="perf.changerate >= 0 ? 'up' : 'down'">
                    {{ perf.changerate >= 0 ? '+' : '' }}{{ perf.changerate.toFixed(2) }}%
                  </span>
                  <span class="perf-vs">
                    <span class="perf-vs-label">vs 沪深300</span>
                    <span class="perf-vs-value" :class="perf.hs300_changerate >= 0 ? 'up' : 'down'">
                      {{ perf.hs300_changerate >= 0 ? '+' : '' }}{{ perf.hs300_changerate.toFixed(2) }}%
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <div v-if="data.revenue_ranking?.length" class="industry-subsection">
              <div class="sub-title">营收分析（亿元）</div>
              <div class="comp-table">
                <div class="comp-row comp-header">
                  <span class="comp-cell name">名称</span>
                  <span class="comp-cell num">营收</span>
                  <span class="comp-cell num">排名</span>
                </div>
                <div
                  v-for="(item, idx) in data.revenue_ranking"
                  :key="item.stock_code"
                  class="comp-row"
                  :class="{ highlighted: item.stock_code === selectedStock?.code }"
                >
                  <span class="comp-cell name">
                    <span v-if="idx < 3" class="rank-badge" :class="'rank-' + (idx + 1)">{{ ['龙头','龙二','龙三'][idx] }}</span>
                    {{ item.stock_name }}
                  </span>
                  <span class="comp-cell num">{{ (item.total_operate_income / 1e8).toFixed(2) }}</span>
                  <span class="comp-cell num rank">{{ item.total_operate_income_rank }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ===== Steep: Modal — 24px radius, ink shadow ===== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.15s ease;
}

.modal-container {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  width: 780px;
  max-width: 92vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-modal);
  overflow: hidden;
  animation: slideUp 0.2s ease;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.modal-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.industry-icon {
  font-size: 20px;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.009em;
}

.industry-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--fog);
  color: var(--text-secondary);
}

.modal-close {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.modal-close:hover {
  background: var(--fog);
  color: var(--ink);
}

.modal-body {
  padding: 24px 28px;
  overflow-y: auto;
  flex: 1;
}

.modal-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-muted);
  font-size: 14px;
}

.kline-icon {
  font-size: 32px;
}

/* 行业子区域 */
.industry-subsection {
  margin-bottom: 24px;
}

.industry-subsection:last-child {
  margin-bottom: 0;
}

.sub-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text-primary);
  letter-spacing: -0.009em;
}

/* 市场表现网格 */
.perf-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.perf-item {
  background: var(--fog);
  padding: 14px 16px;
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.perf-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.perf-value {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.perf-value.up { color: var(--red); }
.perf-value.down { color: var(--green); }

/* vs 沪深300 */
.perf-vs {
  font-size: 11px;
  display: flex;
  gap: 4px;
  align-items: center;
}

.perf-vs-label {
  color: var(--text-secondary);
}

.perf-vs-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.perf-vs-value.up { color: var(--red); }
.perf-vs-value.down { color: var(--green); }

/* Steep: 行业表格 — 无边线靠表面区分 */
.comp-table {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.comp-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 60px;
  gap: 0;
}

.comp-row + .comp-row {
  border-top: 1px solid var(--border-light);
}

/* Steep: active row — Apricot Wash 代替蓝色 */
.comp-row.highlighted {
  background: var(--apricot-wash);
}
.comp-row.highlighted .comp-cell.name {
  color: var(--rust);
  font-weight: 700;
}

.comp-header {
  background: var(--fog);
  font-weight: 500;
  font-size: 12px;
  color: var(--text-muted);
}

.comp-cell {
  padding: 10px 14px;
  font-size: 13px;
}

.comp-cell.name {
  font-weight: 600;
}

.comp-cell.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.comp-cell.num.up { color: var(--red); }
.comp-cell.num.down { color: var(--green); }

/* Steep: rank badges — Rust 系配色 */
.rank-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: 6px;
  vertical-align: middle;
}
.rank-badge.rank-1 {
  background: var(--apricot-wash);
  color: var(--rust);
}
.rank-badge.rank-2 {
  background: var(--fog);
  color: var(--text-secondary);
}
.rank-badge.rank-3 {
  background: var(--apricot-wash);
  color: var(--rust);
  opacity: 0.7;
}

.comp-cell.rank {
  color: var(--text-muted);
  text-align: center;
}
</style>
