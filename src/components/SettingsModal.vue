<script setup>
import { ref } from "vue";
import { useSettings } from "../composables/useSettings.js";
import SettingsTabNotify from "./settings/SettingsTabNotify.vue";
import SettingsTabRefresh from "./settings/SettingsTabRefresh.vue";
import SettingsTabChart from "./settings/SettingsTabChart.vue";
import SettingsTabAi from "./settings/SettingsTabAi.vue";
import SettingsTabAbout from "./settings/SettingsTabAbout.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

defineProps({ show: { type: Boolean, default: false } });
const emit = defineEmits(["close"]);

const { resetAll } = useSettings();

/** 恢复默认二次确认（避免一键清空全部设置） */
const showResetConfirm = ref(false);

function confirmReset() {
  resetAll();
  showResetConfirm.value = false;
}

const tabs = [
  { key: "notify", label: "通知", icon: "🔔" },
  { key: "refresh", label: "刷新", icon: "⏱" },
  { key: "chart", label: "图表", icon: "📊" },
  { key: "ai", label: "AI", icon: "🤖" },
  { key: "about", label: "关于", icon: "ℹ️" },
];

const activeTab = ref(
  (() => {
    try { return localStorage.getItem("stock-analysis-settings-tab") || "notify"; }
    catch { return "notify"; }
  })()
);

function switchTab(key) {
  activeTab.value = key;
  try { localStorage.setItem("stock-analysis-settings-tab", key); } catch { /* */ }
}

function closeModal() { emit("close"); }
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container">
        <!-- 头部 -->
        <div class="modal-header">
          <div class="modal-header-left">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="10" cy="10" r="3"/>
              <path d="M10 1.5V3m0 14v1.5M1.5 10H3m14 0h1.5M3.4 3.4l1.06 1.06m11.08 11.08 1.06 1.06M3.4 16.6l1.06-1.06m11.08-11.08 1.06-1.06"/>
            </svg>
            <span class="modal-title">设置</span>
          </div>
          <button class="modal-close-btn" @click="closeModal">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 4l10 10M14 4l-10 10"/>
            </svg>
          </button>
        </div>

        <!-- Tab 导航 -->
        <div class="tab-bar">
          <button
            v-for="tab in tabs" :key="tab.key"
            class="tab-btn"
            :class="{ active: activeTab === tab.key }"
            @click="switchTab(tab.key)"
          >
            <span class="tab-icon">{{ tab.icon }}</span>
            {{ tab.label }}
          </button>
        </div>

        <!-- Tab 内容 -->
        <SettingsTabNotify v-show="activeTab === 'notify'" />
        <SettingsTabRefresh v-show="activeTab === 'refresh'" />
        <SettingsTabChart v-show="activeTab === 'chart'" />
        <SettingsTabAi v-show="activeTab === 'ai'" />
        <SettingsTabAbout v-show="activeTab === 'about'" />

        <!-- 底部操作 -->
        <div class="modal-footer">
          <button class="btn-reset" @click="showResetConfirm = true">恢复默认</button>
          <button class="btn-close" @click="closeModal">完成</button>
        </div>
      </div>
    </div>
  </Teleport>

  <ConfirmDialog
    :show="showResetConfirm"
    title="恢复默认设置"
    message="将清除全部自定义设置并恢复默认值，确定继续？"
    confirm-text="恢复默认"
    danger
    @confirm="confirmReset"
    @cancel="showResetConfirm = false"
  />
</template>

<style>
@import "../assets/modal.css";

/* ── Tab 子组件样式（非 scoped：穿透 Teleport + 子组件边界） ── */
.tab-content {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

.setting-group { margin-bottom: 20px; }
.setting-group:last-child { margin-bottom: 0; }
.setting-group.disabled { opacity: 0.5; pointer-events: none; }

.setting-group-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 10px;
  margin-top: 0;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
  font-size: 14px;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}
.setting-row:last-child { border-bottom: none; }
.setting-row.sub { padding-left: 16px; }

/* 设置项下的补充说明 */
.setting-desc {
  display: block;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  margin-top: 2px;
}

/* 行内补充说明（标签与开关之间） */
.setting-hint {
  flex: 1;
  min-width: 0;
  margin: 0 12px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  text-align: right;
}

