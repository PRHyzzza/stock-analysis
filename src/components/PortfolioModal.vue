<script setup>
/**
 * PortfolioModal — 组合视角面板
 *
 * 与 PositionModal（逐只盈亏）的分工：本面板回答「这一篮子股票作为一个组合，
 * 赚了多少（当日 + 累计）、钱压在哪里（权重/行业/资产类别）、风险有多大
 * （集中度 HHI、最大单票、加权 PE）」。
 *
 * 数据全部来自单例 composable `usePortfolio`（唯一真源，本组件不重算口径）：
 *   - 金额一律为**折合人民币**（港股按 usePositions.fxRate 换算），与持仓弹窗一致
 *   - 但逐只明细表的「现价 / 成本 / 数量」仍按**原币种**展示（`currency` 字段），
 *     否则港股会被显示成一个用户不认识的数字
 *
 * 口径披露（项目铁律，禁止无标注展示统计）：
 *   1. 当日盈亏缺昨收 → 「N 只未计（缺昨收）」（不拿成本价凑数）
 *   2. 行业标签有缺失 → 覆盖率 + 「占比仅按已取到的 M 只市值计算」
 *   3. 含港股      → 汇率换算说明
 *   4. 加权 PE 剔除亏损股 → 「N 只亏损/无 PE 已剔除」
 *
 * 行业标签抓取由本组件驱动（composable 只提供缓存 + 去重）：
 * 逐只串行、失败静默，绝不阻断面板其余部分。
 */
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { signChar, fmtPct, trendClass } from "../utils/format";
import { usePortfolio } from "../composables/usePortfolio.js";

const props = defineProps({
  show: { type: Boolean, default: false },
});

const emit = defineEmits(["close", "open-detail"]);

const pf = usePortfolio();

/**
 * 金额千分位（人民币口径，保留 2 位）
 * 与 utils/format.js 的 fmtMoney（输入单位万元）口径不同，故保留本地实现并显式命名，禁止混用
 */
