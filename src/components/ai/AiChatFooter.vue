<script setup>
/**
 * AiChatFooter — 底部输入区域（含上下文标签 + 文本输入 + 发送按钮）
 */
defineProps({
  disabled: { type: Boolean, default: false },
  selectedStock: { type: Object, default: null },
  inputText: { type: String, default: "" },
  loading: { type: Boolean, default: false },
  globalMode: { type: Boolean, default: false },
});

const emit = defineEmits(["send", "update:inputText", "keydown-catch"]);

function onKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    emit("send");
  }
}
</script>

<template>
  <div class="modal-footer">
    <div class="stock-context" v-if="selectedStock">
      <span class="context-tag">{{ selectedStock.name }}({{ selectedStock.code }})</span>
    </div>
    <div class="input-row">
      <textarea
        :value="inputText"
        class="msg-input"
        :placeholder="globalMode ? '输入你的问题，如：最近有什么热点新闻？' : selectedStock ? `问关于 ${selectedStock.name} 的问题...` : '请先选中一只股票...'"
        :disabled="disabled"
        rows="1"
        @input="emit('update:inputText', $event.target.value)"
        @keydown="onKeydown"
      ></textarea>
      <button
        class="btn-send"
        :disabled="!inputText.trim() || disabled"
        @click="emit('send')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.modal-footer {
  flex-shrink: 0;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border);
}

.stock-context {
  margin-bottom: 8px;
}

.context-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: var(--apricot-wash);
  color: var(--rust);
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 600;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.msg-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-family: inherit;
  background: var(--fog);
  color: var(--text-primary);
  outline: none;
  resize: none;
  line-height: 1.5;
  max-height: 100px;
  transition: border-color 0.15s;
}

.msg-input:focus {
  border-color: var(--ink);
}

.msg-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.msg-input::placeholder {
  color: var(--dove);
}

.btn-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--ink);
  color: var(--white);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.btn-send:hover {
  opacity: 0.85;
}

.btn-send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