/* ── Toggle Switch ── */
.toggle {
  appearance: none;
  width: 40px; height: 22px;
  border-radius: var(--radius-full);
  background: var(--border);
  position: relative;
  cursor: pointer;
  transition: background var(--transition-fast);
  flex-shrink: 0;
}
.toggle::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 18px; height: 18px;
  border-radius: var(--radius-full);
  background: var(--white);
  transition: transform var(--transition-fast);
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.toggle:checked { background: var(--ink); }
.toggle:checked::after { transform: translateX(18px); }
.toggle:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Select ── */
.select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color var(--transition-fast);
  min-width: 120px;
}
.select:focus { border-color: var(--ink); }

/* ── 文本输入（API Key 等） ── */
.key-input {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--fog);
  color: var(--text-primary);
  font-size: 13px;
  font-family: monospace;
  transition: border-color var(--transition-fast);
  width: 180px;
  flex-shrink: 0;
  /* 覆盖 .setting-row 的 user-select: none，保证输入框内可选中/粘贴 */
  user-select: text;
}
.key-input:focus { border-color: var(--rust); box-shadow: var(--focus-glow); }

.key-status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-muted);
}
.key-status.is-ok { color: var(--green); }
.key-status.is-error { color: var(--red); }

.key-btns {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 12px;
}
.btn-key {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
}
.btn-key:hover { background: var(--hover-bg); border-color: var(--ink); }
.btn-key:active { transform: scale(0.98); }
.btn-key:disabled { opacity: 0.5; cursor: not-allowed; }

.key-hint { margin: 8px 0 0; }

/* ── Slider ── */
.slider-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.slider {
  width: 100px;
  accent-color: var(--ink);
}
.slider-val {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  min-width: 32px;
  text-align: right;
}

/* ── MA Chips ── */
.ma-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ma-chip {
  display: flex;
  align-items: center;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  user-select: none;
}
.ma-chip:hover { border-color: var(--ink); color: var(--ink); }
.ma-chip:active { transform: scale(0.98); }
.ma-chip.active {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--white);
}
/* 视觉隐藏但保留键盘可达/读屏可读（原 display:none 会让 checkbox 无法聚焦） */
.hidden-check {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* 键盘聚焦到隐藏 checkbox 时，让外层 chip 显示焦点环 */
.ma-chip:has(.hidden-check:focus-visible) {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px; /* 内缩：弹窗 body 会滚动，外扩环会被裁 */
}
</style>

<style scoped>

/* ── Overlay ── */
.modal-overlay {
  z-index: 2000;
}

.modal-container {
  width: 480px;
  max-height: 80vh;
  border-radius: var(--radius-lg);
  box-shadow:
    0 1px 0 var(--ink),
    0 20px 25px rgba(23, 25, 28, 0.06),
    0 8px 10px rgba(23, 25, 28, 0.03);
  animation: none;
}

/* ── Header ── */
.modal-header {
  padding: 20px 24px 0;
  border-bottom: none;
}
.modal-header-left {
  color: var(--ink);
}
.modal-title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.modal-close-btn {
  border-radius: var(--radius-full);
}
.modal-close-btn:hover { background: var(--hover-bg); color: var(--ink); }

/* ── Tab bar ── */
.tab-bar {
  display: flex;
  gap: 0;
  padding: 16px 24px 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tab-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  gap: 6px;
}
.tab-btn:hover { color: var(--ink); background: var(--hover-bg); }
.tab-btn:active { transform: scale(0.98); }
.tab-btn.active {
  color: var(--ink);
  border-bottom-color: var(--ink);
  background: transparent;
}
.tab-icon { font-size: 14px; }

/* ── Footer ── */
.modal-footer {
  display: flex;
  justify-content: space-between;
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.btn-reset {
  padding: 8px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-reset:hover { border-color: var(--rust); color: var(--rust); }
.btn-reset:active { transform: scale(0.98); }
.btn-close {
  width: auto;
  height: auto;
  padding: 8px 24px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--ink);
  color: var(--white);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-close:hover { opacity: 0.85; }
.btn-close:active { transform: scale(0.98); }
</style>
