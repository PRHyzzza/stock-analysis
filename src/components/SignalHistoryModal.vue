<script setup>
/**
 * SignalHistoryModal.vue — 历史信号胜率面板（本地历史库「读」回路）
 *
 * 背景：`signal_event` 表自建库起只写不读（`StockDetail.vue` 把日内量价陷阱/放量信号
 * 落库，但没有任何界面消费它）。本面板补上这条回路：把**真实落库过的信号**取回来，
 * 与之后真实走出的**日 K** 对照，展示「这些信号后来怎么样了」。
 *
 * 与 BacktestModal 的分工（PROJECT.md §7.19 / §7.26，UI 必须如实区分）：
 *   - BacktestModal 是**规则回测**：把 8 条日线规则在历史 K 线上重放，样本是规则触发次数。
 *   - 本面板是**实盘记录统计**：只统计真的被落库过的信号（即你当时确实打开过该股分时图），
 *     样本天然稀疏且存在选择偏差，因此**不等于策略胜率**。
 *
 * 数据全部来自 `useSignalHistory`（唯一真源，本组件不重算口径、不直接 invoke）：
 *   - 收益一律**按日 K 收盘价估算**（信号是日内信号，但分时数据不落库，无法回算日内收益）
 *   - 胜负**按信号方向**判定：bull 涨了算胜、bear 跌了算胜；方向 unknown 不计入胜率
 *
 * 注意：`useSignalHistory` **不是单例**（每次调用返回新实例，状态不会跨组件共享）。
 * 当前全项目只有本组件调用它，故不存在重复 IPC；若将来在 `App.vue` 等处再调一次，
 * 两边会各自拉一遍 `get_signal_events` + 逐只日 K，届时需改为单例（见 PROJECT.md §7.12 的同类约定）。
 *
 * 重要：`events` / `statsByPeriod` 等是 ref，模板中必须 `.value`；
 * `statsByPeriod` / `byName` / `byCode` 是 computed 且依赖 barsCache，
 * 故打开面板必须 `await ensureAllBars()`，否则统计全空。
 *
 * null 口径：`winRatePct` / `avgRetPct` / `profitFactor` / `bestPct` / `worstPct`
 * 均可能为 null（无有效样本），一律显示 `--`，绝不渲染 NaN / null / Infinity。
 */
import { ref, computed, watch } from "vue";
import { useSignalHistory, HOLD_PERIODS } from "../composables/useSignalHistory.js";
import { trendClass } from "../utils/format.js";

const props = defineProps({
  show: { type: Boolean, default: false },
});

const emit = defineEmits(["close", "open-detail"]);

const sh = useSignalHistory();

/** 样本不足阈值（与 BacktestModal 的 MIN_SAMPLE 同口径：<10 笔仅供参考） */
const MIN_SAMPLE = 10;

/** 明细列表最多渲染条数（库里最多 500 条，全渲染会拖慢弹窗） */
const DETAIL_LIMIT = 100;

/** 最近若干条信号明细 */
const detailRows = computed(() => (sh.events.value || []).slice(0, DETAIL_LIMIT));

/** 明细被截断的条数（>0 时如实披露，避免误以为只有这些） */
const hiddenCount = computed(() =>
  Math.max(0, (sh.events.value?.length || 0) - detailRows.value.length)
);

// ── 打开流程 ──
/**
 * 必须「先拉事件、再补日 K」：`statsByPeriod` / `byName` / `byCode` 是依赖
 * `barsCache` 的 computed，不 await `ensureAllBars()` 的话统计会全是 0 样本。
 * `loadSignals` 失败时保留旧数据并置 error（§7.16），后续 ensureAllBars 仍会执行。
 *
 * 两个函数内部都已自行 catch（loadSignals 写 error、ensureBars 静默并记入
 * barsFailed），此处再兜一层 try/catch，确保 watch 里不被 await 的调用
 * 不会产生 unhandled rejection。
 */
