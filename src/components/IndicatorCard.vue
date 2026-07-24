<script setup>
/**
 * IndicatorCard.vue — 技术指标展示卡片（在 TechAnalysisModal 中使用）
 *
 * Props:
 *  - title: 指标名称
 *  - accent: 标题左侧色条颜色（CSS 变量名），默认 "var(--rust)"
 *  - rows:  [{ label, value, cls }]  指标数据行
 *  - signal: { text, cls }           金叉/死叉信号（内联标题行）
 *  - status: { text, cls }           超买/超卖状态（内联标题行）
 *  - alignment: { text, cls }        均线排列形态（内联标题行）
 *  - detail: 底部描述文字
 *  - layout: "grid" | "chips" | "single"  布局模式
 */
defineProps({
  title: { type: String, required: true },
  accent: { type: String, default: "var(--rust)" },
  rows: { type: Array, default: () => [] },
  signal: { type: Object, default: null },
  status: { type: Object, default: null },
  alignment: { type: Object, default: null },
  detail: { type: String, default: "" },
  layout: { type: String, default: "grid" },
});
</script>

<template>
  <div class="tech-section">
    <!-- 标题行：左色条 + 标题 + 右侧内联信号/状态/排列 -->
    <div class="tech-section-title">
      <span class="tech-title-text">{{ title }}</span>
      <span v-if="signal" class="tech-title-badge" :class="signal.cls">{{ signal.text }}</span>
      <span v-if="status" class="tech-title-badge" :class="status.cls">{{ status.text }}</span>
      <span v-if="alignment" class="tech-title-badge" :class="alignment.cls">{{ alignment.text }}</span>
    </div>

    <div class="tech-card">
      <!-- Grid 布局（MACD / KDJ 等 3 值） -->
      <div v-if="layout === 'grid' && rows.length > 0" class="tech-grid">
        <div v-for="r in rows" :key="r.label" class="tech-item">
          <span class="tech-label">{{ r.label }}</span>
          <span class="tech-value" :class="r.cls || ''">{{ r.value }}</span>
        </div>
      </div>

      <!-- Chips 布局（MA 均线水平排列） -->
      <div v-if="layout === 'chips' && rows.length > 0" class="tech-chips">
        <div v-for="r in rows" :key="r.label" class="tech-chip">
          <span class="tech-chip-label">{{ r.label }}</span>
          <span class="tech-chip-value">{{ r.value }}</span>
        </div>
      </div>

      <!-- Single 布局（WR / RSI 单值居中） -->
      <div v-if="layout === 'single' && rows.length > 0" class="tech-single">
        <span class="tech-single-value" :class="rows[0].cls || ''">{{ rows[0].value }}</span>
      </div>

      <!-- 底部描述 -->
      <div v-if="detail" class="tech-detail" v-html="detail"></div>
    </div>
  </div>
</template>

<style scoped>
.tech-section { margin-bottom: 16px; }
.tech-section:last-child { margin-bottom: 0; }

/* ── 标题行 ── */
.tech-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
  padding-left: 12px;
  position: relative;
  letter-spacing: -0.009em;
  text-transform: uppercase;
}
.tech-section-title::before {
  content: "";
  position: absolute;
  left: 0; top: 1px; bottom: 1px;
  width: 3px; border-radius: 2px;
  background: v-bind(accent);
}
.tech-title-text { flex-shrink: 0; }
.tech-title-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
}

/* ── 卡片 ── */
.tech-card {
  background: var(--fog);
  border-radius: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border-light);
}

/* ── Grid 布局 ── */
.tech-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.tech-item {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px;
  background: var(--card-bg); border-radius: 8px;
}
.tech-label { font-size: 10px; color: var(--text-muted); font-weight: 500; }
.tech-value {
  font-size: 16px; font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums; line-height: 1.2;
}

/* ── Chips 布局（MA） ── */
.tech-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tech-chip {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 10px;
  background: var(--card-bg); border-radius: 8px;
  min-width: 52px;
}
.tech-chip-label { font-size: 10px; color: var(--text-muted); font-weight: 500; }
.tech-chip-value {
  font-size: 13px; font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* ── Single 布局 ── */
.tech-single {
  text-align: center;
  padding: 4px 0;
}
.tech-single-value {
  font-size: 28px; font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

/* ── 描述文字 ── */
.tech-detail {
  margin-top: 10px; padding: 8px 12px;
  background: var(--card-bg); border-radius: 8px;
  font-size: 11px; color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
}

/* ===== 信号/状态标签颜色 ===== */
.signal-up {
  background: var(--red-bg);
  color: var(--red);
}
.signal-down {
  background: var(--green-bg);
  color: var(--green);
}
.signal-none {
  background: var(--fog);
  color: var(--text-muted);
}
</style>
