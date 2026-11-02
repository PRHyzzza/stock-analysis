<script setup>
/**
 * PaperTradingModal.vue — 手动模拟盘面板
 *
 * 模型：**你自己决定买卖** → 按当前实时价 + 滑点立即成交 → 记账。
 * 没有选股池驱动的自动买入、没有委托队列、没有定时任务、没有自动止盈止损。
 *
 * 与旧版（选股驱动 · 每日向前累积）的差别：
 *   旧：D 日收盘打分 → 次日开盘撮合 → 跑批日志
 *   新：点「买入/卖出」→ 用**下单这一刻**的报价成交（拿面板打开时的旧价成交是自欺欺人）
 *
 * 口径必须如实披露（面板底部常显）：
 *   - 成交价 = 最新价 ± 单边滑点，夹在当日高低与涨跌停之间
 *   - 只在交易时段可下单（9:30-11:30 / 13:00-15:00，判定只走 `marketTime`）
 *   - 涨停不可买、跌停不可卖（不假装在板上成交）
 *   - 全额费用（佣金万 2.5 最低 5 元 / 印花税卖出 0.05% / 过户费双向 0.001%）
 *   - A 股 T+1：当日买入的股份当日不可卖
 *   - 净值按**收盘价**记账（与实时权益是两个口径），缺价标 `partial`
 *
 * 参考打分（6 因子 + 风险扣分 + 战法）只做展示，**不参与任何成交判定**。
 */
import { ref, computed, watch, onUnmounted } from "vue";
import { usePaperAccount } from "../composables/usePaperAccount.js";
import { signChar, trendClass } from "../utils/format.js";
import { getToday } from "../utils/marketTime.js";
import { effectiveInterval, onIntervalModeChange } from "../utils/refreshInterval.js";
import { DEFAULT_CONFIG, floorLot, maxBuyShares, sellableShares } from "../utils/paperEngine.js";
import { DEFAULT_SCORE_CONFIG } from "../utils/paperScore.js";

const props = defineProps({
  show: { type: Boolean, default: false },
});

const emit = defineEmits(["close", "open-detail"]);

const pa = usePaperAccount();
const {
  account,
  pool,
  positionRows,
  summary,
  today,
  liveEquity,
  error,
  busy,
  migrated,
  ticket,
  scoreInfo,
  missingPrices,
  canTrade,
  tradeBlockedReason,
  addToPool,
  removeFromPool,
  reloadPool,
  refreshStatus,
  refreshPrices,
  refreshNav,
  loadTicket,
  loadScore,
  preview,
  buy,
  sell,
  review,
  overnight,
  loadOvernightReview,
  exportLedger,
  importLedger,
  updateConfig,
  resetAccount,
  clearAll,
  ackMigrated,
} = pa;

const tab = ref("overview");
const TABS = [
  { id: "overview", label: "总览" },
  { id: "positions", label: "持仓" },
  { id: "trades", label: "成交" },
  { id: "review", label: "复盘" },
  { id: "pool", label: "自选" },
  { id: "settings", label: "配置" },
];

// ── 格式（金额为「元」；与 utils/format 的万元口径区分，故本地实现）──
function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function signedMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return signChar(n) + (n < 0 ? "-" : "") + money(Math.abs(n));
}
function pctText(v, digits = 2) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return (n > 0 ? "+" : "") + n.toFixed(digits) + "%";
}
function rateText(v, digits = 1) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(digits) + "%";
}
function priceText(v, digits = 2) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "--";
}
function sharesText(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("zh-CN") : "--";
}

// ── 下单票据 ──────────────────────────────────────────
const tradeCode = ref("");
const tradeShares = ref("100");
const orderHint = ref("");
/** 一次性提示：迁移自 v1 */
const showMigrated = ref(false);

/** 票据里那只票的持仓与可卖股数 */
const ticketPosition = computed(() => {
  const code = ticket.value.code;
  if (!code) return null;
  return positionRows.value.find((p) => p.code === code) || null;
});
const ticketSellable = computed(() => {
  const pos = account.value.positions?.find((p) => p.code === ticket.value.code);
  return pos ? sellableShares(pos, getToday()) : 0;
});
/** 最大可买（含费用与最小单位约束） */
const maxBuy = computed(() => {
  if (!ticket.value.code || !(ticket.value.price > 0)) return 0;
  return maxBuyShares(account.value, { code: ticket.value.code, price: ticket.value.price });
});

/** 命中「一夜持股」时给一句操作提示（形态识别，不是买卖建议） */
const overnightHit = computed(() =>
  (scoreInfo.value.res?.patternHits || []).includes("一夜持股")
);

/** 数量输入模式：按股数 / 按金额 */
const inputMode = ref("shares");
const tradeAmount = ref("");
/** 大额下单待确认（5 秒内再点一次才成交） */
const confirmPending = ref({ side: "", at: 0 });
/** 账本导入导出面板 */
const ledgerOpen = ref(false);
const ledgerText = ref("");
const ledgerHint = ref("");
/** 复盘页隔夜样本是否展开 */
const overnightOpen = ref(false);

/** 实际下单股数（按金额模式下由金额换算，并按最小单位规整） */
const sharesNum = computed(() => {
  if (inputMode.value === "amount") {
    const amt = Number(tradeAmount.value);
    const px = Number(ticket.value.price);
    if (!(amt > 0) || !(px > 0)) return 0;
    return Math.max(0, floorLot(ticket.value.code, amt / px));
  }
  return Math.max(0, Math.floor(Number(tradeShares.value) || 0));
});
const buyPreview = computed(() => preview("buy", sharesNum.value));
const sellPreview = computed(() => preview("sell", sharesNum.value));

/** 输入代码后查行情 + 参考分（回车/失焦触发，避免每敲一个字符就打接口） */
async function lookup() {
  orderHint.value = "";
  const code = tradeCode.value.trim();
  if (!/^\d{6}$/.test(code)) {
    orderHint.value = "请输入 6 位 A 股代码";
    return;
  }
  await loadTicket(code);
  if (ticket.value.error) {
    orderHint.value = ticket.value.error;
    return;
  }
  loadScore(code); // 参考分，不阻塞下单
}

