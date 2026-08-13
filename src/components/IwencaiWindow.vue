<script setup>
/**
 * 问财选股独立窗口
 *
 * 由主窗口顶部"选股"按钮以 ?iwencai=1 参数打开独立窗口（系统标题栏）。
 * 内部复用 useIwencaiRobot 全链路：WebView 内注入 chameleon.js 生成 Cookie v
 * → 调用 Rust get_iwencai_robot → 渲染结果表格。
 * 点击结果行 → 发送 iwencai-select-stock 事件给主窗口联动选中并聚焦，随后关闭自身。
 */
import { ref, computed, reactive, onMounted, nextTick } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import {
  useIwencaiRobot,
  normalizeIwencaiResult,
  parseIwencaiCode,
} from "../composables/useIwencaiRobot";

const appWindow = getCurrentWindow();

const { data, loading, error, vError, search, warmV } = useIwencaiRobot();

const question = ref("");
const page = ref(1);
// 请求 perpage（服务端上限 100；实测 page 参数被忽略，翻页在本地进行）
const perpage = 50;
// 本地每页显示行数
const PAGE_SIZE = 20;
const inputRef = ref(null);

// 常用示例问句（点击快速填充）
const examples = [
  "非ST ，现价与一年内最低价比从小到大排列，(9:25分至9:40分成交量÷自由流通股×100)>2，实际换手率,现价>开盘价，现价>均价,量比>1,5日均价/20日均价>1,5天日均成交量/20天日均成交量>1,3天内无涨停，集中度变小，二季报盈利或二季报预告盈利或年报盈利，现价与一年内最低价比从小到大排列，市值大于50亿",
];

