<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";

const props = defineProps({
  watchlist: { type: Array, default: () => [] },
});

const emit = defineEmits(["select-stock", "remove-stock"]);

const hotList = ref([]);
const loading = ref(false);
const error = ref("");
const selectedCode = ref("");

async function loadHotList() {
  loading.value = true;
  error.value = "";
  try {
    const data = await invoke("get_hot_list");
    hotList.value = data.stock_list || [];
  } catch (e) {
    error.value = String(e);
    console.error("获取热榜数据失败:", e);
  } finally {
    loading.value = false;
  }
}

function selectStock(item) {
  selectedCode.value = item.code;
  // 已是自选股 → 取消自选，不改变右侧面板
  if (isInWatchlist(item.code)) {
    emit("remove-stock", item.code);
    return;
  }
  // 非自选 → 选中并显示到右侧
  const stock = {
    code: item.code,
    name: item.name,
    price: 0,
    change: 0,
    changePct: item.rise_and_fall,
    open: 0,
    high: 0,
    low: 0,
    prevClose: 0,
    volume: 0,
    turnover: 0,
    turnoverRate: 0,
    pe: 0,
    amplitude: 0,
  };
  emit("select-stock", stock);
}

function rankChgText(chg) {
  if (chg > 0) return `↑${chg}`;
  if (chg < 0) return `↓${Math.abs(chg)}`;
  return "—";
}

function rankChgClass(chg) {
  if (chg > 0) return "rank-up";
  if (chg < 0) return "rank-down";
  return "rank-flat";
}

function marketLabel(market) {
  return market === 17 ? "SH" : "SZ";
}

function isInWatchlist(code) {
  return props.watchlist.some((s) => s.code === code);
}

let refreshTimer;

onMounted(() => {
  loadHotList();
  // 每 60 秒刷新
  refreshTimer = setInterval(loadHotList, 60000);
});

onUnmounted(() => {
  clearInterval(refreshTimer);
});
</script>

<template>
  <div class="hotlist-section">
    <div class="list-header">
      <span class="list-title">热榜</span>
      <button class="hot-refresh-btn" :class="{ loading }" @click="loadHotList" :disabled="loading">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 8a6 6 0 0 1 10.47-4M14 8a6 6 0 0 1-10.47 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M13.5 2v4h-4M2.5 14v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="stock-list">
      <div v-if="loading" class="hot-loading">
        <span class="hot-spinner"></span>
        <span>加载中...</span>
      </div>

      <div v-else-if="error" class="hot-error">
        <span>{{ error }}</span>
      </div>

      <template v-else>
        <div
          v-for="item in hotList"
          :key="item.code"
          class="stock-item"
          :class="{
            active: selectedCode === item.code,
            'in-watchlist': isInWatchlist(item.code),
          }"
          @click="selectStock(item)"
        >
          <div class="hot-rank-col">
            <span class="hot-rank-num" :class="{ 'rank-top': item.order <= 3 }">{{ item.order }}</span>
          </div>
          <div class="item-left">
            <div class="hot-name-row">
              <span class="item-name">{{ item.name }}</span>
              <span class="item-code">{{ item.code }}</span>
              <span class="hot-market" :class="item.market === 17 ? 'market-sh' : 'market-sz'">{{ marketLabel(item.market) }}</span>
            </div>
            <div class="hot-tags" v-if="item.tags?.length">
              <span class="hot-tag" v-for="tag in item.tags.slice(0, 2)" :key="tag">{{ tag }}</span>
              <span v-if="item.popularity_tag" class="hot-pop-tag">{{ item.popularity_tag }}</span>
            </div>
          </div>
          <div class="item-right">
            <span class="item-change" :class="item.rise_and_fall >= 0 ? 'up' : 'down'">
              {{ item.rise_and_fall > 0 ? '+' : '' }}{{ item.rise_and_fall.toFixed(2) }}%
            </span>
            <span class="hot-rank-chg" :class="rankChgClass(item.hot_rank_chg)">
              {{ rankChgText(item.hot_rank_chg) }}
            </span>
          </div>
        </div>

        <div v-if="hotList.length === 0" class="empty-state">
          暂无数据
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ===== Steep: 热榜 ===== */
.hotlist-section {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--border-light);
}

.list-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.009em;
}

.hot-refresh-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.hot-refresh-btn:hover {
  color: var(--ink);
  border-color: var(--ink);
}
.hot-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hot-refresh-btn.loading svg {
  animation: spin 0.8s linear infinite;
}

.stock-list {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex: 1;
}

.stock-item {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
}

.stock-item:hover {
  background: var(--fog);
}

.stock-item.active {
  background: var(--apricot-wash);
}

.stock-item.in-watchlist {
  background: rgba(93, 42, 26, 0.04);
}

.stock-item.in-watchlist .item-name {
  color: var(--rust);
}

.stock-item.in-watchlist .hot-rank-num {
  color: var(--rust);
}

.stock-item.in-watchlist.active {
  background: var(--apricot-wash);
}

.stock-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  background: var(--rust);
  border-radius: 0 2px 2px 0;
}

.stock-item + .stock-item {
  border-top: 1px solid var(--border-light);
}

/* 排名列 */
.hot-rank-col {
  display: flex;
  align-items: center;
  justify-content: center;
}

.hot-rank-num {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-muted);
  min-width: 24px;
  text-align: center;
}

.hot-rank-num.rank-top {
  color: var(--rust);
  font-size: 15px;
}

/* 名称行 */
.item-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  min-width: 0;
}

.hot-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.item-name {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-code {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  flex-shrink: 0;
}

.hot-market {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.market-sh {
  background: var(--sky-wash);
  color: #2563eb;
}
.market-sz {
  background: var(--apricot-wash);
  color: var(--rust);
}

/* 标签行 */
.hot-tags {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.hot-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--fog);
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
}

.hot-pop-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--apricot-wash);
  color: var(--rust);
  font-weight: 500;
  white-space: nowrap;
}

/* 右侧 */
.item-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.item-change {
  font-size: 13px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 4px;
  min-width: 58px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.item-change.up {
  color: var(--red);
  background: var(--red-bg);
}

.item-change.down {
  color: var(--green);
  background: var(--green-bg);
}

/* 排名变化 */
.hot-rank-chg {
  font-size: 13px;
  font-weight: 600;
  min-width: 32px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.rank-up { color: var(--red); }
.rank-down { color: var(--green); }
.rank-flat { color: var(--text-muted); }

/* 加载 & 错误 & 空状态 */
.hot-loading,
.hot-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 13px;
}

.hot-error {
  color: var(--red);
  text-align: center;
  word-break: break-all;
}

.hot-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
