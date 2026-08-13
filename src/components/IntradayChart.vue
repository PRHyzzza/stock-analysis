<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { createChart, ColorType, LineSeries, HistogramSeries, AreaSeries, createSeriesMarkers } from "lightweight-charts";
import { getLimitPct } from "../utils/limit";
import { usePositions } from "../composables/usePositions.js";

const { positions } = usePositions();

const props = defineProps({
  data: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  signalMarkers: { type: Array, default: () => [] },
  code: { type: String, default: "" }, // 股票代码，用于按板块计算涨跌停参考线
});

const chartContainer = ref(null);

/** 图例信号标记提示 */
function markerLegendTooltip() {
  return '🔴 ▼ = 偏离均价 >3%，高抛信号\n🟢 ▲ = 偏离均价 <-3%，低吸信号';
}

let chart = null;
let areaSeries = null;
let priceLineSeries = null;
let avgPriceSeries = null;
let vwapSeries = null;
let volumeSeries = null;
let baseLine = null;
let limitUpLine = null;
let limitDownLine = null;
let signalMarkersPlugin = null;
/** 缓存的 timestamp 映射 (timeStr → unixTs)，供信号标记使用 */
let _timeMap = new Map();

/** 当前股票持仓成本价（未持仓时为 null） */
const costPrice = computed(() => {
  if (!props.code) return null;
  const pos = positions.value.find((p) => p.code === props.code);
  return pos && pos.buyPrice > 0 ? pos.buyPrice : null;
});
/** 持仓成本线引用 */
let costLine = null;
/** 最近一次价格数据缓存（供持仓变化时刷新成本线） */
let _lastPriceData = [];

/** 已 fitContent 的数据身份（交易日+点数）：仅切换股票时重置视图，
 *  定时刷新数据时保留用户的缩放/平移 */
let fittedDataKey = "";

/**
 * 渲染/更新持仓成本线：仅当持仓且成本价在今日价格波动范围内（正常显示内可见）时显示，否则移除
 */
function updateCostLine(priceData) {
  if (!priceLineSeries) return;
  const cost = costPrice.value;
  let inRange = false;
  if (cost != null && priceData.length > 0) {
    let min = Infinity;
    let max = -Infinity;
    for (const d of priceData) {
      if (d.value < min) min = d.value;
      if (d.value > max) max = d.value;
    }
    inRange = cost >= min && cost <= max;
  }
  if (inRange) {
    if (costLine) {
      costLine.applyOptions({ price: cost });
    } else {
      costLine = priceLineSeries.createPriceLine({
        price: cost,
        color: "#f0b429",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "成本",
      });
    }
  } else if (costLine) {
    try { priceLineSeries.removePriceLine(costLine); } catch {}
    costLine = null;
  }
}