const normalized = computed(() => normalizeIwencaiResult(data.value));
const rowCount = computed(() => data.value?.rowCount ?? 0);
// 服务端免费接口不支持 page 翻页（实测 page=2/3 返回内容与第 1 页完全相同），
// 因此采用本地分页：一次请求 perpage=50 拉回全部行，前端按 PAGE_SIZE 切片
const localRows = computed(() => {
  const rows = normalized.value.rows;
  const start = (page.value - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
});
const totalPages = computed(() => {
  const n = normalized.value.rows.length;
  return Math.max(1, Math.ceil(n / PAGE_SIZE));
});

onMounted(() => {
  nextTick(() => inputRef.value?.focus());
  // 进入窗口立即预热问财凭证 v（chameleon.js 持续刷新，有效约 30 分钟）：
  // 避免首次搜索时才注入导致的等待，也防止窗口闲置后凭证过期
  warmV().catch(() => {
    /* 预热失败不阻塞 UI，搜索时会自动重试 */
  });
});

/** 执行搜索（第 1 页） */
function doSearch() {
  const q = question.value.trim();
  if (!q) return;
  page.value = 1;
  search(q, 1, perpage);
}

/** 翻页：本地切片切换，不再请求服务端（服务端 page 参数无效） */
function changePage(p) {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  page.value = p;
}

/** 点击行 → 通知主窗口选中股票并关闭自身 */
function onRowClick(row) {
  const parsed = parseIwencaiCode(row);
  if (!parsed) return;
  const name = String(row["股票简称"] ?? "");
  emit("iwencai-select-stock", { code: parsed.code, market: parsed.market, name });
  appWindow.close();
}

/** 本窗口会话内已加入自选的代码集合（防止重复加） */
const starred = reactive(new Set());

/** 行内股票代码（用于按钮状态判断） */
function rowCode(row) {
  const parsed = parseIwencaiCode(row);
  return parsed ? parsed.code : "";
}

/** 点击「自选」→ 通知主窗口加入自选并本地标记 */
function onAddWatchlist(row) {
  const parsed = parseIwencaiCode(row);
  if (!parsed || starred.has(parsed.code)) return;
  const name = String(row["股票简称"] ?? "");
  emit("iwencai-add-watchlist", { code: parsed.code, market: parsed.market, name });
  starred.add(parsed.code);
}

/** 单元格显示：空值 → --；数值列按列类型/单位格式化（长小数、大数读起来更直观） */
function cellText(v, col) {
  if (v === null || v === undefined || v === "") return "--";
  if (col?.type === "DOUBLE" || typeof v === "number") {
    const num = Number(v);
    if (Number.isFinite(num)) {
      const abs = Math.abs(num);
      if (abs >= 1e8) return (num / 1e8).toFixed(2) + "亿";
      if (abs >= 1e4) return (num / 1e4).toFixed(2) + "万";
      return Number.isInteger(num) ? String(num) : num.toFixed(2);
    }
  }
  return String(v);
}
</script>

<template>
  <div class="iwencai-window">
    <!-- 顶部工具条 -->
    <header class="toolbar">
      <div class="toolbar-left">
        <span class="toolbar-badge">问财</span>
        <span class="toolbar-title">智能选股</span>
      </div>
      <button
        class="search-btn"
        :disabled="loading || !question.trim()"
        @click="doSearch"
      >
        <span v-if="loading" class="spinner"></span>
        {{ loading ? "查询中…" : "查询" }}
      </button>
    </header>

    <div class="iwencai-body">
      <!-- 问句输入区 -->
      <section class="query-card">
        <textarea
          ref="inputRef"
          v-model="question"
          class="query-input"
          rows="4"
          placeholder="输入选股条件，如：非ST，市值大于50亿，量比大于1…"
          @keydown.enter.exact.prevent="doSearch"
        ></textarea>
        <div class="query-actions">
          <div class="query-examples">
            <span class="example-label">试试：</span>
            <button
              v-for="ex in examples"
              :key="ex"
              class="example-chip"
              @click="question = ex"
            >{{ ex }}</button>
          </div>
        </div>
      </section>

      <!-- v 凭证错误提示 -->
      <div v-if="vError" class="error-banner">
        <span class="error-icon">⚠️</span>
        <span class="error-text">无法获取问财验证凭证，请检查网络后重试</span>
      </div>

      <!-- 查询错误提示 -->
      <div v-else-if="error" class="error-banner">
        <span class="error-icon">⚠️</span>
        <span class="error-text">{{ error }}</span>
      </div>

      <!-- 结果区 -->
      <section v-if="data" class="result-card">
        <div class="result-meta">
          <span class="result-count">共 <b>{{ rowCount }}</b> 条结果</span>
          <span v-if="normalized.rows.length < rowCount" class="result-hint">
            仅加载前 {{ normalized.rows.length }} 条（免费接口限制）
          </span>
          <span class="result-page">第 {{ page }} / {{ totalPages }} 页</span>
        </div>
        <div class="result-table-wrap">
          <table class="result-table">
            <thead>
              <tr>
                <th v-for="col in normalized.columns" :key="col.key">
                  {{ col.name }}
                </th>
                <th class="th-sticky">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in localRows"
                :key="i"
                class="result-row"
                @click="onRowClick(row)"
              >
                <td v-for="col in normalized.columns" :key="col.key">
                  {{ cellText(row[col.key], col) }}
                </td>
                <td class="td-sticky">
                  <button
                    class="star-btn"
                    :class="{ added: starred.has(rowCode(row)) }"
                    @click.stop="onAddWatchlist(row)"
                  >{{ starred.has(rowCode(row)) ? "✓ 已加" : "★ 自选" }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- 分页 -->
        <div class="pagination">
          <button class="page-btn" :disabled="page <= 1" @click="changePage(page - 1)">‹ 上一页</button>
          <span class="page-info">{{ page }} / {{ totalPages }}</span>
          <button class="page-btn" :disabled="page >= totalPages" @click="changePage(page + 1)">下一页 ›</button>
        </div>
      </section>

      <!-- 空状态 -->
      <div v-else-if="!loading && !error" class="empty-state">
        <div class="empty-icon">🔍</div>
        <p class="empty-title">输入选股条件开始查询</p>
        <p class="empty-sub">点击结果行可联动主窗口查看个股详情</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 浅色 Steep 设计系统（与主窗口一致） */
.iwencai-window {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--text-primary);
  font-size: 14px;
  letter-spacing: -0.009em;
  padding: 16px;
  gap: 14px;
}

/* ===== 顶部工具条 ===== */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toolbar-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--rust);
  background: var(--apricot-wash);
  padding: 3px 10px;
  border-radius: var(--radius-full);
}

