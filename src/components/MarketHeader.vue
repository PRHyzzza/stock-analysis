<script setup>
/**
 * MarketHeader.vue — 顶部指数栏 + 全局操作按钮区
 *
 * 布局：左侧指数（可横向滚动，永不推动右侧按钮）/ 右侧按钮区（固定不动）
 *
 * 按钮分三组（分段控件 + 1px 分隔），取代原来 9 个一模一样的描边胶囊：
 *   [持仓 组合 信号 模拟盘]  账户与交易（fog 底、无缝分段）
 *   [选股 画像]             工具
 *   AI                     强调色（apricot 底 + rust 字，唯一高亮项）
 *   设置 / 刷新             独立控件（刷新是唯一描边按钮 = 主要动作）
 * 分组只是视觉与信息层级，emit 名称与顺序保持不变，父组件零改动。
 *
 * 窄窗口：先隐藏文字标签（保留 aria-label + title，键盘与读屏仍可用），
 * 再收紧内边距；图标始终可见，不会换行或溢出。
 */
import { num, fmtPctOrDash, trendClass } from "../utils/format";

defineProps({
  indices: { type: Array, default: () => [] },
  refreshing: { type: Boolean, default: false },
});

defineEmits(["refresh", "open-positions", "open-portfolio", "open-signal-history", "open-paper", "open-profile", "open-settings", "open-global-ai", "open-iwencai"]);
</script>