// 持仓变化时刷新成本线（无需重新拉取分时数据）
watch(costPrice, () => {
  if (priceLineSeries && _lastPriceData.length > 0) updateCostLine(_lastPriceData);
});

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

  // 价格区域填充（AreaSeries 填充价格线与图表底部之间）
  areaSeries = chart.addSeries(AreaSeries, {
    lineColor: "#e74c3c",
    topColor: "rgba(231, 76, 60, 0.28)",
    bottomColor: "rgba(39, 174, 96, 0.08)",
    lineWidth: 0,
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    crosshairMarkerVisible: false,
  });

  // 价格线（叠加在面积填充上方，用于清晰的走势线）
  priceLineSeries = chart.addSeries(LineSeries, {
    color: "#e74c3c",
    lineWidth: 1.5,
    priceLineVisible: true,
    priceLineColor: "rgba(163, 166, 175, 0.3)",
    lastValueVisible: true,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    crosshairMarkerRadius: 4,
    crosshairMarkerBorderColor: "#e74c3c",
    crosshairMarkerBackgroundColor: "#ffffff",
  });

  // 均价线
  avgPriceSeries = chart.addSeries(LineSeries, {
    color: "#9c27b0",
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    crosshairMarkerVisible: false,
  });

  // VWAP 线
  vwapSeries = chart.addSeries(LineSeries, {
    color: "#2196F3",
    lineWidth: 1,
    lineStyle: 0,
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
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
    scaleMargins: { top: 0.72, bottom: 0.02 },
  });

  // 昨收基准线（中性灰虚线 — 昨收是参考线非涨跌方向，绿色易误读为"支撑/跌"）
  baseLine = priceLineSeries.createPriceLine({
    price: 0,
    color: "rgba(128, 134, 142, 0.55)",
    lineWidth: 1,
    lineStyle: 3,
    axisLabelVisible: true,
    title: "昨收",
  });

  // 涨跌停参考线（initChart 后由 updateLimitLines 动态创建/移除）
  limitUpLine = null;
  limitDownLine = null;

  // T+0 信号标记插件
  signalMarkersPlugin = createSeriesMarkers(priceLineSeries);

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
  if (!areaSeries || !avgPriceSeries || !volumeSeries || !baseLine || !intradayData) return;

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

  let prevPrice = null;
  const newTimeMap = new Map();

  for (const item of items) {
    const [h, m] = item.time.split(':').map(Number);
    // 用 Date.UTC 把东八区时间当作 UTC 对待，保证 crosshair 显示正确
    const timestamp = Math.floor(Date.UTC(year, month, day, h, m) / 1000);
    newTimeMap.set(item.time, timestamp);

    priceData.push({ time: timestamp, value: item.price });

    let avgPrice = item.avgPrice;
    // 安全校验：跳过异常值（0 或超出当前价 ±80%），避免拉伸价格轴
    if (avgPrice > 0 && avgPrice > item.price * 0.2 && avgPrice < item.price * 1.8) {
      avgPriceData.push({ time: timestamp, value: avgPrice });
    }

    // VWAP
    if (item.vwap > 0) {
      vwapData.push({ time: timestamp, value: item.vwap });
    }

    // 成交量柱颜色：对比上一分钟价格，红=买盘推动上涨，绿=卖盘打压下跌
    let volColor;
    if (prevPrice === null) {
      // 第一根：与昨收比较
      volColor = item.price >= preClose
        ? "rgba(231, 76, 60, 0.45)"
        : "rgba(39, 174, 96, 0.45)";
    } else if (item.price > prevPrice) {
      volColor = "rgba(231, 76, 60, 0.45)";
    } else if (item.price < prevPrice) {
      volColor = "rgba(39, 174, 96, 0.45)";
    } else {
      volColor = "rgba(163, 166, 175, 0.35)";
    }
    prevPrice = item.price;

    volumeData.push({
      time: timestamp,
      value: item.volume,
      color: volColor,
    });
  }

  areaSeries.setData(priceData);
  priceLineSeries.setData(priceData);

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

  // 更新涨跌停参考线（港股无涨跌停，自动隐藏）
  updateLimitLines(preClose);

  // 存储时间映射供信号标记使用
  _timeMap = newTimeMap;

  // 渲染 T+0 信号标记
  renderSignalMarkers();

  // 渲染持仓成本线（仅当成本价在当前分时显示范围内可见）
  _lastPriceData = priceData;
  updateCostLine(priceData);

  // 仅当数据身份变化（切换股票）时 fitContent，
  // 定时刷新（默认 60s）不重置用户缩放/平移
  const dataKey = `${date}:${items.length}`;
  if (dataKey !== fittedDataKey) {
    fittedDataKey = dataKey;
    chart.timeScale().fitContent();
  }
}

/**
 * 涨跌停参考线：按板块阈值（主板±10% / 创业科创±20% / 北交所±30%）基于昨收计算，
 * 港股无涨跌停限制（getLimitPct 返回 0）时移除参考线。
 */
