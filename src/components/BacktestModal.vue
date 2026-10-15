<script setup>
/**
 * BacktestModal.vue — 信号回测与胜率面板
 *
 * 数据源：本地历史库（Rust db.rs）沉淀的日 K；本地不足时自动补拉远端一次（落库为旁路）。
 * 口径：日线级规则 + 固定持有期 + 非重叠交易；日内信号（T+0/量价陷阱）需分时数据，暂不参与回测。
 */
import { ref, computed, watch } from "vue";
import { useSignalBacktest, HOLD_PERIODS, MIN_SAMPLE } from "../composables/useSignalBacktest.js";

const props = defineProps({
  show: { type: Boolean, default: false },
  stock: { type: Object, default: null },
});

const emit = defineEmits(["close"]);

const { loading, syncing, error, data, stats, load, loadStats } = useSignalBacktest();

/** 当前选中的持有期（交易日） */
const hold = ref(HOLD_PERIODS[1]);

/** 按当前持有期展开的规则统计（数据不足时为空数组） */
const rows = computed(() => {
  const res = data.value;
  if (!res?.rules?.length) return [];
  return res.rules.map((rule) => ({ ...rule, stat: rule.byPeriod[hold.value] || null }));
});

/** 按胜率降序的排序视图（样本不足的排后面，避免误导） */
const sortedRows = computed(() => {
  return [...rows.value].sort((a, b) => {
    const av = a.stat?.trades >= MIN_SAMPLE ? (a.stat.winRate ?? -1) : -1;
    const bv = b.stat?.trades >= MIN_SAMPLE ? (b.stat.winRate ?? -1) : -1;
    if (bv !== av) return bv - av;
    return (b.stat?.trades || 0) - (a.stat?.trades || 0);
  });
});

/** 当前信号状态：按「现在成立 / 最近成立 / 未触发」分组，只取最近 LOOKBACK 根内出现过的 */
const LOOKBACK = 10;

const currentGroups = computed(() => {
  const res = data.value;
  if (!res?.enough || !res.rules?.length) return [];
  const active = [];
  const recent = [];
  const idle = [];
  for (const rule of res.rules) {
    const item = {
      id: rule.id,
      name: rule.name,
      hint: rule.hint,
      barsAgo: rule.barsAgo,
      lastHitDate: rule.lastHitDate,
      signalCount: rule.signalCount,
    };
    if (rule.active) active.push(item);
    else if (rule.barsAgo != null && rule.barsAgo <= LOOKBACK) recent.push(item);
    else idle.push(item);
  }
  recent.sort((a, b) => a.barsAgo - b.barsAgo);
  idle.sort((a, b) => (a.barsAgo ?? Infinity) - (b.barsAgo ?? Infinity));
  return [
    { key: "active", label: "现在成立", tone: "on", items: active },
    { key: "recent", label: `近 ${LOOKBACK} 日内出现过`, tone: "recent", items: recent },
    // 当前 K 线上不成立：既含「很久前出现过」也含「区间内从未出现」，故不叫「未触发」
    { key: "idle", label: "当前不成立", tone: "off", items: idle },
  ].filter((g) => g.items.length);
});

/** 当前成立条数（用于折叠标题） */
const activeCount = computed(
  () => data.value?.rules?.filter((r) => r.active).length || 0
);

/** 距今天数文案 */
function agoText(barsAgo) {
  if (barsAgo == null) return "区间内未出现";
  if (barsAgo === 0) return "今日";
  return `${barsAgo} 个交易日前`;
}

/** 该规则在回测区间内是否出现过（用于区分「很久前有过」与「从未出现」） */
function everFired(rule) {
  return rule.signalCount > 0;
}

/** 本地库概况文本（行数均为累计值：事件类表按保留天数清理，不是「当前生效的提醒数」） */
const dbSummary = computed(() => {
  const s = stats.value;
  if (!s) return "";
  const size = s.sizeBytes > 0 ? ` (${(s.sizeBytes / 1024).toFixed(0)} KB)` : "";
  return `本地 K 线 ${s.klineRows} 行 / ${s.klineCodes} 只，行情快照 ${s.quoteRows} 行，信号 ${s.signalRows} 条，提醒通知 ${s.alertRows} 次${size}`;
});

