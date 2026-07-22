<script setup>
/**
 * AiModelControls.vue — AI 分析弹窗头部控件组
 *
 * 包含：模型下拉选择器、思考链开关、推理深度选择器
 * 从 AiAnalysisModal.vue 分离，保持独立状态管理。
 */
import { ref, onMounted, onUnmounted, watch } from "vue";
import { useAiAnalysis } from "../../composables/useAiAnalysis.js";

const {
  currentModel,
  availableModels,
  setModel,
  thinkingEnabled,
  reasoningEffort,
  setThinkingEnabled,
  setReasoningEffort,
} = useAiAnalysis();

// ── 自定义下拉状态 ──
const modelOpen = ref(false);
const effortOpen = ref(false);
const modelBtnRef = ref(null);
const effortBtnRef = ref(null);
const modelMenuRef = ref(null);
const effortMenuRef = ref(null);

function toggleModel() { modelOpen.value = !modelOpen.value; effortOpen.value = false; }
function toggleEffort() { effortOpen.value = !effortOpen.value; modelOpen.value = false; }
function selectModel(m) { setModel(m.value); modelOpen.value = false; }
function selectEffort(e) { setReasoningEffort(e); effortOpen.value = false; }

function onWindowClick(e) {
  if (modelBtnRef.value && !modelBtnRef.value.contains(e.target) && modelMenuRef.value && !modelMenuRef.value.contains(e.target)) {
    modelOpen.value = false;
  }
  if (effortBtnRef.value && !effortBtnRef.value.contains(e.target) && effortMenuRef.value && !effortMenuRef.value.contains(e.target)) {
    effortOpen.value = false;
  }
}

onMounted(() => window.addEventListener("click", onWindowClick, true));
onUnmounted(() => window.removeEventListener("click", onWindowClick, true));
</script>

<template>
  <div class="header-controls">
    <!-- 模型选择 -->
    <div class="ctrl-dropdown" :class="{ open: modelOpen }">
      <button
        ref="modelBtnRef"
        class="ctrl-select ctrl-model"
        @click.stop="toggleModel"
        :title="availableModels.find(m => m.value === currentModel)?.label"
      >
        <span class="ctrl-select-label">{{ availableModels.find(m => m.value === currentModel)?.label }}</span>
        <svg class="ctrl-select-arrow" width="8" height="5" viewBox="0 0 8 5"><path d="M1 1l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
      </button>
      <div v-if="modelOpen" ref="modelMenuRef" class="ctrl-menu">
        <button
          v-for="m in availableModels"
          :key="m.value"
          class="ctrl-menu-item"
          :class="{ active: m.value === currentModel }"
          @click.stop="selectModel(m)"
        >
          <span class="ctrl-menu-label">{{ m.label }}</span>
          <svg v-if="m.value === currentModel" class="ctrl-menu-check" width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l2.5 2.5L10 3" stroke="var(--rust)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        </button>
      </div>
    </div>

    <!-- 思考开关 -->
    <label class="ctrl-toggle" title="启用思考链（reasoning）">
      <input
        type="checkbox"
        class="ctrl-toggle-input"
        :checked="thinkingEnabled"
        @change="setThinkingEnabled(($event.target).checked)"
      />
      <span class="ctrl-toggle-track">
        <span class="ctrl-toggle-knob"></span>
      </span>
      <span class="ctrl-toggle-label">思考</span>
    </label>

    <!-- 推理深度 -->
    <div v-if="thinkingEnabled" class="ctrl-dropdown" :class="{ open: effortOpen }">
      <button
        ref="effortBtnRef"
        class="ctrl-select ctrl-effort"
        @click.stop="toggleEffort"
        :title="reasoningEffort === 'max' ? '最大推理' : '高推理'"
      >
        <span class="ctrl-select-label">{{ reasoningEffort === 'max' ? '最大推理' : '高推理' }}</span>
        <svg class="ctrl-select-arrow" width="8" height="5" viewBox="0 0 8 5"><path d="M1 1l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
      </button>
      <div v-if="effortOpen" ref="effortMenuRef" class="ctrl-menu">
        <button
          class="ctrl-menu-item"
          :class="{ active: reasoningEffort === 'high' }"
          @click.stop="selectEffort('high')"
        >
          <span class="ctrl-menu-label">高推理</span>
          <span class="ctrl-menu-desc">响应更快</span>
          <svg v-if="reasoningEffort === 'high'" class="ctrl-menu-check" width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l2.5 2.5L10 3" stroke="var(--rust)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        </button>
        <button
          class="ctrl-menu-item"
          :class="{ active: reasoningEffort === 'max' }"
          @click.stop="selectEffort('max')"
        >
          <span class="ctrl-menu-label">最大推理</span>
          <span class="ctrl-menu-desc">深度更强</span>
          <svg v-if="reasoningEffort === 'max'" class="ctrl-menu-check" width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l2.5 2.5L10 3" stroke="var(--rust)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 从 AiAnalysisModal.vue 提取的控件样式 */