<template>
  <header class="market-header">
    <div class="header-left">
      <div class="market-indices">
        <template v-for="(idx, i) in indices" :key="idx.code">
          <span v-if="i > 0" class="index-divider"></span>
          <span class="index-item">
            <span class="index-name">{{ idx.name }}</span>
            <span class="index-value" :class="num(idx.price) ? trendClass(idx.change) : ''">
              {{ num(idx.price) ? idx.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--' }}
            </span>
            <span class="index-change" :class="num(idx.price) ? trendClass(idx.change) : ''">
              {{ num(idx.price) ? fmtPctOrDash(idx.changePct) : '--' }}
            </span>
          </span>
        </template>
      </div>
    </div>

    <div class="header-right">
      <!-- AI 助手：唯一的强调色入口 -->
      <button
        class="tool-btn tool-btn--accent"
        aria-label="AI 助手"
        title="AI 助手（全局对话）"
        @click="$emit('open-global-ai')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2L14.09 8.26L20 9.27L15.5 13.97L16.82 20L12 16.77L7.18 20L8.5 13.97L4 9.27L9.91 8.26L12 2Z" fill="currentColor" stroke="currentColor" stroke-width="0.5" />
        </svg>
        <span class="label">AI</span>
      </button>

      <span class="tool-sep" aria-hidden="true"></span>

      <!-- 账户与交易 -->
      <div class="tool-group" role="group" aria-label="账户与交易">
        <button class="tool-btn" aria-label="持仓" title="持仓（成本 / 止损止盈）" @click="$emit('open-positions')">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 13V5l5-3 5 3v8" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <rect x="6" y="8" width="4" height="5" rx="0.4" stroke="currentColor" stroke-width="1.2"/>
          </svg>
          <span class="label">持仓</span>
        </button>
        <button class="tool-btn" aria-label="组合" title="持仓组合（当日盈亏 / 权重 / 集中度）" @click="$emit('open-portfolio')">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 13V9M6 13V4M10 13V7M14 13V2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span class="label">组合</span>
        </button>
        <button class="tool-btn" aria-label="信号" title="历史信号胜率（本地记录的信号后来涨跌如何）" @click="$emit('open-signal-history')">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 2v12h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <path d="M4 10l3-3.5 2.5 2L14 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="4" cy="10" r="1.2" fill="currentColor"/>
            <circle cx="7" cy="6.5" r="1.2" fill="currentColor"/>
            <circle cx="9.5" cy="8.5" r="1.2" fill="currentColor"/>
          </svg>
          <span class="label">信号</span>
        </button>
        <button class="tool-btn" aria-label="模拟盘" title="模拟盘（选股驱动 · 每日向前累积）" @click="$emit('open-paper')">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.8" y="8.6" width="2.6" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
            <rect x="6" y="5.4" width="2.6" height="8.2" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
            <rect x="10.2" y="2.4" width="2.6" height="11.2" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
          </svg>
          <span class="label">模拟盘</span>
        </button>
      </div>

      <span class="tool-sep" aria-hidden="true"></span>

      <!-- 分析工具 -->
      <div class="tool-group" role="group" aria-label="分析工具">
        <button class="tool-btn" aria-label="问财选股" title="问财选股" @click="$emit('open-iwencai')">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.3"/>
            <path d="M9.5 9.5L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            <path d="M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          </svg>
          <span class="label">选股</span>
        </button>
        <button class="tool-btn" aria-label="用户画像" title="用户画像（风格与偏好）" @click="$emit('open-profile')">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="5.5" r="3" stroke="currentColor" stroke-width="1.3"/>
            <path d="M3 14c0-2.8 2.24-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          <span class="label">画像</span>
        </button>
      </div>

      <span class="tool-sep" aria-hidden="true"></span>

      <!-- 独立控件：设置（窄窗口只剩图标）+ 刷新（唯一描边按钮） -->
      <button class="tool-btn tool-btn--icon" aria-label="设置" title="设置" @click="$emit('open-settings')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>

      <button
        class="refresh-btn"
        :class="{ loading: refreshing }"
        :disabled="refreshing"
        :aria-busy="refreshing"
        aria-label="刷新全部行情"
        title="刷新全部行情"
        @click="$emit('refresh')"
      >
        <svg class="refresh-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 8a6 6 0 0 1 10.47-4M14 8a6 6 0 0 1-10.47 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M13.5 2v4h-4M2.5 14v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="label">{{ refreshing ? '刷新中…' : '刷新' }}</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.market-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  height: 44px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

/* ===== 左：指数 ===== */
.header-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.market-indices {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.market-indices::-webkit-scrollbar {
  display: none;
}

.index-item {
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-size: 13px;
  white-space: nowrap;
  flex-shrink: 0;
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
  font-variant-numeric: tabular-nums;
}

.index-change.up,
.index-value.up { color: var(--red); }

.index-change.down,
.index-value.down { color: var(--green); }

.index-divider {
  width: 1px;
  height: 14px;
  background: var(--border);
  flex-shrink: 0;
}

/* ===== 右：按钮区 ===== */
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 分段控件：fog 底托住一组无缝按钮，比 N 个描边胶囊干净得多。
   高度账：内层按钮 24 + 上下 padding 2×2 = 28px，与 AI / 设置 / 刷新三个
   独立控件等高——四种控件共用一条基线才能看起来是一套东西。
   改这里的高度必须同步改下面三处的 height，否则会出现 2px 的错位。 */
.tool-group {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  background: var(--fog);
  border-radius: var(--radius-full);
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.009em;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.tool-btn:hover {
  background: var(--card-bg);
  color: var(--ink);
}

.tool-btn:active {
  transform: scale(0.97);
}

/* AI：唯一强调色（apricot 底 + rust 字），悬停反白 */
.tool-btn--accent {
  height: 28px;
  padding: 0 11px;
  background: var(--apricot-wash);
  color: var(--rust);
}
.tool-btn--accent:hover {
  background: var(--rust);
  color: var(--white);
}

/* 设置：等高方形图标按钮（与分段控件视觉重量一致） */
.tool-btn--icon {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
}
.tool-btn--icon:hover {
  border-color: var(--ink);
  background: transparent;
  color: var(--ink);
}

/* 刷新：唯一描边按钮 = 主要动作 */
.refresh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.009em;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.refresh-btn:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.refresh-btn:active {
  transform: scale(0.97);
}
.refresh-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.refresh-btn.loading .refresh-icon {
  animation: spin 0.8s linear infinite;
}

.tool-sep {
  width: 1px;
  height: 16px;
  background: var(--border);
  flex-shrink: 0;
}

/* 中等宽度：隐藏文字，只留图标（aria-label/title 保证可达性），收紧内边距 */
@media (max-width: 1180px) {
  .market-header {
    padding: 0 14px;
    gap: 12px;
  }
  .market-indices {
    gap: 14px;
  }
  .header-right {
    gap: 6px;
  }
  .tool-btn .label,
  .refresh-btn .label {
    display: none;
  }
  .tool-btn {
    padding: 0 7px;
  }
  .tool-btn--accent {
    padding: 0 8px;
  }
  .refresh-btn {
    padding: 0 8px;
  }
}

/* 更窄：隐藏指数涨跌幅与分隔符，优先保证按钮区完整 */
@media (max-width: 860px) {
  .index-change,
  .tool-sep {
    display: none;
  }
  .index-item {
    gap: 5px;
  }
  .market-indices {
    gap: 10px;
  }
  .header-right {
    gap: 5px;
  }
  .tool-group {
    gap: 0;
  }
  .tool-btn {
    padding: 0 6px;
  }
}
</style>
