<script setup>
import { ref, computed, onMounted, onUpdated, onUnmounted, watch, nextTick } from "vue";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from "lightweight-charts";

const props = defineProps({
  data: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  period: { type: String, default: "day" },
  markers: { type: Array, default: () => [] },
  showSR: { type: Boolean, default: false },
});

const emit = defineEmits(["change-period"]);

const periodNames = { day: "日 K", week: "周 K", month: "月 K" };
const periodLabel = computed(() => `${periodNames[props.period] || "日 K"} 线`);

const chartContainer = ref(null);
let chart = null;
let candleSeries = null;
let volumeSeries = null;
let markersPlugin = null;
/** 30日高低价线引用 */
let highPriceLine = null;
let lowPriceLine = null;

/** 支撑/阻力线 */
let srPriceLines = [];
const srLevels = ref({ support: [], resistance: [] });

/** 内部状态：是否显示支撑/阻力线（由父组件通过暴露的方法控制） */
let _srVisible = false;

/** 由父组件调用：切换支撑/阻力线显示 */
function toggleSR() {
  _srVisible = !_srVisible;
  // 清理旧线
  srPriceLines.forEach((line) => { try { candleSeries?.removePriceLine(line); } catch (e) {} });
  srPriceLines = [];
  if (_srVisible) {
    if (!candleSeries) {
      nextTick(() => {
        if (candleSeries) renderSupportResistance();
      });
      return;
    }
    renderSupportResistance();
  }
}

/** 在更新数据后，如果 SR 已开启则重新渲染 */
function refreshSRIfVisible() {
  if (_srVisible && candleSeries) {
    srPriceLines.forEach((line) => { try { candleSeries?.removePriceLine(line); } catch (e) {} });
    srPriceLines = [];
    renderSupportResistance();
  }
}

defineExpose({ toggleSR });

/** 响应 showSR 变化（备用方案） */
watch(() => props.showSR, (val) => {
  if (val !== _srVisible) {
    toggleSR();
  }
}, { immediate: false, flush: 'sync' });

/** 渲染支撑/阻力线到图表 */
function renderSupportResistance() {
  try {
    if (!candleSeries) return;

    // 移除旧的支撑/阻力线
    srPriceLines.forEach((line) => { try { candleSeries?.removePriceLine(line); } catch (e) {} });
    srPriceLines = [];

    const { support, resistance } = srLevels.value;

    // 创建阻力线 (红色系)
    resistance.forEach((r, i) => {
      const opacity = 1 - i * 0.2;
      const label = r.fib ? `阻力(${(r.fib * 100).toFixed(0)}%)` : `阻力${i + 1}`;
      srPriceLines.push(
        candleSeries.createPriceLine({
          price: r.price,
          color: `rgba(231, 76, 60, ${opacity})`,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: label,
        })
      );
    });

    // 创建支撑线 (绿色系)
    support.forEach((s, i) => {
      const opacity = 1 - i * 0.2;
      const label = s.fib ? `支撑(${(s.fib * 100).toFixed(0)}%)` : `支撑${i + 1}`;
      srPriceLines.push(
        candleSeries.createPriceLine({
          price: s.price,
          color: `rgba(39, 174, 96, ${opacity})`,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: label,
        })
      );
    });
  } catch (_err) {
    // 忽略渲染错误
  }
}

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

