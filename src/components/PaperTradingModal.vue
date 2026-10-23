<script setup>
/**
 * PaperTradingModal.vue — 选股驱动 · 每日向前累积 的模拟盘面板
 *
 * 三段式（与用户选定的方案一致）：
 *   选股池（问财筛选结果 / 手动加 / 每日定时自动跑策略） → 每个交易日收盘跑日线规则 → 次日开盘撮合
 *
 * 「自动选股」标签页只管**配置与触发**：定时判定与跑批逻辑在
 * `usePaperAutoRun.js`（调度）+ `utils/paperAuto.js`（纯逻辑），本组件不重算口径。
 *
 * 与 BacktestModal 的口径差异（PROJECT.md §7.19，面板必须如实披露）：
 *   BacktestModal：信号日收盘买入、持有 N 日收盘卖出、**不计费用**
 *   本面板      ：信号日收盘出单、**次日开盘价 + 滑点**成交、**计全额费用（含最低佣金 5 元）**
 *   两者数字不可直接比较，本面板会更"难看"，这是它的价值。
 *
 * 数据全部来自 `usePaperAccount`（唯一真源，本组件不直接 invoke、不重算口径）。
 *
 * null 口径：所有可能缺失的数值（totalReturn / maxDrawdown / winRate）一律显示 `--`，
 * 绝不渲染 NaN / null / Infinity。样本 < 10 笔的胜率必须标「样本不足」（§7.26）。
 */
import { ref, computed, watch } from "vue";
import { usePaperAccount } from "../composables/usePaperAccount.js";
import { usePaperAutoRun, AUTO_RETRY_MS } from "../composables/usePaperAutoRun.js";
import { signChar, trendClass } from "../utils/format.js";
import { DEFAULT_CONFIG } from "../utils/paperEngine.js";
import { DEFAULT_AUTO_CONFIG, describeAutoResult, normalizeTime } from "../utils/paperAuto.js";

const props = defineProps({
  show: { type: Boolean, default: false },
});

const emit = defineEmits(["close", "open-detail"]);

const pa = usePaperAccount();
// 解构后模板里自动解包 ref（不经对象访问就不需要 .value）
const {
  account,
  pool,
  positions,
  summary,
  today,
  running,
  error,
  stale,
  diagnostics,
  addToPool,
  removeFromPool,
  clearPool,
  reloadPool,
  runForward,
  updateConfig,
  resetAccount,
  clearAll,
  autoConfig,
  autoRunning,
  lastAuto,
  updateAutoConfig,
  setStrategies,
} = pa;
// 自动运行的调度器：面板里的「立即执行一次」和「最近判断」都走它（与定时任务同一份逻辑）
const autoRun = usePaperAutoRun();

/** 当前标签页 */
const tab = ref("overview");
const TABS = [
  { id: "overview", label: "总览" },
  { id: "positions", label: "持仓" },
  { id: "trades", label: "成交" },
  { id: "pool", label: "选股池" },
  { id: "auto", label: "自动选股" },
  { id: "runs", label: "运行日志" },
  { id: "settings", label: "配置" },
];

/** 手动加池的输入 */
const manualCode = ref("");
const manualName = ref("");
const poolHint = ref("");

/** 运行结果提示（一次性） */
const runHint = ref("");

/** 需要二次确认的危险操作：'reset' | 'clear' | '' */
const confirming = ref("");

// ── 格式化 ────────────────────────────────────────────
/** 金额千分位（人民币元，2 位）—— 与 utils/format 的 fmtMoney（输入万元）口径不同，故本地实现 */
function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 带符号金额 */
function signedMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return signChar(n) + (n < 0 ? "-" : "") + money(Math.abs(n));
}

/** 带符号百分比；null/NaN/Infinity → "--" */
function pctText(v, digits = 2) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return (n > 0 ? "+" : "") + n.toFixed(digits) + "%";
}

/** 纯百分比（不带 +） */
function rateText(v, digits = 1) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(digits) + "%";
}

/** 股数（千分位） */
function sharesText(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("zh-CN") : "--";
}

