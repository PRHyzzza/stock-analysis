<script setup>
import { computed } from "vue";
import { useSettings } from "../composables/useSettings.js";

defineProps({ show: { type: Boolean, default: false } });
const emit = defineEmits(["close"]);

const { state, resetAll } = useSettings();

const tabs = [
  { key: "notify", label: "通知", icon: "🔔" },
  { key: "refresh", label: "刷新", icon: "⏱" },
  { key: "chart", label: "图表", icon: "📊" },
  { key: "ai", label: "AI", icon: "🤖" },
];
const activeTab = computed({
  get: () => {
    try { return localStorage.getItem("stock-analysis-settings-tab") || "notify"; }
    catch { return "notify"; }
  },
  set: (v) => {
    try { localStorage.setItem("stock-analysis-settings-tab", v); }
    catch { /* ignore */ }
  },
});

/** 触发 activeTab 响应式更新 */
function switchTab(key) {
  activeTab.value = key;
  // Force reactivity via a simple trick
  try { localStorage.setItem("stock-analysis-settings-tab", key); } catch { /* */ }
}

// 刷新间隔选项
const intervalOptions = [
  { value: 10000, label: "10 秒" },
  { value: 30000, label: "30 秒" },
  { value: 60000, label: "1 分钟" },
  { value: 120000, label: "2 分钟" },
  { value: 300000, label: "5 分钟" },
  { value: 0, label: "关闭" },
];

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

        <!-- ── 通知设置 ── -->
        <div v-show="activeTab === 'notify'" class="tab-content">
          <label class="setting-row">
            <span class="setting-label">启用通知</span>
            <input type="checkbox" v-model="state.notifyEnabled" class="toggle" />
          </label>
          <div class="setting-group" :class="{ disabled: !state.notifyEnabled }">
            <p class="setting-group-title">上涨触发</p>
            <label class="setting-row sub"><span>涨超 5%</span><input type="checkbox" v-model="state.notifyUp5" class="toggle" :disabled="!state.notifyEnabled" /></label>
            <label class="setting-row sub"><span>涨超 7%</span><input type="checkbox" v-model="state.notifyUp7" class="toggle" :disabled="!state.notifyEnabled" /></label>
            <label class="setting-row sub"><span>涨停</span><input type="checkbox" v-model="state.notifyLimitUp" class="toggle" :disabled="!state.notifyEnabled" /></label>
          </div>
          <div class="setting-group" :class="{ disabled: !state.notifyEnabled }">
            <p class="setting-group-title">下跌触发</p>
            <label class="setting-row sub"><span>跌超 5%</span><input type="checkbox" v-model="state.notifyDown5" class="toggle" :disabled="!state.notifyEnabled" /></label>
            <label class="setting-row sub"><span>跌超 7%</span><input type="checkbox" v-model="state.notifyDown7" class="toggle" :disabled="!state.notifyEnabled" /></label>
            <label class="setting-row sub"><span>跌停</span><input type="checkbox" v-model="state.notifyLimitDown" class="toggle" :disabled="!state.notifyEnabled" /></label>
          </div>
          <div class="setting-group" :class="{ disabled: !state.notifyEnabled }">
            <p class="setting-group-title">动态触发</p>
            <label class="setting-row sub"><span>快速拉升</span><input type="checkbox" v-model="state.notifyFastRise" class="toggle" :disabled="!state.notifyEnabled" /></label>
            <label class="setting-row sub"><span>快速下跌</span><input type="checkbox" v-model="state.notifyFastFall" class="toggle" :disabled="!state.notifyEnabled" /></label>
            <label class="setting-row sub">
              <span>快速变动阈值</span>
              <div class="slider-wrap">
                <input type="range" min="1" max="5" step="0.5" v-model.number="state.notifyFastThreshold" class="slider" :disabled="!state.notifyEnabled" />
                <span class="slider-val">{{ state.notifyFastThreshold }}%</span>
              </div>
            </label>
          </div>
        </div>

        <!-- ── 刷新设置 ── -->
        <div v-show="activeTab === 'refresh'" class="tab-content">
          <div class="setting-group">
            <p class="setting-group-title">自动刷新间隔</p>
            <label class="setting-row">
              <span>大盘指数</span>
              <select v-model.number="state.indicesRefreshMs" class="select">
                <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </label>
            <label class="setting-row">
              <span>自选行情</span>
              <select v-model.number="state.quotesRefreshMs" class="select">
                <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </label>
            <label class="setting-row">
              <span>K 线数据</span>
              <select v-model.number="state.klineRefreshMs" class="select">
                <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </label>
          </div>
        </div>

        <!-- ── 图表设置 ── -->
        <div v-show="activeTab === 'chart'" class="tab-content">
          <div class="setting-group">
            <p class="setting-group-title">K 线均线周期</p>
            <div class="ma-chips">
              <label v-for="p in [5,10,20,30,60,120,250]" :key="p" class="ma-chip" :class="{ active: state.klineMaPeriods.includes(p) }">
                <input type="checkbox" :value="p" v-model="state.klineMaPeriods" class="hidden-check" />
                MA{{ p }}
              </label>
            </div>
          </div>
          <div class="setting-group">
            <p class="setting-group-title">其他</p>
            <label class="setting-row">
              <span>显示 30 日最高/最低价参考线</span>
              <input type="checkbox" v-model="state.klineShow30DayHL" class="toggle" />
            </label>
          </div>
        </div>

        <!-- ── AI 设置 ── -->
        <div v-show="activeTab === 'ai'" class="tab-content">
          <div class="setting-group">
            <p class="setting-group-title">模型</p>
            <label class="setting-row">
              <span>默认模型</span>
              <select v-model="state.aiModel" class="select">
                <option value="deepseek-v4-flash">DeepSeek V4 Flash (更快)</option>
                <option value="deepseek-v4-pro">DeepSeek V4 Pro (更准)</option>
              </select>
            </label>
          </div>
          <div class="setting-group">
            <p class="setting-group-title">推理</p>
            <label class="setting-row">
              <span>启用思考模式</span>
              <input type="checkbox" v-model="state.aiThinkingEnabled" class="toggle" />
            </label>
            <label class="setting-row">
              <span>推理深度</span>
              <select v-model="state.aiReasoningEffort" class="select">
                <option value="low">低 (快速)</option>
                <option value="high">高 (深入)</option>
                <option value="max">最大 (最深入)</option>
              </select>
            </label>
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="modal-footer">
          <button class="btn-reset" @click="resetAll">恢复默认</button>
          <button class="btn-close" @click="closeModal">完成</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Overlay ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(23, 25, 28, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-container {
  width: 480px;
  max-height: 80vh;
  background: var(--card-bg, #fff);
  border-radius: 24px;
  border: 1px solid var(--border);
  box-shadow:
    0 1px 0 var(--ink),
    0 20px 25px rgba(23, 25, 28, 0.06),
    0 8px 10px rgba(23, 25, 28, 0.03);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Header ── */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0;
  flex-shrink: 0;
}
.modal-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink);
}
.modal-title {
  font-size: 17px;
  font-weight: 700;
  font-family: 'Signifier', 'Noto Serif SC', 'Noto Serif SC', serif;
  letter-spacing: -0.01em;
}
.modal-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px; height: 32px;
  border-radius: var(--radius-full);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.modal-close-btn:hover { background: var(--border); color: var(--ink); }

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
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tab-btn:hover { color: var(--text-secondary); }
.tab-btn.active {
  color: var(--ink);
  border-bottom-color: var(--ink);
}
.tab-icon { font-size: 14px; }

