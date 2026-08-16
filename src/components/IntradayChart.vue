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
    prediction: { type: Object, default: null },
    predictionLoading: { type: Boolean, default: false },
});

const chartContainer = ref(null);

let chart = null;
let areaSeries = null;
let priceLineSeries = null;
let avgPriceSeries = null;
let vwapSeries = null;
let aiSeries = null;
let aiUpperSeries = null;
let aiLowerSeries = null;
let volumeSeries = null;
let baseLine = null;
let limitUpLine = null;
let limitDownLine = null;
/** 今开/日内最高/日内最低参考线（开盘高低收参考，随分时数据同源计算） */
let openLine = null;
let highLine = null;
let lowLine = null;
let signalMarkersPlugin = null;
/** 是否已经为当前预测线 fitContent 过（避免每次分时刷新都重置用户缩放） */
let _predictionFitted = false;
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

  // AI 预测线（橙色虚线 + 上下区间辅助线）
  aiSeries = chart.addSeries(LineSeries, {
    color: "#e67e22",
    lineWidth: 2,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    crosshairMarkerVisible: false,
  });
  aiUpperSeries = chart.addSeries(LineSeries, {
    color: "rgba(230, 126, 34, 0.35)",
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    crosshairMarkerVisible: false,
  });
  aiLowerSeries = chart.addSeries(LineSeries, {
    color: "rgba(230, 126, 34, 0.35)",
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    crosshairMarkerVisible: false,
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

  // 今开/最高/最低参考线（今开=首分钟价，最高/最低=分时数据极值，与图上价格同源）
  // 点线/点划线样式，与涨跌停的虚线（lineStyle 2）区分
  openLine = priceLineSeries.createPriceLine({
    price: 0,
    color: "rgba(52, 152, 219, 0.6)",
    lineWidth: 1,
    lineStyle: 3,
    axisLabelVisible: true,
    title: "今开",
  });
  highLine = priceLineSeries.createPriceLine({
    price: 0,
    color: "rgba(231, 76, 60, 0.6)",
    lineWidth: 1,
    lineStyle: 1,
    axisLabelVisible: true,
    title: "最高",
  });
  lowLine = priceLineSeries.createPriceLine({
    price: 0,
    color: "rgba(39, 174, 96, 0.6)",
    lineWidth: 1,
    lineStyle: 1,
    axisLabelVisible: true,
    title: "最低",
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

  // 今开/最高/最低参考线：与图上价格同源（首分钟价 = 今开，数据极值 = 日内高低）
  let high = -Infinity;
  let low = Infinity;
  for (const it of items) {
    if (it.price > high) high = it.price;
    if (it.price < low) low = it.price;
  }
  if (openLine) openLine.applyOptions({ price: items[0]?.price ?? preClose });
  if (highLine) highLine.applyOptions({ price: high === -Infinity ? preClose : high });
  if (lowLine) lowLine.applyOptions({ price: low === Infinity ? preClose : low });

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

/** 渲染 AI 预测线：只保留晚于最后一根实际分时的点，避免和实际线重叠 */
function updatePrediction(predictionData) {
  if (!aiSeries || !props.data?.items?.length) return;

  const items = props.data.items;
  const lastItem = items[items.length - 1];
  const lastTime = lastItem?.time || "";
  const points = predictionData?.points || [];

  if (!points.length) {
    _predictionFitted = false;
    aiSeries.setData([]);
    if (aiUpperSeries) aiUpperSeries.setData([]);
    if (aiLowerSeries) aiLowerSeries.setData([]);
    return;
  }

  const date = props.data.date;
  if (!date || date.length !== 8) {
    _predictionFitted = false;
    aiSeries.setData([]);
    if (aiUpperSeries) aiUpperSeries.setData([]);
    if (aiLowerSeries) aiLowerSeries.setData([]);
    return;
  }

  const year = parseInt(date.slice(0, 4));
  const month = parseInt(date.slice(4, 6)) - 1;
  const day = parseInt(date.slice(6, 8));

  const main = [];
  const upper = [];
  const lower = [];

  for (const p of points) {
    const time = p?.time;
    if (!time || time <= lastTime) continue;
    const [h, m] = time.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const timestamp = Math.floor(Date.UTC(year, month, day, h, m) / 1000);
    const price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) continue;

    main.push({ time: timestamp, value: price });
    if (Number.isFinite(Number(p.upper)) && Number(p.upper) > 0) {
      upper.push({ time: timestamp, value: Number(p.upper) });
    }
    if (Number.isFinite(Number(p.lower)) && Number(p.lower) > 0) {
      lower.push({ time: timestamp, value: Number(p.lower) });
    }
  }

  // 用当前实际价作为锚点，让预测线从最新价平滑延伸
  if (main.length > 0 && lastTime) {
    const [lh, lm] = lastTime.split(":").map(Number);
    if (Number.isFinite(lh) && Number.isFinite(lm)) {
      const lastTs = Math.floor(Date.UTC(year, month, day, lh, lm) / 1000);
      main.unshift({ time: lastTs, value: lastItem.price });
    }
  }


  aiSeries.setData(main);
  if (aiUpperSeries) aiUpperSeries.setData(upper);
  if (aiLowerSeries) aiLowerSeries.setData(lower);

  // 预测线首次出现时让图表缩放到包含未来区域
  if (main.length > 0 && !_predictionFitted) {
      _predictionFitted = true;
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
          updatePrediction(props.prediction);
      });
    } else if (priceLineSeries) {
      // 切换到无数据股票：清空旧图表，避免残留上一只股票的内容
      priceLineSeries.setData([]);
      if (areaSeries) areaSeries.setData([]);
      if (avgPriceSeries) avgPriceSeries.setData([]);
      if (vwapSeries) vwapSeries.setData([]);
      if (volumeSeries) volumeSeries.setData([]);
        if (aiSeries) aiSeries.setData([]);
        if (aiUpperSeries) aiUpperSeries.setData([]);
        if (aiLowerSeries) aiLowerSeries.setData([]);
        _predictionFitted = false;
      [baseLine, limitUpLine, limitDownLine, costLine, openLine, highLine, lowLine].forEach((l) => {
        if (l) { try { priceLineSeries.removePriceLine(l); } catch (e) {} }
      });
      baseLine = null;
      limitUpLine = null;
      limitDownLine = null;
      costLine = null;
      openLine = null;
      highLine = null;
      lowLine = null;
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

// AI 预测线独立更新
watch(
  () => props.prediction,
  () => {
    if (aiSeries) {
      updatePrediction(props.prediction);
    }
  },
  { deep: true }
);


onMounted(() => {
  nextTick(() => {
    if (props.data && props.data.items && props.data.items.length > 0) {
      initChart();
      updateChartData(props.data);
        updatePrediction(props.prediction);
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
      aiSeries = null;
      aiUpperSeries = null;
      aiLowerSeries = null;
    baseLine = null;
    limitUpLine = null;
    limitDownLine = null;
    openLine = null;
    highLine = null;
    lowLine = null;
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
          <span v-if="prediction || predictionLoading" class="legend-item ai-legend">
            <span class="legend-dot" style="background: #e67e22"></span>
            AI 预测
          </span>
        <span class="legend-sep">|</span>
        <span class="legend-item ref-legend">
          <span class="legend-line" style="background: rgba(52, 152, 219, 0.7)"></span>
          今开
        </span>
        <span class="legend-item ref-legend">
          <span class="legend-line" style="background: rgba(231, 76, 60, 0.7)"></span>
          最高
        </span>
        <span class="legend-item ref-legend">
          <span class="legend-line" style="background: rgba(39, 174, 96, 0.7)"></span>
          最低
        </span>
        <template v-if="signalMarkers.length > 0">
          <span class="legend-sep">|</span>
          <!-- 前瞻预警（橙点） -->
          <span class="legend-item signal-legend" title="前瞻预警：放量急拉/急跌/无量拉升（当下可判，追高/杀跌前先看量能）">
            <span class="legend-dot" style="background: #f39c12"></span>
            预警
          </span>
          <!-- 陷阱确认（红/绿方块） -->
          <span class="legend-item signal-legend" title="疑似诱多?/疑似诱空?：跌破/收复关键位的警报确认（需 confirm 走势验证）">
            <span class="legend-square" style="background: #e74c3c"></span>
            <span class="legend-square" style="background: #27ae60"></span>
            陷阱
          </span>
          <!-- 方向事件（深色箭头：突破/破位） -->
          <span class="legend-item signal-legend" title="突破↑/破位↓：放量越过 30 分钟前高/前低；偏离>3% 等 T+0 信号见红绿箭头">
            <span class="legend-dot" style="background: #c0392b"></span>
            <span class="legend-dot" style="background: #1e8449"></span>
            突破/破位
          </span>
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
        <div v-if="predictionLoading && !loading" class="intraday-loading ai-prediction-loading">
          <span class="intraday-loading-icon">⟳</span>
          <span>AI 预测生成中...</span>
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

/* 参考线图例（今开/最高/最低的水平线示意） */
.legend-line {
  width: 14px;
  height: 2px;
  display: inline-block;
  border-radius: 1px;
}

/* 信号图例方块（陷阱/背离类标记示意） */
.legend-square {
  width: 8px;
  height: 8px;
  display: inline-block;
  border-radius: 2px;
  margin-right: 2px;
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
</style>