/** 价格（元/股，固定小数位，缺失 → "--"）；模拟盘价格一律两位，成本价另用三位 */
function priceText(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

// ── 派生数据 ──────────────────────────────────────────
/** 净值曲线 SVG 折线点（无数据返回空串） */
const navPolyline = computed(() => {
  const rows = account.value?.nav || [];
  if (rows.length < 2) return "";
  const values = rows.map((r) => Number(r.equity) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 100;
  const H = 30;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / span) * H;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
});

/** 净值曲线是否上涨（决定线色） */
const navUp = computed(() => {
  const rows = account.value?.nav || [];
  if (rows.length < 2) return null;
  return (Number(rows[rows.length - 1].equity) || 0) >= (Number(rows[0].equity) || 0);
});

/** 成交明细（最新在前） */
const tradeRows = computed(() =>
  (account.value?.trades || []).slice().reverse().slice(0, 200)
);

/** 运行日志（最新在前） */
const runRows = computed(() =>
  (account.value?.runs || []).slice().reverse().slice(0, 120)
);

/** 待成交委托 */
const pendingRows = computed(() => account.value?.pending || []);

/** 最近一次运行 */
const lastRun = computed(() => {
  const runs = account.value?.runs || [];
  return runs.length ? runs[runs.length - 1] : null;
});

/** 池内取数诊断（池中每只票一根状态条） */
const diagRows = computed(() => {
  const d = diagnostics.value || {};
  return pool.value.map((p) => ({
    ...p,
    diag: d[p.code] || null,
  }));
});

// ── 自动选股 ──────────────────────────────────────────
/** 策略编辑草稿（新增一行用；编辑既有行直接改 autoConfig.strategies） */
const newQuestion = ref("");
const autoHint = ref("");

/** 最近一次自动运行的可读文案 */
const autoResultText = computed(() => {
  const r = lastAuto.value;
  if (!r) return "";
  if (r.error) return r.error;
  return describeAutoResult(r);
});

/** 调度器最近的判断（回答「为什么今天还没跑」） */
const autoCheckText = computed(() => autoRun.lastCheck.value?.reason || "");

/** 策略列表的本地副本（template 里 v-for 遍历 + 就地编辑/删除） */
const strategyRows = computed(() => autoConfig.value.strategies || []);

/** 启用的策略条数（0 条时定时任务必然空转，须在 UI 上明确提示） */
const enabledStrategyCount = computed(
  () => strategyRows.value.filter((s) => s.enabled !== false && s.question).length
);

function setAuto(patch) {
  updateAutoConfig(patch);
}

function commitAutoTime(raw) {
  const t = normalizeTime(raw);
  if (!t) {
    autoHint.value = "运行时刻格式应为 HH:mm（如 15:30）";
    return;
  }
  autoHint.value = "";
  updateAutoConfig({ time: t });
}

function addStrategy() {
  const q = newQuestion.value.trim();
  if (!q) {
    autoHint.value = "请输入问财策略语句（如「连续三年ROE大于15%」）";
    return;
  }
  if (strategyRows.value.some((s) => s.question === q)) {
    autoHint.value = "该策略语句已存在";
    return;
  }
  if (strategyRows.value.length >= 10) {
    autoHint.value = "最多保存 10 条策略";
    return;
  }
  const nextId = `s${Date.now().toString(36)}`;
  setStrategies([...strategyRows.value, { id: nextId, question: q, enabled: true }]);
  newQuestion.value = "";
  autoHint.value = "";
}

function removeStrategy(id) {
  setStrategies(strategyRows.value.filter((s) => s.id !== id));
}

function toggleStrategy(id) {
  setStrategies(
    strategyRows.value.map((s) => (s.id === id ? { ...s, enabled: s.enabled === false } : s))
  );
}

/** 立即跑一次（跳过时刻判断，用于验证策略是否有效；不占用当天的定时名额） */
async function runAutoNow() {
  autoHint.value = "";
  const res = await autoRun.trigger(new Date(), true);
  if (!res) {
    autoHint.value = "自动运行正在进行中，请稍候";
    return;
  }
  autoHint.value = res.error ? res.error : describeAutoResult(res);
  // 池可能被自动任务改过，面板里的池同步一次
  reloadPool();
}

// ── 交互 ──────────────────────────────────────────────
/** 打开面板：先从 localStorage 同步一次选股池（问财是独立窗口，跨窗口不共享响应式状态） */
watch(
  () => props.show,
  (open) => {
    if (!open) {
      confirming.value = "";
      return;
    }
    reloadPool();
    runHint.value = "";
  },
  { immediate: true }
);

async function doRun(force = false) {
  runHint.value = "";
  const res = await runForward({ force });
  if (res.busy) {
    runHint.value = "正在运行中，请稍候";
    return;
  }
  if (res.upToDate) {
    runHint.value = "已是最新交易日，没有新的数据可跑（今日收盘后或补充 K 线后再试）";
    return;
  }
  if (res.days > 0) {
    const buys = res.reports.reduce((s, r) => s + r.filled.filter((f) => f.side === "buy").length, 0);
    const sells = res.reports.reduce((s, r) => s + r.filled.filter((f) => f.side === "sell").length, 0);
    runHint.value = `向前累积 ${res.days} 个交易日：成交 ${buys} 买 / ${sells} 卖`;
  } else if (!pa.error.value) {
    runHint.value = "本次没有可运行的交易日";
  }
}

function submitManual() {
  const code = manualCode.value.trim();
  if (!/^\d{6}$/.test(code)) {
    poolHint.value = "请输入 6 位 A 股代码（模拟盘不做港股/北交所之外的市场）";
    return;
  }
  const added = addToPool([{ code, name: manualName.value.trim(), source: "manual" }]);
  if (!added.length) {
    poolHint.value = "该代码已在选股池中";
    return;
  }
  manualCode.value = "";
  manualName.value = "";
  poolHint.value = "";
}

function confirmThen(action) {
  if (confirming.value !== action) {
    confirming.value = action;
    return;
  }
  confirming.value = "";
  runHint.value = "";
  if (action === "reset") resetAccount();
  else if (action === "clear") clearAll();
}

function openDetail(code) {
  if (code) emit("open-detail", code);
}

/** 配置项输入（数字类，失焦/回车时提交） */
function commitNumber(key, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  if (key === "initialCash") {
    // 初始资金只在空账户时可改（有流水后改基准会让收益率失真）
    if ((account.value.trades || []).length > 0) {
      runHint.value = "已有成交流水，初始资金不可再改（会破坏收益率基准）；如需重来请「重置账户」";
      return;
    }
  }
  updateConfig({ [key]: n });
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-container paper-container">
        <div class="modal-header">
          <div class="modal-header-left">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--rust)" stroke-width="1.5">
              <path d="M2 17h16" stroke-linecap="round"/>
              <path d="M3 13l4-4 3 2.5L17 5" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="17" cy="5" r="1.6" fill="var(--rust)" stroke="none"/>
            </svg>
            <span class="modal-title">模拟盘</span>
            <span class="mode-pill">选股驱动 · 每日向前累积</span>
            <span v-if="autoConfig.enabled" class="auto-pill">每日 {{ autoConfig.time }} 自动</span>
            <span v-if="stale" class="stale-pill">数据不完整</span>
          </div>
          <button class="modal-close" @click="emit('close')" title="关闭">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- ══ 工具条：运行 + 关键指标 ══ -->
          <div class="run-bar">
            <div class="run-left">
              <button class="run-btn" :disabled="running || !pool.length" @click="doRun(false)">
                <span v-if="running" class="spinner"></span>
                {{ running ? "运行中…" : "运行到最新" }}
              </button>
              <button class="ghost-btn" :disabled="running || !pool.length" title="重跑最后一个交易日（当日行情有更新时用）" @click="doRun(true)">
                重跑当日
              </button>
              <span class="run-meta">
                <template v-if="account.lastRunDate">已跑到 <b>{{ account.lastRunDate }}</b></template>
                <template v-else>尚未运行</template>
                <span class="dot">·</span>
                池 <b>{{ pool.length }}</b> 只
                <span class="dot">·</span>
                持仓 <b>{{ positions.length }}</b> 只
              </span>
            </div>
            <div class="run-right">
              <span class="equity-label">总权益</span>
              <span class="equity-value">¥{{ money(summary.equity) }}</span>
              <span class="equity-pct" :class="trendClass(summary.totalReturn)">
                {{ pctText(summary.totalReturn) }}
              </span>
            </div>
          </div>

          <div v-if="error" class="paper-error">{{ error }}</div>
          <div v-else-if="runHint" class="paper-hint">{{ runHint }}</div>

          <!-- ══ 标签页 ══ -->
          <div class="tabs">
            <button
              v-for="t in TABS"
              :key="t.id"
              class="tab-btn"
              :class="{ active: tab === t.id }"
              @click="tab = t.id"
            >{{ t.label }}</button>
          </div>

          <div class="tab-body">
            <!-- ─── 总览 ─── -->
            <template v-if="tab === 'overview'">
              <div class="metric-grid">
                <div class="metric">
                  <span class="m-label">初始资金</span>
                  <span class="m-value">¥{{ money(summary.initialCash) }}</span>
                </div>
                <div class="metric">
                  <span class="m-label">可用现金</span>
                  <span class="m-value">¥{{ money(summary.cash) }}</span>
                </div>
                <div class="metric">
                  <span class="m-label">持仓市值</span>
                  <span class="m-value">¥{{ money(summary.marketValue) }}</span>
                </div>
                <div class="metric">
                  <span class="m-label">累计收益</span>
                  <span class="m-value" :class="trendClass(summary.totalReturn)">
                    {{ pctText(summary.totalReturn) }}
                  </span>
                </div>
                <div class="metric">
                  <span class="m-label">最大回撤</span>
                  <span class="m-value">-{{ rateText(summary.maxDrawdown) }}</span>
                </div>
                <div class="metric">
                  <span class="m-label">今日盈亏</span>
                  <span class="m-value" :class="trendClass(today.delta)">
                    {{ today.delta == null ? "--" : signedMoney(today.delta) }}
                  </span>
                </div>
                <div class="metric">
                  <span class="m-label">已实现盈亏</span>
                  <span class="m-value" :class="trendClass(summary.realizedTotal)">
                    {{ signedMoney(summary.realizedTotal) }}
                  </span>
                </div>
                <div class="metric">
                  <span class="m-label">累计费用</span>
                  <span class="m-value muted">¥{{ money(summary.feeTotal) }}</span>
                </div>
              </div>

              <!-- 胜率 -->
              <div class="win-card">
                <div class="win-head">
                  <span class="win-title">已平仓交易胜率</span>
                  <span class="win-rate" :class="summary.winRate == null ? '' : summary.winRate >= 50 ? 'up' : 'down'">
                    {{ rateText(summary.winRate) }}
                  </span>
                </div>
                <div class="win-sub">
                  {{ summary.winCount }} 胜 / {{ summary.lossCount }} 负，共 {{ summary.closedCount }} 笔平仓
                  <span v-if="!summary.enough" class="win-low">样本不足（&lt;10 笔），仅供参考</span>
                </div>
              </div>

              <!-- 净值曲线 -->
              <div class="nav-card">
                <div class="nav-head">
                  <span class="nav-title">净值曲线</span>
                  <span class="nav-days">{{ summary.navDays }} 个交易日</span>
                </div>
                <svg v-if="navPolyline" class="nav-svg" viewBox="0 0 100 30" preserveAspectRatio="none">
                  <polyline
                    :points="navPolyline"
                    fill="none"
                    :stroke="navUp ? 'var(--red)' : 'var(--green)'"
                    stroke-width="0.6"
                    vector-effect="non-scaling-stroke"
                  />
                </svg>
                <div v-else class="nav-empty">还没有净值记录，先点「运行到最新」</div>
                <div v-if="summary.partial" class="nav-warn">
                  {{ summary.missing.length }} 只持仓缺当日收盘价，已按成本价估值（净值不完整）
                </div>
              </div>

              <!-- 待成交委托 -->
              <div class="pending-card" v-if="pendingRows.length">
                <div class="sec-title">待次日开盘成交（{{ pendingRows.length }} 笔）</div>
                <div class="pending-row" v-for="o in pendingRows" :key="o.id">
                  <span class="pg-side" :class="o.side === 'buy' ? 'up' : 'down'">
                    {{ o.side === "buy" ? "买" : "卖" }}
                  </span>
                  <button class="link-btn" @click="openDetail(o.code)">{{ o.name || o.code }}</button>
                  <span class="pg-code">{{ o.code }}</span>
                  <span class="pg-reason">{{ o.reason }}</span>
                </div>
              </div>
            </template>

            <!-- ─── 持仓 ─── -->
            <template v-else-if="tab === 'positions'">
              <div v-if="!positions.length" class="tab-empty">
                当前无持仓
                <span class="tab-empty-sub">选股池内规则触发后，会在下一个交易日开盘买入</span>
              </div>
              <table v-else class="paper-table">
                <thead>
                  <tr>
                    <th>标的</th>
                    <th class="num">股数</th>
                    <th class="num">成本价</th>
                    <th class="num">成本额</th>
                    <th>建仓日</th>
                    <th>触发规则</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in positions" :key="p.code">
                    <td>
                      <button class="link-btn" @click="openDetail(p.code)">{{ p.name || p.code }}</button>
                      <span class="cell-code">{{ p.code }}</span>
                    </td>
                    <td class="num">{{ sharesText(p.shares) }}</td>
                    <td class="num">{{ priceText(p.costPrice, 3) }}</td>
                    <td class="num">¥{{ money(p.costAmount) }}</td>
                    <td>{{ p.openDate }}</td>
                    <td class="rule-cell">{{ (p.openRules || []).length ? `${p.openRules.length} 条` : "—" }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="tab-note">
                成本价已含买入费用。持仓的当前市值与浮盈请以「总览」的净值口径为准——
                模拟盘只按记账交易日的收盘价估值，不用实时行情另算一套（避免两处数字打架）。
              </p>
            </template>

            <!-- ─── 成交 ─── -->
            <template v-else-if="tab === 'trades'">
              <div v-if="!tradeRows.length" class="tab-empty">还没有成交记录</div>
              <table v-else class="paper-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>标的</th>
                    <th>方向</th>
                    <th class="num">价格</th>
                    <th class="num">股数</th>
                    <th class="num">金额</th>
                    <th class="num">费用</th>
                    <th class="num">已实现盈亏</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="t in tradeRows" :key="t.id">
                    <td>{{ t.date }}</td>
                    <td>
                      <button class="link-btn" @click="openDetail(t.code)">{{ t.name || t.code }}</button>
                      <span class="cell-code">{{ t.code }}</span>
                    </td>
                    <td>
                      <span class="side-tag" :class="t.side === 'buy' ? 'up' : 'down'">
                        {{ t.side === "buy" ? "买入" : "卖出" }}
                      </span>
                    </td>
                    <td class="num">{{ priceText(t.price, 2) }}</td>
                    <td class="num">{{ sharesText(t.shares) }}</td>
                    <td class="num">¥{{ money(t.amount) }}</td>
                    <td class="num muted">¥{{ money(t.feeTotal) }}</td>
                    <td class="num" :class="t.realized == null ? 'muted' : trendClass(t.realized)">
                      {{ t.realized == null ? "—" : signedMoney(t.realized) }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="tradeRows.length >= 200" class="tab-note">仅显示最近 200 笔成交。</p>
            </template>

            <!-- ─── 选股池 ─── -->
            <template v-else-if="tab === 'pool'">
              <div class="pool-add">
                <input v-model="manualCode" class="pool-input code" placeholder="6 位代码" maxlength="6" @keyup.enter="submitManual" />
                <input v-model="manualName" class="pool-input" placeholder="名称（可空）" @keyup.enter="submitManual" />
                <button class="ghost-btn" @click="submitManual">加入</button>
                <button class="ghost-btn danger" :disabled="!pool.length" @click="clearPool">清空池</button>
              </div>
              <div v-if="poolHint" class="pool-hint-line">{{ poolHint }}</div>

              <div v-if="!pool.length" class="tab-empty">
                选股池为空
                <span class="tab-empty-sub">在「问财选股」窗口点「模拟盘」，或在上方手动输入代码</span>
              </div>
              <div v-else class="pool-list">
                <div class="pool-item" v-for="row in diagRows" :key="row.code">
                  <button class="link-btn" @click="openDetail(row.code)">{{ row.name || row.code }}</button>
                  <span class="cell-code">{{ row.code }}</span>
                  <span class="pool-diag" v-if="row.diag">
                    <span class="diag-bars">{{ row.diag.bars }} 根日K</span>
                    <span v-if="row.diag.error" class="diag-err">{{ row.diag.error }}</span>
                    <span v-else-if="row.diag.bars < 60" class="diag-warn">不足 60 根，规则无法判定</span>
                  </span>
                  <span class="pool-diag muted" v-else>未取数</span>
                  <button class="icon-btn" title="移出选股池" @click="removeFromPool(row.code)">
                    <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                      <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
              <p class="tab-note">
                移到池外不会强制平仓——引擎对池外持仓只卖不买，仍会按止盈/止损/持有期退出。
              </p>
            </template>

            <!-- ─── 自动选股 ─── -->
            <template v-else-if="tab === 'auto'">
              <div class="auto-head">
                <label class="auto-switch">
                  <input
                    class="toggle"
                    type="checkbox"
                    :checked="autoConfig.enabled"
                    @change="setAuto({ enabled: $event.target.checked })"
                  />
                  <span class="auto-switch-text">
                    <b>每日定时自动选股并跑批</b>
                    <span class="auto-sub">到点自动查问财 → 更新选股池 → 向前累积撮合，无需手动</span>
                  </span>
                </label>
                <button
                  class="ghost-btn"
                  :disabled="autoRunning || !enabledStrategyCount"
                  title="跳过时刻判断，立刻按当前策略跑一次（用于验证策略是否有效）"
                  @click="runAutoNow"
                >
                  <span v-if="autoRunning" class="spinner"></span>
                  {{ autoRunning ? "执行中…" : "立即执行一次" }}
                </button>
              </div>

              <div class="cfg-grid auto-grid">
                <label class="cfg-item">
                  <span class="cfg-label">每天运行时刻（本地时区）</span>
                  <input
                    class="cfg-input"
                    type="text"
                    placeholder="15:30"
                    :value="autoConfig.time"
                    @change="commitAutoTime($event.target.value)"
                  />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">选股池更新方式</span>
                  <select
                    class="cfg-input"
                    :value="autoConfig.mode"
                    @change="setAuto({ mode: $event.target.value })"
                  >
                    <option value="replace">跟随策略（当日命中即当日池）</option>
                    <option value="merge">只增不减（策略漏选不踢票）</option>
                  </select>
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">每条策略取行数</span>
                  <input
                    class="cfg-input"
                    type="number"
                    min="1"
                    max="100"
                    :value="autoConfig.perpage"
                    @change="setAuto({ perpage: Number($event.target.value) })"
                  />
                </label>
                <label class="auto-check-line">
                  <input
                    class="toggle small"
                    type="checkbox"
                    :checked="autoConfig.notify"
                    @change="setAuto({ notify: $event.target.checked })"
                  />
                  <span class="cfg-label">跑完发系统通知</span>
                </label>
              </div>

              <div class="auto-section">
                <div class="auto-section-head">
                  <span class="cfg-label">问财策略语句（{{ enabledStrategyCount }} 条启用）</span>
                </div>
                <div class="pool-add">
                  <input
                    v-model="newQuestion"
                    class="pool-input"
                    placeholder="如：连续三年ROE大于15%，市值小于300亿"
                    maxlength="120"
                    @keyup.enter="addStrategy"
                  />
                  <button class="ghost-btn" @click="addStrategy">添加策略</button>
                </div>
                <div v-if="autoHint" class="pool-hint-line">{{ autoHint }}</div>

                <div v-if="!strategyRows.length" class="tab-empty auto-empty">
                  还没有策略
                  <span class="tab-empty-sub">
                    添加一条问财语句即可；多个策略的命中结果会合并去重后进池
                  </span>
                </div>
                <div v-else class="pool-list">
                  <div
                    class="pool-item"
                    v-for="s in strategyRows"
                    :key="s.id"
                    :class="{ 'strategy-off': s.enabled === false }"
                  >
                    <input
                      class="toggle small"
                      type="checkbox"
                      :checked="s.enabled !== false"
                      :title="s.enabled === false ? '启用该策略' : '停用该策略'"
                      @change="toggleStrategy(s.id)"
                    />
                    <span class="strategy-q">{{ s.question }}</span>
                    <span v-if="s.enabled === false" class="strategy-tag">已停用</span>
                    <button class="icon-btn" title="删除该策略" @click="removeStrategy(s.id)">
                      <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                        <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div class="auto-section">
                <span class="cfg-label">最近一次自动运行</span>
                <div v-if="!lastAuto" class="auto-last muted">尚未自动运行过</div>
                <div v-else class="auto-last">
                  <span class="auto-last-date">{{ lastAuto.date }}</span>
                  <span :class="lastAuto.error ? 'diag-err' : ''">{{ autoResultText }}</span>
                </div>
                <div v-if="autoCheckText" class="auto-reason">当前判断：{{ autoCheckText }}</div>
              </div>

              <p class="tab-note">
                定时任务只在<b>主窗口</b>运行（关掉应用不会在后台跑）：每次启动会先补判断一次，
                到点且当天没跑过才执行；应用整天没开时错过的日期不单独补跑，
                而是由「向前累积」在下次运行时从上次跑到的那天之后一次性补齐。
                运行失败会隔 {{ Math.round(AUTO_RETRY_MS / 60000) }} 分钟重试，不会每分钟打问财（避免被限流）。
                默认时刻 {{ DEFAULT_AUTO_CONFIG.time }}（收盘后 30 分钟，日 K 收盘价稳定后才取数）。
              </p>
            </template>

            <!-- ─── 运行日志 ─── -->
            <template v-else-if="tab === 'runs'">
              <div v-if="!runRows.length" class="tab-empty">还没有运行记录</div>
              <table v-else class="paper-table">
                <thead>
                  <tr>
                    <th>交易日</th>
                    <th class="num">扫描</th>
                    <th class="num">信号</th>
                    <th class="num">成交</th>
                    <th class="num">卖单</th>
                    <th class="num">买单</th>
                    <th class="num">权益</th>
                    <th>跳过</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in runRows" :key="r.date">
                    <td>{{ r.date }}</td>
                    <td class="num">{{ r.scanned }}</td>
                    <td class="num">{{ (r.signalCodes || []).length }}</td>
                    <td class="num">{{ r.filledCount }}</td>
                    <td class="num">{{ r.exitCount }}</td>
                    <td class="num">{{ r.entryCount }}</td>
                    <td class="num" :class="r.partial ? 'muted' : ''">
                      ¥{{ money(r.equity) }}<span v-if="r.partial" class="partial-mark">*</span>
                    </td>
                    <td class="skip-cell">
                      <template v-if="(r.skipped || []).length">
                        <span v-for="(s, i) in r.skipped" :key="i" class="skip-item">
                          {{ s.code }} {{ s.side === "buy" ? "买" : "卖" }}：{{ s.reason }}
                        </span>
                      </template>
                      <span v-else class="muted">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="tab-note">带 * 的权益值有持仓缺当日收盘价，按成本价估值（不完整）。</p>
            </template>

            <!-- ─── 配置 ─── -->
            <template v-else-if="tab === 'settings'">
              <div class="cfg-grid">
                <label class="cfg-item">
                  <span class="cfg-label">初始资金（元）</span>
                  <input class="cfg-input" type="number" :value="account.config.initialCash" @change="commitNumber('initialCash', $event.target.value)" />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">固定持有期（交易日，0=不限）</span>
                  <input class="cfg-input" type="number" :value="account.config.holdDays" @change="commitNumber('holdDays', $event.target.value)" />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">最大持仓只数</span>
                  <input class="cfg-input" type="number" :value="account.config.maxPositions" @change="commitNumber('maxPositions', $event.target.value)" />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">单票预算（占总权益 %）</span>
                  <input class="cfg-input" type="number" :value="account.config.perTradeCashPct" @change="commitNumber('perTradeCashPct', $event.target.value)" />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">单票最大权重（%）</span>
                  <input class="cfg-input" type="number" :value="account.config.maxWeightPct" @change="commitNumber('maxWeightPct', $event.target.value)" />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">止损（%，0=关闭）</span>
                  <input class="cfg-input" type="number" :value="account.config.stopLossPct" @change="commitNumber('stopLossPct', $event.target.value)" />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">止盈（%，0=关闭）</span>
                  <input class="cfg-input" type="number" :value="account.config.takeProfitPct" @change="commitNumber('takeProfitPct', $event.target.value)" />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">单向滑点（%）</span>
                  <input class="cfg-input" type="number" step="0.05" :value="(account.config.slippage * 100).toFixed(2)" @change="commitNumber('slippage', Number($event.target.value) / 100)" />
                </label>
              </div>

              <div class="cfg-fees">
                <span class="cfg-label">费率</span>
                <span class="cfg-fee-line">
                  佣金 万{{ (account.config.fees.commissionRate * 10000).toFixed(2) }}（最低 {{ account.config.fees.commissionMin }} 元）
                  <span class="dot">·</span>
                  印花税 {{ (account.config.fees.stampTaxRate * 100).toFixed(3) }}%（仅卖出）
                  <span class="dot">·</span>
                  过户费 {{ (account.config.fees.transferFeeRate * 100).toFixed(3) }}%（双向）
                </span>
              </div>

              <div class="danger-zone">
                <button class="ghost-btn danger" @click="confirmThen('reset')">
                  {{ confirming === "reset" ? "再点一次确认重置（清空流水与净值，保留选股池）" : "重置账户" }}
                </button>
                <button class="ghost-btn danger" @click="confirmThen('clear')">
                  {{ confirming === "clear" ? "再点一次确认彻底清空（含选股池）" : "彻底清空" }}
                </button>
              </div>

              <p class="tab-note">
                改动配置不会重算历史——新参数只影响之后的交易日。想用新参数从头验证，
                请「重置账户」后重新运行。默认值：持有 {{ DEFAULT_CONFIG.holdDays }} 日、最多 {{ DEFAULT_CONFIG.maxPositions }} 只、
                单票 {{ DEFAULT_CONFIG.perTradeCashPct }}%、止损 {{ DEFAULT_CONFIG.stopLossPct }}%、止盈 {{ DEFAULT_CONFIG.takeProfitPct }}%。
              </p>
            </template>
          </div>

          <!-- ══ 底部口径声明（必须始终可见） ══ -->
          <p class="paper-disclaimer">
            口径：<b>D 日收盘</b>跑日线规则出单 → <b>D+1 开盘价</b>成交（含 {{ (account.config.slippage * 100).toFixed(2) }}% 单边滑点），
            <b>全额计入</b>佣金/印花税/过户费，A 股 T+1、涨跌停与停牌不可成交，最小下单单位按板块校验。
            与「信号回测」面板口径不同（那边是信号日收盘买、不计费用），两者数字不可直接比较；
            样本不足 10 笔的胜率仅供参考，历史表现不代表未来收益，本面板不构成投资建议。
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
.paper-container {
  width: 920px;
  max-width: 96vw;
  height: 82vh;
  max-height: 88vh;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.mode-pill {
  font-size: 11px;
  font-weight: 600;
  color: var(--rust);
  background: var(--apricot-wash);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.stale-pill {
  font-size: 11px;
  font-weight: 600;
  color: var(--warn-ink);
  background: var(--warn-bg);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

/* 自动运行开启时的常显标记：用户一眼能看到「账户正在被自动改」 */
.auto-pill {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--fog);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-variant-numeric: tabular-nums;
}

/* ── 运行条 ── */
.run-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.run-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.run-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--rust);
  color: var(--white);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background var(--transition-fast), transform var(--transition-fast);
}
.run-btn:hover:not(:disabled) { background: var(--ink); }
.run-btn:active:not(:disabled) { transform: scale(0.98); }
.run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ghost-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}
.ghost-btn:hover:not(:disabled) { border-color: var(--rust); color: var(--rust); background: var(--hover-bg); }
.ghost-btn:active:not(:disabled) { background: var(--active-bg); }
.ghost-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ghost-btn.danger { color: var(--danger-ink); border-color: rgba(220, 38, 38, 0.3); }
.ghost-btn.danger:hover:not(:disabled) { background: var(--danger-bg); border-color: var(--danger-ink); }

.run-meta {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.run-meta b { color: var(--text-secondary); font-weight: 600; }
.dot { margin: 0 6px; color: var(--dove); }

.run-right {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
}
.equity-label { font-size: 12px; color: var(--text-muted); }
.equity-value { font-size: 18px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.equity-pct { font-size: 13px; font-weight: 600; }

/* ── 提示条 ── */
.paper-error,
.paper-hint {
  margin: 10px 20px 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  line-height: 1.5;
  flex-shrink: 0;
}
.paper-error { color: var(--danger-ink); background: var(--danger-bg); }
.paper-hint { color: var(--text-secondary); background: var(--fog); }

/* ── 标签页 ── */
.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 10px 20px 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tab-btn {
  padding: 7px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
}
.tab-btn:hover { color: var(--text-primary); background: var(--hover-bg); }
.tab-btn.active { color: var(--rust); border-bottom-color: var(--rust); font-weight: 600; }

.tab-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 8px;
}

/* ── 指标网格 ── */
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--fog);
  border-radius: var(--radius-sm);
}
.m-label { font-size: 11.5px; color: var(--text-muted); }
.m-value { font-size: 15px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.m-value.muted { color: var(--text-secondary); font-weight: 500; }

/* ── 胜率卡 ── */
.win-card {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.win-head { display: flex; align-items: baseline; justify-content: space-between; }
.win-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.win-rate { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.win-sub { margin-top: 4px; font-size: 12px; color: var(--text-muted); }
.win-low {
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--warn-bg);
  color: var(--warn-ink);
  font-weight: 600;
}

/* ── 净值卡 ── */
.nav-card {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.nav-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.nav-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.nav-days { font-size: 12px; color: var(--text-muted); }
.nav-svg { display: block; width: 100%; height: 90px; }
.nav-empty { font-size: 12.5px; color: var(--text-muted); text-align: center; padding: 24px 0; }
.nav-warn {
  margin-top: 6px;
  font-size: 12px;
  color: var(--warn-ink);
}

/* ── 待成交 ── */
.pending-card {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.sec-title { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; }
.pending-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 0;
  font-size: 12.5px;
  border-top: 1px solid var(--border-light);
}
.pg-side { font-weight: 700; flex-shrink: 0; }
.pg-code { color: var(--text-muted); font-size: 11.5px; flex-shrink: 0; }
.pg-reason { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── 表格 ── */
.paper-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.paper-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  font-size: 11.5px;
  color: var(--text-muted);
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.paper-table td {
  padding: 8px 10px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-light);
  vertical-align: top;
}
.paper-table tbody tr:hover td { background: var(--hover-bg); }
.paper-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.paper-table .muted { color: var(--text-muted); }
.cell-code { margin-left: 6px; font-size: 11px; color: var(--text-muted); }
.rule-cell { font-size: 11.5px; color: var(--text-muted); }
.skip-cell { font-size: 11.5px; }
.skip-item { display: block; color: var(--text-muted); }
.partial-mark { color: var(--warn-ink); font-weight: 700; margin-left: 2px; }

.link-btn {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--text-primary);
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: color var(--transition-fast);
}
.link-btn:hover { color: var(--rust); text-decoration: underline; }

.side-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: var(--radius-xs);
  font-size: 11.5px;
  font-weight: 600;
  background: var(--fog);
}

.up { color: var(--red); }
.down { color: var(--green); }

/* ── 选股池 ── */
.pool-add { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.pool-input {
  flex: 1;
  min-width: 0;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
}
.pool-input.code { flex: 0 0 120px; }
.pool-input::placeholder { color: var(--dove); }
.pool-hint-line { margin-bottom: 8px; font-size: 12px; color: var(--warn-ink); }

.pool-list { display: flex; flex-direction: column; }
.pool-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 4px;
  border-bottom: 1px solid var(--border-light);
  font-size: 12.5px;
}
.pool-diag { display: flex; align-items: center; gap: 8px; margin-left: auto; font-size: 11.5px; }
.pool-diag.muted { color: var(--text-muted); }
.diag-bars { color: var(--text-muted); }
.diag-err { color: var(--danger-ink); }
.diag-warn { color: var(--warn-ink); }

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.icon-btn:hover { background: var(--danger-bg); color: var(--danger-ink); }

/* ── 配置 ── */
.cfg-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 14px;
}
.cfg-item { display: flex; flex-direction: column; gap: 4px; }
.cfg-label { font-size: 11.5px; color: var(--text-muted); }
.cfg-input {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  font-variant-numeric: tabular-nums;
}
.cfg-fees { margin-top: 14px; display: flex; flex-direction: column; gap: 4px; }
.cfg-fee-line { font-size: 12.5px; color: var(--text-secondary); }

.danger-zone {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

/* ── 自动选股 ── */
.auto-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}
.auto-switch { display: flex; align-items: center; gap: 10px; cursor: pointer; min-width: 0; }
.auto-switch-text { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; color: var(--text-primary); }
.auto-sub { font-size: 11.5px; color: var(--text-muted); }

/* Toggle 开关（与 SettingsModal 同款：视觉隐藏原生框会破坏键盘可达，故用 appearance:none） */
.toggle {
  appearance: none;
  width: 40px;
  height: 22px;
  border-radius: var(--radius-full);
  background: var(--border);
  position: relative;
  cursor: pointer;
  transition: background var(--transition-fast);
  flex-shrink: 0;
  margin: 0;
}
.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  background: var(--white);
  transition: transform var(--transition-fast);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
.toggle:checked { background: var(--ink); }
.toggle:checked::after { transform: translateX(18px); }
.toggle.small { width: 32px; height: 18px; }
.toggle.small::after { width: 14px; height: 14px; }
.toggle.small:checked::after { transform: translateX(14px); }

.auto-grid { grid-template-columns: repeat(2, 1fr); }
.auto-check-line { display: flex; align-items: center; gap: 8px; padding-top: 16px; cursor: pointer; }

.auto-section {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border-light);
}
.auto-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.auto-empty { min-height: 96px; }
.auto-empty .tab-empty-sub { max-width: 380px; text-align: center; line-height: 1.6; }

.strategy-off .strategy-q { color: var(--text-muted); text-decoration: line-through; }
.strategy-q { flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.5; word-break: break-word; }
.strategy-tag {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--fog);
  padding: 1px 7px;
  border-radius: var(--radius-full);
}

.auto-last { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; font-size: 12.5px; }
.auto-last.muted { color: var(--text-muted); }
.auto-last-date { font-size: 11.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.auto-reason { margin-top: 6px; font-size: 11.5px; color: var(--text-muted); }

/* ── 空态与说明 ── */
.tab-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 140px;
  font-size: 13px;
  color: var(--text-secondary);
}
.tab-empty-sub { font-size: 12px; color: var(--text-muted); }

.tab-note {
  margin-top: 10px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-muted);
}

.paper-disclaimer {
  flex-shrink: 0;
  margin: 0;
  padding: 10px 20px 12px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--text-muted);
  background: var(--fog);
}

/* ── spinner ── */
.spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(255, 255, 255, 0.4);
  border-top-color: var(--white);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
/* 浅色按钮上的 spinner 换成深色描边，否则白圈白底看不见 */
.ghost-btn .spinner {
  border-color: rgba(23, 25, 28, 0.15);
  border-top-color: var(--rust);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
