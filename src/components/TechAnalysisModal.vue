<script setup>
import { computed } from "vue";

const props = defineProps({
  show: { type: Boolean, default: false },
  klineData: { type: Array, default: null },
  stockName: { type: String, default: "" },
});

const emit = defineEmits(["close"]);

function closeModal() {
  emit("close");
}

// ---- 技术指标计算 ----

/** EMA 计算 */
function ema(data, period) {
  const result = [];
  const k = 2 / (period + 1);
  let prev = data[0];
  result.push(prev);
  for (let i = 1; i < data.length; i++) {
    const val = data[i] * k + prev * (1 - k);
    result.push(val);
    prev = val;
  }
  return result;
}

/** MACD: 返回 [{ dif, dea, macd }, ...] */
function calcMACD(closePrices) {
  if (closePrices.length < 26) return [];
  const ema12 = ema(closePrices, 12);
  const ema26 = ema(closePrices, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = ema(dif, 9);
  const macd = dif.map((v, i) => 2 * (v - dea[i]));
  return dif.map((v, i) => ({ dif: v, dea: dea[i], macd: macd[i] }));
}

/** KDJ: 返回 [{ k, d, j }, ...] */
function calcKDJ(data, n = 9) {
  if (data.length < n) return [];
  const rsv = [];
  for (let i = 0; i < data.length; i++) {
    if (i < n - 1) { rsv.push(50); continue; }
    const slice = data.slice(i - n + 1, i + 1);
    const high = Math.max(...slice.map((s) => s.high));
    const low = Math.min(...slice.map((s) => s.low));
    const close = data[i].close;
    rsv.push(high === low ? 50 : ((close - low) / (high - low)) * 100);
  }
  let k = 50, d = 50;
  return rsv.map((v) => {
    k = (2 / 3) * k + (1 / 3) * v;
    d = (2 / 3) * d + (1 / 3) * k;
    const j = 3 * k - 2 * d;
    return { k, d, j };
  });
}

/** 均线趋势: 比较最新 N 个周期的均线斜率 */
function calcMATrend(closePrices) {
  if (closePrices.length < 5) return {};
  const mas = {};
  [5, 10, 20, 30].forEach((p) => {
    if (closePrices.length < p) return;
    let sum = 0;
    for (let i = closePrices.length - p; i < closePrices.length; i++) {
      sum += closePrices[i];
    }
    mas[p] = sum / p;
  });
  return mas;
}

/** WR (Williams %R): 返回最近值 */
function calcWR(data, n = 14) {
  if (data.length < n) return [];
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < n - 1) { result.push(null); continue; }
    const slice = data.slice(i - n + 1, i + 1);
    const high = Math.max(...slice.map((s) => s.high));
    const low = Math.min(...slice.map((s) => s.low));
    const close = data[i].close;
    const wr = high === low ? -50 : ((high - close) / (high - low)) * -100;
    result.push(wr);
  }
  return result;
}

/** 判断交叉信号 */
function getCrossSignal(arr, key1, key2, lookback = 3) {
  if (arr.length < lookback + 1) return null;
  const prev = arr[arr.length - lookback];
  const curr = arr[arr.length - 1];
  const prevDiff = prev[key1] - prev[key2];
  const currDiff = curr[key1] - curr[key2];
  if (prevDiff <= 0 && currDiff > 0) return "金叉 ↑";
  if (prevDiff >= 0 && currDiff < 0) return "死叉 ↓";
  return null;
}

