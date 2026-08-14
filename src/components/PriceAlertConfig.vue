<script setup>
/**
 * PriceAlertConfig.vue — 自定义价格/条件提醒配置主体（AlertsModal「价格提醒」Tab）
 * 为当前股票配置"突破/跌破目标价"提醒，可选放量条件（当日量 ≥ N 倍 5 日均量），
 * 触发时发送 Windows 原生通知（仅交易时段）。触发模式：一次性（触发后暂停）或每日（每交易日一次）。
 */
import { ref, computed } from "vue";
import { usePriceAlerts } from "../composables/usePriceAlerts.js";

const props = defineProps({
  stock: { type: Object, default: null },
});

const { alertsForCode, addAlert, updateAlert, removeAlert, rearmAlert, pauseAlert } = usePriceAlerts();

const list = computed(() => (props.stock ? alertsForCode(props.stock.code) : []));

// ── 新建表单（父级用 v-if + :key 挂载，每次进入本 Tab 都是全新实例，天然重置）──
const direction = ref("above"); // "above" | "below"
const targetPrice = ref("");
const volumeCondition = ref(false);
const volumeMultiple = ref(2);
const mode = ref("once"); // "once" | "daily"

// 默认目标价 = 当前价
{
  const p = props.stock?.price;
  targetPrice.value = p > 0 ? p.toFixed(2) : "";
}

const currentPrice = computed(() => props.stock?.price || 0);
const isHK = computed(() => {
  const s = props.stock;
  return s && (s.market === "HK" || (s.code && s.code.length === 5));
});
const currencySymbol = computed(() => (isHK.value ? "HK$" : "¥"));

const targetNum = computed(() => {
  const t = parseFloat(targetPrice.value);
  return t > 0 && !Number.isNaN(t) ? t : null;
});

/** 现价已在目标价另一侧（新建时会提示"回落/回升后重新突破才触发"） */
const pricePastTarget = computed(() => {
  const t = targetNum.value;
  if (!t || !currentPrice.value) return false;
  return direction.value === "above"
    ? currentPrice.value >= t
    : currentPrice.value <= t;
});

const formError = computed(() => {
  if (targetPrice.value.trim() === "") return "";
  if (!targetNum.value) return "请输入有效的目标价格";
  return "";
});

const DIR_OPTIONS = [
  { key: "above", label: "突破", desc: "现价上穿目标价" },
  { key: "below", label: "跌破", desc: "现价下穿目标价" },
];
const MODE_OPTIONS = [
  { key: "once", label: "一次性", desc: "触发后自动暂停" },
  { key: "daily", label: "每日", desc: "每交易日最多一次" },
];

const DIR_LABELS = { above: "突破", below: "跌破" };

function submitAdd() {
  if (!props.stock || !targetNum.value) return;
  addAlert({
    code: props.stock.code,
    name: props.stock.name || props.stock.code,
    direction: direction.value,
    price: targetNum.value,
    volumeCondition: volumeCondition.value,
    volumeMultiple: volumeMultiple.value || 2,
    mode: mode.value,
  });
  // 添加成功后清空价格输入，方便连续添加
  targetPrice.value = "";
}

function toggleEnabled(alert) {
  if (alert.enabled) {
    pauseAlert(alert.id);
  } else {
    rearmAlert(alert.id);
  }
}

/** 提醒状态文案 */
function statusText(alert) {
  if (!alert.enabled) {
    return alert.triggeredAt ? "已触发 · 已暂停" : "已暂停";
  }
  if (alert.triggeredAt) {
    const d = new Date(alert.triggeredAt);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return alert.mode === "once" ? `已触发 ${hm}` : `今日已触发 ${hm} · 继续监控`;
  }
  return "监控中";
}

function fmtPrice(v) {
  return Number(v).toFixed(2);
}
</script>