function fmtMoneyThousands(v) {
  const n = Number(v) || 0;
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 带符号金额：+1,234.00 / -1,234.00 */
function fmtSignedMoney(v) {
  if (v == null) return "--";
  const n = Number(v) || 0;
  return signChar(n) + (n < 0 ? "-" : "") + fmtMoneyThousands(Math.abs(n));
}

function closeModal() {
  emit("close");
}

function openDetail(row) {
  if (row?.code) emit("open-detail", row.code);
}

// ── 行业标签抓取 ──
/**
 * 注入 fetcher，避免 composable 直接依赖 tauri invoke。
 * 港股该命令固定返回「港股」，composable 将其视为「未知」而非失败入缓存。
 */
async function fetchIndustry(code) {
  const d = await invoke("get_stock_industry", { code });
  return d?.industry_name || "";
}

/** 为当前全部持仓补行业标签；任何异常都吞掉，不影响面板其余部分 */
async function loadIndustries() {
  try {
    const codes = pf.rows.value.map((r) => r.code).filter(Boolean);
    if (codes.length === 0) return;
    await pf.ensureIndustries(codes, fetchIndustry);
  } catch {
    /* 行业标签失败不应影响组合面板 */
  }
}

/** 重试：先清失败记录，再重新抓取 */
async function retryIndustries() {
  pf.resetIndustryFailures();
  await loadIndustries();
}

// 面板打开时抓取（show 由 false → true）
watch(
  () => props.show,
  (open) => {
    if (open) loadIndustries();
  },
  { immediate: true }
);

/** 是否仍在抓行业（用于加载态文案） */
function isIndustryLoading() {
  return pf.industryLoading.value.length > 0;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container portfolio-container">
        <div class="modal-header">
          <div class="modal-header-left">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--rust)" stroke-width="1.5">
              <path d="M2 17h16" stroke-linecap="round"/>
              <rect x="4" y="10" width="3" height="7" rx="0.6"/>
              <rect x="8.5" y="6" width="3" height="11" rx="0.6"/>
              <rect x="13" y="12.5" width="3" height="4.5" rx="0.6"/>
            </svg>
            <span class="modal-title">持仓组合</span>
            <span v-if="pf.count.value > 0" class="count-pill">{{ pf.count.value }} 只</span>
          </div>
          <button class="modal-close" @click="closeModal" title="关闭">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- ══════ 空状态 ══════ -->
          <div v-if="pf.isEmpty.value" class="pf-empty">
            <span class="empty-main">暂无持仓记录，请先在「持仓」中添加</span>
            <span class="empty-hint">添加后可在此查看组合盈亏、权重分布与集中度风险</span>
          </div>

          <template v-else>
            <!-- ══════ 1. 总览区（盈亏口径） ══════ -->
            <section class="pf-section">
              <p class="pf-group-title">总览</p>

              <div class="overview-grid">
                <div class="ov-item">
                  <span class="ov-label">总市值</span>
                  <span class="ov-value">¥{{ fmtMoneyThousands(pf.totalMarketValueCNY.value) }}</span>
                </div>
                <div class="ov-item">
                  <span class="ov-label">总成本</span>
                  <span class="ov-value">¥{{ fmtMoneyThousands(pf.totalCostCNY.value) }}</span>
                </div>
                <div class="ov-item">
                  <span class="ov-label">浮动盈亏</span>
                  <span class="ov-value" :class="trendClass(pf.totalProfitCNY.value)">
                    {{ fmtSignedMoney(pf.totalProfitCNY.value) }}
                  </span>
                </div>
                <div class="ov-item">
                  <span class="ov-label">盈亏率</span>
                  <span class="ov-value" :class="trendClass(pf.totalProfitPctCNY.value)">
                    {{ fmtPct(pf.totalProfitPctCNY.value) || "--" }}
                  </span>
                </div>
              </div>

              <!-- 当日盈亏：独立卡片，突出「今日」维度 -->
              <div class="day-card">
                <div class="day-main">
                  <span class="ov-label">当日盈亏</span>
                  <span class="day-value" :class="trendClass(pf.dayProfit.value.value)">
                    {{ signChar(pf.dayProfit.value.value) }}¥{{ fmtMoneyThousands(Math.abs(pf.dayProfit.value.value)) }}
                    <span v-if="pf.dayProfit.value.pct != null" class="day-pct">
                      {{ fmtPct(pf.dayProfit.value.pct) }}
                    </span>
                  </span>
                  <span v-if="pf.dayProfit.value.missing > 0" class="day-missing">
                    {{ pf.dayProfit.value.missing }} 只未计（缺昨收）
                  </span>
                </div>
                <div class="day-breadth">
                  <span class="breadth-item up">涨 {{ pf.dayBreadth.value.up }}</span>
                  <span class="breadth-sep">/</span>
                  <span class="breadth-item down">跌 {{ pf.dayBreadth.value.down }}</span>
                  <span v-if="pf.dayBreadth.value.flat > 0" class="breadth-item flat">
                    平 {{ pf.dayBreadth.value.flat }}
                  </span>
                </div>
              </div>

              <!-- 当日最好 / 最差（仅在有昨收数据时） -->
              <div v-if="pf.dayBestWorst.value.best" class="day-extremes">
                <span class="ext-item">
                  最佳
                  <button class="ext-link up" @click="openDetail(pf.dayBestWorst.value.best)">
                    {{ pf.dayBestWorst.value.best.name }}
                    {{ fmtSignedMoney(pf.dayBestWorst.value.best.dayProfitCNY) }}
                  </button>
                </span>
                <span class="ext-item">
                  最差
                  <button class="ext-link down" @click="openDetail(pf.dayBestWorst.value.worst)">
                    {{ pf.dayBestWorst.value.worst.name }}
                    {{ fmtSignedMoney(pf.dayBestWorst.value.worst.dayProfitCNY) }}
                  </button>
                </span>
              </div>
            </section>

            <!-- ══════ 2. 仓位分布 ══════ -->
            <section class="pf-section">
              <p class="pf-group-title">仓位分布</p>
              <div class="weight-list">
                <div
                  v-for="r in pf.rowsByProfit.value"
                  :key="'w-' + r.code"
                  class="weight-row"
                  @click="openDetail(r)"
                  :title="`查看 ${r.name}`"
                >
                  <div class="weight-head">
                    <span class="w-name">{{ r.name }}</span>
                    <span class="w-code">{{ r.code }}</span>
                    <span class="w-pct">{{ (r.weightPct || 0).toFixed(2) }}%</span>
                  </div>
                  <div class="weight-track">
                    <span
                      class="weight-fill"
                      :style="{ width: Math.min(100, Math.max(0, r.weightPct || 0)) + '%' }"
                    ></span>
                  </div>
                </div>
              </div>
            </section>

            <!-- ══════ 3. 集中度与风险区（与盈亏区视觉分开） ══════ -->
            <section class="pf-section risk-section">
              <p class="pf-group-title risk-title">集中度与风险</p>

              <div class="risk-grid">
                <div class="risk-item">
                  <span class="ov-label">前三大权重</span>
                  <span class="ov-value">{{ pf.top3WeightPct.value.toFixed(2) }}%</span>
                </div>
                <div class="risk-item">
                  <span class="ov-label">HHI</span>
                  <span class="ov-value">{{ Math.round(pf.hhi.value) }}</span>
                </div>
                <div class="risk-item">
                  <span class="ov-label">集中度</span>
                  <span class="ov-value">{{ pf.concentration.value.level }}</span>
                </div>
                <div class="risk-item">
                  <span class="ov-label">最大行业权重</span>
                  <span class="ov-value">
                    {{ pf.maxIndustryWeightPct.value == null ? "--" : pf.maxIndustryWeightPct.value.toFixed(2) + "%" }}
                  </span>
                </div>
              </div>

              <p class="risk-hint">{{ pf.concentration.value.hint }}</p>

              <div class="risk-rows">
                <div class="risk-row">
                  <span class="risk-row-label">最大单票</span>
                  <button
                    v-if="pf.topHolding.value"
                    class="ext-link"
                    @click="openDetail(pf.topHolding.value)"
                  >
                    {{ pf.topHolding.value.name }}（{{ pf.topHolding.value.code }}）
                    {{ (pf.topHolding.value.weightPct || 0).toFixed(2) }}%
                  </button>
                  <span v-else class="risk-row-value">--</span>
                </div>

                <div class="risk-row">
                  <span class="risk-row-label">加权 PE</span>
                  <span class="risk-row-value">
                    {{ pf.weightedPE.value.value == null ? "--" : pf.weightedPE.value.value.toFixed(2) }}
                    <span v-if="pf.weightedPE.value.excluded > 0" class="metric-note">
                      {{ pf.weightedPE.value.excluded }} 只亏损/无 PE 已剔除
                    </span>
                  </span>
                </div>
              </div>
            </section>

            <!-- ══════ 4. 行业分布 ══════ -->
            <section class="pf-section">
              <p class="pf-group-title">行业分布</p>

              <!-- 覆盖率标注（强制口径披露） -->
              <div v-if="pf.byIndustry.value.unknownCount > 0" class="coverage-note">
                <span class="metric-note block-note">
                  行业数据缺失 {{ pf.byIndustry.value.unknownCount }} 只（覆盖率
                  {{ pf.byIndustry.value.coveragePct.toFixed(0) }}%），占比仅按已取到的
                  {{ pf.byIndustry.value.knownCount }} 只市值计算
                </span>
                <button
                  v-if="!isIndustryLoading()"
                  class="btn-retry"
                  @click="retryIndustries"
                >重试</button>
              </div>

              <div v-if="pf.byIndustry.value.groups.length > 0" class="industry-list">
                <div
                  v-for="g in pf.byIndustry.value.groups"
                  :key="'ind-' + g.key"
                  class="industry-row"
                >
                  <div class="industry-head">
                    <span class="ind-name">{{ g.key }}</span>
                    <span class="ind-count">{{ g.count }} 只</span>
                    <span class="ind-value">¥{{ fmtMoneyThousands(g.marketValueCNY) }}</span>
                    <span class="ind-pct">{{ (g.weightPct || 0).toFixed(2) }}%</span>
                  </div>
                  <div class="weight-track">
                    <span
                      class="weight-fill ind-fill"
                      :style="{ width: Math.min(100, Math.max(0, g.weightPct || 0)) + '%' }"
                    ></span>
                  </div>
                </div>
              </div>

              <!-- 加载中 -->
              <div v-else-if="isIndustryLoading()" class="industry-state">
                <span class="state-spinner"></span>
                <span>正在获取行业标签…（{{ pf.industryLoading.value.length }} 只待处理）</span>
              </div>

              <!-- 失败/空态 + 重试 -->
              <div v-else class="industry-state">
                <span>暂无行业数据（获取失败或全部未取到）</span>
                <button class="btn-retry" @click="retryIndustries">重试</button>
              </div>
            </section>

            <!-- ══════ 5. 资产类别 ══════ -->
            <section class="pf-section">
              <p class="pf-group-title">资产类别</p>
              <div class="asset-list">
                <div
                  v-for="a in pf.byAssetClass.value"
                  :key="'ac-' + a.key"
                  class="asset-row"
                >
                  <span class="asset-key">{{ a.key }}</span>
                  <span class="asset-count">{{ a.count }} 只</span>
                  <span class="asset-value">¥{{ fmtMoneyThousands(a.marketValueCNY) }}</span>
                  <span class="asset-profit" :class="trendClass(a.profitCNY)">
                    {{ fmtSignedMoney(a.profitCNY) }}
                  </span>
                  <span class="asset-pct">{{ (a.weightPct || 0).toFixed(2) }}%</span>
                </div>
              </div>
              <p v-if="pf.hasHK.value" class="fx-note">
                * 港股已按 1 港元 ≈ {{ Number(pf.fxRate.value).toFixed(4) }} 人民币换算
              </p>
            </section>

            <!-- ══════ 6. 持仓明细表 ══════ -->
            <section class="pf-section">
              <p class="pf-group-title">持仓明细</p>
              <div class="detail-table">
                <div class="dt-head">
                  <span class="dt-c-name">名称/代码</span>
                  <span class="dt-c-num">现价</span>
                  <span class="dt-c-num">成本</span>
                  <span class="dt-c-num">数量</span>
                  <span class="dt-c-num">当日涨跌</span>
                  <span class="dt-c-num">浮动盈亏</span>
                  <span class="dt-c-num">盈亏率</span>
                  <span class="dt-c-num">权重</span>
                </div>
                <button
                  v-for="r in pf.rows.value"
                  :key="'d-' + r.code"
                  class="dt-row"
                  @click="openDetail(r)"
                  :title="`查看 ${r.name} 详情`"
                >
                  <span class="dt-c-name dt-name-cell">
                    <span class="dt-name">{{ r.name }}</span>
                    <span class="dt-code">{{ r.code }}</span>
                  </span>
                  <span class="dt-c-num">{{ r.currency }}{{ (r.currentPrice || 0).toFixed(2) }}</span>
                  <span class="dt-c-num">{{ r.currency }}{{ (r.buyPrice || 0).toFixed(2) }}</span>
                  <span class="dt-c-num">{{ r.quantity || 0 }}</span>
                  <span class="dt-c-num" :class="trendClass(r.dayChangePct)">
                    {{ r.dayChangePct == null ? "--" : fmtPct(r.dayChangePct) }}
                  </span>
                  <span class="dt-c-num" :class="trendClass(r.profitCNY)">
                    {{ fmtSignedMoney(r.profitCNY) }}
                  </span>
                  <span class="dt-c-num" :class="trendClass(r.profitPct)">
                    {{ fmtPct(r.profitPct) || "--" }}
                  </span>
                  <span class="dt-c-num dt-weight">{{ (r.weightPct || 0).toFixed(2) }}%</span>
                </button>
              </div>
            </section>
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
/* ===== 容器：比 PositionModal 宽，容纳 8 列明细表 ===== */
.modal-overlay {
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
  animation: none;
}

.portfolio-container {
  width: 860px;
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
.pf-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pf-group-title {
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
.pf-group-title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 1px;
  bottom: 1px;
  width: 3px;
  border-radius: 2px;
  background: var(--rust);
}

/* 风险区标题用不同色，强化「风险 ≠ 盈亏」的分区感 */
.risk-title::before {
  background: var(--ink);
}

/* ===== 1. 总览 ===== */
.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.ov-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
}
.ov-item:last-child {
  border-right: none;
}

.ov-label {
  font-size: 11px;
  color: var(--text-muted);
}

.ov-value {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.ov-value.up,
.day-value.up,
.ext-link.up,
.asset-profit.up,
.dt-c-num.up {
  color: var(--red);
}
.ov-value.down,
.day-value.down,
.ext-link.down,
.asset-profit.down,
.dt-c-num.down {
  color: var(--green);
}
.ov-value.flat,
.day-value.flat,
.ext-link.flat,
.asset-profit.flat,
.dt-c-num.flat {
  color: var(--text-secondary);
}

/* 当日盈亏卡片 */
.day-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-radius: var(--radius-md);
  background: var(--fog);
  border: 1px solid var(--border-light);
}

.day-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.day-value {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.day-pct {
  font-size: 12px;
  font-weight: 600;
  margin-left: 6px;
}

.day-missing {
  font-size: 11px;
  color: var(--text-muted);
}

.day-breadth {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.breadth-item.up { color: var(--red); }
.breadth-item.down { color: var(--green); }
.breadth-item.flat { color: var(--text-muted); }
.breadth-sep { color: var(--text-muted); }

.day-extremes {
  display: flex;
  gap: 20px;
  font-size: 11px;
  color: var(--text-muted);
  padding-left: 2px;
}

.ext-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ext-link {
  border: none;
  background: transparent;
  padding: 0;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  color: var(--rust);
  text-decoration: none;
}
.ext-link:hover {
  text-decoration: underline;
}

/* ===== 2. 仓位分布 ===== */
.weight-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.weight-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
}

.weight-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}

.w-name {
  font-weight: 600;
  color: var(--ink);
}

.w-code {
  font-size: 11px;
  color: var(--text-muted);
}

.w-pct {
  margin-left: auto;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.weight-track {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--fog);
  overflow: hidden;
}

.weight-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--rust);
  transition: width 0.3s ease;
  min-width: 2px;
}