async function reload() {
  try {
    await sh.loadSignals({});   // 全库（跨股票汇总）
    await sh.ensureAllBars();   // 补日K，然后 computed 才有数据
  } catch (e) {
    // 兜底：composable 已负责置 error，这里只防止未捕获 rejection
    if (!sh.error.value) sh.error.value = String(e?.message || e || "读取历史信号失败");
  }
}

/** 面板打开时加载（show 由 false → true） */
watch(
  () => props.show,
  (open) => {
    if (open) reload();
  },
  { immediate: true }
);

function closeModal() {
  emit("close");
}

/** 点击信号 → 切到该股详情；父组件负责关闭本弹窗 */
function openDetail(code) {
  if (code) emit("open-detail", code);
}

// ── 展示辅助（所有数值入口都先判 null，保证不出现 NaN） ──

/** 安全的统计对象取值（防御 stats 缺失） */
function statOf(stats) {
  return stats || {
    judged: 0, decided: 0, samples: 0, wins: 0, losses: 0, flats: 0,
    winRatePct: null, avgRetPct: null, profitFactor: null, unknownDir: 0,
  };
}

/** 百分比：null / NaN / Infinity → "--"（`Infinity` 必须显式拦掉，否则会渲染成 "Infinity%"） */
function pct(v) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(2) + "%";
}

/** 带符号百分比：null / NaN / Infinity → "--"（对齐 useSignalHistory 的方向收益口径） */
function signedPct(v) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
}

/** 盈亏比：null 表示无亏损样本（全胜/全负），显示 "--" 而非 Infinity */
function pfText(v) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(2);
}

/** 价格：<=0 或非法表示未记录 → "--" */
function priceText(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !(n > 0)) return "--";
  return n.toFixed(2);
}

/** 计数：缺字段按 0 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 持仓期：>=1 显示 "N 日"，否则 "--"（HOLD_PERIODS 恒为数字，此处仅防御） */
function holdText(p) {
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? `${n} 日` : "--";
}

/** 方向徽标文案 */
function dirLabel(dir) {
  if (dir === "bull") return "看涨";
  if (dir === "bear") return "看跌";
  return "未知";
}

/** 信号类型徽标文案 */
function kindLabel(kind) {
  if (kind === "trap") return "陷阱";
  if (kind === "volume") return "放量";
  return kind ? String(kind) : "未知";
}

/** 统计行的最小样本判定 */
function isThin(judged) {
  return num(judged) < MIN_SAMPLE;
}

/** 覆盖度披露所需的统计口径 */
const cov = computed(() => sh.coverage.value || {});
const evaluable = computed(() => num(cov.value.evaluable));
const totalEvents = computed(() => num(cov.value.total));
const failedCodes = computed(() => sh.barsFailed.value || []);

