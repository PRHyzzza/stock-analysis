<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { createChart, ColorType, LineSeries, HistogramSeries } from "lightweight-charts";

const props = defineProps({
  data: { type: Object, default: null },
  loading: { type: Boolean, default: false },
});

const chartContainer = ref(null);
let chart = null;
let priceSeries = null;
let avgPriceSeries = null;
let vwapSeries = null;
let volumeSeries = null;
let baseLine = null;

function formatTime(timeStr) {
  // "09:30" → "9:30" 或保持原样，但 compat 用字符串时间即可
  return timeStr;
}

function initChart() {
  if (!chartContainer.value || chart) return;

  chart = createChart(chartContainer.value, {
    width: chartContainer.value.clientWidth,
    height: chartContainer.value.clientHeight,
    layout: {
      background: { type: ColorType.Solid, color: "#ffffff" },
      textColor: "#777b86",
      fontSize: 11,
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
      scaleMargins: { top: 0.08, bottom: 0.25 },
    },
    timeScale: {
      borderColor: "rgba(163, 166, 175, 0.2)",
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time) => {
        const date = new Date(time * 1000);
        const h = date.getUTCHours().toString().padStart(2, "0");
        const m = date.getUTCMinutes().toString().padStart(2, "0");
        return `${h}:${m}`;
      },
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    handleScroll: { vertTouchDrag: false },
  });

  // 价格线
  priceSeries = chart.addSeries(LineSeries, {
    color: "#e74c3c",
    lineWidth: 2,
    priceLineVisible: true,
    priceLineColor: "rgba(163, 166, 175, 0.3)",
    lastValueVisible: true,
    crosshairMarkerRadius: 4,
    crosshairMarkerBorderColor: "#e74c3c",
    crosshairMarkerBackgroundColor: "#ffffff",
  });

  // 均价线
  avgPriceSeries = chart.addSeries(LineSeries, {
    color: "#f39c12",
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  // VWAP 线
  vwapSeries = chart.addSeries(LineSeries, {
    color: "#2196F3",
    lineWidth: 1,
    lineStyle: 0,
    priceLineVisible: false,
    lastValueVisible: true,
    crosshairMarkerRadius: 3,
    crosshairMarkerBorderColor: "#2196F3",
    crosshairMarkerBackgroundColor: "#ffffff",
  });

  // 成交量
  volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    priceLineVisible: false,
  });

  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.80, bottom: 0 },
  });

  // 昨收基准线
  baseLine = priceSeries.createPriceLine({
    price: 0,
    color: "rgba(39, 174, 96, 0.5)",
    lineWidth: 1,
    lineStyle: 3,
    axisLabelVisible: true,
    title: "昨收",
  });

  // ResizeObserver
  const observer = new ResizeObserver(() => {
    if (chartContainer.value && chart) {
      const { clientWidth, clientHeight } = chartContainer.value;
      chart.applyOptions({ width: clientWidth, height: clientHeight });
    }
  });
  observer.observe(chartContainer.value);
  chart._observer = observer;
}