/** 提醒明细：累计触发次数 ≠ 当前挂着的提醒，单独一行说清楚 */
const alertSummary = computed(() => {
  const s = stats.value;
  if (!s) return "";
  if (!s.alertRows) return "提醒通知：本地从未记录到成功发出的通知";
  const parts = [`累计 ${s.alertRows} 次`];
  if (s.alertRowsToday > 0) parts.push(`今日 ${s.alertRowsToday} 次`);
  if (s.alertRowsDistinct != null && s.alertRowsDistinct !== s.alertRows) {
    parts.push(`去重后 ${s.alertRowsDistinct} 条`);
  }
  if (s.alertLastDate) parts.push(`最近 ${s.alertLastDate}`);
  return `提醒通知：${parts.join(" · ")}（累计发出次数，不是当前生效的提醒）`;
});

function pctText(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** 涨跌配色（红涨绿跌，仅用于数据展示） */
function pctColor(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return "var(--text-secondary)";
  return v > 0 ? "var(--red)" : "var(--green)";
}

/** 盈亏比 = 平均盈利 / |平均亏损| */
function payoffText(stat) {
  if (!stat?.trades || stat.avgWin == null || stat.avgLoss == null || stat.avgLoss === 0) return "—";
  const ratio = stat.avgWin / Math.abs(stat.avgLoss);
  return Number.isFinite(ratio) ? ratio.toFixed(2) : "—";
}

function winRateColor(v) {
  if (v == null) return "var(--text-muted)";
  if (v >= 55) return "var(--red)";
  if (v >= 45) return "var(--text-primary)";
  if (v >= 35) return "var(--text-secondary)";
  return "var(--green)";
}

async function reload(forceNetwork) {
  if (!props.stock?.code) return;
  await load(props.stock.code, { forceNetwork });
  loadStats();
}

// 打开时（或切换股票）加载；关闭不清理，便于快速来回切换
watch(
  () => [props.show, props.stock?.code],
  ([show]) => {
    if (show) {
      hold.value = HOLD_PERIODS[1];
      reload(false);
    }
  }
);

function switchHold(h) {
  hold.value = h;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-container">
        <div class="modal-header">
          <div class="modal-title-row">
            <span class="bt-icon">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                <path d="M2 13V3M2 13h12"/>
                <path d="M4.5 10.5 7 7.5l2 1.5L13 4"/>
              </svg>
            </span>
            <span class="modal-title">信号回测</span>
            <span class="modal-badge" v-if="stock">{{ stock.name }} ({{ stock.code }})</span>
          </div>
          <button class="btn-close" @click="emit('close')">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body bt-body">
          <!-- 数据区间 + 本地库概况 -->
          <div class="bt-meta">
            <div class="bt-meta-line">
              <span v-if="data?.enough">
                回测区间 <b>{{ data.from }}</b> ~ <b>{{ data.to }}</b>，共 <b>{{ data.bars }}</b> 根日 K
                <span class="bt-warmup">（前 {{ Math.min(60, data.bars) }} 根用于指标预热）</span>
              </span>
              <span v-else-if="!loading && !error">历史样本不足，无法回测</span>
              <span v-else-if="loading">正在读取历史数据…</span>
            </div>
            <div class="bt-meta-line bt-muted" v-if="dbSummary">{{ dbSummary }}</div>
            <div class="bt-meta-line bt-muted" v-if="alertSummary">{{ alertSummary }}</div>
          </div>

          <!-- 持有期切换 + 同步 -->
          <div class="bt-toolbar">
            <div class="bt-holds">
              <span class="bt-toolbar-label">持有期</span>
              <button
                v-for="h in HOLD_PERIODS"
                :key="h"
                class="bt-hold"
                :class="{ active: hold === h }"
                @click="switchHold(h)"
              >{{ h }} 日</button>
            </div>
            <button class="bt-sync" :disabled="syncing || loading" @click="reload(true)">
              {{ syncing ? "同步中…" : "同步更多历史" }}
            </button>
          </div>

          <div v-if="error" class="bt-error">{{ error }}</div>

          <!-- 当前信号状态（「现在」；与下方历史统计相互独立，不代表未来收益） -->
          <div class="bt-now" v-if="currentGroups.length">
            <div class="bt-now-head">
              <span class="bt-now-title">当前状态</span>
              <span class="bt-now-asof">截至 {{ data.asOf }}</span>
              <span class="bt-now-count" :class="{ hit: activeCount > 0 }">
                {{ activeCount > 0 ? `${activeCount} 条规则现在成立` : "当前无规则成立" }}
              </span>
            </div>
            <div class="bt-now-group" v-for="g in currentGroups" :key="g.key">
              <span class="bt-now-label" :class="`tone-${g.tone}`">{{ g.label }}</span>
              <div class="bt-now-items">
                <span
                  v-for="it in g.items"
                  :key="it.id"
                  class="bt-chip"
                  :class="[`tone-${g.tone}`, { never: g.tone !== 'active' && !everFired(it) }]"
                  :title="it.hint"
                >
                  {{ it.name }}
                  <em v-if="g.tone !== 'active'">{{ agoText(it.barsAgo) }}</em>
                </span>
              </div>
            </div>
          </div>

          <!-- 统计表 -->
          <table class="bt-table" v-if="sortedRows.length">
            <thead>
              <tr>
                <th class="col-name">规则</th>
                <th>信号</th>
                <th>样本</th>
                <th>胜率</th>
                <th>平均收益</th>
                <th>盈亏比</th>
                <th>最大回撤</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sortedRows" :key="row.id">
                <td class="col-name">
                  <div class="bt-rule-name">{{ row.name }}</div>
                  <div class="bt-rule-hint">{{ row.hint }}</div>
                </td>
                <td class="num">{{ row.signalCount }}</td>
                <td class="num">{{ row.stat?.trades ?? 0 }}</td>
                <td class="num">
                  <template v-if="row.stat?.trades">
                    <div class="bt-winrate">
                      <span :style="{ color: winRateColor(row.stat.winRate) }">
                        {{ row.stat.winRate.toFixed(1) }}%
                      </span>
                      <span class="bt-bar">
                        <span class="bt-bar-fill" :style="{ width: `${Math.min(100, row.stat.winRate)}%` }"></span>
                      </span>
                    </div>
                    <div class="bt-low" v-if="row.stat.trades < MIN_SAMPLE">样本不足</div>
                  </template>
                  <span v-else class="bt-muted">—</span>
                </td>
                <td class="num" :style="{ color: pctColor(row.stat?.avgRet) }">
                  {{ pctText(row.stat?.avgRet) }}
                </td>
                <td class="num bt-strong">
                  {{ payoffText(row.stat) }}
                </td>
                <td class="num bt-muted">
                  {{ row.stat?.maxDrawdown == null ? "—" : `${row.stat.maxDrawdown.toFixed(2)}%` }}
                </td>
              </tr>
            </tbody>
          </table>

          <div v-else-if="!loading && !error && !data" class="bt-empty">
            本地与远端均未取到历史日 K 数据
          </div>

          <p class="bt-note">
            口径：信号日收盘买入、持有 N 个交易日后收盘卖出，<b>持有期内不重复开仓</b>（非重叠交易）；
            胜率 = 盈利笔数 / 总笔数，平均收益 = 单笔平均涨跌幅，盈亏比 = 平均盈利 / 平均亏损（等权、未计手续费与滑点）。
            样本少于 {{ MIN_SAMPLE }} 笔的结果仅供参考。
            当前版本仅回测<b>日线级</b>规则——T+0 / 量价陷阱等日内信号依赖分时数据，不在本表范围内。
            顶部「当前状态」只表示<b>最后一根日 K</b> 上各规则是否触发，与下方持有期胜率相互独立，
            不代表该信号未来会上涨；历史表现不代表未来收益，本面板不构成投资建议。
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
@import "../assets/modal.css";
</style>

<style scoped>
.modal-container {
  width: 860px;
}

.modal-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bt-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--sky-wash);
  color: var(--ink);
}