/** 有事件但一条都统计不了（缺价格或缺日K） */
const noEvaluable = computed(() => totalEvents.value > 0 && evaluable.value === 0);
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container sh-container">
        <div class="modal-header">
          <div class="modal-header-left">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--rust)" stroke-width="1.5">
              <path d="M2 16.5h16" stroke-linecap="round"/>
              <path d="M3 13l4-4.5 3.2 2.6L17 4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M13.5 4H17v3.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="modal-title">历史信号胜率</span>
            <span v-if="totalEvents > 0" class="count-pill">{{ totalEvents }} 条信号</span>
            <span v-if="sh.loading.value" class="count-pill loading-pill">加载中…</span>
          </div>
          <button class="modal-close" @click="closeModal" title="关闭">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- ══════ 加载态（首屏，无旧数据时） ══════ -->
          <div v-if="sh.loading.value && totalEvents === 0" class="state-block">
            <span class="state-spinner"></span>
            <span class="state-text">正在读取本地历史库…</span>
          </div>

          <template v-else>
            <!-- ══════ 错误态（失败保留旧数据，只提示不静默） ══════ -->
            <div v-if="sh.error.value" class="error-block">
              <span class="error-text">读取历史信号失败：{{ sh.error.value }}</span>
              <button class="btn-retry" @click="reload">重试</button>
            </div>

            <!-- ══════ 空状态 / 无数据（本地库还没有任何信号，且不是加载失败） ══════ -->
            <div v-if="totalEvents === 0 && !sh.error.value" class="state-block tall">
              <span class="state-main">本地历史库中还没有信号记录</span>
              <span class="state-sub">
                信号在你打开个股分时图时自动记录，先去个股页看几次就会有了
              </span>
            </div>

            <!-- ══════ 有数据：口径声明 + 统计（刷新失败时保留旧数据，见上方错误条） ══════ -->
            <template v-if="totalEvents > 0">
              <!-- ══════ 1. 口径声明区（强制，§7.19 / §7.26） ══════ -->
              <section class="sh-section calibre-box">
                <p class="sh-group-title">统计口径（必读）</p>
                <ul class="calibre-list">
                  <li>
                    本页统计的是<strong>真实落库过的信号</strong>（即你当时确实打开过该股分时图），
                    样本稀疏且存在选择偏差，<strong>不等于策略胜率</strong>
                  </li>
                  <li>
                    信号为日内信号，但分时数据不落库，收益一律<strong>按日K收盘价估算</strong>
                  </li>
                  <li>
                    胜负按<strong>信号方向</strong>判定：看涨信号涨了算胜，看跌信号跌了算胜；
                    <strong>方向未知的不计入胜率</strong>
                  </li>
                </ul>
              </section>

              <!-- ══════ 2. 覆盖度披露 ══════ -->
              <section class="sh-section cov-box">
                <p class="cov-line">
                  共 <b>{{ totalEvents }}</b> 条信号 /
                  <b>{{ num(cov.codes) }}</b> 只股票 /
                  其中 <b>{{ evaluable }}</b> 条已具备价格与日K
                </p>
                <p v-if="evaluable > 0" class="cov-note">
                  实际参与统计的条数按持有期递减（信号若发生在日K末端，持有期越长越无足够K线可算），
                  一律以下方表格的「样本数」为准
                </p>
                <p v-if="num(cov.noPrice) > 0 || num(cov.noBars) > 0" class="cov-warn">
                  {{ num(cov.noPrice) }} 条未记录价格、{{ num(cov.noBars) }} 条缺日K，已排除在统计外
                </p>
              </section>

              <!-- ══════ 3. 有信号但无可统计样本 ══════ -->
              <section v-if="noEvaluable" class="sh-section empty-eval">
                <span class="state-main">
                  有 {{ totalEvents }} 条信号但均缺少价格或日K数据，暂时无法统计收益
                </span>
                <span v-if="failedCodes.length > 0" class="state-sub">
                  未取到日K的代码：{{ failedCodes.join("、") }}
                </span>
                <span class="state-sub">
                  日K来自本地历史库，个股页多翻几次会逐步补齐
                </span>
              </section>

              <template v-else>
                <!-- ══════ 4. 按持有期统计 ══════ -->
                <section class="sh-section">
                  <p class="sh-group-title">按持有期统计（交易日）</p>
                  <div class="stat-table">
                    <div class="stat-head">
                      <span class="c-period">持有期</span>
                      <span class="c-num">样本数</span>
                      <span class="c-num">胜率</span>
                      <span class="c-num">平均收益</span>
                      <span class="c-num">盈亏比</span>
                      <span class="c-note">备注</span>
                    </div>
                    <div v-for="p in HOLD_PERIODS" :key="'hp-' + p" class="stat-row">
                      <span class="c-period">{{ holdText(p) }}</span>
                      <span class="c-num">
                        {{ num(statOf(sh.statsByPeriod.value[p]).judged) }}
                        <span class="sub-num">/ {{ num(statOf(sh.statsByPeriod.value[p]).samples) }}</span>
                      </span>
                      <span class="c-num win-cell">{{ pct(statOf(sh.statsByPeriod.value[p]).winRatePct) }}</span>
                      <span class="c-num" :class="trendClass(statOf(sh.statsByPeriod.value[p]).avgRetPct)">
                        {{ signedPct(statOf(sh.statsByPeriod.value[p]).avgRetPct) }}
                      </span>
                      <span class="c-num">{{ pfText(statOf(sh.statsByPeriod.value[p]).profitFactor) }}</span>
                      <span class="c-note">
                        <span v-if="isThin(statOf(sh.statsByPeriod.value[p]).judged)" class="tag-thin">样本不足</span>
                        <span v-if="num(statOf(sh.statsByPeriod.value[p]).unknownDir) > 0" class="tag-unknown">
                          {{ num(statOf(sh.statsByPeriod.value[p]).unknownDir) }} 条方向未知未计入
                        </span>
                        <span v-if="num(statOf(sh.statsByPeriod.value[p]).flats) > 0" class="tag-unknown">
                          {{ num(statOf(sh.statsByPeriod.value[p]).flats) }} 条平盘未进退分母
                        </span>
                      </span>
                    </div>
                  </div>
                  <p class="foot-note">
                    样本数 = 可判定方向的条数 / 实际算出收益的条数；胜率 = 胜 ÷（胜 + 负），
                    平盘（0 收益）不进退分母、单独标注；盈亏比 = 总盈利 ÷ 总亏损，
                    无亏损样本时显示 --。样本少于 {{ MIN_SAMPLE }} 笔仅供参考。
                  </p>
                </section>

                <!-- ══════ 5. 按信号类型分组（3 日口径） ══════ -->
                <section class="sh-section">
                  <p class="sh-group-title">按信号类型分组（3 日口径）</p>
                  <div v-if="sh.byName.value.length === 0" class="state-block">
                    <span class="state-text">暂无分组数据</span>
                  </div>
                  <div v-else class="stat-table name-table">
                    <div class="stat-head">
                      <span class="c-name">信号名</span>
                      <span class="c-dir">方向</span>
                      <span class="c-num">出现次数</span>
                      <span class="c-num">可统计</span>
                      <span class="c-num">胜率</span>
                      <span class="c-num">平均收益</span>
                    </div>
                    <div v-for="g in sh.byName.value" :key="'n-' + g.name" class="stat-row">
                      <span class="c-name">{{ g.name || "(未命名)" }}</span>
                      <span class="c-dir">
                        <span class="dir-badge" :class="'d-' + (g.dir || 'unknown')">{{ dirLabel(g.dir) }}</span>
                      </span>
                      <span class="c-num">{{ num(g.count) }}</span>
                      <span class="c-num">{{ num(statOf(g.stats).judged) }}</span>
                      <span class="c-num win-cell">{{ pct(statOf(g.stats).winRatePct) }}</span>
                      <span class="c-num" :class="trendClass(statOf(g.stats).avgRetPct)">
                        {{ signedPct(statOf(g.stats).avgRetPct) }}
                      </span>
                    </div>
                  </div>
                </section>

                <!-- ══════ 6. 按股票分组（3 日口径，可点击进详情） ══════ -->
                <section class="sh-section">
                  <p class="sh-group-title">按股票分组（3 日口径）</p>
                  <div v-if="sh.byCode.value.length === 0" class="state-block">
                    <span class="state-text">暂无分组数据</span>
                  </div>
                  <div v-else class="stat-table code-table">
                    <div class="stat-head">
                      <span class="c-code">代码</span>
                      <span class="c-num">信号数</span>
                      <span class="c-date">最近日期</span>
                      <span class="c-num">胜率</span>
                    </div>
                    <button
                      v-for="c in sh.byCode.value"
                      :key="'c-' + c.code"
                      class="stat-row row-btn"
                      @click="openDetail(c.code)"
                      :title="`查看 ${c.code} 详情`"
                    >
                      <span class="c-code code-link">{{ c.code }}</span>
                      <span class="c-num">{{ num(c.count) }}</span>
                      <span class="c-date">{{ c.lastDate || "--" }}</span>
                      <span class="c-num win-cell">{{ pct(statOf(c.stats).winRatePct) }}</span>
                    </button>
                  </div>
                </section>

                <!-- ══════ 7. 信号明细 ══════ -->
                <section class="sh-section">
                  <p class="sh-group-title">
                    信号明细
                    <span class="title-note">最近 {{ detailRows.length }} 条</span>
                  </p>
                  <div class="stat-table detail-table">
                    <div class="stat-head">
                      <span class="c-date">日期</span>
                      <span class="c-time">时间</span>
                      <span class="c-code">代码</span>
                      <span class="c-name">信号名</span>
                      <span class="c-dir">方向</span>
                      <span class="c-kind">类型</span>
                      <span class="c-num">触发价</span>
                    </div>
                    <button
                      v-for="(ev, i) in detailRows"
                      :key="'e-' + (ev.ts != null ? ev.ts : i) + '-' + (ev.code || '')"
                      class="stat-row row-btn"
                      @click="openDetail(ev.code)"
                      :title="`查看 ${ev.code} 详情`"
                    >
                      <span class="c-date">{{ ev.date || "--" }}</span>
                      <span class="c-time">{{ ev.time || "--" }}</span>
                      <span class="c-code code-link">{{ ev.code || "--" }}</span>
                      <span class="c-name detail-name" :title="ev.detail || ev.name">
                        {{ ev.name || "(未命名)" }}
                      </span>
                      <span class="c-dir">
                        <span class="dir-badge" :class="'d-' + (ev.dir || 'unknown')">
                          {{ dirLabel(ev.dir) }}
                        </span>
                      </span>
                      <span class="c-kind">
                        <span class="kind-badge" :class="'k-' + (ev.kind || 'other')">
                          {{ kindLabel(ev.kind) }}
                        </span>
                      </span>
                      <span class="c-num">{{ priceText(ev.price) }}</span>
                    </button>
                  </div>
                  <p v-if="hiddenCount > 0" class="foot-note">
                    仅显示最近 {{ detailRows.length }} 条，另有 {{ hiddenCount }} 条较早记录未展示
                  </p>
                </section>
              </template>
            </template>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
