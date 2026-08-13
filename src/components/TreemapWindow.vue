<script setup>
/**
 * 大盘云图独立窗口(?treemap=1 参数加载)
 *
 * 由主窗口标题栏"云图"按钮打开(系统标题栏, 可自由缩放)。
 * 数据: useMarketTreemap 8 秒轮询 Rust get_market_treemap(行业树 1h 缓存 + 实时行情 3s 缓存)。
 * 交互: 悬停色块看详情, 双击个股色块 → 发 treemap-select-stock 事件联动主窗口选中并聚焦。
 */
import { computed, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import TreemapCanvas from "./TreemapCanvas.vue";
import { useMarketTreemap } from "../composables/useMarketTreemap";

const appWindow = getCurrentWindow();

const { data, loading, error, start } = useMarketTreemap(8000);

const stats = computed(() => data.value || { up: 0, flat: 0, down: 0, time: "" });

// 加载失败时重试按钮
async function retry() {
  start(); // start() 内部会立即 load 一次
}

onMounted(() => start());

/** 双击色块 → 主窗口联动选中该股票并聚焦 */
function onSelectStock(stock) {
  if (!stock?.code) return;
  const market = stock.code.endsWith(".SH") ? "SH" : "SZ";
  emit("treemap-select-stock", { code: stock.code, market, name: stock.name || "" });
  appWindow.setFocus();
}
</script>

<template>
  <div class="treemap-window">
    <!-- 顶部统计条 -->
    <div class="tm-header">
      <div class="tm-title">
        大盘云图
        <span class="tm-sub">A股行业热力图 · 面积=流通市值 颜色=涨跌幅</span>
      </div>
      <div class="tm-stats">
        <span class="stat up">↑ 上涨 <b>{{ stats.up }}</b></span>
        <span class="stat flat">平盘 <b>{{ stats.flat }}</b></span>
        <span class="stat down">↓ 下跌 <b>{{ stats.down }}</b></span>
        <span class="tm-time" v-if="stats.time">更新 {{ stats.time }}</span>
        <span v-if="loading" class="tm-loading">刷新中…</span>
        <button v-if="error" class="tm-retry" @click="retry">重试</button>
      </div>
    </div>

    <!-- 数据加载失败提示 -->
    <div v-if="error" class="tm-error">{{ error }}</div>

    <!-- 热力图画布 -->
    <div class="tm-body">
      <TreemapCanvas :data="data" @select-stock="onSelectStock" />
    </div>

    <!-- 底部色带图例 -->
    <div class="tm-footer">
      <span class="legend-label">-4%</span>
      <div class="legend-bar"></div>
      <span class="legend-label">0%</span>
      <div class="legend-bar"></div>
      <span class="legend-label">+4%</span>
      <span class="legend-hint">双击色块可在主窗口查看</span>
    </div>
  </div>
</template>

<style scoped>
.treemap-window {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #262931;
  color: #e8eaed;
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  user-select: none;
}

/* 顶部统计条 */
.tm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid #34383f;
  flex-shrink: 0;
}
.tm-title {
  font-size: 15px;
  font-weight: 700;
}
.tm-sub {
  margin-left: 10px;
  font-size: 11px;
  font-weight: 400;
  color: #9aa0a6;
}
.tm-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
}
.stat b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.stat.up b { color: #f4554f; }
.stat.flat b { color: #c8ccd2; }
.stat.down b { color: #2fbb4e; }
.tm-time { color: #9aa0a6; }
.tm-loading { color: #6ea8fe; }
.tm-retry {
  padding: 3px 10px;
  font-size: 12px;
  color: #e8eaed;
  background: #3d4148;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.tm-retry:hover { background: #4a4f57; }

/* 错误提示 */
.tm-error {
  padding: 6px 16px;
  font-size: 12px;
  color: #f4554f;
  background: rgba(244, 85, 79, 0.1);
  border-bottom: 1px solid rgba(244, 85, 79, 0.2);
  flex-shrink: 0;
}

/* 画布区域 */
.tm-body {
  flex: 1;
  min-height: 0;
}

/* 底部图例 */
.tm-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-top: 1px solid #34383f;
  font-size: 11px;
  color: #9aa0a6;
  flex-shrink: 0;
}
.legend-label {
  font-variant-numeric: tabular-nums;
}
.legend-bar {
  width: 120px;
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(
    to right,
    #30cc5a 0%,
    #30be56 10%,
    #31894e 25%,
    #3d5451 40%,
    #414554 50%,
    #6f4552 60%,
    #9d434b 75%,
    #ce3d41 90%,
    #f63538 100%
  );
}
.legend-hint {
  margin-left: auto;
}
</style>
