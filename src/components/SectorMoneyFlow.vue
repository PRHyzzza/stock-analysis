<script setup>
import { ref, computed } from "vue";
import { signChar, formatAmount, inflowClass, pctClass } from "../utils/format.js";

const props = defineProps({
  sectorList: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
});

const emit = defineEmits(["refresh"]);

const sortMode = ref("flow"); // 'flow' | 'changePct'

function toggleMode(mode) {
  sortMode.value = mode;
}

const sortedList = computed(() => {
  const list = [...props.sectorList];
  if (sortMode.value === "flow") {
    list.sort((a, b) => b.mainNetInflow - a.mainNetInflow);
  } else {
    list.sort((a, b) => b.changePct - a.changePct);
  }
  return list;
});

const maxAbsValue = computed(() => {
  const list = sortedList.value;
  if (list.length === 0) return 1;
  if (sortMode.value === "flow") {
    const m = Math.max(...list.map(i => Math.abs(i.mainNetInflow)));
    return m > 0 ? m : 1;
  } else {
    const m = Math.max(...list.map(i => Math.abs(i.changePct)));
    return m > 0 ? m : 1;
  }
});

const stats = computed(() => {
  if (sortMode.value === "flow") {
    const total = props.sectorList.reduce((s, item) => s + item.mainNetInflow, 0);
    const inflow = props.sectorList.filter((i) => i.mainNetInflow > 0).length;
    const outflow = props.sectorList.filter((i) => i.mainNetInflow < 0).length;
    return { total, inflow, outflow, mode: "flow" };
  } else {
    const upCount = props.sectorList.filter((i) => i.changePct > 0).length;
    const downCount = props.sectorList.filter((i) => i.changePct < 0).length;
    return { total: 0, inflow: upCount, outflow: downCount, mode: "changePct" };
  }
});

function getItemValue(item) {
  return sortMode.value === "flow" ? item.mainNetInflow : item.changePct;
}

function getItemBarRatio(item) {
  const val = Math.abs(getItemValue(item));
  return Math.min(val / maxAbsValue.value * 100, 100);
}
</script>

<template>
  <div class="sector-flow-panel">
    <!-- 头部统计 -->
    <div class="sf-header">
      <div class="sf-title-row">
        <span class="sf-title">板块资金</span>
        <div class="sf-actions">
          <div class="sf-mode-toggle">
            <button
              class="sf-mode-btn"
              :class="{ active: sortMode === 'flow' }"
              @click="toggleMode('flow')"
            >资金</button>
            <button
              class="sf-mode-btn"
              :class="{ active: sortMode === 'changePct' }"
              @click="toggleMode('changePct')"
            >涨跌</button>
          </div>
          <button class="sf-refresh-btn" :class="{ loading }" @click="emit('refresh')" :disabled="loading">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 0 1 10.47-4M14 8a6 6 0 0 1-10.47 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M13.5 2v4h-4M2.5 14v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div v-if="sectorList.length > 0" class="sf-stats">
        <template v-if="stats.mode === 'flow'">
          <div class="sf-stat">
            <span class="sf-stat-label">总净流入</span>
            <span class="sf-stat-val" :class="inflowClass(stats.total)">{{ signChar(stats.total) }}{{ formatAmount(stats.total) }}</span>
          </div>
          <div class="sf-stat">
            <span class="sf-stat-label">流入板块</span>
            <span class="sf-stat-val up">{{ stats.inflow }}</span>
          </div>
          <div class="sf-stat">
            <span class="sf-stat-label">流出板块</span>
            <span class="sf-stat-val down">{{ stats.outflow }}</span>
          </div>
        </template>
        <template v-else>
          <div class="sf-stat">
            <span class="sf-stat-label">上涨板块</span>
            <span class="sf-stat-val up">{{ stats.inflow }}</span>
          </div>
          <div class="sf-stat">
            <span class="sf-stat-label">下跌板块</span>
            <span class="sf-stat-val down">{{ stats.outflow }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- 加载 / 错误 -->
    <div v-if="loading" class="sf-status">
      <span class="sf-spinner"></span>
      <span>加载中...</span>
    </div>
    <div v-else-if="error" class="sf-status sf-error">
      <span>{{ error }}</span>
      <button class="sf-retry-btn" @click="emit('refresh')">重试</button>
    </div>

    <!-- 板块列表 -->
    <div v-else class="sf-list">
      <div
        v-for="(item, idx) in sortedList"
        :key="item.code"
        class="sf-item"
      >
        <div class="sf-item-rank" :class="{ 'top3': idx < 3 }">{{ idx + 1 }}</div>
        <div class="sf-item-info">
          <span class="sf-item-name">{{ item.name }}</span>
          <div class="sf-item-detail">
            <span v-if="sortMode === 'flow'" class="sf-item-sub" :class="pctClass(item.changePct)">
              涨跌 {{ signChar(item.changePct) }}{{ item.changePct.toFixed(2) }}%
            </span>
            <span v-else class="sf-item-sub" :class="inflowClass(item.mainNetInflow)">
              资金 {{ signChar(item.mainNetInflow) }}{{ formatAmount(item.mainNetInflow) }}
            </span>
          </div>
        </div>
        <div class="sf-item-flow">
          <span class="sf-item-main" :class="sortMode === 'flow' ? inflowClass(item.mainNetInflow) : pctClass(item.changePct)">
            <template v-if="sortMode === 'flow'">
              {{ signChar(item.mainNetInflow) }}{{ formatAmount(item.mainNetInflow) }}
            </template>
            <template v-else>
              {{ signChar(item.changePct) }}{{ item.changePct.toFixed(2) }}%
            </template>
          </span>
          <div class="sf-flow-bar-wrap">
            <div
              class="sf-flow-bar"
              :class="getItemValue(item) >= 0 ? 'bar-in' : 'bar-out'"
              :style="{ width: getItemBarRatio(item) + '%' }"
            ></div>
          </div>
        </div>
      </div>
      <div v-if="sortedList.length === 0" class="sf-empty">
        暂无数据
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== 板块资金面板 ===== */
.sector-flow-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.sf-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.sf-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.sf-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.009em;
}