async function refreshQuote() {
  if (!ticket.value.code) return;
  await loadTicket(ticket.value.code);
}

function applyQuick(kind) {
  const px = Number(ticket.value.price) || 0;
  if (inputMode.value === "amount") {
    const cap = Math.round((maxBuy.value || 0) * px);
    if (kind === "max-buy") tradeAmount.value = String(cap);
    else if (kind === "half-buy") tradeAmount.value = String(Math.round(cap / 2));
    else if (kind === "max-sell") tradeAmount.value = String(Math.round((ticketSellable.value || 0) * px));
    else tradeAmount.value = String(kind);
    return;
  }
  if (kind === "max-buy") tradeShares.value = String(maxBuy.value || 0);
  else if (kind === "half-buy") tradeShares.value = String(Math.floor((maxBuy.value || 0) / 2));
  else if (kind === "max-sell") tradeShares.value = String(ticketSellable.value || 0);
  else tradeShares.value = String(kind);
}

/** 数量框回车：Enter 买 / Shift+Enter 卖（鼠标不必离开输入框） */
function onEnterSubmit(e) {
  submit(e?.shiftKey ? "sell" : "buy");
}

// ── 账本备份 ──────────────────────────────────────────
function doExport() {
  ledgerText.value = exportLedger();
  ledgerOpen.value = true;
  ledgerHint.value = "已生成账本 JSON：复制保存即可（换机器时粘回去点「导入覆盖」）";
}

async function copyLedger() {
  const text = ledgerText.value || exportLedger();
  ledgerText.value = text;
  try {
    await navigator.clipboard.writeText(text);
    ledgerHint.value = "已复制到剪贴板";
  } catch {
    ledgerHint.value = "复制失败（浏览器限制），请手动全选文本框内容复制";
  }
}

function doImport() {
  const res = importLedger(ledgerText.value);
  ledgerHint.value = res.ok
    ? `导入成功：${res.counts.positions} 只持仓、${res.counts.trades} 笔成交、${res.counts.nav} 个净值点`
    : `导入失败：${res.reason}`;
  if (res.ok) {
    ledgerText.value = "";
    ledgerOpen.value = false;
  }
}

/** 从持仓/自选点「卖出」或「买入」：填充票据并跳到总览 */
async function tradeStock(code, side = "buy") {
  tab.value = "overview";
  tradeCode.value = code;
  await lookup();
  if (side === "sell") {
    tradeShares.value = String(ticketSellable.value || 0);
  }
}

/**
 * 下单
 * @param {"buy"|"sell"} side
 * @param {{ force?: boolean }} [opts] force=true 表示用户已确认过大额提示
 */
async function submit(side, opts = {}) {
  orderHint.value = "";
  const pv = side === "buy" ? buyPreview.value : sellPreview.value;
  const cash = Number(account.value.cash) || 0;
  const bigAmount = pv?.ok && (pv.amount >= 50000 || (cash > 0 && pv.amount >= cash * 0.5));
  // 大额买入二次确认：手滑多打一个零的代价比多点一次大得多
  if (side === "buy" && bigAmount && !opts.force) {
    confirmPending.value = { side, at: Date.now() };
    orderHint.value = `本笔买入 ¥${money(pv.amount)}（占可用现金 ${((pv.amount / Math.max(1, cash)) * 100).toFixed(0)}%），再点一次确认`;
    return;
  }
  confirmPending.value = { side: "", at: 0 };

  const code = ticket.value.code || tradeCode.value.trim();
  const sameCode = scoreInfo.value.code === code && scoreInfo.value.res?.enough;
  const res = await (side === "buy" ? buy : sell)({
    code,
    shares: sharesNum.value,
    // 买入时把参考分与命中战法写进流水，复盘才能按战法归因（不影响成交）
    meta: sameCode
      ? {
          score: scoreInfo.value.res.score,
          patterns: scoreInfo.value.res.patternHits || [],
          penalty: scoreInfo.value.res.penalty || 0,
        }
      : null,
  });
  if (!res.ok) {
    orderHint.value = res.reason || "下单失败";
    return;
  }
  const t = res.trade;
  const parts = [
    `${t.side === "buy" ? "买入" : "卖出"} ${t.name || t.code} ${sharesText(t.shares)} 股 @ ${priceText(t.price)}`,
    `费用 ¥${money(t.feeTotal)}`,
  ];
  if (t.realized != null) parts.push(`已实现 ${signedMoney(t.realized)}`);
  orderHint.value = parts.join("，");
  // 成交后重置数量，避免误点第二笔
  if (side === "buy") {
    tradeShares.value = "100";
    tradeAmount.value = "";
  } else {
    tradeShares.value = String(ticketSellable.value || 0);
  }
  confirmPending.value = { side: "", at: 0 };
}

/** 5 秒内不点第二次就取消大额确认 */
watch(confirmPending, (v) => {
  if (!v.side) return;
  const at = v.at;
  setTimeout(() => {
    if (confirmPending.value.at === at) confirmPending.value = { side: "", at: 0 };
  }, 5000);
});

/** 改数量/换代码就作废待确认状态 */
watch([tradeShares, tradeAmount, inputMode], () => {
  if (confirmPending.value.side) confirmPending.value = { side: "", at: 0 };
});

// ── 派生数据 ──────────────────────────────────────────
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
const navUp = computed(() => {
  const rows = account.value?.nav || [];
  if (rows.length < 2) return null;
  return (Number(rows[rows.length - 1].equity) || 0) >= (Number(rows[0].equity) || 0);
});

/** 成交明细（最新在前） */
const tradeRows = computed(() => (account.value?.trades || []).slice().reverse().slice(0, 200));
const recentTrades = computed(() => tradeRows.value.slice(0, 6));

/** 自选池里每只票是否持仓（用于按钮态） */
function heldShares(code) {
  return positionRows.value.find((p) => p.code === code)?.shares || 0;
}

// ── 自选池 ────────────────────────────────────────────
const manualCode = ref("");
const manualName = ref("");
const poolHint = ref("");