// ---- 计算结果 ----
const indicators = computed(() => {
  if (!props.klineData || props.klineData.length < 10) return null;

  const closePrices = props.klineData.map((d) => d.close);

  // MACD
  const macdData = calcMACD(closePrices);
  const latestMACD = macdData.length > 0 ? macdData[macdData.length - 1] : null;
  const prevMACD = macdData.length > 1 ? macdData[macdData.length - 2] : null;
  const macdCross = getCrossSignal(macdData, "dif", "dea", 2);

  // WR
  const wrData = calcWR(props.klineData);
  const latestWR = wrData.filter((v) => v !== null).slice(-1)[0] ?? null;

  // KDJ
  const kdjData = calcKDJ(props.klineData);
  const latestKDJ = kdjData.length > 0 ? kdjData[kdjData.length - 1] : null;
  const kdjCross = getCrossSignal(kdjData, "k", "d", 2);
  // KDJ 超买超卖
  const kdjStatus = latestKDJ
    ? (latestKDJ.k > 80 || latestKDJ.d > 80 || latestKDJ.j > 100
        ? "超买 ⚠️"
        : latestKDJ.k < 20 || latestKDJ.d < 20 || latestKDJ.j < 0
          ? "超卖 🔔"
          : "正常 ✓")
    : null;

  // MA 趋势
  const maValues = calcMATrend(closePrices);
  const sortedMas = Object.entries(maValues).sort((a, b) => Number(a[0]) - Number(b[0]));
  const maTrend = sortedMas.length >= 2
    ? (sortedMas[0][1] > sortedMas[sortedMas.length - 1][1] ? "多头 📈" : "空头 📉")
    : null;
  const maTrendDetail = sortedMas.map(([p, v]) => `MA${p}: ${v.toFixed(2)}`).join("  ");

  // 均线排列: 检查每条短期均线是否都大于/小于长期均线
  const maAlignment = (() => {
    if (sortedMas.length < 3) return null;
    let allBullish = true;
    let allBearish = true;
    for (let i = 0; i < sortedMas.length - 1; i++) {
      if (sortedMas[i][1] <= sortedMas[i + 1][1]) allBullish = false;
      if (sortedMas[i][1] >= sortedMas[i + 1][1]) allBearish = false;
    }
    if (allBullish) return "多头排列 ✅";
    if (allBearish) return "空头排列 ❌";
    return "交叉缠绕 ⚡";
  })();

  return {
    macd: latestMACD,
    macdPrev: prevMACD,
    macdCross,
    kdj: latestKDJ,
    kdjCross,
    kdjStatus,
    wr: latestWR,
    maTrend,
    maTrendDetail,
    maValues,
    maAlignment,
  };
});

// ---- 格式化 ----
function fmt(v, d = 2) {
  if (v == null) return "--";
  return v.toFixed(d);
}

function fmtSignal(signal) {
  if (!signal) return { text: "--", cls: "signal-none" };
  if (signal.includes("金叉")) return { text: signal, cls: "signal-up" };
  return { text: signal, cls: "signal-down" };
}

