<script setup>
import { ref, watch } from "vue";
import { useAiAnalysis } from "../composables/useAiAnalysis";
import AiApiKeySetup from "./ai/AiApiKeySetup.vue";
import AiChatMessages from "./ai/AiChatMessages.vue";
import AiChatFooter from "./ai/AiChatFooter.vue";
import AiModelControls from "./ai/AiModelControls.vue";
import { calcChipDistribution } from "../composables/useChipDistribution";

const props = defineProps({
  show: { type: Boolean, default: false },
  selectedStock: { type: Object, default: null },
  klineData: { type: Array, default: null },
  moneyFlow: { type: Object, default: null },
  industryData: { type: Object, default: null },
  indices: { type: Array, default: null },
  positions: { type: Array, default: () => [] },
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
} = useAiAnalysis();

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
      positions: props.positions,
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
            <span class="modal-title">AI</span>
            <span class="ai-badge">Agent</span>

            <span class="ctrl-divider"></span>

            <AiModelControls />
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
  width: 900px;
  max-width: 95vw;
  height: 680px;
  max-height: 90vh;
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

/* ===== AI 控件样式（已迁移到 AiModelControls.vue） ===== */

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
