<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useAiAnalysis } from "../composables/useAiAnalysis";
import AiApiKeySetup from "./ai/AiApiKeySetup.vue";
import AiChatMessages from "./ai/AiChatMessages.vue";
import AiChatFooter from "./ai/AiChatFooter.vue";
import { calcChipDistribution } from "../composables/useChipDistribution";

const props = defineProps({
  show: { type: Boolean, default: false },
  selectedStock: { type: Object, default: null },
  klineData: { type: Array, default: null },
  moneyFlow: { type: Object, default: null },
  industryData: { type: Object, default: null },
  indices: { type: Array, default: null },
});

const emit = defineEmits(["close"]);

const {
  messages,
  loading,
  error,
  apiKey,
  setApiKey,
  sendMessage,
  clearHistory,
  switchStock,
  currentStockCode,
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

// 弹窗打开或切换股票时加载对应对话
watch(() => props.show, (val) => {
  if (val && props.selectedStock) {
    switchStock(props.selectedStock.code);
  }
});

watch(() => props.selectedStock?.code, (newCode) => {
  if (props.show && newCode) {
    switchStock(newCode);
  }
});

const inputText = ref("");
const showApiKeyInput = ref(!apiKey.value);
const apiKeyInput = ref(apiKey.value);

watch(
  () => props.show,
  (val) => {
    if (val) {
      showApiKeyInput.value = !apiKey.value;
      apiKeyInput.value = apiKey.value;
    }
  }
);

function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  setApiKey(key);
  showApiKeyInput.value = false;
}

function closeModal() {
  emit("close");
}

async function handleSend() {
  const text = inputText.value.trim();
  if (!text || loading.value) return;
  inputText.value = "";

  try {
    const chipData = calcChipDistribution(props.klineData || []);
    const contextData = {
      klineData: props.klineData,
      moneyFlow: props.moneyFlow,
      industryData: props.industryData,
      indices: props.indices,
      chipData,
    };
    await sendMessage(text, props.selectedStock, contextData);
  } catch (e) {
    if (e.message === "NO_API_KEY") {
      showApiKeyInput.value = true;
    }
  }
}

function handleClear() {
  clearHistory();
}

function doSuggestion(text) {
  if (loading.value) return;
  inputText.value = text;
  handleSend();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container">
        <!-- 头部 -->
        <div class="modal-header">
          <div class="modal-header-left">
            <span class="ai-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L14.09 8.26L20 9.27L15.5 13.97L16.82 20L12 16.77L7.18 20L8.5 13.97L4 9.27L9.91 8.26L12 2Z" fill="var(--rust)" stroke="var(--rust)" stroke-width="0.5" />
              </svg>
            </span>
            <span class="modal-title">锐眼 AI</span>
            <span class="ai-badge">Agent</span>

            <span class="ctrl-divider"></span>

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
          </div>
          <div class="modal-header-actions">
            <button v-if="messages.length > 0" class="btn-header btn-clear" @click="handleClear" title="清空对话">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4M3 4l1 9.5a1 1 0 001 1h6a1 1 0 001-1L13 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <button class="btn-header btn-close" @click="closeModal">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 主体 -->
        <div class="modal-body">
          <!-- 错误提示 -->
          <div v-if="error && !showApiKeyInput" class="error-banner">
            <span class="error-icon">⚠️</span>
            <span class="error-text">{{ error }}</span>
          </div>

          <!-- API Key 设置 -->
          <AiApiKeySetup
            v-if="showApiKeyInput"
            :api-key-input="apiKeyInput"
            @save="saveApiKey"
            @update:api-key-input="apiKeyInput = $event"
          />

          <!-- 对话区域 -->
          <AiChatMessages
            v-else
            :messages="messages"
            :loading="loading"
            :selected-stock="selectedStock"
            @suggestion="doSuggestion"
          />
        </div>

        <!-- 底部输入 -->
        <AiChatFooter
          v-if="!showApiKeyInput"
          :input-text="inputText"
          :disabled="loading || !selectedStock"
          :selected-stock="selectedStock"
          :loading="loading"
          @send="handleSend"
          @update:input-text="inputText = $event"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ===== Modal 覆盖层 ===== */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(23, 25, 28, 0.45);
  animation: fadeIn 0.15s ease;
  backdrop-filter: blur(2px);
}

