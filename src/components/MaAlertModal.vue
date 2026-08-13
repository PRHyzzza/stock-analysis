<script setup>
/**
 * MaAlertModal.vue — 个股均线提醒配置弹窗
 *
 * 每只股票独立配置监控的均线周期（5/10/20/30/60 日）与触发方向（上穿/下穿/双向）。
 * 股价穿越均线时发送 Windows 原生通知（仅交易时段，每周期每日一次）。
 */
import { computed } from "vue";
import { useMaAlerts, MA_PERIODS } from "../composables/useMaAlerts.js";

const props = defineProps({
  show: { type: Boolean, default: false },
  stock: { type: Object, default: null },
  klineData: { type: Array, default: null },
  klinePeriod: { type: String, default: "day" },
});

const emit = defineEmits(["close"]);

const { getConfig, togglePeriod, setDirection } = useMaAlerts();

const cfg = computed(() => (props.stock ? getConfig(props.stock.code) : null));
const activePeriods = computed(() => cfg.value?.periods || []);
const direction = computed(() => cfg.value?.direction || "both");

function isActive(p) {
  return activePeriods.value.includes(p);
}

function closeModal() {
  emit("close");
}

/** 基于日 K 计算各周期当前均线值（仅日K数据时有效，供参考） */
const maValues = computed(() => {
  const k = props.klineData;
  if (!k || k.length < 5 || props.klinePeriod !== "day") return {};
  const closes = k.map((x) => x.close);
  const out = {};
  for (const p of MA_PERIODS) {
    if (closes.length < p) continue;
    out[p] = closes.slice(-p).reduce((a, b) => a + b, 0) / p;
  }
  return out;
});

const price = computed(() => props.stock?.price || 0);

/** 现价相对均线位置：线上（多头）红色，线下（空头）绿色（A 股惯例） */
function posCls(ma) {
  if (!ma || !price.value) return "";
  return price.value >= ma ? "above" : "below";
}

const DIR_OPTIONS = [
  { key: "both", label: "双向" },
  { key: "cross_up", label: "仅上穿" },
  { key: "cross_down", label: "仅下穿" },
];

const directionLabel = computed(
  () => DIR_OPTIONS.find((d) => d.key === direction.value)?.label || "双向"
);
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container">
        <!-- 头部 -->
        <div class="modal-header">
          <div class="modal-title-row">
            <span class="bell-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M10 20a2 2 0 0 0 4 0" stroke-linecap="round"/>
              </svg>
            </span>
            <span class="modal-title">均线提醒</span>
            <span class="modal-badge" v-if="stock">{{ stock.name }} ({{ stock.code }})</span>
          </div>
          <button class="btn-close" @click="closeModal">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <!-- 配置区 -->
        <div class="modal-body ma-body">
          <p class="ma-tip">股价穿越所选均线时发送 Windows 通知，仅交易时段生效，每只股票每个均线每日通知一次。</p>

          <div class="ma-section">
            <p class="setting-group-title">监控周期</p>
            <div class="ma-chips">
              <label
                v-for="p in MA_PERIODS"
                :key="p"
                class="ma-chip"
                :class="{ active: isActive(p) }"
              >
                <input
                  type="checkbox"
                  :checked="isActive(p)"
                  @change="stock && togglePeriod(stock.code, p)"
                  class="hidden-check"
                />
                <span>MA{{ p }}</span>
                <span v-if="maValues[p]" class="ma-chip-val" :class="posCls(maValues[p])">
                  {{ maValues[p].toFixed(2) }}
                </span>
              </label>
            </div>
            <p v-if="klinePeriod !== 'day'" class="ma-hint">当前图表非日K，均线参考值以日K为准（切换日K后显示）。</p>
          </div>

          <div class="ma-section">
            <p class="setting-group-title">触发方向</p>
            <div class="ma-dirs">
              <button
                v-for="opt in DIR_OPTIONS"
                :key="opt.key"
                class="ma-dir-btn"
                :class="{ active: direction === opt.key }"
                :disabled="!cfg"
                @click="stock && setDirection(stock.code, opt.key)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- 状态 -->
          <div class="ma-status" :class="{ muted: !cfg }">
            <span class="ma-status-dot"></span>
            <template v-if="cfg">
              <span>已启用：{{ activePeriods.map((p) => "MA" + p).join(" / ") }} · {{ directionLabel }}</span>
            </template>
            <template v-else>
              <span>未启用 — 点击上方均线周期即可开启</span>
            </template>
          </div>
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
  width: 460px;
}

.modal-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bell-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--apricot-wash);
  color: var(--rust);
}

.modal-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--fog);
  padding: 2px 10px;
  border-radius: var(--radius-full);
}

.ma-body {
  padding: 20px;
  overflow-y: auto;
}

.ma-tip {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0 0 18px;
}

.ma-section {
  margin-bottom: 18px;
}

/* ── 周期 Chips（与设置页风格一致）── */
.ma-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ma-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}
.ma-chip:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.ma-chip.active {
  border-color: var(--ink);
  background: var(--ink);
  color: #fff;
}
.hidden-check {
  display: none;
}

/* 均线参考值：线上红色 / 线下绿色（A 股惯例） */
.ma-chip-val {
  font-size: 11px;
  font-weight: 600;
}
.ma-chip-val.above { color: var(--red); }
.ma-chip-val.below { color: var(--green); }
.ma-chip.active .ma-chip-val.above,
.ma-chip.active .ma-chip-val.below {
  color: #fff;
}

.ma-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 8px 0 0;
}

/* ── 方向单选 ── */
.ma-dirs {
  display: flex;
  gap: 8px;
}
.ma-dir-btn {
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
.ma-dir-btn:hover:not(:disabled) {
  border-color: var(--ink);
  color: var(--ink);
}
.ma-dir-btn.active {
  border-color: var(--ink);
  background: var(--ink);
  color: #fff;
}
.ma-dir-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── 状态条 ── */
.ma-status {
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
.ma-status.muted {
  background: var(--fog);
  color: var(--text-muted);
}
.ma-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
</style>