async function submitManual() {
  const code = manualCode.value.trim();
  if (!/^\d{6}$/.test(code)) {
    poolHint.value = "请输入 6 位 A 股代码（模拟盘只做 A 股）";
    return;
  }
  let name = manualName.value.trim();
  if (!name) {
    await loadTicket(code);
    name = ticket.value.name || "";
  }
  const added = addToPool({ code, name, source: "manual" });
  poolHint.value = added.length ? `已加入自选：${code}` : "该代码已在自选中";
  manualCode.value = "";
  manualName.value = "";
}

// ── 配置 ──────────────────────────────────────────────
const confirming = ref("");
const cfgHint = ref("");

function commitNumber(key, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  if (key === "initialCash" && (account.value.trades || []).length > 0) {
    cfgHint.value = "已有成交流水，初始资金不可再改（会破坏收益率基准）；如需重来请「重置账户」";
    return;
  }
  cfgHint.value = "";
  updateConfig({ [key]: n });
}

function commitFee(key, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return;
  updateConfig({ fees: { ...account.value.config.fees, [key]: n } });
}

function confirmThen(action) {
  if (confirming.value !== action) {
    confirming.value = action;
    return;
  }
  confirming.value = "";
  orderHint.value = "";
  cfgHint.value = "";
  if (action === "reset") resetAccount();
  else if (action === "clear") clearAll();
  else if (action === "import") doImport();
}

function openDetail(code) {
  if (code) emit("open-detail", code);
}

// ── 打开面板时的刷新与轮询 ─────────────────────────────
let timer = null;
let unsubscribe = null;

function tick() {
  if (!props.show) return;
  refreshStatus();
  if ((account.value.positions || []).length) refreshPrices();
}

function schedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, effectiveInterval(60 * 1000));
}

watch(
  () => props.show,
  async (open) => {
    if (!open) {
      confirming.value = "";
      orderHint.value = "";
      poolHint.value = "";
      if (timer) clearInterval(timer);
      timer = null;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      return;
    }
    showMigrated.value = !!migrated.value;
    reloadPool();
    refreshStatus();
    await refreshPrices();
    await refreshNav();
    schedule();
    unsubscribe = onIntervalModeChange(schedule);
  },
  { immediate: true }
);

onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (unsubscribe) unsubscribe();
});
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
            <span class="mode-pill">手动交易</span>
            <span class="session-pill" :class="canTrade ? 'open' : 'closed'">
              {{ canTrade ? "交易中" : tradeBlockedReason }}
            </span>
          </div>
          <button class="modal-close" @click="emit('close')" title="关闭">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- ══ 工具条：实时权益 ══ -->
          <div class="run-bar">
            <div class="run-left">
              <span class="run-meta">
                现金 <b>¥{{ money(summary.cash) }}</b>
                <span class="dot">·</span>
                持仓 <b>{{ positionRows.length }}</b> 只
                <span class="dot">·</span>
                成交 <b>{{ account.trades?.length || 0 }}</b> 笔
              </span>
            </div>
            <div class="run-right">
              <span class="equity-label">实时总权益</span>
              <span class="equity-value">¥{{ money(liveEquity) }}</span>
              <span class="equity-pct" :class="trendClass(summary.totalReturn)">
                {{ pctText(summary.totalReturn) }}
              </span>
            </div>
          </div>

          <div v-if="showMigrated" class="paper-hint migrate">
            已从旧版（选股跑批）账户切换为手动交易：现金、持仓、成交与净值曲线都保留，
            「待成交委托」和「每日运行日志」已丢弃（新模型里没有这两个概念）。
            <button class="link-btn" @click="showMigrated = false; ackMigrated()">知道了</button>
          </div>
          <div v-if="error" class="paper-error">{{ error }}</div>
          <div v-else-if="orderHint" class="paper-hint">{{ orderHint }}</div>

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
            <!-- ─── 总览 + 下单 ─── -->
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
                  <span class="m-value">¥{{ money(positionRows.reduce((s, p) => s + (p.marketValue || 0), 0)) }}</span>
                </div>
                <div class="metric">
                  <span class="m-label">累计收益</span>
                  <span class="m-value" :class="trendClass(summary.totalReturn)">{{ pctText(summary.totalReturn) }}</span>
                </div>
                <div class="metric">
                  <span class="m-label">今日盈亏</span>
                  <span class="m-value" :class="trendClass(today.delta)">
                    {{ today.delta == null ? "--" : signedMoney(today.delta) }}
                  </span>
                </div>
                <div class="metric">
                  <span class="m-label">已实现盈亏</span>
                  <span class="m-value" :class="trendClass(summary.realizedTotal)">{{ signedMoney(summary.realizedTotal) }}</span>
                </div>
                <div class="metric">
                  <span class="m-label">累计费用</span>
                  <span class="m-value muted">¥{{ money(summary.feeTotal) }}</span>
                </div>
                <div class="metric">
                  <span class="m-label">胜率（已平仓）</span>
                  <span class="m-value" :class="summary.winRate == null ? '' : summary.winRate >= 50 ? 'up' : 'down'">
                    {{ rateText(summary.winRate) }}
                  </span>
                </div>
              </div>

              <!-- ══ 下单区 ══ -->
              <div class="trade-card">
                <div class="trade-head">
                  <span class="sec-title">下单</span>
                  <span class="trade-sub">
                    成交价按<b>当前最新价</b> ± {{ (account.config.slippage * 100).toFixed(2) }}% 滑点即时撮合
                  </span>
                </div>

                <div class="trade-row">
                  <input
                    v-model="tradeCode"
                    class="pool-input code"
                    placeholder="6 位代码"
                    maxlength="6"
                    inputmode="numeric"
                    @keyup.enter="lookup"
                    @blur="tradeCode && lookup()"
                  />
                  <button class="ghost-btn" :disabled="ticket.loading" @click="lookup">
                    {{ ticket.loading ? "查询中…" : "查询" }}
                  </button>
                  <span v-if="ticket.error" class="trade-err">{{ ticket.error }}</span>
                  <template v-else-if="ticket.code">
                    <button class="link-btn trade-name" @click="openDetail(ticket.code)">
                      {{ ticket.name || ticket.code }}
                    </button>
                    <span class="trade-price" :class="trendClass(ticket.changePct)">
                      {{ priceText(ticket.price) }}
                      <span class="trade-chg">{{ pctText(ticket.changePct) }}</span>
                    </span>
                    <button class="icon-refresh" title="刷新报价" @click="refreshQuote">刷新</button>
                  </template>
                </div>

                <div class="trade-row">
                  <div class="mode-toggle">
                    <button
                      class="mode-btn"
                      :class="{ active: inputMode === 'shares' }"
                      @click="inputMode = 'shares'"
                    >股数</button>
                    <button
                      class="mode-btn"
                      :class="{ active: inputMode === 'amount' }"
                      @click="inputMode = 'amount'"
                    >金额</button>
                  </div>
                  <input
                    v-if="inputMode === 'shares'"
                    v-model="tradeShares"
                    class="pool-input code"
                    placeholder="股数"
                    inputmode="numeric"
                    @keyup.enter="onEnterSubmit"
                  />
                  <input
                    v-else
                    v-model="tradeAmount"
                    class="pool-input code"
                    placeholder="金额（元）"
                    inputmode="decimal"
                    @keyup.enter="onEnterSubmit"
                  />
                  <div class="quick-group">
                    <template v-if="inputMode === 'shares'">
                      <button class="quick-btn" @click="applyQuick(100)">100</button>
                      <button class="quick-btn" @click="applyQuick(1000)">1000</button>
                    </template>
                    <template v-else>
                      <button class="quick-btn" @click="applyQuick(5000)">5000</button>
                      <button class="quick-btn" @click="applyQuick(10000)">1 万</button>
                    </template>
                    <button class="quick-btn" @click="applyQuick('half-buy')">半仓</button>
                    <button class="quick-btn" @click="applyQuick('max-buy')">全仓</button>
                    <button class="quick-btn" @click="applyQuick('max-sell')">可卖</button>
                  </div>
                  <span class="trade-limit">
                    可买 <b>{{ sharesText(maxBuy) }}</b> 股 · 可卖 <b>{{ sharesText(ticketSellable) }}</b> 股
                  </span>
                </div>

                <div class="preview-grid">
                  <div class="preview-col">
                    <div class="preview-head">
                      <span class="side-tag buy">买入</span>
                      <span v-if="ticketPosition" class="preview-held">已持有 {{ sharesText(ticketPosition.shares) }} 股</span>
                    </div>
                    <template v-if="buyPreview && buyPreview.ok">
                      <div class="preview-line">成交价 <b>{{ priceText(buyPreview.price) }}</b></div>
                      <div class="preview-line">金额 ¥{{ money(buyPreview.amount) }} · 费用 ¥{{ money(buyPreview.feeTotal) }}</div>
                      <div class="preview-line">现金变动 <b class="down">{{ signedMoney(buyPreview.cashDelta) }}</b></div>
                    </template>
                    <div v-else class="preview-line muted">{{ buyPreview?.reason || "输入代码与股数后显示预估" }}</div>
                  </div>
                  <div class="preview-col">
                    <div class="preview-head">
                      <span class="side-tag sell">卖出</span>
                      <span v-if="ticketPosition" class="preview-held">
                        成本 {{ priceText(ticketPosition.costPrice, 3) }} · 浮盈
                        <b :class="trendClass(ticketPosition.pnl)">{{ signedMoney(ticketPosition.pnl) }}</b>
                      </span>
                    </div>
                    <template v-if="sellPreview && sellPreview.ok">
                      <div class="preview-line">成交价 <b>{{ priceText(sellPreview.price) }}</b></div>
                      <div class="preview-line">金额 ¥{{ money(sellPreview.amount) }} · 费用 ¥{{ money(sellPreview.feeTotal) }}</div>
                      <div class="preview-line">
                        回款 <b class="up">{{ signedMoney(sellPreview.cashDelta) }}</b>
                        <template v-if="sellPreview.realized != null">
                          · 已实现 <b :class="trendClass(sellPreview.realized)">{{ signedMoney(sellPreview.realized) }}</b>
                        </template>
                      </div>
                    </template>
                    <div v-else class="preview-line muted">{{ sellPreview?.reason || "当前无持仓可卖" }}</div>
                  </div>
                </div>

                <div class="trade-actions">
                  <button
                    class="trade-btn buy"
                    :class="{ confirming: confirmPending.side === 'buy' }"
                    :disabled="busy || !canTrade || !buyPreview?.ok"
                    :title="canTrade ? '' : tradeBlockedReason"
                    @click="submit('buy', { force: confirmPending.side === 'buy' })"
                  >
                    {{ busy ? "处理中…" : confirmPending.side === "buy" ? "再点一次确认买入" : "买入" }}
                  </button>
                  <button
                    class="trade-btn sell"
                    :disabled="busy || !canTrade || !sellPreview?.ok"
                    :title="canTrade ? '' : tradeBlockedReason"
                    @click="submit('sell')"
                  >
                    {{ busy ? "处理中…" : "卖出" }}
                  </button>
                  <span v-if="!canTrade" class="trade-blocked">{{ tradeBlockedReason }}</span>
                  <span v-else class="trade-blocked muted">下单即按当前价成交，不支持撤单</span>
                </div>
              </div>

              <!-- ══ 参考打分（不影响成交）══ -->
              <div class="score-card" v-if="scoreInfo.code">
                <div class="sec-title">
                  参考打分
                  <span class="score-sub">{{ scoreInfo.code }} {{ ticket.name }} · 仅供观察，不影响买卖</span>
                </div>
                <div v-if="scoreInfo.loading" class="preview-line muted">计算中…</div>
                <div v-else-if="scoreInfo.error" class="preview-line muted">{{ scoreInfo.error }}</div>
                <template v-else-if="scoreInfo.res">
                  <div class="score-row">
                    <span class="score-num" :class="scoreInfo.res.score >= DEFAULT_SCORE_CONFIG.minScore ? 'up' : 'muted'">{{ scoreInfo.res.score }}</span>
                    <span class="score-bar"><span class="score-bar-fill" :style="{ width: `${scoreInfo.res.score}%` }"></span></span>
                    <span class="score-tag muted" v-if="scoreInfo.res.penalty > 0">风险 -{{ scoreInfo.res.penalty }}</span>
                    <span
                      class="score-tag pattern"
                      v-if="(scoreInfo.res.patternHits || []).length"
                      :title="(scoreInfo.res.patternHits || []).join('、')"
                    >{{ scoreInfo.res.patternHits[0] }}{{ scoreInfo.res.patternHits.length > 1 ? ` +${scoreInfo.res.patternHits.length - 1}` : "" }}</span>
                  </div>
                  <p class="tab-note">{{ scoreInfo.text }}</p>
                  <p v-if="overnightHit" class="tab-note overnight">
                    形态同时满足「一夜持股」：常见做法是<b>尾盘买入、次日开盘卖出</b>（A 股 T+1 允许次日卖）。
                    这是形态识别，不是买卖建议。
                  </p>
                </template>
              </div>

              <!-- ══ 净值 ══ -->
              <div class="nav-card">
                <div class="nav-head">
                  <span class="nav-title">净值曲线（每个交易日一个快照）</span>
                  <span class="nav-days">{{ summary.navDays }} 个交易日 · 最后 {{ summary.lastDate || "--" }}</span>
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
                <div v-else class="nav-empty">还没有净值记录：打开面板或成交后会在交易日记一个点</div>
                <div v-if="summary.partial" class="nav-warn">
                  {{ summary.missing.length }} 只持仓缺价，当日净值未计入（不写假数据）
                </div>
              </div>

              <!-- ══ 最近成交 ══ -->
              <div class="pending-card" v-if="recentTrades.length">
                <div class="sec-title">最近成交</div>
                <div class="pending-row" v-for="t in recentTrades" :key="t.id">
                  <span class="pg-side" :class="t.side === 'buy' ? 'up' : 'down'">{{ t.side === "buy" ? "买" : "卖" }}</span>
                  <button class="link-btn" @click="openDetail(t.code)">{{ t.name || t.code }}</button>
                  <span class="pg-code">{{ t.code }} · {{ t.date }} {{ t.time }}</span>
                  <span class="pg-reason">
                    {{ sharesText(t.shares) }} 股 @ {{ priceText(t.price) }} · 费用 ¥{{ money(t.feeTotal) }}
                    <template v-if="t.realized != null"> · 已实现 {{ signedMoney(t.realized) }}</template>
                  </span>
                </div>
              </div>
            </template>

            <!-- ─── 持仓 ─── -->
            <template v-else-if="tab === 'positions'">
              <div v-if="!positionRows.length" class="tab-empty">
                当前无持仓
                <span class="tab-empty-sub">在「总览」输入代码后点买入，或从「自选」里选一只</span>
              </div>
              <table v-else class="paper-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th class="num">股数</th>
                    <th class="num">成本价</th>
                    <th class="num">现价</th>
                    <th class="num">市值</th>
                    <th class="num">今日盈亏</th>
                    <th class="num">浮动盈亏</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in positionRows" :key="p.code">
                    <td>
                      <button class="link-btn" @click="openDetail(p.code)">{{ p.name || p.code }}</button>
                      <span class="cell-code">{{ p.code }}</span>
                      <span v-if="p.openDate" class="cell-code">· {{ p.openDate }} 建仓</span>
                    </td>
                    <td class="num">{{ sharesText(p.shares) }}</td>
                    <td class="num">{{ priceText(p.costPrice, 3) }}</td>
                    <td class="num" :class="p.price == null ? 'muted' : ''">
                      {{ p.price == null ? "缺价" : priceText(p.price) }}
                    </td>
                    <td class="num">{{ money(p.marketValue) }}</td>
                    <td class="num" :class="trendClass(p.dayPnl)">
                      {{ p.dayPnl == null ? "--" : signedMoney(p.dayPnl) }}
                      <span class="pnl-pct">{{ pctText(p.dayPnlPct) }}</span>
                    </td>
                    <td class="num" :class="trendClass(p.pnl)">
                      {{ signedMoney(p.pnl) }}
                      <span class="pnl-pct">{{ pctText(p.pnlPct) }}</span>
                    </td>
                    <td>
                      <button class="ghost-btn tiny" @click="tradeStock(p.code, 'sell')">卖出</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="missingPrices.length" class="tab-note warn">
                {{ missingPrices.length }} 只持仓未取到实时价（{{ missingPrices.join("、") }}）：市值按成本价估算，仅供参考。
              </p>
              <p class="tab-note">
                现价来自实时行情，仅供看浮动盈亏；净值曲线每个交易日只保留**最近一次刷新**的快照（不保证是收盘价），两者口径不同，不要混着比。
              </p>
            </template>

            <!-- ─── 成交 ─── -->
            <template v-else-if="tab === 'trades'">
              <div v-if="!tradeRows.length" class="tab-empty">还没有成交记录</div>
              <table v-else class="paper-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>名称</th>
                    <th>方向</th>
                    <th class="num">成交价</th>
                    <th class="num">股数</th>
                    <th class="num">金额</th>
                    <th class="num">费用</th>
                    <th class="num">已实现</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="t in tradeRows" :key="t.id">
                    <td class="muted">{{ t.date }}<span class="cell-code">{{ t.time }}</span></td>
                    <td>
                      <button class="link-btn" @click="openDetail(t.code)">{{ t.name || t.code }}</button>
                      <span class="cell-code">{{ t.code }}</span>
                    </td>
                    <td><span class="side-tag" :class="t.side === 'buy' ? 'up' : 'down'">{{ t.side === "buy" ? "买入" : "卖出" }}</span></td>
                    <td class="num">{{ priceText(t.price) }}</td>
                    <td class="num">{{ sharesText(t.shares) }}</td>
                    <td class="num">{{ money(t.amount) }}</td>
                    <td class="num muted">{{ money(t.feeTotal) }}</td>
                    <td class="num" :class="trendClass(t.realized)">
                      {{ t.realized == null ? "—" : signedMoney(t.realized) }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="tradeRows.length >= 200" class="tab-note">仅显示最近 200 笔成交。</p>
            </template>

            <!-- ─── 复盘 ─── -->
            <template v-else-if="tab === 'review'">
              <div class="metric-grid">
                <div class="metric">
                  <span class="m-label">已平仓配对</span>
                  <span class="m-value">{{ review.count }} 笔</span>
                </div>
                <div class="metric">
                  <span class="m-label">胜率</span>
                  <span class="m-value" :class="review.winRate == null ? '' : review.winRate >= 50 ? 'up' : 'down'">
                    {{ rateText(review.winRate) }}
                  </span>
                </div>
                <div class="metric">
                  <span class="m-label">平均每笔</span>
                  <span class="m-value" :class="trendClass(review.avgPnl)">{{ signedMoney(review.avgPnl) }}</span>
                </div>
                <div class="metric">
                  <span class="m-label">累计已实现</span>
                  <span class="m-value" :class="trendClass(review.totalPnl)">{{ signedMoney(review.totalPnl) }}</span>
                </div>
              </div>
              <p v-if="!review.enough" class="tab-note warn">样本不足 10 笔（当前 {{ review.count }} 笔），以下统计仅供参考。</p>
              <p v-if="review.legacySells" class="tab-note">
                另有 {{ review.legacySells }} 笔历史卖出缺少批次明细（旧版本成交），未计入持有期统计。
              </p>

              <div class="nav-card">
                <div class="nav-head">
                  <span class="nav-title">隔夜缺口 · 买入价 → 次日开盘</span>
                  <button class="ghost-btn tiny" :disabled="overnight.loading" @click="loadOvernightReview(true)">
                    {{ overnight.loading ? "计算中…" : overnight.data ? "重算" : "计算" }}
                  </button>
                </div>
                <div v-if="!overnight.data" class="nav-empty">
                  点「计算」：逐笔比较买入价与次日开盘价，用来检验「一夜持股」到底有没有正期望
                </div>
                <div v-else-if="!overnight.data.count" class="nav-empty">{{ overnight.error || "暂无可统计的隔夜样本" }}</div>
                <template v-else>
                  <div class="gap-grid">
                    <div class="gap-item">
                      <span class="m-label">样本</span><b>{{ overnight.data.count }} 笔</b>
                    </div>
                    <div class="gap-item">
                      <span class="m-label">平均缺口</span>
                      <b :class="trendClass(overnight.data.meanGap)">{{ pctText(overnight.data.meanGap) }}</b>
                    </div>
                    <div class="gap-item">
                      <span class="m-label">中位缺口</span>
                      <b :class="trendClass(overnight.data.medianGap)">{{ pctText(overnight.data.medianGap) }}</b>
                    </div>
                    <div class="gap-item">
                      <span class="m-label">高开占比</span>
                      <b>{{ rateText(overnight.data.positiveRate) }}</b>
                    </div>
                  </div>
                  <p v-if="!overnight.data.enough" class="tab-note warn">样本不足 10 笔：均值会被单笔异常值主导，别据此下结论。</p>
                  <p v-if="overnight.error" class="tab-note warn">{{ overnight.error }}</p>
                  <button class="link-btn" @click="overnightOpen = !overnightOpen">
                    {{ overnightOpen ? "收起逐笔样本" : "展开逐笔样本" }}
                  </button>
                  <table v-if="overnightOpen" class="paper-table gap-table">
                    <thead>
                      <tr>
                        <th>买入日</th><th>标的</th><th class="num">买入价</th><th>次日</th><th class="num">开盘</th><th class="num">缺口</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(g, i) in overnight.data.samples" :key="`${g.code}-${g.buyDate}-${i}`">
                        <td class="muted">{{ g.buyDate }}</td>
                        <td>
                          <button class="link-btn" @click="openDetail(g.code)">{{ g.name || g.code }}</button>
                          <span class="cell-code">{{ g.code }}</span>
                        </td>
                        <td class="num">{{ priceText(g.buyPrice) }}</td>
                        <td class="muted">{{ g.nextDate }}</td>
                        <td class="num">{{ priceText(g.nextOpen) }}</td>
                        <td class="num" :class="trendClass(g.gapPct)">{{ pctText(g.gapPct) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </template>
              </div>

              <div class="score-card">
                <div class="sec-title">按持有期</div>
                <table class="paper-table">
                  <thead>
                    <tr><th>持有期</th><th class="num">笔数</th><th class="num">胜率</th><th class="num">平均盈亏</th><th class="num">合计</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="b in review.byHold" :key="b.id">
                      <td>{{ b.label }}</td>
                      <td class="num">{{ b.count }}</td>
                      <td class="num">{{ rateText(b.winRate) }}</td>
                      <td class="num" :class="trendClass(b.avgPnl)">{{ b.avgPnl == null ? "--" : signedMoney(b.avgPnl) }}</td>
                      <td class="num" :class="trendClass(b.totalPnl)">{{ b.count ? signedMoney(b.totalPnl) : "--" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="score-card">
                <div class="sec-title">
                  按买入时战法
                  <span class="score-sub">一笔配对只记首个战法，不重复计数；「无战法」= 下单时没有参考分</span>
                </div>
                <table class="paper-table">
                  <thead>
                    <tr><th>战法</th><th class="num">笔数</th><th class="num">胜率</th><th class="num">平均盈亏</th><th class="num">合计</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="p in review.byPattern" :key="p.name">
                      <td>{{ p.name }}</td>
                      <td class="num">{{ p.count }}</td>
                      <td class="num">{{ rateText(p.winRate) }}</td>
                      <td class="num" :class="trendClass(p.avgPnl)">{{ p.avgPnl == null ? "--" : signedMoney(p.avgPnl) }}</td>
                      <td class="num" :class="trendClass(p.totalPnl)">{{ signedMoney(p.totalPnl) }}</td>
                    </tr>
                    <tr v-if="!review.byPattern.length">
                      <td colspan="5" class="muted">还没有平仓配对</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="score-card">
                <div class="sec-title">按买入时参考分</div>
                <table class="paper-table">
                  <thead>
                    <tr><th>分数档</th><th class="num">笔数</th><th class="num">胜率</th><th class="num">平均盈亏</th><th class="num">合计</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="b in review.byScore" :key="b.id">
                      <td>{{ b.label }}</td>
                      <td class="num">{{ b.count }}</td>
                      <td class="num">{{ rateText(b.winRate) }}</td>
                      <td class="num" :class="trendClass(b.avgPnl)">{{ b.avgPnl == null ? "--" : signedMoney(b.avgPnl) }}</td>
                      <td class="num" :class="trendClass(b.totalPnl)">{{ b.count ? signedMoney(b.totalPnl) : "--" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>

            <!-- ─── 自选 ─── -->
            <template v-else-if="tab === 'pool'">
              <div class="pool-add">
                <input v-model="manualCode" class="pool-input code" placeholder="6 位代码" maxlength="6" inputmode="numeric" @keyup.enter="submitManual" />
                <input v-model="manualName" class="pool-input" placeholder="名称（可留空自动查）" @keyup.enter="submitManual" />
                <button class="ghost-btn" @click="submitManual">加入自选</button>
              </div>
              <div v-if="poolHint" class="pool-hint-line">{{ poolHint }}</div>

              <div v-if="!pool.length" class="tab-empty">
                自选是空的
                <span class="tab-empty-sub">手动输入代码、或在问财选股窗口把标的加入模拟盘；这里只是方便你快速下单</span>
              </div>
              <table v-else class="paper-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th class="num">持仓</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in pool" :key="p.code">
                    <td>
                      <button class="link-btn" @click="openDetail(p.code)">{{ p.name || p.code }}</button>
                      <span class="cell-code">{{ p.code }}</span>
                    </td>
                    <td class="num" :class="heldShares(p.code) ? '' : 'muted'">
                      {{ heldShares(p.code) ? `${sharesText(heldShares(p.code))} 股` : "—" }}
                    </td>
                    <td class="pool-ops">
                      <button class="ghost-btn tiny" @click="tradeStock(p.code, 'buy')">买入</button>
                      <button class="ghost-btn tiny" :disabled="!heldShares(p.code)" @click="tradeStock(p.code, 'sell')">卖出</button>
                      <button class="icon-btn" title="移出自选" @click="removeFromPool(p.code)">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="tab-note">自选只是「快速下单入口」，不会自动买入任何标的。</p>
            </template>

            <!-- ─── 配置 ─── -->
            <template v-else-if="tab === 'settings'">
              <div class="cfg-grid">
                <label class="cfg-item">
                  <span class="cfg-label">初始资金（元）</span>
                  <input class="cfg-input" type="number" :value="account.config.initialCash" @change="commitNumber('initialCash', $event.target.value)" />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">单边滑点（%）</span>
                  <input
                    class="cfg-input"
                    type="number"
                    step="0.01"
                    :value="(account.config.slippage * 100).toFixed(2)"
                    @change="commitNumber('slippage', Number($event.target.value) / 100)"
                  />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">佣金费率（万分之）</span>
                  <input
                    class="cfg-input"
                    type="number"
                    step="0.1"
                    :value="(account.config.fees.commissionRate * 10000).toFixed(2)"
                    @change="commitFee('commissionRate', Number($event.target.value) / 10000)"
                  />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">单笔最低佣金（元）</span>
                  <input class="cfg-input" type="number" :value="account.config.fees.commissionMin" @change="commitFee('commissionMin', $event.target.value)" />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">印花税率（%，仅卖出）</span>
                  <input
                    class="cfg-input"
                    type="number"
                    step="0.01"
                    :value="(account.config.fees.stampTaxRate * 100).toFixed(3)"
                    @change="commitFee('stampTaxRate', Number($event.target.value) / 100)"
                  />
                </label>
                <label class="cfg-item">
                  <span class="cfg-label">过户费率（%，双向）</span>
                  <input
                    class="cfg-input"
                    type="number"
                    step="0.0001"
                    :value="(account.config.fees.transferFeeRate * 100).toFixed(4)"
                    @change="commitFee('transferFeeRate', Number($event.target.value) / 100)"
                  />
                </label>
              </div>
              <p v-if="cfgHint" class="tab-note warn">{{ cfgHint }}</p>
              <p class="tab-note">
                配置只影响**之后的成交**，不重算历史流水与净值。默认值：初始资金 ¥{{ money(DEFAULT_CONFIG.initialCash) }}、
                滑点 {{ (DEFAULT_CONFIG.slippage * 100).toFixed(2) }}%、佣金万 2.5（最低 5 元）、印花税卖出 0.05%、过户费双向 0.001%。
              </p>

              <p class="sec-title ledger-title">账本备份（localStorage 一清就没了）</p>
              <div class="ledger-row">
                <button class="ghost-btn" @click="doExport">导出账本</button>
                <button class="ghost-btn" @click="copyLedger">复制</button>
                <button class="ghost-btn" @click="ledgerOpen = !ledgerOpen">{{ ledgerOpen ? "收起导入" : "导入账本" }}</button>
              </div>
              <textarea
                v-model="ledgerText"
                class="ledger-textarea"
                :rows="ledgerOpen ? 8 : 3"
                placeholder="导出的账本 JSON 会出现在这里；换机器时把备份粘进来再点「导入覆盖」"
              ></textarea>
              <p v-if="ledgerHint" class="tab-note">{{ ledgerHint }}</p>
              <div v-if="ledgerOpen" class="ledger-row">
                <button class="ghost-btn danger" @click="confirmThen('import')">
                  {{ confirming === "import" ? "再点一次确认覆盖当前账户" : "导入覆盖当前账户" }}
                </button>
              </div>

              <div class="danger-zone">
                <button class="ghost-btn danger" @click="confirmThen('reset')">
                  {{ confirming === "reset" ? "再点一次确认重置（保留自选）" : "重置账户" }}
                </button>
                <button class="ghost-btn danger" @click="confirmThen('clear')">
                  {{ confirming === "clear" ? "再点一次确认清空（含自选）" : "清空全部" }}
                </button>
              </div>
            </template>
          </div>

          <!-- ══ 底部口径声明（必须始终可见） ══ -->
          <p class="paper-disclaimer">
            口径：<b>手动下单</b>，成交价 = 下单时的<b>最新价 ± 单边滑点</b>（{{ (account.config.slippage * 100).toFixed(2) }}%），
            仅在<b>交易时段</b>（9:30-11:30 / 13:00-15:00，A 股交易日）可成交；<b>涨停不可买、跌停不可卖</b>，避免假装在板上成交。
            <b>全额计入</b>佣金（万 2.5，最低 5 元）/ 印花税（卖出 0.05%）/ 过户费（双向 0.001%），A 股 <b>T+1</b>（当日买入不可卖），
            最小下单单位按板块校验（主板 100 股整数倍、科创板 200 股起、北交所 100 股起）。
            净值曲线是<b>每日权益快照</b>（同一交易日覆盖，收盘后打开面板即收盘权益），与上面的实时权益口径不同；参考打分只做观察，不参与成交。
            历史表现不代表未来收益，本面板不构成投资建议。
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

.session-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}
.session-pill.open { color: var(--green); background: var(--green-bg); }
.session-pill.closed { color: var(--text-muted); background: var(--fog); }

/* ── 工具条 ── */
.run-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.run-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.run-meta {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.run-meta b { color: var(--text-secondary); font-weight: 600; }
.dot { margin: 0 6px; color: var(--dove); }
.run-right { display: flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
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
  line-height: 1.6;
  flex-shrink: 0;
}
.paper-error { color: var(--danger-ink); background: var(--danger-bg); }
.paper-hint { color: var(--text-secondary); background: var(--fog); }
.paper-hint.migrate { color: var(--warn-ink); background: var(--warn-bg); }
.paper-hint .link-btn { margin-left: 8px; font-size: 12px; }

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
.metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
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

/* ── 下单卡 ── */
.trade-card {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.trade-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.trade-sub { font-size: 11.5px; color: var(--text-muted); }
.trade-sub b { color: var(--text-secondary); font-weight: 600; }

.trade-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.trade-name { font-size: 13px; }
.trade-price { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.trade-chg { font-size: 11.5px; font-weight: 500; margin-left: 2px; }
.trade-err { font-size: 12px; color: var(--danger-ink); }
.trade-limit { margin-left: auto; font-size: 11.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.trade-limit b { color: var(--text-secondary); font-weight: 600; }

.quick-group { display: flex; gap: 4px; }
.quick-btn {
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}
.quick-btn:hover { border-color: var(--rust); color: var(--rust); background: var(--hover-bg); }

.icon-refresh {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  padding: 2px 4px;
}
.icon-refresh:hover { color: var(--rust); text-decoration: underline; }

.preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 4px 0 10px;
}
.preview-col {
  padding: 9px 11px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--fog);
  min-width: 0;
}
.preview-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.preview-held { font-size: 11.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.preview-line { font-size: 12px; color: var(--text-secondary); line-height: 1.8; font-variant-numeric: tabular-nums; }
.preview-line.muted { color: var(--text-muted); }
.preview-line b { color: var(--text-primary); font-weight: 600; }

.trade-actions { display: flex; align-items: center; gap: 8px; }
.trade-btn {
  min-width: 92px;
  padding: 8px 18px;
  border: none;
  border-radius: var(--radius-full);
  color: var(--white);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}
.trade-btn.buy { background: var(--red); }
.trade-btn.sell { background: var(--green); }
.trade-btn:active:not(:disabled) { transform: scale(0.98); }
.trade-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.trade-blocked { font-size: 11.5px; color: var(--warn-ink); }
.trade-blocked.muted { color: var(--text-muted); }

/* ── 净值卡 ── */
.nav-card {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.nav-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.nav-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.nav-days { font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.nav-svg { display: block; width: 100%; height: 90px; }
.nav-empty { font-size: 12.5px; color: var(--text-muted); text-align: center; padding: 24px 0; }
.nav-warn { margin-top: 6px; font-size: 12px; color: var(--warn-ink); }

/* ── 最近成交 / 参考分 ── */
.pending-card,
.score-card {
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

.score-sub { margin-left: 8px; font-weight: 400; font-size: 11.5px; color: var(--text-muted); }
.score-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12.5px;
}
.score-bar {
  flex: 1;
  min-width: 40px;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--border-light);
  overflow: hidden;
}
.score-bar-fill { display: block; height: 100%; background: var(--graphite); border-radius: var(--radius-full); }
.score-num { width: 34px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
.score-num.muted { color: var(--text-muted); font-weight: 400; }
.score-tag {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: 11px;
  border-radius: var(--radius-full);
  color: var(--warn-ink);
  background: var(--warn-bg);
}
.score-tag.muted { color: var(--text-muted); background: var(--hover-bg); }
.score-tag.pattern {
  color: var(--text-secondary);
  background: var(--hover-bg);
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 表格 ── */
.paper-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
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
.pnl-pct { display: block; font-size: 11px; color: var(--text-muted); }
.pool-ops { display: flex; align-items: center; gap: 6px; }

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
.side-tag.buy { color: var(--red); background: var(--red-bg); }
.side-tag.sell { color: var(--green); background: var(--green-bg); }

.up { color: var(--red); }
.down { color: var(--green); }

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
.ghost-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ghost-btn.danger { color: var(--danger-ink); border-color: rgba(220, 38, 38, 0.3); }
.ghost-btn.danger:hover:not(:disabled) { background: var(--danger-bg); border-color: var(--danger-ink); }
.ghost-btn.tiny { padding: 3px 10px; font-size: 11.5px; }

/* ── 自选 ── */
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
.cfg-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 14px; }
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
.danger-zone {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

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
.tab-empty-sub { font-size: 12px; color: var(--text-muted); max-width: 420px; text-align: center; line-height: 1.6; }
.tab-note { margin-top: 10px; font-size: 11.5px; line-height: 1.6; color: var(--text-muted); }
.tab-note.warn { color: var(--warn-ink); }
.tab-note.overnight { color: var(--text-secondary); }
.tab-note.overnight b { color: var(--text-primary); font-weight: 600; }
/* ── 数量模式切换 ── */
.mode-toggle { display: flex; border: 1px solid var(--border); border-radius: var(--radius-full); overflow: hidden; }
.mode-btn {
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
}
.mode-btn.active { background: var(--fog); color: var(--text-primary); font-weight: 600; }
.trade-btn.confirming { background: var(--danger-ink); }

/* ── 复盘 ── */
.gap-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 8px; }
.gap-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: var(--fog);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.gap-item .m-label { font-size: 11px; font-weight: 400; }
.gap-table { margin-top: 8px; }

/* ── 账本备份 ── */
.ledger-title { margin-top: 16px; }
.ledger-row { display: flex; gap: 8px; margin-bottom: 8px; }
.ledger-textarea {
  width: 100%;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 1.5;
  outline: none;
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
</style>
