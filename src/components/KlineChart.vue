<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from "lightweight-charts";

const props = defineProps({
  data: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  period: { type: String, default: "day" },
  markers: { type: Array, default: () => [] },
});

const emit = defineEmits(["change-period"]);

const periodNames = { day: "日 K", week: "周 K", month: "月 K" };
const periodLabel = computed(() => `📊 ${periodNames[props.period] || "日 K"} 线`);

const chartContainer = ref(null);
let chart = null;
let candleSeries = null;
let volumeSeries = null;
let markersPlugin = null;
/** 均线系列 */
const maPeriods = [5, 10, 20, 30];
const maColors = {
  5: "#ff4500", 10: "#1a73e8", 20: "#9c27b0",
  30: "#00acc1",
};
const maSeries = {};
const maLatestValues = ref({});

function computeMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) continue;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

function initChart() {
  if (!chartContainer.value || chart) return;

  chart = createChart(chartContainer.value, {
    width: chartContainer.value.clientWidth,
    height: chartContainer.value.clientHeight,
    layout: {
      background: { type: ColorType.Solid, color: "#ffffff" },
      textColor: "#6b7280",
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: "#f3f4f6" },
      horzLines: { color: "#f3f4f6" },
    },
    crosshair: {
      mode: 0,
      vertLine: { color: "#9ca3af", width: 1, style: 2, labelBackgroundColor: "#374151" },
      horzLine: { color: "#9ca3af", width: 1, style: 2, labelBackgroundColor: "#374151" },
    },
    rightPriceScale: {
      borderColor: "#e5e7eb",
      scaleMargins: { top: 0.05, bottom: 0.25 },
    },
    timeScale: {
      borderColor: "#e5e7eb",
      timeVisible: false,
      ticksVisible: true,
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    handleScroll: { vertTouchDrag: false },
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: "#e74c3c",
    downColor: "#27ae60",
    borderUpColor: "#e74c3c",
    borderDownColor: "#27ae60",
    wickUpColor: "#e74c3c",
    wickDownColor: "#27ae60",
    priceFormat: {
      type: "price",
      precision: 2,
      minMove: 0.01,
    },
  });

  volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    priceLineVisible: false,
  });

  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.80, bottom: 0 },
  });

  // 添加均线
  maPeriods.forEach((p) => {
    const series = chart.addSeries(LineSeries, {
      color: maColors[p],
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    maSeries[p] = series;
  });

  // 创建标记插件
  markersPlugin = createSeriesMarkers(candleSeries);

  // 响应式 resize
  const observer = new ResizeObserver(() => {
    if (chartContainer.value && chart) {
      const { clientWidth, clientHeight } = chartContainer.value;
      chart.applyOptions({ width: clientWidth, height: clientHeight });
    }
  });
  observer.observe(chartContainer.value);
  chart._observer = observer;
}

function updateChartData(newData) {
  if (!candleSeries || !volumeSeries || !newData || newData.length === 0) {
    console.warn("[KlineChart] No data to update:", { candleSeries: !!candleSeries, volumeSeries: !!volumeSeries, dataLen: newData?.length });
    return;
  }

  const candleData = [];
  const volumeData = [];

  for (const item of newData) {
    const time = item.date;
    candleData.push({
      time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    });

    // 根据涨跌决定成交量颜色
    const isUp = item.close >= item.open;
    volumeData.push({
      time,
      value: item.volume,
      color: isUp ? "rgba(231, 76, 60, 0.4)" : "rgba(39, 174, 96, 0.4)",
    });
  }

  candleSeries.setData(candleData);
  volumeSeries.setData(volumeData);

  // 更新均线数据
  const latestValues = {};
  maPeriods.forEach((p) => {
    const series = maSeries[p];
    if (series) {
      const maData = computeMA(candleData, p);
      series.setData(maData);
      if (maData.length > 0) {
        latestValues[p] = maData[maData.length - 1].value;
      }
    }
  });
  maLatestValues.value = latestValues;

  // 渲染加入自选标记
  if (markersPlugin) {
    if (props.markers && props.markers.length > 0) {
      markersPlugin.setMarkers(
        props.markers.map((m) => ({
          time: m.time,
          position: m.position || "belowBar",
          color: m.color || "#f0b429",
          shape: m.shape || "arrowUp",
          text: m.text || "",
          size: m.size ?? 1,
        }))
      );
    } else {
      markersPlugin.setMarkers([]);
    }
  }

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
    if (newData && newData.length > 0) {
      // 等待 DOM 更新后初始化图表并渲染数据
      nextTick(() => {
        ensureChart();
        updateChartData(newData);
      });
    }
  },
  { deep: true, immediate: true }
);

