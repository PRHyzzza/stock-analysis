<script setup>
/**
 * AlertsModal.vue — 合并的个股提醒弹窗（均线提醒 + 价格提醒）
 * 两个 Tab：均线提醒（穿越均线通知）/ 价格提醒（突破/跌破目标价 + 放量条件）。
 * 通过 v-if + :key 切换挂载，切换股票时配置组件自动重置。
 */
import { ref, watch } from "vue";
import MaAlertConfig from "./MaAlertConfig.vue";
import PriceAlertConfig from "./PriceAlertConfig.vue";

const props = defineProps({
  show: { type: Boolean, default: false },
  stock: { type: Object, default: null },
  klineData: { type: Array, default: null },
  klinePeriod: { type: String, default: "day" },
});

const emit = defineEmits(["close"]);

const tab = ref("ma"); // "ma" | "price"

// 每次打开弹窗回到"均线提醒"Tab
watch(
  () => props.show,
  (v) => {
    if (v) tab.value = "ma";
  }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
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
            <span class="modal-title">提醒</span>
            <span class="modal-badge" v-if="stock">{{ stock.name }} ({{ stock.code }})</span>
          </div>
          <button class="btn-close" @click="emit('close')">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <!-- Tab 切换 -->
        <div class="alerts-tabs">
          <button
            class="alerts-tab"
            :class="{ active: tab === 'ma' }"
            @click="tab = 'ma'"
          >均线提醒</button>
          <button
            class="alerts-tab"
            :class="{ active: tab === 'price' }"
            @click="tab = 'price'"
          >价格提醒</button>
        </div>

        <div class="modal-body">
          <MaAlertConfig
            v-if="tab === 'ma'"
            :key="'ma-' + (stock?.code || '')"
            :stock="stock"
            :kline-data="klineData"
            :kline-period="klinePeriod"
          />
          <PriceAlertConfig
            v-else
            :key="'price-' + (stock?.code || '')"
            :stock="stock"
          />
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
  width: 540px;
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

/* ── Tab 切换 ── */
.alerts-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 20px 0;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.alerts-tab {
  padding: 8px 18px;
  border: none;
  border-radius: 8px 8px 0 0;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.alerts-tab:hover {
  color: var(--text-primary);
}
.alerts-tab.active {
  color: var(--rust);
  border-bottom-color: var(--rust);
}
</style>
