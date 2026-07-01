<script setup>
/**
 * AiApiKeySetup — API Key 设置界面
 */
defineProps({
  apiKeyInput: { type: String, default: "" },
});

const emit = defineEmits(["save", "update:apiKeyInput"]);
</script>

<template>
  <div class="api-key-section">
    <div class="api-key-icon">🔑</div>
    <p class="api-key-desc">
      请输入你的 DeepSeek API Key 以启用 AI 分析功能。
      <br /><span class="api-key-hint">Key 仅存储在本地浏览器，不会上传到服务器。</span>
    </p>
    <div class="api-key-row">
      <input
        :value="apiKeyInput"
        type="password"
        class="api-key-input"
        placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        @input="emit('update:apiKeyInput', $event.target.value)"
        @keydown.enter="emit('save')"
      />
      <button class="btn-save-key" :disabled="!apiKeyInput.trim()" @click="emit('save')">
        确认
      </button>
    </div>
  </div>
</template>

<style scoped>
.api-key-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 40px;
  text-align: center;
  gap: 12px;
  flex: 1;
}

.api-key-icon {
  font-size: 40px;
  margin-bottom: 8px;
}

.api-key-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.api-key-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.api-key-row {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 420px;
  margin-top: 8px;
}

.api-key-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-family: monospace;
  background: var(--fog);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s;
}

.api-key-input:focus {
  border-color: var(--ink);
}

.btn-save-key {
  padding: 10px 24px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--ink);
  color: var(--white);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s;
  white-space: nowrap;
}

.btn-save-key:hover {
  opacity: 0.85;
}

.btn-save-key:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
