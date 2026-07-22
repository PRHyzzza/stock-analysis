<script setup>
/**
 * IndicatorCard.vue — 技术指标展示卡片（在 TechAnalysisModal 中使用）
 *
 * Props:
 *  - title: 指标名称
 *  - rows:  [{ label, value, cls }]  指标数据行
 *  - signal: { text, cls }           金叉/死叉信号
 *  - status: { text, cls }           超买/超卖状态
 *  - detail: 底部描述文字
 *  - alignment: { text, cls }        均线排列形态（可选，仅 MA 使用）
 */
defineProps({
  title: { type: String, required: true },
  rows: { type: Array, default: () => [] },
  signal: { type: Object, default: null },
  status: { type: Object, default: null },
  detail: { type: String, default: "" },
  alignment: { type: Object, default: null },
});
</script>

<template>
  <div class="tech-section">
    <div class="tech-section-title">{{ title }}</div>
    <div class="tech-card">
      <!-- 核心数值网格 -->
      <div class="tech-grid" v-if="rows.length > 0">
        <div v-for="r in rows" :key="r.label" class="tech-item">
          <span class="tech-label">{{ r.label }}</span>
          <span class="tech-value" :class="r.cls || ''">{{ r.value }}</span>
        </div>
      </div>

      <!-- 信号/状态行 -->
      <div v-if="signal" class="tech-signal">
        <span class="tech-label">信号</span>
        <span class="tech-value-lg" :class="signal.cls">{{ signal.text }}</span>
      </div>

      <div v-if="status" class="tech-status">
        <span class="tech-label">{{ status.label || '超买/超卖' }}</span>
        <span class="tech-value-lg" :class="status.cls">{{ status.text }}</span>
      </div>

      <!-- 均线排列形态 -->
      <div v-if="alignment" class="tech-alignment">
        <span class="tech-label">排列形态</span>
        <span class="tech-value-lg" :class="alignment.cls">{{ alignment.text }}</span>
      </div>

      <!-- 底部描述 -->
      <div v-if="detail" class="tech-detail" v-html="detail"></div>
    </div>
  </div>
</template>

<style scoped>
/* 这些样式与 TechAnalysisModal 中的 tech-* class 一致 */
.tech-section { margin-bottom: 20px; }
.tech-section:last-child { margin-bottom: 0; }
.tech-section-title {
  font-size: 13px; font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px; padding-left: 12px;
  position: relative; letter-spacing: -0.009em;
}
.tech-section-title::before {
  content: ""; position: absolute;
  left: 0; top: 3px; bottom: 3px;
  width: 3px; border-radius: 2px;
  background: var(--rust);
}
.tech-card {
  background: var(--fog); border-radius: 12px;
  padding: 16px 18px;
  border: 1px solid var(--border-light);
}
.tech-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px; margin-bottom: 14px;
}
.tech-item {
  display: flex; flex-direction: column; gap: 3px;
  padding: 8px 12px;
  background: var(--card-bg); border-radius: 8px;
}
.tech-label { font-size: 11px; color: var(--text-muted); font-weight: 500; }
.tech-value {
  font-size: 17px; font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums; line-height: 1.3;
}
.tech-value-lg {
  font-size: 18px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.tech-detail {
  margin-top: 10px; padding: 8px 12px;
  background: var(--card-bg); border-radius: 8px;
  font-size: 12px; color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  line-height: 1.6; word-break: break-all;
}
.tech-signal, .tech-status, .tech-alignment {
  border-top: 1px solid var(--border-light);
  padding-top: 12px; margin-top: 12px;
  display: flex; align-items: center; justify-content: space-between;
}
</style>
