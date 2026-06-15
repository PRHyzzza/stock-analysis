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
/** 30日高低价线引用 */
let highPriceLine = null;
let lowPriceLine = null;
const extreme30 = ref({ high: null, low: null });

/** 支撑/阻力线 */
let srPriceLines = [];
const srLevels = ref({ support: [], resistance: [] });

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

/** 计算支撑与阻力位 */
function calcSupportResistance(candleData) {
  if (candleData.length < 30) return { support: [], resistance: [] };

  // 1. 寻找波段高点/低点
  const swingHighs = [];
  const swingLows = [];
  const lookback = 3; // 左右各看 3 根

  for (let i = lookback; i < candleData.length - lookback; i++) {
    const segHigh = candleData.slice(i - lookback, i + lookback + 1);
    const segLow = candleData.slice(i - lookback, i + lookback + 1);
    const maxHigh = Math.max(...segHigh.map((c) => c.high));
    const minLow = Math.min(...segLow.map((c) => c.low));

    if (candleData[i].high === maxHigh) {
      swingHighs.push(candleData[i].high);
    }
    if (candleData[i].low === minLow) {
      swingLows.push(candleData[i].low);
    }
  }

  // 2. 聚类：将相近的价格合并
  function cluster(prices, thresholdRatio = 0.005) {
    if (prices.length === 0) return [];
    const sorted = [...prices].sort((a, b) => a - b);
    const clusters = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const avg = clusters[clusters.length - 1].reduce((s, v) => s + v, 0) / clusters[clusters.length - 1].length;
      if (Math.abs(sorted[i] - avg) / avg <= thresholdRatio) {
        clusters[clusters.length - 1].push(sorted[i]);
      } else {
        clusters.push([sorted[i]]);
      }
    }
    // 返回 { price: 集群均价, strength: 出现次数 }
    return clusters
      .filter((c) => c.length >= 2) // 至少出现 2 次才有效
      .map((c) => ({ price: c.reduce((s, v) => s + v, 0) / c.length, strength: c.length }))
      .sort((a, b) => b.strength - a.strength);
  }

  const resistanceClusters = cluster(swingHighs, 0.005);
  const supportClusters = cluster(swingLows, 0.005);

  // 3. 筛选最强的 3 条，并且排除离当前价格太远的
  const latestPrice = candleData[candleData.length - 1].close;
  const priceRange = latestPrice * 0.25; // 上下 25% 范围

  const topResistance = resistanceClusters
    .filter((r) => r.price >= latestPrice && r.price - latestPrice <= priceRange)
    .slice(0, 3)
    .sort((a, b) => a.price - b.price); // 从低到高

  const topSupport = supportClusters
    .filter((s) => s.price <= latestPrice && latestPrice - s.price <= priceRange)
    .slice(0, 3)
    .sort((a, b) => b.price - a.price); // 从高到低

  return { support: topSupport, resistance: topResistance };
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
    upColor: "#27ae60",
    downColor: "#e74c3c",
    borderUpColor: "#27ae60",
    borderDownColor: "#e74c3c",
    wickUpColor: "#27ae60",
    wickDownColor: "#e74c3c",
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
      color: isUp ? "rgba(39, 174, 96, 0.4)" : "rgba(231, 76, 60, 0.4)",
    });
  }

  candleSeries.setData(candleData);
  volumeSeries.setData(volumeData);

  // 计算近 30 日高低并更新/创建价格线
  const lookback = Math.min(30, candleData.length);
  const recentCandles = candleData.slice(-lookback);
  const high30 = Math.max(...recentCandles.map((c) => c.high));
  const low30 = Math.min(...recentCandles.map((c) => c.low));
  extreme30.value = { high: high30, low: low30 };

  if (highPriceLine) {
    highPriceLine.applyOptions({ price: high30 });
  } else {
    highPriceLine = candleSeries.createPriceLine({
      price: high30,
      color: "#e74c3c",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "30日高",
    });
  }
  if (lowPriceLine) {
    lowPriceLine.applyOptions({ price: low30 });
  } else {
    lowPriceLine = candleSeries.createPriceLine({
      price: low30,
      color: "#27ae60",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "30日低",
    });
  }

  // 支撑与阻力
  const { support, resistance } = calcSupportResistance(candleData);
  srLevels.value = { support, resistance };

  // 移除旧的支撑/阻力线
  srPriceLines.forEach((line) => candleSeries.removePriceLine(line));
  srPriceLines = [];

  // 创建阻力线 (红色系)
  resistance.forEach((r, i) => {
    const opacity = 1 - i * 0.2; // 最强最亮
    srPriceLines.push(
      candleSeries.createPriceLine({
        price: r.price,
        color: `rgba(231, 76, 60, ${opacity})`,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `阻力${i + 1}`,
      })
    );
  });

  // 创建支撑线 (绿色系)
  support.forEach((s, i) => {
    const opacity = 1 - i * 0.2;
    srPriceLines.push(
      candleSeries.createPriceLine({
        price: s.price,
        color: `rgba(39, 174, 96, ${opacity})`,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `支撑${i + 1}`,
      })
    );
  });

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
    highPriceLine = null;
    lowPriceLine = null;
    srPriceLines = [];
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
