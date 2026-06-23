<script setup>
import { onMounted, computed } from "vue";
import { useIwencaiData } from "../composables/useIwencaiData";

const props = defineProps({
  /** 传入已加载的外部数据，优先级高于内部加载 */
  externalData: { type: Array, default: null },
  /** 检查股票是否已在自选股中 */
  isInWatchlist: { type: Function, default: () => false },
});

const emit = defineEmits(["select-stock", "add-watchlist"]);

const { list, loading, error, loadData, getVal, findKey } = useIwencaiData();

// 合并外部数据或内部数据
const displayList = computed(() => props.externalData || list.value);

// 按涨跌幅排序（API 已按从高到低返回，这里保持顺序）
const sortedList = computed(() => displayList.value);

/** 格式化涨跌幅 */
function fmtChgPct(v) {
  if (v == null || v === "") return "--";
  const n = Number(v);
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

/** 格式化市值 */
function fmtMarketCap(v) {
  if (v == null || v === "") return "--";
  const n = Number(v);
  if (n >= 1e8) return (n / 1e8).toFixed(1) + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
  return n.toLocaleString();
}

/** 格式化股本 */
function fmtShares(v) {
  if (v == null || v === "") return "--";
  const n = Number(v);
  if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
  return n.toLocaleString();
}

/** 读取股票代码（支持 code 或 股票代码 字段） */
function getCode(row) {
  return row["股票代码"] || row["code"] || row["market_code"] || "--";
}

/** 读取股票名称 */
function getName(row) {
  return row["股票简称"] || "--";
}

/** 读取最新价 */
function getPrice(row) {
  const v = row["最新价"];
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

/** 读取涨跌幅（支持最新涨跌幅 和 涨跌幅:前复权[日期] 两种字段） */
function getChangePct(row) {
  const v = row["最新涨跌幅"] ?? getVal(row, "涨跌幅");
  if (v == null || v === "") return null;
  const s = String(v).replace(/%/g, "").trim();
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  // 安全兜底：涨跌幅超过 ±100% 不合逻辑，可能是误匹配到排名值
  if (Math.abs(n) > 100) {
    const v2 = getVal(row, "涨跌幅:前复权");
    if (v2 != null && v2 !== v) {
      const s2 = String(v2).replace(/%/g, "").trim();
      const n2 = parseFloat(s2);
      if (!isNaN(n2) && Math.abs(n2) <= 100) return n2;
    }
    return null;
  }
  return n;
}

/** 读取总市值 */
function getMarketCap(row) {
  return getVal(row, "总市值");
}

/** 读取总股本 */
function getTotalShares(row) {
  return getVal(row, "总股本");
}

/** 读取行业 */
function getIndustry(row) {
  return getVal(row, "所属同花顺行业") || getVal(row, "行业") || "";
}

/** 读取技术形态 */
function getTechPattern(row) {
  return getVal(row, "技术形态");
}

/** 从行数据提取标准股票对象 */
function toStockInfo(row) {
  return {
    code: getCode(row),
    name: getName(row),
    price: getPrice(row) ?? 0,
    change: getChangePct(row) ?? 0,
    changePct: getChangePct(row) ?? 0,
    market: row["股票市场类型"] || "",
  };
}

function handleRowClick(stock) {
  emit("select-stock", toStockInfo(stock));
}

onMounted(() => {
  if (!props.externalData) {
    loadData();
  }
});
</script>

<template>
  <section class="screener">
    <!-- 标题栏 -->
    <div class="screener-header">
      <div class="screener-title">
        <h2>选股结果</h2>
        <span class="screener-count">共 {{ sortedList.length }} 只</span>
      </div>
      <div class="screener-legend">
        <span class="legend-item">
          <span class="legend-dot dot-up"></span>上涨
        </span>
        <span class="legend-item">
          <span class="legend-dot dot-down"></span>下跌
        </span>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="screener-loading">
      <span class="loading-spinner"></span>
      <span>加载选股数据中...</span>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="screener-error">
      <p>{{ error }}</p>
      <button class="btn-retry" @click="loadData()">重试</button>
    </div>

    <!-- 空状态 -->
    <div v-else-if="sortedList.length === 0" class="screener-empty">
      暂无数据，请先运行选股
    </div>

    <!-- 表格 -->
    <div v-else class="screener-table-wrap">
      <table class="screener-table">
        <thead>
          <tr>
            <th class="col-rank">#</th>
            <th class="col-code">代码</th>
            <th class="col-name">名称</th>
            <th class="col-price">最新价</th>
            <th class="col-chg">涨跌幅</th>
            <th class="col-cap">总市值</th>
            <th class="col-shares">总股本</th>
            <th class="col-action">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in sortedList"
            :key="getCode(row)"
            class="screener-row"
            @click="handleRowClick(row)"
          >
            <td class="col-rank">{{ idx + 1 }}</td>
            <td class="col-code">
              <span class="code-text">{{ getCode(row) }}</span>
            </td>
            <td class="col-name">
              <span class="name-text">{{ getName(row) }}</span>
            </td>
            <td class="col-price">
              <span class="price-text">{{ getPrice(row) != null ? getPrice(row).toFixed(2) : "--" }}</span>
            </td>
            <td class="col-chg">
              <span
                class="chg-text"
                :class="getChangePct(row) != null ? (getChangePct(row) >= 0 ? 'up' : 'down') : ''"
              >
                {{ getChangePct(row) != null ? fmtChgPct(getChangePct(row)) : "--" }}
              </span>
            </td>
            <td class="col-cap">{{ fmtMarketCap(getMarketCap(row)) }}</td>
            <td class="col-shares">{{ fmtShares(getTotalShares(row)) }}</td>
            <td class="col-action" @click.stop>
              <button
                v-if="!props.isInWatchlist(getCode(row))"
                class="btn-add-watch"
                @click="emit('add-watchlist', toStockInfo(row))"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
                自选
              </button>
              <span v-else class="added-badge">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                已加
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
/* ===== Screener 页面 — Steep 设计语言 ===== */
.screener {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  animation: fadeIn 0.3s ease;
}

.screener-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.screener-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.screener-title h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: -0.02em;
}

.screener-count {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 500;
}

.screener-legend {
  display: flex;
  gap: 16px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-up { background: var(--red); }
.dot-down { background: var(--green); }

/* 加载 */
.screener-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 14px;
}

.loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* 错误 & 空状态 */
.screener-error,
.screener-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
  font-size: 14px;
}

