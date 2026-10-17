<script setup>
/**
 * 迷你置顶盯盘小窗
 *
 * 由主窗口 TitleBar 的"迷你"按钮以 ?mini=1 参数打开（无边框、置顶、可拖动）。
 * 显示自选股实时行情，双击某只股票 → 主窗口联动选中并聚焦。
 */
import { ref, onMounted, onUnmounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { useWatchlist } from "../composables/useWatchlist";
import { useQuoteLoader } from "../composables/useQuoteLoader";
import { effectiveInterval, onIntervalModeChange } from "../utils/refreshInterval";

/** 迷你窗行情轮询间隔（窗口不可见时由 effectiveInterval 降频） */
const POLL_MS = 10000;

const appWindow = getCurrentWindow();
const { watchlist } = useWatchlist();
const { loadQuotesBatch } = useQuoteLoader();

/** 自选股 + 实时行情合并列表 */
const quotes = ref([]);
const isPinned = ref(true);
const lastUpdated = ref("");

function isHK(stock) {
  return stock.market === "HK" || /^\d{5}$/.test(stock.code || "");
}

function formatPrice(stock) {
  const price = stock.price ?? 0;
  if (!price) return "--";
  return price.toFixed(2);
}

function formatPct(stock) {
  const pct = stock.changePct ?? stock.change_pct ?? 0;
  if (pct === 0 && !stock.price) return "--";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function pctClass(stock) {
  const pct = stock.changePct ?? stock.change_pct ?? 0;
  return pct > 0 ? "up" : pct < 0 ? "down" : "flat";
}

async function refresh() {
  const codes = watchlist.value.map((s) => s.code);
  if (codes.length === 0) {
    quotes.value = [];
    return;
  }
  const data = await loadQuotesBatch(codes);
  if (!data) return;
  const quoteMap = new Map(data.map((q) => [q.code, q]));
  quotes.value = watchlist.value.map((s) => {
    const q = quoteMap.get(s.code);
    return q ? { ...s, ...q } : { ...s, price: 0, changePct: 0 };
  });
  lastUpdated.value = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function togglePin() {
  isPinned.value = !isPinned.value;
  await appWindow.setAlwaysOnTop(isPinned.value);
}

/** 双击 → 通知主窗口选中该股票 */
function selectStock(stock) {
  emit("mini-select-stock", { code: stock.code });
}

function closeMini() {
  appWindow.close();
}

let timer = null;
let unsubscribeIntervalMode = null;

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** 按当前可见性重建定时器（先清旧定时器，保证只有一份） */
function startTimer() {
  stopTimer();
  timer = setInterval(refresh, effectiveInterval(POLL_MS));
}

onMounted(() => {
  refresh();
  startTimer();
  unsubscribeIntervalMode = onIntervalModeChange(startTimer);
});
onUnmounted(() => {
  stopTimer();
  if (unsubscribeIntervalMode) unsubscribeIntervalMode();
});
</script>

<template>
  <div class="mini-app">
    <!-- 迷你标题栏（可拖动） -->
    <header class="mini-titlebar" data-tauri-drag-region>
      <div class="mini-title">
        <span class="mini-dot"></span>
        盯盘
      </div>
      <div class="mini-controls">
        <button
          class="mini-btn"
          :class="{ active: isPinned }"
          :title="isPinned ? '取消置顶' : '置顶'"
          @click="togglePin"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
            <path d="M7.5 1.5L4.5 4.5l-.3 2.2L1 9.9 2.1 11l3.2-3.2L7.5 7.5l3-3L9 3l1.5-1.5H9.6L8.4.2h-.9z"/>
          </svg>
        </button>
        <button class="mini-btn" title="关闭" @click="closeMini">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
      </div>
    </header>

    <!-- 自选股列表 -->
    <div class="mini-body">
      <div class="mini-list-header">
        <span>自选股</span>
        <span class="mini-count">{{ quotes.length }} 只</span>
      </div>

      <div v-if="quotes.length === 0" class="mini-empty">
        <p>暂无自选股</p>
        <p class="mini-empty-sub">请在主窗口添加自选股后查看</p>
      </div>

      <div v-else class="mini-list">
        <div
          v-for="stock in quotes"
          :key="stock.code"
          class="mini-item"
          :title="`双击在主窗口打开 ${stock.name}`"
          role="button"
          tabindex="0"
          @dblclick="selectStock(stock)"
          @keydown.enter="selectStock(stock)"
        >
          <div class="mini-item-left">
            <span class="mini-name">{{ stock.name }}</span>
            <span class="mini-code">
              {{ stock.code }}
              <span v-if="isHK(stock)" class="mini-hk">HK</span>
            </span>
          </div>
          <div class="mini-item-right">
            <span class="mini-price" :class="pctClass(stock)">
              {{ isHK(stock) ? "HK$" : "¥" }}{{ formatPrice(stock) }}
            </span>
            <span class="mini-pct" :class="pctClass(stock)">{{ formatPct(stock) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部刷新信息 -->
    <footer class="mini-footer">
      <span v-if="lastUpdated">更新于 {{ lastUpdated }}</span>
      <span v-else>双击股票可在主窗口打开</span>
    </footer>
  </div>
</template>

<style scoped>
.mini-app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
  font-size: 13px;
}

/* ── 标题栏 ── */
.mini-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 8px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-light);
  user-select: none;
  flex-shrink: 0;
}

.mini-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.mini-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--red);
}

.mini-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  -webkit-app-region: no-drag;
}

.mini-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.mini-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}
.mini-btn:active {
  transform: scale(0.96);
}
.mini-btn.active {
  color: var(--red);
}

/* ── 列表 ── */
.mini-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.mini-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 6px;
  font-size: 10px;
  color: var(--text-muted);
}

.mini-count {
  color: var(--text-muted);
}

.mini-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mini-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--card-bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast),
    transform var(--transition-fast);
}
.mini-item:hover {
  background: var(--hover-bg);
  border-color: var(--border);
  transform: translateY(-1px);
}
.mini-item:active {
  background: var(--hover-bg-strong);
  transform: scale(0.98);
}

.mini-item-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mini-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 110px;
}

.mini-code {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

.mini-hk {
  font-size: 9px;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--warn-bg);
  color: var(--warn-ink);
}

.mini-item-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.mini-price {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.mini-pct {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.up { color: var(--red); }
.down { color: var(--green); }
.flat { color: var(--text-secondary); }

/* ── 空状态 ── */
.mini-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  height: 100%;
  gap: 8px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
.mini-empty-sub {
  font-size: 12px;
  color: var(--text-muted);
  opacity: 0.7;
}

/* ── 底部 ── */
.mini-footer {
  flex-shrink: 0;
  padding: 8px 12px;
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
  border-top: 1px solid var(--border-light);
  background: var(--card-bg);
  user-select: none;
}
</style>
