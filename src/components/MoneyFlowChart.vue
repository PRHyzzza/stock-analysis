<script setup>
/**
 * MoneyFlowChart.vue — 主力资金流向历史柱状图（近 N 日）
 *
 * 用 lightweight-charts 画每日主力净流入柱状图（A 股惯例：净流入红色 / 净流出绿色），
 * 叠加 5 日净流入均线（紫色）观察趋势，右上角显示今日/5日/10日/20日累计净流入。
 * 数据来自东方财富 daykline 接口（单位：万元）。
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { createChart, ColorType, HistogramSeries, LineSeries } from "lightweight-charts";

const props = defineProps({
  /** [{ date, mainNetInflow, superLargeNet, largeNet, mediumNet, smallNet, close }] 正序（旧→新） */
  data: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
});

const chartContainer = ref(null);
let chart = null;
let histSeries = null;
let maSeries = null;
let resizeObserver = null;

const UP = "#e74c3c";   // 净流入（A 股红涨惯例）
const DOWN = "#27ae60"; // 净流出
const MA_COLOR = "#7c3aed";

/** 万元 → 展示文本（≥1亿 显示亿，否则显示万） */
function fmtWan(v) {
  const abs = Math.abs(v);
  if (abs >= 10000) return (v / 10000).toFixed(2) + "亿";
  return v.toFixed(0) + "万";
}

const isEmpty = computed(() => !props.data || props.data.length === 0);

/** 今日 + 近 5/10/20 日累计净流入摘要 */
const summary = computed(() => {
  if (isEmpty.value) return null;
  const d = props.data;
  const sum = (n) => d.slice(-n).reduce((a, b) => a + b.mainNetInflow, 0);
  return {
    last: d[d.length - 1],
    sum5: sum(5),
    sum10: sum(10),
    sum20: sum(20),
  };
});

function initChart() {
  if (!chartContainer.value || chart) return;

  chart = createChart(chartContainer.value, {
    width: chartContainer.value.clientWidth,
    height: chartContainer.value.clientHeight,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: "#777b86",
      fontSize: 12,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: "rgba(163, 166, 175, 0.12)" },
      horzLines: { color: "rgba(163, 166, 175, 0.12)" },
    },
    crosshair: {
      mode: 0,
      vertLine: { color: "#8b8c8d", width: 1, style: 2, labelBackgroundColor: "#4c4c4c" },
      horzLine: { color: "#8b8c8d", width: 1, style: 2, labelBackgroundColor: "#4c4c4c" },
    },
    rightPriceScale: {
      borderColor: "rgba(163, 166, 175, 0.2)",
      scaleMargins: { top: 0.12, bottom: 0.08 },
    },
    timeScale: {
      borderColor: "rgba(163, 166, 175, 0.2)",
      timeVisible: false,
      ticksVisible: true,
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    localization: {
      priceFormatter: (p) => fmtWan(p),
    },
    handleScroll: { vertTouchDrag: false },
  });

  histSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "custom", formatter: (p) => fmtWan(p) },
    priceLineVisible: false,
    lastValueVisible: false,
    base: 0,
  });

  maSeries = chart.addSeries(LineSeries, {
    color: MA_COLOR,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: { type: "custom", formatter: (p) => fmtWan(p) },
  });

  resizeObserver = new ResizeObserver(() => {
    if (chart && chartContainer.value) {
      chart.applyOptions({
        width: chartContainer.value.clientWidth,
        height: chartContainer.value.clientHeight,
      });
    }
  });
  resizeObserver.observe(chartContainer.value);
  chart._observer = resizeObserver;

  updateChart();
}

function updateChart() {
  if (!chart || !histSeries || !maSeries) return;
  const d = props.data;
  if (!d || d.length === 0) {
    histSeries.setData([]);
    maSeries.setData([]);
    return;
  }
  // 防御性排序：lightweight-charts 要求时间严格升序（日期字符串字典序 = 时间序），
  // 即使后端顺序变化也不会触发 "data must be asc ordered" 断言崩溃
  const sorted = [...d].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  histSeries.setData(
    sorted.map((it) => ({
      time: it.date,
      value: it.mainNetInflow,
      color: it.mainNetInflow >= 0 ? UP : DOWN,
    }))
  );
  // MA5 净流入均线（前 4 天无值，跳过）
  const ma = [];
  for (let i = 4; i < sorted.length; i++) {
    let s = 0;
    for (let j = i - 4; j <= i; j++) s += sorted[j].mainNetInflow;
    ma.push({ time: sorted[i].date, value: s / 5 });
  }
  maSeries.setData(ma);
  chart.timeScale().fitContent();
}

watch(
  () => props.data,
  () => nextTick(updateChart),
  { deep: false }
);

onMounted(() => {
  nextTick(() => {
    initChart();
  });
});

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect();
  if (chart) {
    chart.remove();
    chart = null;
    histSeries = null;
    maSeries = null;
  }
});
</script>

<template>
  <div class="mf-wrap">
    <div class="mf-head">
      <span class="mf-title">主力净流入 · 近{{ isEmpty ? 30 : data.length }}日</span>
      <template v-if="summary">
        <span class="mf-sep">|</span>
        <span class="mf-chip" :class="summary.last.mainNetInflow >= 0 ? 'inflow' : 'outflow'">
          今日 {{ fmtWan(summary.last.mainNetInflow) }}
        </span>
        <span class="mf-chip" :class="summary.sum5 >= 0 ? 'inflow' : 'outflow'">
          5日 {{ fmtWan(summary.sum5) }}
        </span>
        <span class="mf-chip" :class="summary.sum10 >= 0 ? 'inflow' : 'outflow'">
          10日 {{ fmtWan(summary.sum10) }}
        </span>
        <span class="mf-chip" :class="summary.sum20 >= 0 ? 'inflow' : 'outflow'">
          20日 {{ fmtWan(summary.sum20) }}
        </span>
      </template>
      <span v-if="!isEmpty" class="mf-legend">
        <span class="mf-legend-dot" style="background: #e74c3c"></span>净流入
        <span class="mf-legend-dot" style="background: #27ae60"></span>净流出
        <span class="mf-legend-dot" style="background: #7c3aed"></span>5日均线
      </span>
    </div>
    <div class="mf-chart" ref="chartContainer"></div>
    <div v-if="isEmpty && !loading" class="mf-empty">暂无资金流向历史数据</div>
    <div v-if="loading && isEmpty" class="mf-empty">加载中…</div>
  </div>
</template>

<style scoped>
.mf-wrap {
  margin-top: 18px;
  border-top: 1px dashed var(--border);
  padding-top: 16px;
  position: relative;
}

.mf-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.mf-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.mf-sep {
  color: var(--border);
}

.mf-chip {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.mf-chip.inflow { color: var(--red); }
.mf-chip.outflow { color: var(--green); }

.mf-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
}
.mf-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-left: 6px;
}

.mf-chart {
  width: 100%;
  height: 240px;
  position: relative;
}

.mf-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 12px;
  color: var(--text-muted);
  padding: 20px;
}
</style>