function updateChartData(intradayData) {
  if (!priceSeries || !avgPriceSeries || !volumeSeries || !baseLine || !intradayData) return;

  const { items, preClose, date } = intradayData;
  if (!items || items.length === 0) return;

  // 用 API 返回的实际日期（YYYYMMDD）
  const year = parseInt(date.slice(0, 4));
  const month = parseInt(date.slice(4, 6)) - 1; // 0-based
  const day = parseInt(date.slice(6, 8));

  const priceData = [];
  const avgPriceData = [];
  const vwapData = [];
  const volumeData = [];

  for (const item of items) {
    const [h, m] = item.time.split(':').map(Number);
    // 用 Date.UTC 把东八区时间当作 UTC 对待，保证 crosshair 显示正确
    const timestamp = Math.floor(Date.UTC(year, month, day, h, m) / 1000);

    priceData.push({ time: timestamp, value: item.price });

    // 计算均价（成交额 / 成交量），如果 API 没提供的话
    // turnover 是元, volume 是手 (1手=100股), 所以 avgPrice = turnover / (volume * 100)
    let avgPrice = item.avgPrice;
    if (avgPrice <= 0 && item.volume > 0 && item.turnover > 0) {
      avgPrice = item.turnover / (item.volume * 100);
    }
    if (avgPrice > 0) {
      avgPriceData.push({ time: timestamp, value: avgPrice });
    }

    // VWAP
    if (item.vwap > 0) {
      vwapData.push({ time: timestamp, value: item.vwap });
    }

    const isUp = item.price >= preClose;
    volumeData.push({
      time: timestamp,
      value: item.volume,
      color: isUp ? "rgba(231, 76, 60, 0.4)" : "rgba(39, 174, 96, 0.4)",
    });
  }

  priceSeries.setData(priceData);

  if (avgPriceData.length > 0) {
    avgPriceSeries.setData(avgPriceData);
  } else {
    avgPriceSeries.setData([]);
  }

  if (vwapData.length > 0) {
    vwapSeries.setData(vwapData);
  } else {
    vwapSeries.setData([]);
  }

  volumeSeries.setData(volumeData);

  // 更新昨收基准线
  baseLine.applyOptions({ price: preClose });

  chart.timeScale().fitContent();
}

function ensureChart() {
  if (!chart) {
    initChart();
  }
}

watch(
  () => props.data,
  (newData) => {
    if (newData && newData.items && newData.items.length > 0) {
      nextTick(() => {
        ensureChart();
        updateChartData(newData);
      });
    }
  },
  { deep: true, immediate: true }
);

onMounted(() => {
  nextTick(() => {
    if (props.data && props.data.items && props.data.items.length > 0) {
      initChart();
      updateChartData(props.data);
    }
  });
});

onUnmounted(() => {
  if (chart) {
    if (chart._observer) chart._observer.disconnect();
    chart.remove();
    chart = null;
    priceSeries = null;
    avgPriceSeries = null;
    vwapSeries = null;
    volumeSeries = null;
    baseLine = null;
  }
});
</script>

<template>
  <div class="intraday-wrapper">
    <div class="intraday-header">
      <span class="intraday-title">分时图</span>
      <div class="intraday-legend">
        <span class="legend-item price-legend">
          <span class="legend-dot" style="background: #e74c3c"></span>
          价格
        </span>
        <span class="legend-item avg-legend">
          <span class="legend-dot" style="background: #f39c12"></span>
          均价
        </span>
        <span class="legend-item vwap-legend">
          <span class="legend-dot" style="background: #2196F3"></span>
          VWAP
        </span>
      </div>
    </div>
    <div class="intraday-chart-wrap">
      <div ref="chartContainer" class="intraday-chart"></div>
      <div v-if="loading" class="intraday-loading">
        <span class="intraday-loading-icon">⟳</span>
        <span>加载分时数据中...</span>
      </div>
      <div v-else-if="!data || !data.items || data.items.length === 0" class="intraday-empty">
        <span class="intraday-empty-icon">—</span>
        <p class="intraday-empty-text">暂无分时数据（非交易时段）</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.intraday-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.intraday-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 8px 0;
}

.intraday-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.intraday-legend {
  display: flex;
  align-items: center;
  gap: 16px;
}

.legend-item {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.intraday-chart-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
}

.intraday-chart {
  height: 100%;
  min-height: 200px;
}

.intraday-loading,
.intraday-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.85);
  z-index: 10;
  font-size: 13px;
}

.intraday-loading-icon {
  font-size: 24px;
  animation: spin 0.8s linear infinite;
}

.intraday-empty-icon {
  font-size: 32px;
  color: var(--text-muted);
  opacity: 0.4;
}

.intraday-empty-text {
  margin: 0;
  font-size: 13px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