.ind-fill {
  background: var(--sky-wash);
}

/* ===== 3. 集中度与风险 ===== */
.risk-section {
  padding: 16px;
  border-radius: var(--radius-md);
  background: var(--fog);
  border: 1px solid var(--border-light);
}

.risk-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.risk-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  background: var(--card-bg);
  border-radius: var(--radius-sm);
}

.risk-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
}

.risk-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.risk-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.risk-row-label {
  color: var(--text-muted);
  flex-shrink: 0;
  min-width: 72px;
}

.risk-row-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.metric-note {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 6px;
}

.block-note {
  margin: 0;
  line-height: 1.5;
}

/* 覆盖率标注 + 重试同一行 */
.coverage-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.coverage-note .block-note {
  margin-left: 0;
}

/* ===== 4. 行业分布 ===== */
.industry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.industry-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}

.ind-name {
  font-weight: 600;
  color: var(--ink);
}

.ind-count {
  font-size: 11px;
  color: var(--text-muted);
}

.ind-value {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.ind-pct {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  min-width: 56px;
  text-align: right;
}

.industry-state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 0;
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

.btn-retry {
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

/* ===== 5. 资产类别 ===== */
.asset-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.asset-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  background: var(--fog);
  font-size: 12px;
}

.asset-key {
  font-weight: 600;
  color: var(--ink);
  min-width: 44px;
}

.asset-count {
  font-size: 11px;
  color: var(--text-muted);
}

.asset-value {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.asset-profit {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  min-width: 92px;
  text-align: right;
}

.asset-pct {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  min-width: 56px;
  text-align: right;
}

.fx-note {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
}

/* ===== 6. 持仓明细表 ===== */
.detail-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.dt-head,
.dt-row {
  display: grid;
  grid-template-columns: 1.6fr 0.9fr 0.9fr 0.7fr 0.9fr 1.1fr 0.8fr 0.8fr;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
}

.dt-head {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--fog);
}

.dt-row {
  border: none;
  border-top: 1px solid var(--border-light);
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
  width: 100%;
}
.dt-row:hover {
  background: var(--fog);
}

.dt-c-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.dt-name-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-align: left;
}

.dt-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dt-code {
  font-size: 10px;
  color: var(--text-muted);
}

.dt-weight {
  font-weight: 700;
  color: var(--text-secondary);
}

/* ===== 空状态 ===== */
.pf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 56px 0;
  color: var(--text-muted);
  font-size: 14px;
}

.empty-hint {
  font-size: 12px;
  opacity: 0.7;
}
</style>