// 标记独立更新（当只修改了加入自选日而不刷新 K 线数据时）
watch(
  () => props.markers,
  (markers) => {
    if (markersPlugin) {
      if (markers && markers.length > 0) {
        markersPlugin.setMarkers(
          markers.map((m) => ({
            time: m.time,
            position: m.position || "belowBar",
            color: m.color || "#f0b429",
            shape: m.shape || "arrowUp",
            text: m.text || "",
            size: m.size ?? 1,
          }))
        );
      } else {
        markersPlugin.setMarkers([]);
      }
    }
  },
  { deep: true }
);

onMounted(() => {
  // 挂载后等待 DOM 就绪，如果已有数据则初始化
  nextTick(() => {
    if (props.data && props.data.length > 0) {
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
    candleSeries = null;
    volumeSeries = null;
    Object.keys(maSeries).forEach((k) => delete maSeries[k]);
  }
});
</script>

<template>
  <div class="kline-wrapper">
    <div class="kline-header">
      <span class="kline-title">{{ periodLabel }}</span>
      <div class="kline-header-right">
        <div class="kline-periods">
          <button
            class="period-btn"
            :class="{ active: props.period === 'day' }"
            @click="emit('change-period', 'day')"
          >日 K</button>
          <button
            class="period-btn"
            :class="{ active: props.period === 'week' }"
            @click="emit('change-period', 'week')"
          >周 K</button>
          <button
            class="period-btn"
            :class="{ active: props.period === 'month' }"
            @click="emit('change-period', 'month')"
          >月 K</button>
        </div>
        <div class="kline-legend">
          <span v-for="p in maPeriods" :key="p" class="legend-item ma-legend">
            <span class="legend-dot" :style="{ background: maColors[p] }"></span>
            MA{{ p }} <span class="ma-value">{{ maLatestValues[p]?.toFixed(2) ?? "--" }}</span>
          </span>
        </div>
      </div>
    </div>
    <div class="kline-chart-wrap">
      <div ref="chartContainer" class="kline-chart"></div>
      <div v-if="loading" class="kline-loading">
        <span class="kline-loading-icon">🔄</span>
        <span>加载 K 线数据中...</span>
      </div>
      <div v-else-if="!data || data.length === 0" class="kline-empty">
        <span class="kline-empty-icon">📉</span>
        <p class="kline-empty-text">暂无 K 线数据</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kline-wrapper {
  margin-bottom: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.kline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.kline-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.kline-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.kline-periods {
  display: flex;
  background: var(--bg);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
}

.period-btn {
  padding: 4px 14px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  background: transparent;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.period-btn:hover {
  color: var(--text-primary);
}

.period-btn.active {
  background: var(--card-bg);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.kline-legend {
  display: flex;
  align-items: center;
  gap: 12px;
}

.legend-item {
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend-dot.up {
  background: var(--red);
}

.legend-dot.down {
  background: var(--green);
}

.ma-value {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--text-primary);
}

.kline-chart-wrap {
  position: relative;
  width: 100%;
  min-height: 200px;
  flex: 1;
  border-radius: 10px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.kline-chart {
  width: 100%;
  height: 100%;
}

.kline-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 14px;
}

.kline-loading-icon {
  font-size: 22px;
  opacity: 0.5;
  animation: kline-spin 1s linear infinite;
}

@keyframes kline-spin {
  to { transform: rotate(360deg); }
}

.kline-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #fff;
  color: var(--text-muted);
}

.kline-empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
  opacity: 0.5;
}

.kline-empty-text {
  font-size: 13px;
}
</style>