.toolbar-title {
  font-size: 16px;
  font-weight: 600;
}

.search-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 24px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--ink);
  color: var(--white);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.search-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.search-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.search-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* ===== 主体 ===== */
.iwencai-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

/* ===== 问句输入卡 ===== */
.query-card {
  padding: 14px 16px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  flex-shrink: 0;
}

.query-input {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  min-height: 96px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
  font-family: inherit;
  letter-spacing: -0.009em;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.query-input:focus {
  border-color: var(--dove);
  box-shadow: 0 0 0 3px rgba(163, 166, 175, 0.15);
}

.query-input::placeholder {
  color: var(--slate);
}

.query-actions {
  margin-top: 10px;
}

.query-examples {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.example-label {
  color: var(--text-muted);
  font-size: 12px;
}

.example-chip {
  padding: 4px 14px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.example-chip:hover {
  border-color: var(--rust);
  color: var(--rust);
  background: rgba(93, 42, 26, 0.04);
}

/* ===== 错误横幅（复用 modal.css 视觉） ===== */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(220, 38, 38, 0.06);
  border: 1px solid rgba(220, 38, 38, 0.18);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.error-icon {
  font-size: 13px;
}

.error-text {
  font-size: 13px;
  color: #dc2626;
  line-height: 1.4;
}

/* ===== 结果卡 ===== */
.result-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px 16px 12px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.result-meta {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 12px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.result-count b {
  color: var(--text-primary);
  font-weight: 600;
}

.result-hint {
  color: var(--rust);
  font-size: 12px;
}

.result-table-wrap {
  flex: 1;
  overflow: auto;
  min-height: 0;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.result-table {
  /* 内容不足时撑满容器，内容超宽时自然扩展（外层 wrap 横向滚动） */
  width: max-content;
  min-width: 100%;
  /* collapse 与 sticky 不兼容（滚动时边框错位），改用 separate */
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12.5px;
}

.result-table th {
  position: sticky;
  top: 0;
  /* 高于 td-sticky(z1)：垂直滚动时表头不被数据行覆盖 */
  z-index: 2;
  background: var(--fog);
  color: var(--text-secondary);
  font-weight: 600;
  text-align: left;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.result-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-light);
  white-space: nowrap;
  color: var(--text-primary);
}

.result-table tbody tr:last-child td {
  border-bottom: none;
}

.result-row {
  cursor: pointer;
  transition: background 0.12s;
}

.result-row:hover {
  background: rgba(93, 42, 26, 0.05);
}

/* ===== 固定操作列（加入自选） ===== */
/* 层级：th(2) < th-sticky(3)（表头最高，水平+垂直滚动都不被盖）；td-sticky(1) 仅水平滚动粘右 */
.th-sticky {
  position: sticky;
  right: 0;
  z-index: 3;
  background: var(--fog);
  box-shadow: -1px 0 0 var(--border-light);
}

.td-sticky {
  position: sticky;
  right: 0;
  z-index: 1;
  background: var(--card-bg);
  box-shadow: -1px 0 0 var(--border-light);
}

.result-row:hover .td-sticky {
  background: rgba(93, 42, 26, 0.05);
}

.star-btn {
  padding: 3px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.star-btn:hover {
  border-color: var(--rust);
  color: var(--rust);
  background: rgba(93, 42, 26, 0.04);
}

.star-btn.added {
  border-color: rgba(39, 174, 96, 0.35);
  color: var(--green);
  background: rgba(39, 174, 96, 0.06);
  cursor: default;
}

/* ===== 分页 ===== */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding-top: 12px;
  flex-shrink: 0;
}

.page-btn {
  padding: 5px 16px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.page-btn:hover:not(:disabled) {
  border-color: var(--rust);
  color: var(--rust);
  background: rgba(93, 42, 26, 0.04);
}

.page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.page-info {
  color: var(--text-muted);
  font-size: 12px;
}

/* ===== 空状态 ===== */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 6px;
}

.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-sub {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