.modal-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--fog);
  padding: 2px 10px;
  border-radius: var(--radius-full);
}

.bt-body {
  padding: 20px 24px 24px;
  overflow-y: auto;
}

/* ---- 元信息 ---- */
.bt-meta {
  margin-bottom: 14px;
}

.bt-meta-line {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.bt-meta-line b {
  color: var(--text-primary);
  font-weight: 600;
}

.bt-warmup {
  color: var(--text-muted);
  font-size: 12px;
}

.bt-muted {
  color: var(--text-muted);
}

/* ---- 工具条 ---- */
.bt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.bt-holds {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bt-toolbar-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-right: 2px;
}

.bt-hold {
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.bt-hold:hover {
  border-color: var(--ink);
  color: var(--ink);
}

.bt-hold.active {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}

.bt-sync {
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.bt-sync:hover:not(:disabled) {
  background: var(--apricot-wash);
  border-color: var(--rust);
  color: var(--rust);
}

.bt-sync:disabled {
  opacity: 0.55;
  cursor: default;
}

.bt-error {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--fog);
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 14px;
}

/* ---- 统计表 ---- */
.bt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.bt-table th {
  text-align: right;
  font-weight: 600;
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.bt-table th.col-name {
  text-align: left;
}

.bt-table td {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.bt-table tr:last-child td {
  border-bottom: none;
}

.bt-table td.num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.col-name {
  min-width: 210px;
}

.bt-strong {
  font-weight: 600;
  color: var(--text-primary);
}

.bt-rule-name {
  font-weight: 600;
  color: var(--text-primary);
}

.bt-rule-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
  line-height: 1.5;
}

/* ---- 胜率条 ---- */
.bt-winrate {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.bt-bar {
  width: 56px;
  height: 5px;
  border-radius: var(--radius-full);
  background: var(--fog);
  overflow: hidden;
  flex: none;
}

.bt-bar-fill {
  display: block;
  height: 100%;
  background: var(--ink);
}

.bt-low {
  font-size: 11px;
  color: var(--rust);
  margin-top: 2px;
}

.bt-empty {
  padding: 32px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.bt-note {
  margin: 18px 0 0;
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-muted);
}

.bt-note b {
  color: var(--text-secondary);
  font-weight: 600;
}

/* ---- 当前信号状态 ---- */
.bt-now {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin-bottom: 16px;
  background: var(--fog);
}

.bt-now-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.bt-now-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.bt-now-asof {
  font-size: 12px;
  color: var(--text-muted);
}

.bt-now-count {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: auto;
}

.bt-now-count.hit {
  color: var(--rust);
  font-weight: 600;
}

.bt-now-group {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 5px 0;
}

.bt-now-label {
  flex: none;
  width: 108px;
  font-size: 12px;
  padding-top: 3px;
  color: var(--text-muted);
}

.bt-now-label.tone-on {
  color: var(--rust);
  font-weight: 600;
}

.bt-now-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bt-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.bt-chip em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-muted);
}

.bt-chip.tone-on {
  border-color: var(--rust);
  background: var(--apricot-wash);
  color: var(--rust);
  font-weight: 600;
}

.bt-chip.tone-recent {
  color: var(--text-primary);
}

.bt-chip.tone-off {
  opacity: 0.6;
}

/* 区间内从未出现过：与「很久前出现过」区分（后者仍可能有效，只是近期没触发） */
.bt-chip.never {
  opacity: 0.4;
}

.bt-chip.never em {
  font-style: italic;
}
</style>