@import "../assets/modal.css";
</style>

<style scoped>
/* ===== 容器：比默认弹窗宽，容纳多列统计表 ===== */
.modal-overlay {
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
  animation: none;
}

.sh-container {
  width: 900px;
  max-height: 86vh;
}

.modal-header {
  padding: 20px 24px;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.count-pill {
  font-size: 11px;
  font-weight: 600;
  color: var(--rust);
  background: var(--apricot-wash);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-variant-numeric: tabular-nums;
}

.loading-pill {
  color: var(--text-secondary);
  background: var(--fog);
}

.modal-close {
  border-radius: 8px;
}

.modal-body {
  overflow-y: auto;
  padding: 20px 24px 24px;
  gap: 20px;
  display: flex;
  flex-direction: column;
}

/* ===== 通用区块 ===== */
.sh-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sh-group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  margin: 0;
  padding-left: 12px;
  position: relative;
}
.sh-group-title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 1px;
  bottom: 1px;
  width: 3px;
  border-radius: 2px;
  background: var(--rust);
}

.title-note {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

/* ===== 1. 口径声明区（最显眼，禁止弱化） ===== */
.calibre-box {
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--apricot-wash);
}

.calibre-box .sh-group-title {
  color: var(--rust);
}
.calibre-box .sh-group-title::before {
  background: var(--rust);
}

