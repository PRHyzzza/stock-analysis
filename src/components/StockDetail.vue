<script setup>
import KlineChart from "./KlineChart.vue";
import { signChar } from "../utils/format";
import { computed } from "vue";

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
  moneyFlow: { type: Object, default: null },
  moneyFlowLoading: { type: Boolean, default: false },
  watchlistMarkers: { type: Array, default: () => [] },
});

const emit = defineEmits([
  "toggle-watchlist",
  "change-kline-period",
  "open-industry-modal",
  "open-tech-modal",
]);

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

      <!-- K 线图 -->
      <div class="kline-flex-wrap">
        <KlineChart
          :data="klineData"
          :loading="klineLoading"
          :period="klinePeriod"
          :markers="watchlistMarkers"
          @change-period="emit('change-kline-period', $event)"
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
          <span class="flow-title">💰 主力资金</span>
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
          <span>🏭</span>
          <span>行业分析</span>
        </button>
        <button class="btn btn-tech" @click="$emit('open-tech-modal')">
          <span>📐</span>
          <span>技术分析</span>
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
.main-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* ===== 详情卡片 ===== */
.detail-card {
  background: var(--card-bg);
  border-radius: var(--radius);
  padding: 28px 32px;
  box-shadow: var(--shadow);
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
  margin-bottom: 16px;
}

.flow-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 0;
}

.flow-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  flex-shrink: 0;
}

.flow-loading {
  font-size: 12px;
  color: var(--text-muted);
}

.flow-text {
  font-size: 18px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.flow-pct-text {
  font-size: 13px;
  font-weight: 600;
}

.flow-text.inflow,
.flow-pct-text.inflow { color: #dc2626; }
.flow-text.outflow,
.flow-pct-text.outflow { color: #16a34a; }

/* ===== 操作按钮 ===== */
.action-bar {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 10px 28px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-industry {
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  box-shadow: 0 2px 6px rgba(59,130,246,0.25);
}

.btn-industry:hover {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  box-shadow: 0 4px 12px rgba(59,130,246,0.35);
}

.btn-ai {
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #1a1a2e, #2d2d4a);
  color: #fff;
  box-shadow: 0 2px 6px rgba(26,26,46,0.25);
}

.btn-ai:hover {
  background: linear-gradient(135deg, #2d2d4a, #3d3d5a);
  box-shadow: 0 4px 12px rgba(26,26,46,0.35);
}

.btn-tech {
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #0891b2, #06b6d4);
  color: #fff;
  box-shadow: 0 2px 6px rgba(6,182,212,0.25);
}

.btn-tech:hover {
  background: linear-gradient(135deg, #06b6d4, #22d3ee);
  box-shadow: 0 4px 12px rgba(6,182,212,0.35);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1.5px solid var(--border);
  transition: all 0.15s;
}

.btn-ghost:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}

.btn-ghost.in-watchlist {
  color: var(--green);
  border-color: var(--green);
}

.btn-ghost.in-watchlist:hover {
  color: var(--red);
  border-color: var(--red);
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