/* ── Content ── */
.tab-content {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

.setting-group {
  margin-bottom: 20px;
}
.setting-group:last-child { margin-bottom: 0; }
.setting-group.disabled { opacity: 0.4; pointer-events: none; }

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
  border-bottom: 1px solid rgba(163, 166, 175, 0.15);
  font-size: 14px;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}
.setting-row:last-child { border-bottom: none; }
.setting-row.sub { padding-left: 16px; }

/* ── Toggle Switch ── */
.toggle {
  appearance: none;
  width: 40px; height: 22px;
  border-radius: 11px;
  background: var(--border);
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}
.toggle::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.toggle:checked { background: var(--ink); }
.toggle:checked::after { transform: translateX(18px); }
.toggle:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Select ── */
.select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  outline: none;
  min-width: 120px;
}
.select:focus { border-color: var(--ink); }

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
  transition: all 0.15s;
  user-select: none;
}
.ma-chip:hover { border-color: var(--ink); color: var(--ink); }
.ma-chip.active {
  border-color: var(--ink);
  background: var(--ink);
  color: #fff;
}
.hidden-check { display: none; }

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
  transition: all 0.15s;
}
.btn-reset:hover { border-color: var(--rust); color: var(--rust); }
.btn-close {
  padding: 8px 24px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-close:hover { opacity: 0.85; }
</style>