/** 计算支撑与阻力位 — 聚类 + 斐波那契补充 */
function calcSupportResistance(candleData) {
  if (candleData.length < 30) return { support: [], resistance: [] };

  const latestPrice = candleData[candleData.length - 1].close;
  const lookback = 3;

  // 1. 寻找波段高点/低点
  const swingHighs = [];
  const swingLows = [];

  for (let i = lookback; i < candleData.length - lookback; i++) {
    const seg = candleData.slice(i - lookback, i + lookback + 1);
    const maxHigh = Math.max(...seg.map((c) => c.high));
    const minLow = Math.min(...seg.map((c) => c.low));

    if (candleData[i].high === maxHigh) swingHighs.push(candleData[i].high);
    if (candleData[i].low === minLow) swingLows.push(candleData[i].low);
  }

  // 2. 聚类合并相近价格（含单点）
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
    // 所有聚类（含单点）都参与，单点 strength=1
    return clusters.map((c) => ({
      price: c.reduce((s, v) => s + v, 0) / c.length,
      strength: c.length,
    })).sort((a, b) => b.strength - a.strength);
  }

  const resistanceClusters = cluster(swingHighs, 0.005);
  const supportClusters = cluster(swingLows, 0.005);

  const priceRange = latestPrice * 0.25;

  let topResistance = resistanceClusters
    .filter((r) => r.price >= latestPrice && r.price - latestPrice <= priceRange)
    .slice(0, 3)
    .sort((a, b) => a.price - b.price);

  let topSupport = supportClusters
    .filter((s) => s.price <= latestPrice && latestPrice - s.price <= priceRange)
    .slice(0, 3)
    .sort((a, b) => b.price - a.price);

  // 3. 斐波那契补充 — 不再要求 candleData.length >= 60
  const total = topResistance.length + topSupport.length;
  if (total < 3) {
    const recent = candleData.slice(-60);
    const fibHigh = Math.max(...recent.map((c) => c.high));
    const fibLow = Math.min(...recent.map((c) => c.low));
    const diff = fibHigh - fibLow;

    if (diff > 0.001) {
      const fibRatios = [0.236, 0.382, 0.5, 0.618, 0.786];
      const fibLevels = fibRatios.map((r) => ({ price: fibHigh - diff * r, ratio: r }));

      const needR = Math.max(0, 3 - topResistance.length);
      const needS = Math.max(0, 3 - topSupport.length);

      const fibResistances = fibLevels
        .filter((f) => f.price > latestPrice)
        .sort((a, b) => a.price - b.price)
        .slice(0, needR)
        .map((f) => ({ price: f.price, strength: 0, fib: f.ratio }));

      const fibSupports = fibLevels
        .filter((f) => f.price < latestPrice)
        .sort((a, b) => b.price - a.price)
        .slice(0, needS)
        .map((f) => ({ price: f.price, strength: 0, fib: f.ratio }));

      topResistance = [...topResistance, ...fibResistances].slice(0, 3);
      topSupport = [...topSupport, ...fibSupports].slice(0, 3);
    }
  }

  return { support: topSupport, resistance: topResistance };
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
      scaleMargins: { top: 0.05, bottom: 0.25 },
    },
    timeScale: {
      borderColor: "rgba(163, 166, 175, 0.2)",
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

    // 根据涨跌决定成交量颜色 (A股: 红涨绿跌)
    const isUp = item.close >= item.open;
    volumeData.push({
      time,
      value: item.volume,
      color: isUp ? "rgba(231, 76, 60, 0.4)" : "rgba(39, 174, 96, 0.4)",
    });
  }

  candleSeries.setData(candleData);
  volumeSeries.setData(volumeData);

  // 计算近 30 日高低并更新/创建价格线
  const lookback = Math.min(30, candleData.length);
  const recentCandles = candleData.slice(-lookback);
  const high30 = Math.max(...recentCandles.map((c) => c.high));
  const low30 = Math.min(...recentCandles.map((c) => c.low));

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

  // 支撑与阻力 — 保存数据，数据更新后重新渲染
  const { support, resistance } = calcSupportResistance(candleData);
  srLevels.value = { support, resistance };
  refreshSRIfVisible();

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

/** 备份：每次组件更新后检查是否需要渲染 SR 线 */
onUpdated(() => {
  if (!candleSeries) return;
  if (_srVisible && srPriceLines.length === 0) {
    renderSupportResistance();
  } else if (!_srVisible && srPriceLines.length > 0) {
    srPriceLines.forEach((line) => { try { candleSeries?.removePriceLine(line); } catch (e) {} });
    srPriceLines = [];
  }
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
        <span class="kline-loading-icon">⟳</span>
        <span>加载 K 线数据中...</span>
      </div>
      <div v-else-if="!data || data.length === 0" class="kline-empty">
        <span class="kline-empty-icon">—</span>
        <p class="kline-empty-text">暂无 K 线数据</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== Steep: Kline 图表区 ===== */
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
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.009em;
}

.kline-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* Steep: period pill group */
.kline-periods {
  display: flex;
  background: var(--fog);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
}

.period-btn {
  padding: 5px 14px;
  border: none;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  background: transparent;
  color: var(--text-muted);
  transition: all 0.15s;
  letter-spacing: -0.009em;
}

.period-btn:hover {
  color: var(--text-secondary);
}

.period-btn.active {
  background: var(--card-bg);
  color: var(--ink);
  box-shadow: 0 0 0 1px rgba(23, 25, 28, 0.04), 0 1px 3px rgba(23, 25, 28, 0.06);
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
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.ma-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--text-primary);
}

.kline-chart-wrap {
  position: relative;
  width: 100%;
  min-height: 200px;
  flex: 1;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
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
  background: var(--card-bg);
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
  background: var(--card-bg);
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
