<script setup>
/**
 * MoneyFlowSection.vue — 详情页"主力资金"区块
 * 当日主力净流入 + 分档明细（超大单/大单/中单/小单）+ T+0 信号徽标 + 近 30 日净流入柱状图
 */
import { computed } from "vue";
import { fmtMoney, fmtPct } from "../utils/format";
import MoneyFlowChart from "./MoneyFlowChart.vue";

const props = defineProps({
  moneyFlow: { type: Object, default: null },
  moneyFlowLoading: { type: Boolean, default: false },
  moneyFlowHistory: { type: Array, default: null },
  moneyFlowHistoryLoading: { type: Boolean, default: false },
  /** T+0 信号摘要（父组件计算，与分时图标记共用一份信号数据） */
  t0Summary: { type: Object, default: null },
  /** 当前图表模式（仅分时模式显示 T+0 徽标） */
  chartMode: { type: String, default: "intraday" },
});

/** 资金流向分档明细（超大单/大单/中单/小单） */
const flowTiers = computed(() => {
  const mf = props.moneyFlow;
  if (!mf) return [];
  const tiers = [
    { key: "super", label: "超大单", net: mf.superLargeNet, pct: mf.superLargePct },
    { key: "large", label: "大单", net: mf.largeNet, pct: mf.largePct },
    { key: "medium", label: "中单", net: mf.mediumNet, pct: mf.mediumPct },
    { key: "small", label: "小单", net: mf.smallNet, pct: mf.smallPct },
  ];
  return tiers.map((t) => ({
    ...t,
    net: t.net ?? 0,
    pct: t.pct ?? 0,
  }));
});

function t0DirectionTooltip(summary) {
  if (!summary) return '';
  const d = summary.direction;
  const trend = summary.raw.trend;
  if (d === '正T为主') return `日线趋势「${trend}」→ 低吸高抛，先买后卖`;
  if (d === '反T为主') return `日线趋势「${trend}」→ 高抛低吸，先卖后买`;
  return `日线趋势「${trend}」→ 方向不明，建议观望`;
}
</script>

<template>
  <div class="flow-section">
    <div class="flow-header">
      <span class="flow-title">主力资金</span>
      <template v-if="moneyFlow">
        <span class="flow-text" :class="(moneyFlow.mainNetInflow ?? 0) >= 0 ? 'inflow' : 'outflow'">
          {{ fmtMoney(moneyFlow.mainNetInflow) }}
        </span>
        <span class="flow-pct-text" :class="(moneyFlow.mainNetInflow ?? 0) >= 0 ? 'inflow' : 'outflow'">
          {{ fmtPct(moneyFlow.mainNetPct) }}
        </span>
      </template>
      <template v-else-if="!moneyFlowLoading">
        <span class="flow-text">--</span>
      </template>
      <span v-if="moneyFlowLoading" class="flow-loading">加载中...</span>

      <!-- T+0 信号 -->
      <template v-if="chartMode === 'intraday' && t0Summary && t0Summary.hasSignal">
        <span class="flow-sep">|</span>
        <span
          class="t0-badge-inline"
          :class="{
            'dir-up': t0Summary.direction === '正T为主',
            'dir-down': t0Summary.direction === '反T为主',
            'dir-wait': t0Summary.direction === '观望',
          }"
          :title="t0DirectionTooltip(t0Summary)"
        >{{ t0Summary.direction }}</span>
        <span
          v-for="(sig, idx) in t0Summary.signals"
          :key="idx"
          class="t0-chip-inline"
          :title="sig.desc + '\n💡 ' + sig.action"
        >{{ sig.name }}</span>
      </template>
    </div>

    <!-- 全部分档资金 -->
    <div v-if="moneyFlow" class="flow-tiers">
      <div class="flow-tier" v-for="tier in flowTiers" :key="tier.key">
        <span class="tier-name">{{ tier.label }}</span>
        <span class="tier-value" :class="tier.net >= 0 ? 'inflow' : 'outflow'">
          {{ fmtMoney(tier.net) }}
        </span>
        <span class="tier-pct" :class="tier.net >= 0 ? 'inflow' : 'outflow'">
          {{ fmtPct(tier.pct) }}
        </span>
      </div>
    </div>

    <!-- 近 30 日主力净流入历史柱状图 -->
    <MoneyFlowChart
      :data="moneyFlowHistory || []"
      :loading="moneyFlowHistoryLoading"
    />
  </div>
</template>

<style scoped>
/* ===== 主力资金流向 ===== */
.flow-section {
  margin-bottom: 20px;
}

.flow-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 0;
  flex-wrap: wrap;
}

.flow-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
  letter-spacing: -0.009em;
}

.flow-loading {
  font-size: 12px;
  color: var(--text-muted);
}

/* T+0 信号内联 */
.flow-sep {
  color: var(--border-light);
  font-size: 16px;
  margin: 0 6px;
  user-select: none;
}

.t0-badge-inline {
  font-size: 13px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 4px;
  letter-spacing: -0.009em;
  white-space: nowrap;
  cursor: pointer;
}
.t0-badge-inline.dir-up {
  color: var(--red);
  background: rgba(231, 76, 60, 0.1);
}
.t0-badge-inline.dir-down {
  color: var(--green);
  background: rgba(39, 174, 96, 0.1);
}
.t0-badge-inline.dir-wait {
  color: var(--text-secondary);
  background: rgba(163, 166, 175, 0.12);
}

.t0-chip-inline {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--rust);
  background: rgba(201, 94, 54, 0.1);
  white-space: nowrap;
  letter-spacing: -0.005em;
  cursor: pointer;
}

.flow-text {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.flow-pct-text {
  font-size: 15px;
  font-weight: 600;
}

.flow-text.inflow,
.flow-pct-text.inflow { color: var(--red); }
.flow-text.outflow,
.flow-pct-text.outflow { color: var(--green); }

/* 分档资金明细（超大单/大单/中单/小单）— 弹窗宽度下 4 列单行 */
.flow-tiers {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px 24px;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--fog);
}

.flow-tier {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.tier-name {
  color: var(--text-muted);
  font-size: 12px;
  flex-shrink: 0;
}

.tier-value {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tier-pct {
  font-size: 12px;
  font-weight: 500;
}

.tier-value.inflow,
.tier-pct.inflow { color: var(--red); }
.tier-value.outflow,
.tier-pct.outflow { color: var(--green); }
</style>
