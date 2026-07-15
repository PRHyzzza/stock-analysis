<script setup>
defineProps({
  indices: { type: Array, default: () => [] },
  refreshing: { type: Boolean, default: false },
});

defineEmits(["refresh"]);
</script>

<template>
  <header class="market-header">
    <div class="header-left">
      <div class="market-indices">
        <template v-for="(idx, i) in indices" :key="idx.code">
          <span v-if="i > 0" class="index-divider"></span>
          <span class="index-item">
            <span class="index-name">{{ idx.name }}</span>
            <span class="index-value" :class="idx.change >= 0 ? 'up' : 'down'">
              {{ idx.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
            </span>
            <span class="index-change" :class="idx.change >= 0 ? 'up' : 'down'">
              {{ idx.changePct > 0 ? '+' : '' }}{{ idx.changePct.toFixed(2) }}%
            </span>
          </span>
        </template>
      </div>
    </div>
    <div class="header-right">
      <button class="btn-refresh" :class="{ loading: refreshing }" @click="$emit('refresh')" :disabled="refreshing">
        <svg class="refresh-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 8a6 6 0 0 1 10.47-4M14 8a6 6 0 0 1-10.47 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M13.5 2v4h-4M2.5 14v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ refreshing ? '刷新中...' : '刷新' }}</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.market-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 44px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
}

.header-right {
  display: flex;
  align-items: center;
}

.market-indices {
  display: flex;
  align-items: center;
  gap: 24px;
}

.index-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.index-name {
  color: var(--text-muted);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.index-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.index-change {
  font-weight: 500;
  font-size: 12px;
}

.index-change.up,
.index-value.up { color: var(--red); }

.index-change.down,
.index-value.down { color: var(--green); }

.index-divider {
  width: 1px;
  height: 16px;
  background: var(--border);
}

.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-refresh:hover {
  border-color: var(--ink);
  color: var(--ink);
  background: transparent;
}
.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-refresh.loading .refresh-icon {
  animation: spin 0.8s linear infinite;
}
</style>