function updateLimitLines(preClose) {
  if (!priceLineSeries) return;
  const pct = getLimitPct(props.code);

  if (pct <= 0 || !preClose || preClose <= 0) {
    // 无涨跌停或数据缺失 → 移除参考线
    if (limitUpLine) {
      priceLineSeries.removePriceLine(limitUpLine);
      limitUpLine = null;
    }
    if (limitDownLine) {
      priceLineSeries.removePriceLine(limitDownLine);
      limitDownLine = null;
    }
    return;
  }

  // 涨跌停价按实际规则四舍五入到分
  const upPrice = Math.round(preClose * (1 + pct / 100) * 100) / 100;
  const downPrice = Math.round(preClose * (1 - pct / 100) * 100) / 100;

  if (!limitUpLine) {
    limitUpLine = priceLineSeries.createPriceLine({
      price: upPrice,
      color: "rgba(231, 76, 60, 0.55)",
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: true,
      title: "涨停",
    });
  } else {
    limitUpLine.applyOptions({ price: upPrice });
  }

  if (!limitDownLine) {
    limitDownLine = priceLineSeries.createPriceLine({
      price: downPrice,
      color: "rgba(39, 174, 96, 0.55)",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "跌停",
    });
  } else {
    limitDownLine.applyOptions({ price: downPrice });
  }
}

function ensureChart() {
  if (!chart) {
    initChart();
  }
}

/** 将 signalMarkers 的 time (HH:mm) 转为 Unix timestamp 并渲染 */
function renderSignalMarkers() {
  if (!signalMarkersPlugin) return;
  const markers = props.signalMarkers;
  if (!markers || markers.length === 0) {
    signalMarkersPlugin.setMarkers([]);
    return;
  }
  const converted = markers
    .map(m => {
      const ts = _timeMap.get(m.time);
      if (ts == null) return null;
      return { time: ts, position: m.position, color: m.color, shape: m.shape, text: m.text, size: m.size };
    })
    .filter(Boolean);
  signalMarkersPlugin.setMarkers(converted);
}

watch(
  () => props.data,
  (newData) => {
    if (newData && newData.items && newData.items.length > 0) {
      nextTick(() => {
        ensureChart();
        updateChartData(newData);
      });
    } else if (priceLineSeries) {
      // 切换到无数据股票：清空旧图表，避免残留上一只股票的内容
      priceLineSeries.setData([]);
      if (areaSeries) areaSeries.setData([]);
      if (avgPriceSeries) avgPriceSeries.setData([]);
      if (vwapSeries) vwapSeries.setData([]);
      if (volumeSeries) volumeSeries.setData([]);
      [baseLine, limitUpLine, limitDownLine, costLine].forEach((l) => {
        if (l) { try { priceLineSeries.removePriceLine(l); } catch (e) {} }
      });
      baseLine = null;
      limitUpLine = null;
      limitDownLine = null;
      costLine = null;
      signalMarkersPlugin?.setMarkers([]);
      _timeMap = new Map();
      _lastPriceData = [];
    }
  },
  { deep: true, immediate: true }
);

// 信号标记独立更新
watch(
  () => props.signalMarkers,
  () => {
    if (signalMarkersPlugin && _timeMap.size > 0) {
      renderSignalMarkers();
    }
  },
  { deep: true }
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
    areaSeries = null;
    priceLineSeries = null;
    avgPriceSeries = null;
    vwapSeries = null;
    volumeSeries = null;
    baseLine = null;
    limitUpLine = null;
    limitDownLine = null;
    signalMarkersPlugin = null;
    costLine = null;
    _timeMap = new Map();
    _lastPriceData = [];
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
          <span class="legend-dot" style="background: #9c27b0"></span>
          均价
        </span>
        <span class="legend-item vwap-legend">
          <span class="legend-dot" style="background: #2196F3"></span>
          VWAP
        </span>
        <template v-if="signalMarkers.length > 0">
          <span class="legend-sep">|</span>
          <span class="legend-item signal-legend" :title="markerLegendTooltip()">
            <span class="legend-dot" style="background: #e74c3c"></span>
            ▼
          </span>
          <span class="legend-item signal-legend" :title="markerLegendTooltip()">
            <span class="legend-dot" style="background: #27ae60"></span>
            ▲
          </span>
          <span class="legend-label">T+0 信号</span>
        </template>
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
  flex-wrap: wrap;
  gap: 8px 12px;
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
  flex-wrap: wrap;
}

/* 窗口较窄时压缩图例间距 */
@media (max-width: 900px) {
  .intraday-legend {
    gap: 10px;
  }
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

/* 信号图例 */
.legend-sep {
  color: var(--border-light);
  font-size: 12px;
  margin: 0 2px;
  user-select: none;
}

.legend-label {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 500;
  margin-left: 2px;
}
</style>