<template>
  <div class="pa-body">
    <!-- 现价条 -->
    <div class="pa-price-strip">
      <span class="pa-price-label">现价</span>
      <span class="pa-price-val">{{ currencySymbol }}{{ fmtPrice(currentPrice) }}</span>
      <span class="pa-price-note">仅交易时段检测 · 可对任意股票设置（不限于自选）</span>
    </div>

    <!-- 已有提醒列表 -->
    <div v-if="list.length" class="pa-section">
      <p class="setting-group-title">已设提醒（{{ list.length }}）</p>
      <div class="pa-alert-list">
        <div v-for="alert in list" :key="alert.id" class="pa-alert-row" :class="{ paused: !alert.enabled }">
          <div class="pa-alert-main">
            <span class="pa-alert-dir" :class="alert.direction === 'above' ? 'dir-above' : 'dir-below'">
              {{ DIR_LABELS[alert.direction] }}
            </span>
            <span class="pa-alert-price">{{ currencySymbol }}{{ fmtPrice(alert.price) }}</span>
            <span v-if="alert.volumeCondition" class="pa-chip-vol" title="当日成交量 ≥ 目标倍数 × 5日均量才触发">
              放量 {{ alert.volumeMultiple }}×
            </span>
            <span class="pa-chip-mode">{{ alert.mode === "once" ? "一次性" : "每日" }}</span>
            <span class="pa-alert-status">{{ statusText(alert) }}</span>
          </div>
          <div class="pa-alert-actions">
            <button
              class="pa-toggle"
              :class="{ on: alert.enabled }"
              :title="alert.enabled ? '暂停' : '重新启用'"
              @click="toggleEnabled(alert)"
            >
              <span class="pa-toggle-dot"></span>
            </button>
            <button class="pa-del" title="删除提醒" @click="removeAlert(alert.id)">
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建提醒 -->
    <div class="pa-section">
      <p class="setting-group-title">新建提醒</p>

      <div class="pa-form-row">
        <span class="pa-form-label">方向</span>
        <div class="pa-dirs">
          <button
            v-for="opt in DIR_OPTIONS"
            :key="opt.key"
            class="pa-dir-btn"
            :class="{ active: direction === opt.key }"
            :title="opt.desc"
            @click="direction = opt.key"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="pa-form-row">
        <span class="pa-form-label">目标价</span>
        <div class="pa-price-input-wrap">
          <span class="pa-input-currency">{{ currencySymbol }}</span>
          <input
            v-model="targetPrice"
            type="number"
            step="0.01"
            min="0"
            class="pa-input"
            :placeholder="'如 ' + (currentPrice ? fmtPrice(currentPrice) : '0.00')"
            @keyup.enter="submitAdd"
          />
          <span v-if="formError" class="pa-form-error">{{ formError }}</span>
        </div>
      </div>
      <p v-if="pricePastTarget" class="pa-warn">
        ⚠️ 现价已{{ direction === "above" ? "高于" : "低于" }}目标价，将等待价格{{ direction === "above" ? "回落并再次突破" : "回升并再次跌破" }}后才触发。
      </p>

      <div class="pa-form-row">
        <span class="pa-form-label">附加条件</span>
        <label class="pa-vol-toggle">
          <input type="checkbox" v-model="volumeCondition" class="hidden-check" />
          <span class="pa-vol-chip" :class="{ active: volumeCondition }">放量</span>
        </label>
        <template v-if="volumeCondition">
          <span class="pa-vol-sep">≥</span>
          <input v-model.number="volumeMultiple" type="number" min="1" step="0.5" class="pa-input pa-input-sm" />
          <span class="pa-vol-note">× 5日均量</span>
        </template>
      </div>
      <p v-if="volumeCondition" class="pa-hint">早盘时段累计成交量偏低，放量倍数可能难以达标，建议盘中后段观察。</p>

      <div class="pa-form-row">
        <span class="pa-form-label">触发模式</span>
        <div class="pa-dirs">
          <button
            v-for="opt in MODE_OPTIONS"
            :key="opt.key"
            class="pa-dir-btn"
            :class="{ active: mode === opt.key }"
            :title="opt.desc"
            @click="mode = opt.key"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <button class="pa-add-btn" :disabled="!!formError || !targetNum" @click="submitAdd">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        添加提醒
      </button>
    </div>

    <!-- 状态条 -->
    <div class="pa-status" :class="{ muted: list.length === 0 }">
      <span class="pa-status-dot"></span>
      <template v-if="list.length">
        <span>{{ list.filter((a) => a.enabled).length }} 个提醒监控中 · 一次性触发后自动暂停，可随时重新启用</span>
      </template>
      <template v-else>
        <span>尚未设置提醒 — 填写上方表单即可添加</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pa-body {
  padding: 20px;
  overflow-y: auto;
}

