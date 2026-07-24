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
            <button v-if="messages.length > 0" class="btn-close" @click="handleClear" title="清空对话">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4M3 4l1 9.5a1 1 0 001 1h6a1 1 0 001-1L13 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <button class="btn-close" @click="closeModal">
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

<style>
@import "../assets/modal.css";
</style>

<style scoped>

/* AiAnalysisModal 特有样式：覆盖宽高（与 GlobalAiModal 保持一致） */
.modal-container {
  width: 900px;
  height: 680px;
}

</style>