.header-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ctrl-dropdown { position: relative; }

.ctrl-select {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  font-size: 11.5px; font-weight: 600;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--fog);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  cursor: pointer; outline: none; flex-shrink: 0;
  transition: background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
  letter-spacing: -0.01em; line-height: 1; white-space: nowrap;
}
.ctrl-select:hover {
  background-color: var(--white); border-color: var(--dove);
  color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.ctrl-select:focus-visible,
.ctrl-dropdown.open .ctrl-select {
  border-color: var(--dove); box-shadow: 0 1px 3px rgba(0,0,0,.04);
  background-color: var(--white); color: var(--text-primary);
}
.ctrl-select-label { flex: 1; text-align: left; }
.ctrl-select-arrow {
  flex-shrink: 0; color: inherit; opacity: 0.5;
  transition: transform 0.2s ease;
}
.ctrl-dropdown.open .ctrl-select-arrow { transform: rotate(180deg); }
.ctrl-model { width: 130px; }
.ctrl-effort {
  width: 78px; color: var(--rust);
  background: var(--apricot-wash);
  border-color: rgba(93,42,26,.15); font-weight: 700;
}
.ctrl-effort:hover {
  background: var(--white); border-color: var(--rust);
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.ctrl-dropdown.open .ctrl-effort {
  background: var(--white); border-color: var(--rust);
}

.ctrl-menu {
  position: absolute; top: calc(100% + 4px); left: 50%;
  transform: translateX(-50%); min-width: 100%;
  background: var(--white);
  border: 1px solid rgba(23,25,28,.08);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-dropdown);
  padding: 4px; z-index: 1010;
  animation: menuIn 0.15s ease; overflow: hidden;
}
@keyframes menuIn {
  from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.ctrl-menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 6px 10px;
  border: none; background: transparent; border-radius: 8px;
  font-size: 12px; font-weight: 500; font-family: inherit;
  color: var(--text-primary); cursor: pointer; text-align: left;
  transition: background-color 0.12s ease; white-space: nowrap;
}
.ctrl-menu-item:hover { background: var(--fog); }
.ctrl-menu-item.active { font-weight: 600; color: var(--rust); }
.ctrl-menu-label { flex: 1; }
.ctrl-menu-desc {
  font-size: 10px; font-weight: 400; color: var(--text-muted);
}
.ctrl-menu-check { flex-shrink: 0; margin-left: auto; }

/* Toggle */
.ctrl-toggle {
  display: flex; align-items: center; gap: 7px;
  cursor: pointer; user-select: none;
  padding: 3px 5px; border-radius: var(--radius-sm);
  transition: background-color 0.18s ease;
}
.ctrl-toggle:hover { background: var(--fog); }
.ctrl-toggle-input {
  position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none;
}
.ctrl-toggle-track {
  position: relative; width: 28px; height: 16px;
  background: var(--dove); border-radius: var(--radius-full);
  transition: background-color 0.2s ease; flex-shrink: 0;
}
.ctrl-toggle-input:checked + .ctrl-toggle-track { background: var(--rust); }
.ctrl-toggle-knob {
  position: absolute; top: 2px; left: 2px;
  width: 12px; height: 12px;
  background: var(--white); border-radius: 50%;
  transition: transform 0.2s cubic-bezier(.34,1.56,.64,1);
  box-shadow: 0 1px 2px rgba(0,0,0,.12);
}
.ctrl-toggle-input:checked + .ctrl-toggle-track .ctrl-toggle-knob {
  transform: translateX(12px);
}
.ctrl-toggle-label {
  font-size: 11px; font-weight: 600; color: var(--text-muted);
  transition: color .15s; white-space: nowrap; letter-spacing: -.01em;
}
.ctrl-toggle-input:checked ~ .ctrl-toggle-label { color: var(--rust); }
</style>