.setting-group-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin: 0 0 10px;
}

/* ── 现价条 ── */
.pa-price-strip {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--fog);
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.pa-price-label {
  font-size: 12px;
  color: var(--text-muted);
}
.pa-price-val {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.pa-price-note {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}

/* ── 分区 ── */
.pa-section {
  margin-bottom: 20px;
}

/* ── 已有提醒列表 ── */
.pa-alert-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pa-alert-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  transition: opacity 0.15s;
}
.pa-alert-row.paused {
  opacity: 0.55;
}
.pa-alert-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.pa-alert-dir {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}
.pa-alert-dir.dir-above {
  background: var(--red-bg);
  color: var(--red);
}
.pa-alert-dir.dir-below {
  background: var(--green-bg);
  color: var(--green);
}
.pa-alert-price {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.pa-chip-vol,
.pa-chip-mode {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--fog);
  color: var(--text-muted);
}
.pa-chip-vol {
  background: var(--apricot-wash);
  color: var(--rust);
}
.pa-alert-status {
  font-size: 11px;
  color: var(--text-muted);
}
.pa-alert-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* 开关 */
.pa-toggle {
  width: 34px;
  height: 20px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--border);
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
  padding: 0;
}
.pa-toggle.on {
  background: var(--rust);
}
.pa-toggle-dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
}
.pa-toggle.on .pa-toggle-dot {
  left: 17px;
}

.pa-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.pa-del:hover {
  background: var(--fog);
  color: var(--red);
}

/* ── 新建表单 ── */
.pa-form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.pa-form-label {
  width: 64px;
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.pa-dirs {
  display: flex;
  gap: 8px;
}
.pa-dir-btn {
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.pa-dir-btn:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.pa-dir-btn.active {
  border-color: var(--ink);
  background: var(--ink);
  color: #fff;
}

.pa-price-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
}
.pa-input {
  width: 140px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card-bg);
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  outline: none;
  transition: border-color 0.15s;
}
.pa-input:focus {
  border-color: var(--ink);
}
.pa-input-sm {
  width: 72px;
}
.pa-input-currency {
  font-size: 13px;
  color: var(--text-muted);
}
.pa-form-error {
  font-size: 11px;
  color: var(--red);
}

.pa-warn {
  font-size: 11px;
  color: #b45309;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 8px;
  padding: 6px 10px;
  margin: -4px 0 12px 74px;
  line-height: 1.5;
}

.pa-vol-toggle {
  cursor: pointer;
}
.hidden-check {
  display: none;
}
.pa-vol-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  transition: all 0.15s;
}
.pa-vol-chip:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.pa-vol-chip.active {
  border-color: var(--rust);
  background: var(--apricot-wash);
  color: var(--rust);
}
.pa-vol-sep {
  font-size: 12px;
  color: var(--text-muted);
}
.pa-vol-note {
  font-size: 12px;
  color: var(--text-muted);
}
.pa-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: -6px 0 12px 74px;
  line-height: 1.5;
}

.pa-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 22px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--rust);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  box-shadow: var(--shadow-card);
}
.pa-add-btn:hover:not(:disabled) {
  background: #4a2215;
  box-shadow: var(--shadow-elevated);
}
.pa-add-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── 状态条 ── */
.pa-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--green-bg);
  color: var(--green);
  font-size: 12px;
  font-weight: 500;
}
.pa-status.muted {
  background: var(--fog);
  color: var(--text-muted);
}
.pa-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
</style>