.modal-container {
  display: flex;
  flex-direction: column;
  width: 640px;
  height: 560px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
  animation: slideUp 0.2s ease;
}

/* ===== 头部 ===== */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.modal-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ai-icon {
  display: flex;
  align-items: center;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.ai-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--rust);
  background: var(--apricot-wash);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

/* ===== 控件分隔线 ===== */
.ctrl-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  flex-shrink: 0;
  margin: 0 2px;
}

/* ===== AI 控件组 ===== */
.header-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ===== 自定义下拉 ===== */
.ctrl-dropdown {
  position: relative;
}

.ctrl-select {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  font-size: 11.5px;
  font-weight: 600;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--fog);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
  transition: background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
  letter-spacing: -0.01em;
  line-height: 1;
  white-space: nowrap;
}
.ctrl-select:hover {
  background-color: var(--white);
  border-color: var(--dove);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.ctrl-select:focus-visible,
.ctrl-dropdown.open .ctrl-select {
  border-color: var(--dove);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  background-color: var(--white);
  color: var(--text-primary);
}

.ctrl-select-label {
  flex: 1;
  text-align: left;
}

.ctrl-select-arrow {
  flex-shrink: 0;
  color: inherit;
  opacity: 0.5;
  transition: transform 0.2s ease;
}
.ctrl-dropdown.open .ctrl-select-arrow {
  transform: rotate(180deg);
}

.ctrl-model {
  width: 130px;
}

.ctrl-effort {
  width: 78px;
  color: var(--rust);
  background: var(--apricot-wash);
  border-color: rgba(93, 42, 26, 0.15);
  font-weight: 700;
}
.ctrl-effort:hover {
  background: var(--white);
  border-color: var(--rust);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.ctrl-dropdown.open .ctrl-effort {
  background: var(--white);
  border-color: var(--rust);
}

/* ===== 下拉菜单面板 ===== */
.ctrl-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 100%;
  background: var(--white);
  border: 1px solid rgba(23, 25, 28, 0.08);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-dropdown);
  padding: 4px;
  z-index: 1010;
  animation: menuIn 0.15s ease;
  overflow: hidden;
}

@keyframes menuIn {
  from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.ctrl-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.12s ease;
  white-space: nowrap;
}
.ctrl-menu-item:hover {
  background: var(--fog);
}
.ctrl-menu-item.active {
  font-weight: 600;
  color: var(--rust);
}

.ctrl-menu-label {
  flex: 1;
}

.ctrl-menu-desc {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-muted);
}

.ctrl-menu-check {
  flex-shrink: 0;
  margin-left: auto;
}

/* ===== 自定义 Toggle 开关 ===== */
.ctrl-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  user-select: none;
  padding: 3px 5px;
  border-radius: var(--radius-sm);
  transition: background-color 0.18s ease;
}
.ctrl-toggle:hover {
  background: var(--fog);
}

.ctrl-toggle-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.ctrl-toggle-track {
  position: relative;
  width: 28px;
  height: 16px;
  background: var(--dove);
  border-radius: var(--radius-full);
  transition: background-color 0.2s ease;
  flex-shrink: 0;
}
.ctrl-toggle-input:checked + .ctrl-toggle-track {
  background: var(--rust);
}

.ctrl-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: var(--white);
  border-radius: 50%;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
.ctrl-toggle-input:checked + .ctrl-toggle-track .ctrl-toggle-knob {
  transform: translateX(12px);
}

.ctrl-toggle-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  transition: color 0.15s;
  white-space: nowrap;
  letter-spacing: -0.01em;
}
.ctrl-toggle-input:checked ~ .ctrl-toggle-label {
  color: var(--rust);
}

.modal-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-header {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}
.btn-header:hover {
  background: var(--fog);
  color: var(--text-primary);
}

/* ===== 主体 ===== */
.modal-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ===== 错误提示 ===== */
.error-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  margin: 12px 20px 0;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.2);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.error-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.error-text {
  font-size: 13px;
  color: #dc2626;
  line-height: 1.4;
}

/* ===== 全局动画 ===== */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