function fmtTrend(trend) {
  if (!trend) return { text: "--", cls: "signal-none" };
  if (trend.includes("多头")) return { text: trend, cls: "signal-up" };
  return { text: trend, cls: "signal-down" };
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container">
        <div class="modal-header">
          <div class="modal-header-left">
            <span class="tech-icon">📐</span>
            <span class="modal-title">技术分析</span>
            <span class="industry-badge">{{ stockName || '技术面' }}</span>
          </div>
          <button class="modal-close" @click="closeModal">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div v-if="!indicators" class="modal-loading">
            <span class="kline-icon">📉</span>
            <span>K 线数据不足，无法分析（至少需要 26 个交易日）</span>
          </div>

          <template v-else>
            <!-- 均线趋势 -->
            <div class="tech-section">
              <div class="tech-section-title">📊 均线趋势</div>
              <div class="tech-card">
                <div class="tech-row">
                  <span class="tech-label">趋势判断</span>
                  <span class="tech-value-lg" :class="fmtTrend(indicators.maTrend).cls">
                    {{ fmtTrend(indicators.maTrend).text }}
                  </span>
                </div>
                <div class="tech-detail">{{ indicators.maTrendDetail }}</div>
                <div class="tech-alignment">
                  <span class="tech-label">排列形态</span>
                  <span class="tech-value-lg" :class="indicators.maAlignment?.includes('多头排列') ? 'signal-up' : indicators.maAlignment?.includes('空头排列') ? 'signal-down' : 'signal-none'">
                    {{ indicators.maAlignment || '--' }}
                  </span>
                </div>
              </div>
            </div>

            <!-- MACD -->
            <div class="tech-section">
              <div class="tech-section-title">📈 MACD</div>
              <div class="tech-card">
                <div class="tech-grid">
                  <div class="tech-item">
                    <span class="tech-label">DIF</span>
                    <span class="tech-value">{{ fmt(indicators.macd?.dif) }}</span>
                  </div>
                  <div class="tech-item">
                    <span class="tech-label">DEA</span>
                    <span class="tech-value">{{ fmt(indicators.macd?.dea) }}</span>
                  </div>
                  <div class="tech-item">
                    <span class="tech-label">MACD</span>
                    <span class="tech-value" :class="(indicators.macd?.macd ?? 0) >= 0 ? 'up' : 'down'">
                      {{ fmt(indicators.macd?.macd) }}
                    </span>
                  </div>
                </div>
                <div class="tech-signal">
                  <span class="tech-label">信号</span>
                  <span class="tech-value-lg" :class="fmtSignal(indicators.macdCross).cls">
                    {{ fmtSignal(indicators.macdCross).text }}
                  </span>
                </div>
              </div>
            </div>

            <!-- KDJ -->
            <div class="tech-section">
              <div class="tech-section-title">📉 KDJ</div>
              <div class="tech-card">
                <div class="tech-grid">
                  <div class="tech-item">
                    <span class="tech-label">K</span>
                    <span class="tech-value">{{ fmt(indicators.kdj?.k) }}</span>
                  </div>
                  <div class="tech-item">
                    <span class="tech-label">D</span>
                    <span class="tech-value">{{ fmt(indicators.kdj?.d) }}</span>
                  </div>
                  <div class="tech-item">
                    <span class="tech-label">J</span>
                    <span class="tech-value">{{ fmt(indicators.kdj?.j) }}</span>
                  </div>
                </div>
                <div class="tech-signal">
                  <span class="tech-label">金叉/死叉</span>
                  <span class="tech-value-lg" :class="fmtSignal(indicators.kdjCross).cls">
                    {{ fmtSignal(indicators.kdjCross).text }}
                  </span>
                </div>
                <div class="tech-status">
                  <span class="tech-label">超买/超卖</span>
                  <span class="tech-value-lg" :class="indicators.kdjStatus?.includes('超买') ? 'signal-down' : indicators.kdjStatus?.includes('超卖') ? 'signal-up' : 'signal-none'">
                    {{ indicators.kdjStatus || '--' }}
                  </span>
                </div>
              </div>
            </div>

            <!-- WR -->
            <div class="tech-section">
              <div class="tech-section-title">📉 WR (Williams %R)</div>
              <div class="tech-card">
                <div class="tech-row">
                  <span class="tech-label">WR(14)</span>
                  <span class="tech-value-lg" :class="(indicators.wr ?? 0) <= -80 ? 'signal-up' : (indicators.wr ?? 0) >= -20 ? 'signal-down' : ''">
                    {{ indicators.wr != null ? fmt(indicators.wr) + '%' : '--' }}
                  </span>
                </div>
                <div class="tech-detail">
                  超买: ≥ -20 &nbsp;|&nbsp; 超卖: ≤ -80
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-container {
  background: var(--card-bg);
  border-radius: 16px;
  width: 520px;
  max-width: 92vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  animation: slideUp 0.2s ease;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.modal-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tech-icon {
  font-size: 22px;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.3px;
}

.industry-badge {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 20px;
  background: linear-gradient(135deg, #eef2ff, #e0e7ff);
  color: #4f46e5;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 6px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.modal-close:hover {
  background: #f3f4f6;
  color: var(--text-primary);
}

.modal-body {
  padding: 20px 24px 24px;
  overflow-y: auto;
  flex: 1;
}

.modal-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 60px 0;
  color: var(--text-muted);
  font-size: 14px;
}
.kline-icon {
  font-size: 36px;
  opacity: 0.6;
}

/* ===== 区块 ===== */
.tech-section {
  margin-bottom: 20px;
}
.tech-section:last-child {
  margin-bottom: 0;
}

.tech-section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 10px;
  padding-left: 12px;
  position: relative;
  letter-spacing: 0.3px;
}
.tech-section-title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 3px;
  border-radius: 2px;
}
.tech-section:nth-child(1) .tech-section-title::before { background: linear-gradient(180deg, #f59e0b, #f97316); }
.tech-section:nth-child(2) .tech-section-title::before { background: linear-gradient(180deg, #3b82f6, #6366f1); }
.tech-section:nth-child(3) .tech-section-title::before { background: linear-gradient(180deg, #8b5cf6, #a855f7); }
.tech-section:nth-child(4) .tech-section-title::before { background: linear-gradient(180deg, #06b6d4, #0891b2); }

.tech-card {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 12px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  transition: box-shadow 0.15s;
}
.tech-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.tech-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tech-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-bottom: 14px;
}

.tech-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 8px;
}

.tech-label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
  letter-spacing: 0.2px;
  text-transform: uppercase;
}

.tech-value {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

.tech-value-lg {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.tech-detail {
  margin-top: 10px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
  word-break: break-all;
}

.tech-signal {
  border-top: 1px solid #e8ecf1;
  padding-top: 12px;
  margin-top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tech-status {
  border-top: 1px solid #e8ecf1;
  padding-top: 12px;
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tech-alignment {
  border-top: 1px solid #e8ecf1;
  padding-top: 12px;
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ===== 信号标签 ===== */
.signal-up {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 14px;
  border-radius: 20px;
  background: #fef0ef;
  color: #dc2626;
  font-weight: 700;
  font-size: 15px;
}
.signal-down {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 14px;
  border-radius: 20px;
  background: #eafaf1;
  color: #16a34a;
  font-weight: 700;
  font-size: 15px;
}
.signal-none {
  color: var(--text-muted);
  font-weight: 600;
  font-size: 15px;
}

.up { color: #dc2626; }
.down { color: #16a34a; }
</style>