.btn-retry {
  padding: 8px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-retry:hover {
  border-color: var(--ink);
  color: var(--ink);
}

/* ===== 表格容器 ===== */
.screener-table-wrap {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  background: var(--card-bg);
  box-shadow: var(--shadow-card);
}

.screener-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  white-space: nowrap;
}

/* ===== 表头 ===== */
.screener-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
}

.screener-table th {
  background: var(--fog);
  color: var(--text-muted);
  font-weight: 600;
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0.02em;
  padding: 12px 14px;
  text-align: right;
  border-bottom: 1px solid var(--border);
}

.screener-table th:first-child,
.screener-table th:nth-child(2),
.screener-table th:nth-child(3) {
  text-align: left;
}

/* ===== 列宽 ===== */
.col-rank { width: 48px; min-width: 48px; }
.col-code { width: 110px; min-width: 110px; }
.col-name { width: 100px; min-width: 90px; }
.col-price { width: 90px; min-width: 80px; }
.col-chg { width: 90px; min-width: 80px; }
.col-cap { width: 100px; min-width: 90px; }
.col-shares { width: 90px; min-width: 80px; }

.col-action { width: 70px; min-width: 70px; text-align: center; }

/* ===== 行 ===== */
.screener-row {
  cursor: pointer;
  transition: background 0.12s;
}

.screener-row:hover {
  background: var(--fog);
}

.screener-row td {
  padding: 10px 14px;
  text-align: right;
  border-bottom: 1px solid var(--border-light);
  font-variant-numeric: tabular-nums;
}

.screener-row td:first-child,
.screener-row td:nth-child(2),
.screener-row td:nth-child(3) {
  text-align: left;
}

/* 排名 */
.col-rank {
  color: var(--text-muted);
  font-size: 12px;
}

/* 代码 */
.code-text {
  font-family: "SF Mono", "Menlo", "Consolas", monospace;
  font-size: 12px;
  color: var(--text-secondary);
  letter-spacing: -0.01em;
}

/* 名称 */
.name-text {
  font-weight: 500;
  color: var(--text-primary);
}

/* 最新价 */
.price-text {
  font-weight: 500;
}

/* 涨跌幅 */
.chg-text {
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 13px;
}

.chg-text.up {
  color: var(--red);
  background: var(--red-bg);
}

.chg-text.down {
  color: var(--green);
  background: var(--green-bg);
}

/* 加入自选按钮 */
.btn-add-watch {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 10px;
  border: 1px solid var(--border, #ddd);
  border-radius: 9999px;
  background: transparent;
  color: var(--text-secondary, #555);
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn-add-watch:hover {
  border-color: var(--rust, #5d2a1a);
  color: var(--rust, #5d2a1a);
  background: var(--apricot-wash, #fbe1d1);
}

/* 已加标记 */
.added-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 9999px;
  background: var(--sky-wash, #d3e3fc);
  color: #2b4f8c;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
</style>