.sf-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sf-mode-toggle {
  display: flex;
  background: var(--fog);
  border-radius: var(--radius-sm);
  padding: 2px;
  gap: 2px;
}

.sf-mode-btn {
  padding: 4px 10px;
  border: none;
  border-radius: calc(var(--radius-sm) - 2px);
  background: transparent;
  font-size: 12px;
  font-family: inherit;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;
}
.sf-mode-btn:hover {
  color: var(--text-primary);
}
.sf-mode-btn.active {
  background: var(--card-bg);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}

.sf-refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;
}
.sf-refresh-btn:hover { color: var(--text-primary); border-color: var(--border); }
.sf-refresh-btn.loading svg { animation: spin 0.8s linear infinite; }
.sf-refresh-btn:disabled { opacity: 0.5; cursor: default; }

.sf-stats {
  display: flex;
  gap: 20px;
}
.sf-stat {
  display: flex;
  flex-direction: column;
}
.sf-stat-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: -0.009em;
}
.sf-stat-val {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.009em;
}

.sf-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  font-size: 13px;
  color: var(--text-muted);
}
.sf-error {
  flex-direction: column;
  gap: 10px;
  color: var(--red);
}
.sf-retry-btn {
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--card-bg);
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  cursor: pointer;
}
.sf-retry-btn:hover { background: var(--fog); }
.sf-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.sf-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.sf-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-light);
  transition: background 0.15s;
}
.sf-item:hover { background: var(--fog); }

.sf-item-rank {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--fog);
  flex-shrink: 0;
}
.sf-item-rank.top3 {
  color: var(--rust);
  background: var(--apricot-wash);
  font-weight: 700;
}

.sf-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sf-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.009em;
}
.sf-item-detail {
  display: flex;
  gap: 8px;
}
.sf-item-sub {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.sf-item-flow {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  min-width: 80px;
}
.sf-item-main {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.009em;
  white-space: nowrap;
}

.sf-flow-bar-wrap {
  width: 100%;
  height: 3px;
  background: var(--fog);
  border-radius: 2px;
  overflow: hidden;
}
.sf-flow-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}
.bar-in { background: var(--red); }
.bar-out { background: var(--green); }

.up { color: var(--red); }
.down { color: var(--green); }
.inflow-up { color: var(--red); }
.inflow-down { color: var(--green); }
.inflow-zero { color: var(--text-muted); }

.sf-empty {
  padding: 40px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