.calibre-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.calibre-list li {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--ink);
}

.calibre-list strong {
  font-weight: 700;
  color: var(--rust);
}

/* ===== 2. 覆盖度披露 ===== */
.cov-box {
  gap: 4px;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  background: var(--fog);
  border: 1px solid var(--border-light);
}

.cov-line {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.cov-line b {
  color: var(--ink);
  font-weight: 700;
}

.cov-warn {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* 口径提示：说明「已具备价格与日K」不等于任一持有期的实际样本数 */
.cov-note {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* ===== 统计表（通用栅格） ===== */
.stat-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.stat-head,
.stat-row {
  display: grid;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
}

.stat-head {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--fog);
}

.stat-row {
  border-top: 1px solid var(--border-light);
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  color: var(--ink);
  text-align: left;
  min-height: 34px;
}

.row-btn {
  width: 100%;
  border-left: none;
  border-right: none;
  border-bottom: none;
  cursor: pointer;
  transition: background 0.15s;
}
.row-btn:hover {
  background: var(--fog);
}

/* 持有期表：6 列 */
.stat-head,
.stat-row {
  grid-template-columns: 0.8fr 1fr 0.8fr 0.9fr 0.8fr 2.2fr;
}

.c-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.sub-num {
  font-size: 10px;
  color: var(--text-muted);
}

.c-period,
.c-name,
.c-date,
.c-time,
.c-code,
.c-dir,
.c-kind,
.c-note {
  text-align: left;
  min-width: 0;
}

.c-date,
.c-time,
.c-code {
  font-variant-numeric: tabular-nums;
}

.code-link {
  color: var(--rust);
  font-weight: 600;
}

/* 胜率用中性色：红绿在本项目专表涨跌，胜率不参与涨跌语义 */
.win-cell {
  font-weight: 700;
  color: var(--ink);
}

.up {
  color: var(--red);
}
.down {
  color: var(--green);
}

/* 备注列 */
.c-note {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-thin,
.tag-unknown {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.tag-thin {
  color: var(--rust);
  background: var(--apricot-wash);
}

.tag-unknown {
  color: var(--text-muted);
  background: var(--fog);
  border: 1px solid var(--border-light);
}

/* 信号类型表：6 列 */
.name-table .stat-head,
.name-table .stat-row {
  grid-template-columns: 2.2fr 0.8fr 0.8fr 0.8fr 0.8fr 0.9fr;
}

/* 股票表：4 列 */
.code-table .stat-head,
.code-table .stat-row {
  grid-template-columns: 1.2fr 0.8fr 1.2fr 0.9fr;
}

/* 明细表：7 列 */
.detail-table .stat-head,
.detail-table .stat-row {
  grid-template-columns: 1.1fr 0.7fr 0.9fr 2fr 0.7fr 0.7fr 0.9fr;
}

.detail-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 方向 / 类型徽标 */
.dir-badge,
.kind-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.dir-badge.d-bull {
  color: var(--red);
  background: var(--apricot-wash);
}
.dir-badge.d-bear {
  color: var(--green);
  background: var(--fog);
  border: 1px solid var(--border-light);
}
.dir-badge.d-unknown {
  color: var(--text-muted);
  background: var(--fog);
  border: 1px solid var(--border-light);
}

.kind-badge.k-trap {
  color: var(--rust);
  background: var(--apricot-wash);
}
.kind-badge.k-volume {
  color: var(--ink);
  background: var(--sky-wash);
}
.kind-badge.k-other {
  color: var(--text-muted);
  background: var(--fog);
  border: 1px solid var(--border-light);
}

.foot-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

/* ===== 空 / 加载 / 错误 / 无可统计样本 ===== */
.state-block {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 0;
  font-size: 12px;
  color: var(--text-muted);
}

.state-block.tall,
.empty-eval {
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 0;
  text-align: center;
}

.state-main {
  font-size: 14px;
  color: var(--text-secondary);
}

.state-sub,
.state-text {
  font-size: 12px;
  color: var(--text-muted);
}

.state-spinner {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  border-top-color: var(--rust);
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

.error-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  background: var(--fog);
  border: 1px solid var(--border);
}

.error-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.btn-retry {
  flex-shrink: 0;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--rust);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-retry:hover {
  background: var(--apricot-wash);
}
</style>
