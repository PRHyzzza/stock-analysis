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
  min-height: 260px;
  padding: 44px 40px;
  text-align: center;
  gap: 12px;
  flex: 1;
}

.api-key-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: 8px;
  font-size: 30px;
  line-height: 1;
  border-radius: var(--radius-full);
  background: var(--fog);
  border: 1px solid var(--border-light);
}

.api-key-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  max-width: 420px;
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
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-family: "SF Mono", "Fira Code", Consolas, monospace;
  background: var(--fog);
  color: var(--text-primary);
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.api-key-input:focus {
  border-color: var(--rust);
  background: var(--card-bg);
  box-shadow: var(--focus-glow);
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
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.btn-save-key:hover:not(:disabled) {
  background: #2a2d31;
}

.btn-save-key:active:not(:disabled) {
  transform: scale(0.98);
}

.btn-save-key:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
