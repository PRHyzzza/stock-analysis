<script setup>
import KlineChart from "./KlineChart.vue";
import IntradayChart from "./IntradayChart.vue";
import { signChar } from "../utils/format";
import { ref, computed } from "vue";

function fmtMoney(v) {
  if (v == null) return "--";
  const abs = Math.abs(v);
  if (abs >= 10000) return (v / 10000).toFixed(2) + "亿";
  if (abs >= 1000) return (v / 1000).toFixed(2) + "千万";
  return v.toFixed(2) + "万";
}
function fmtPct(v) {
  if (v == null) return "";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

const props = defineProps({
  selectedStock: { type: Object, default: null },
  watchlist: { type: Array, default: () => [] },
  klineData: { type: Array, default: null },
  klineLoading: { type: Boolean, default: false },
  klinePeriod: { type: String, default: "day" },
  intradayData: { type: Object, default: null },
  intradayLoading: { type: Boolean, default: false },
  moneyFlow: { type: Object, default: null },
  moneyFlowLoading: { type: Boolean, default: false },
  watchlistMarkers: { type: Array, default: () => [] },
});

const emit = defineEmits([
  "toggle-watchlist",
  "change-kline-period",
  "open-industry-modal",
  "open-tech-modal",
  "open-ai-modal",
  "open-chip-modal",
  "load-intraday",
]);

const chartMode = ref("intraday"); // "kline" | "intraday"
const showSR = ref(false);
const klineChartRef = ref(null);

function handleToggleSR() {
  showSR.value = !showSR.value;
  klineChartRef.value?.toggleSR();
}

function switchChartMode(mode) {
  if (mode === chartMode.value) return;
  chartMode.value = mode;
  if (mode === "intraday") {
    emit("load-intraday");
  }
}

function isInWatchlist(code) {
  return props.watchlist.some((s) => s.code === code);
}

/** 自选以来涨跌幅 */
const sinceAddedPct = computed(() => {
  const stock = props.selectedStock;
  const klines = props.klineData;
  if (!stock?.addedAt || !klines || !Array.isArray(klines) || klines.length === 0) return null;
  // 找到加入自选当日的 K 线
  const addedKline = klines.find((k) => k.date === stock.addedAt);
  if (!addedKline?.close || addedKline.close === 0) return null;
  const currentPrice = stock.price;
  if (!currentPrice || currentPrice === 0) return null;
  return ((currentPrice - addedKline.close) / addedKline.close) * 100;
});
</script>

<template>
  <main class="main-content">
    <section class="detail-card" v-if="selectedStock">
      <div class="stock-header">
        <div class="stock-tag" :class="selectedStock.change >= 0 ? 'up' : 'down'">
          <span class="tag-arrow">{{ selectedStock.change >= 0 ? "▲" : "▼" }}</span>
          <span class="tag-text">{{ selectedStock.change >= 0 ? "上涨" : "下跌" }}</span>
        </div>
        <div class="stock-identity">
          <h2 class="stock-name">{{ selectedStock.name }}</h2>
          <span class="stock-code">{{ selectedStock.code }}</span>
          <span
            v-if="sinceAddedPct != null"
            class="since-added"
            :class="sinceAddedPct >= 0 ? 'up' : 'down'"
          >
            {{ signChar(sinceAddedPct) }}{{ sinceAddedPct.toFixed(2) }}%
            <span class="since-added-label">自选以来</span>
          </span>
        </div>
      </div>

      <div class="price-area">
        <div class="price-main">
          <span class="price" :class="selectedStock.change >= 0 ? 'up' : 'down'">
            ¥{{ selectedStock.price.toFixed(2) }}
          </span>
          <span class="price-change" :class="selectedStock.change >= 0 ? 'up' : 'down'">
            {{ signChar(selectedStock.change) }}{{ selectedStock.change.toFixed(2) }}
          </span>
          <span class="price-pct" :class="selectedStock.change >= 0 ? 'up' : 'down'">
            {{ signChar(selectedStock.changePct) }}{{ selectedStock.changePct.toFixed(2) }}%
          </span>
        </div>
      </div>

      <!-- 图表切换标签 -->
      <div class="chart-tabs">
        <button
          class="chart-tab"
          :class="{ active: chartMode === 'kline' }"
          @click="switchChartMode('kline')"
        >K 线</button>
        <button
          class="chart-tab"
          :class="{ active: chartMode === 'intraday' }"
          @click="switchChartMode('intraday')"
        >分时</button>
      </div>

      <!-- K 线图 -->
      <div v-show="chartMode === 'kline'" class="kline-flex-wrap">
        <KlineChart
          ref="klineChartRef"
          :data="klineData"
          :loading="klineLoading"
          :period="klinePeriod"
          :markers="watchlistMarkers"
          :show-sr="showSR"
          @change-period="emit('change-kline-period', $event)"
        />
      </div>

      <!-- 分时图 -->
      <div v-show="chartMode === 'intraday'" class="kline-flex-wrap">
        <IntradayChart
          :data="intradayData"
          :loading="intradayLoading"
        />
      </div>

      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">今开</span>
          <span class="meta-value" :class="selectedStock.open >= selectedStock.prevClose ? 'up' : 'down'">
            {{ selectedStock.open?.toFixed(2) ?? '--' }}
          </span>
        </div>
        <div class="meta-item">
          <span class="meta-label">最高</span>
          <span class="meta-value up">{{ selectedStock.high?.toFixed(2) ?? '--' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">昨收</span>
          <span class="meta-value">{{ selectedStock.prevClose?.toFixed(2) ?? '--' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">最低</span>
          <span class="meta-value down">{{ selectedStock.low?.toFixed(2) ?? '--' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">成交量</span>
          <span class="meta-value">{{ selectedStock.volume != null ? (selectedStock.volume / 10000).toFixed(2) + ' 万手' : '--' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">成交额</span>
          <span class="meta-value">{{ selectedStock.turnover != null ? (selectedStock.turnover / 10000).toFixed(2) + ' 亿' : '--' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">换手率</span>
          <span class="meta-value">{{ selectedStock.turnoverRate != null ? selectedStock.turnoverRate.toFixed(2) + '%' : '--' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">市盈率</span>
          <span class="meta-value">{{ selectedStock.pe?.toFixed(2) ?? '--' }}</span>
        </div>
      </div>

      <!-- 主力资金流向 -->
      <div v-if="selectedStock" class="flow-section">
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
        </div>
      </div>

      <div class="action-bar">
        <button class="btn btn-industry" @click="$emit('open-industry-modal')">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="8" width="3" height="6" rx="0.5"/>
            <rect x="6.5" y="5.5" width="3" height="8.5" rx="0.5"/>
            <rect x="11" y="3" width="3" height="11" rx="0.5"/>
          </svg>
          <span>行业分析</span>
        </button>
        <button class="btn btn-tech" @click="$emit('open-tech-modal')">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 14L14 2M2 14l4-1M2 14l1-4" stroke-linejoin="round"/>
            <circle cx="12" cy="4" r="1" fill="currentColor"/>
          </svg>
          <span>技术分析</span>
        </button>
        <button class="btn btn-sr" :class="{ active: showSR }" @click="handleToggleSR">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="4" cy="4" r="1.5" fill="#27ae60"/>
            <circle cx="12" cy="8" r="1.5" fill="#e74c3c"/>
            <circle cx="7" cy="12" r="1.5" fill="#7c3aed"/>
          </svg>
          <span>支撑/阻力</span>
        </button>
        <button class="btn btn-chip" @click="$emit('open-chip-modal')">
          <svg width="18" height="18" viewBox="0 0 20 18" fill="none">
            <path d="M1 16 6 9l3.5 3L14 3l5 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="14" cy="3" r="2.8" fill="currentColor" opacity="0.85"/>
            <path d="M1 16h18" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <span>筹码峰</span>
        </button>
        <button class="btn btn-ai" @click="$emit('open-ai-modal')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L14.09 8.26L20 9.27L15.5 13.97L16.82 20L12 16.77L7.18 20L8.5 13.97L4 9.27L9.91 8.26L12 2Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>
          </svg>
          <span>AI 分析</span>
        </button>
        <button
          class="btn btn-ghost"
          :class="{ 'in-watchlist': selectedStock && isInWatchlist(selectedStock.code) }"
          @click="selectedStock && $emit('toggle-watchlist', selectedStock)"
        >
          {{ selectedStock && isInWatchlist(selectedStock.code) ? "✓ 已自选" : "+ 加自选" }}
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* ===== Steep: 详情区 ===== */
.main-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* ===== Steep: 详情卡片 — 24px 圆角 ===== */
.detail-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 28px 32px;
  box-shadow: var(--shadow-card);
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.stock-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.stock-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
}

/* 中国 A 股标准：红涨绿跌 */
.stock-tag.up {
  color: var(--red);
  background: var(--red-bg);
}

.stock-tag.down {
  color: var(--green);
  background: var(--green-bg);
}

.tag-arrow {
  font-size: 12px;
}

.stock-identity {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.stock-name {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.stock-code {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

/* 自选以来涨跌幅徽标 */
.since-added {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 12px;
  margin-left: 4px;
  white-space: nowrap;
}
.since-added.up {
  color: var(--red);
  background: var(--red-bg);
}
.since-added.down {
  color: var(--green);
  background: var(--green-bg);
}
.since-added-label {
  font-weight: 500;
  opacity: 0.75;
  margin-left: 2px;
}

/* ===== 价格区域 ===== */
.price-area {
  margin-bottom: 24px;
}

.price-main {
  display: flex;
  align-items: baseline;
  gap: 14px;
}

.price {
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.5px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.price.up { color: var(--red); }
.price.down { color: var(--green); }

.price-change {
  font-size: 18px;
  font-weight: 700;
}

.price-change.up { color: var(--red); }
.price-change.down { color: var(--green); }

.price-pct {
  font-size: 16px;
  font-weight: 600;
  padding: 2px 12px;
  border-radius: 6px;
}

.price-pct.up {
  color: var(--red);
  background: var(--red-bg);
}

.price-pct.down {
  color: var(--green);
  background: var(--green-bg);
}

/* ===== 四维数据网格 ===== */
.meta-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 24px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.meta-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.meta-value {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.meta-value.up { color: var(--red); }
.meta-value.down { color: var(--green); }

/* ===== 主力资金流向 ===== */
.flow-section {
  margin-bottom: 20px;
}

.flow-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 0;
}

.flow-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
  letter-spacing: -0.009em;
}

.flow-loading {
  font-size: 12px;
  color: var(--text-muted);
}

.flow-text {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.flow-pct-text {
  font-size: 13px;
  font-weight: 600;
}

.flow-text.inflow,
.flow-pct-text.inflow { color: var(--red); }
.flow-text.outflow,
.flow-pct-text.outflow { color: var(--green); }

/* ===== Steep: 操作按钮 ===== */
.action-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn {
  padding: 10px 24px;
  border: none;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: -0.009em;
}

/* Steep: Primary CTA — Rust fill, full round */
.btn-industry {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--rust);
  color: #fff;
  box-shadow: var(--shadow-card);
}
.btn-industry:hover {
  background: #4a2215;
  box-shadow: var(--shadow-elevated);
}

/* Steep: Secondary filled CTA — Ink fill */
.btn-tech {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--ink);
  color: #fff;
  box-shadow: var(--shadow-card);
}
.btn-tech:hover {
  background: #2a2d30;
  box-shadow: var(--shadow-elevated);
}

/* Steep: Ghost button — 1px ink border */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  transition: all 0.15s;
}
.btn-ghost:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.btn-ghost.in-watchlist {
  color: var(--green);
  border-color: var(--green);
}
.btn-ghost.in-watchlist:hover {
  color: var(--red);
  border-color: var(--red);
}

/* Steep: SR toggle — ghost style */
.btn-sr {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
}
.btn-sr:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.btn-sr.active {
  background: var(--apricot-wash);
  border-color: var(--rust);
  color: var(--rust);
}

/* Steep: 筹码峰按钮 — 山峰图标 + Purple 色调 */
.btn-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(124, 58, 237, 0.08);
  color: #7c3aed;
  border: 1px solid rgba(124, 58, 237, 0.35);
  box-shadow: var(--shadow-card);
}
.btn-chip:hover {
  background: #7c3aed;
  color: #fff;
  border-color: #7c3aed;
  box-shadow: var(--shadow-elevated);
}

/* Steep: AI 分析按钮 — 星形图标 + Rust 色 */
.btn-ai {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--apricot-wash);
  color: var(--rust);
  border: 1px solid var(--rust);
  box-shadow: var(--shadow-card);
}
.btn-ai:hover {
  background: var(--rust);
  color: #fff;
  box-shadow: var(--shadow-elevated);
}

/* ===== 图表切换标签 ===== */
.chart-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  background: var(--bg);
  border-radius: 8px;
  padding: 3px;
  width: fit-content;
}

.chart-tab {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: -0.01em;
}

.chart-tab.active {
  background: var(--card-bg);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.chart-tab:hover:not(.active) {
  color: var(--text-secondary);
}

/* ===== K 线弹性填充 ===== */
.kline-flex-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.kline-flex-wrap :deep(.kline-wrapper) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
}

.kline-flex-wrap :deep(.kline-chart-wrap) {
  flex: 1;
  min-height: 0;
  height: auto;
  max-height: 420px;
}

.kline-flex-wrap :deep(.kline-chart) {
  height: 100%;
  min-height: 200px;
}

</style>
