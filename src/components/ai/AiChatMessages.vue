<script setup>
/**
 * AiChatMessages — 对话消息列表（含欢迎屏 + 打字动画）
 */
import { ref, nextTick, watch } from "vue";

const props = defineProps({
  messages: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  selectedStock: { type: Object, default: null },
});

const emit = defineEmits(["suggestion"]);

const messagesContainer = ref(null);

// 自动滚动到底部
watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    scrollToBottom();
  }
);

watch(
  () => props.loading,
  async () => {
    await nextTick();
    scrollToBottom();
  }
);

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const escaped = escapeHtml(code.trim());
      return `<pre><code>${escaped}</code></pre>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/^[-*]\s(.+)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br>");
  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

defineExpose({ scrollToBottom });
</script>

<template>
  <div ref="messagesContainer" class="messages-list">
    <!-- 欢迎页（无消息时） -->
    <div v-if="messages.length === 0" class="welcome">
      <div class="welcome-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L14.09 8.26L20 9.27L15.5 13.97L16.82 20L12 16.77L7.18 20L8.5 13.97L4 9.27L9.91 8.26L12 2Z" fill="var(--rust)" stroke="var(--rust)" stroke-width="0.5" />
        </svg>
      </div>
      <p class="welcome-title">锐眼 AI 分析助手</p>
      <p class="welcome-desc">
        选中一只股票，然后问我关于它的分析问题。
        <br />我会自动调用工具获取实时数据，给你多维度的专业分析。
      </p>
      <div class="welcome-suggestions" v-if="selectedStock">
        <button
          class="suggestion-chip"
          @click="emit('suggestion', `分析一下${selectedStock.name}的当前走势`)"
        >
          📊 分析走势
        </button>
        <button
          class="suggestion-chip"
          @click="emit('suggestion', `${selectedStock.name}的主力资金情况如何？`)"
        >
          💰 资金流向
        </button>
        <button
          class="suggestion-chip"
          @click="emit('suggestion', `${selectedStock.name}在行业中的表现怎么样？`)"
        >
          🏭 行业对比
        </button>
        <button
          class="suggestion-chip"
          @click="emit('suggestion', `${selectedStock.name}的技术面如何？结合K线分析`)"
        >
          📈 技术分析
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <template v-for="(msg, idx) in messages" :key="idx">
      <div v-if="msg.role === 'user'" class="message user-msg">
        <div class="msg-content">
          <div class="msg-text">{{ msg.content }}</div>
        </div>
      </div>
      <div v-else-if="msg.role === 'assistant'" class="message ai-msg">
        <div class="msg-avatar">AI</div>
        <div class="msg-content">
          <div class="msg-text markdown-body" v-html="renderMarkdown(msg.content)"></div>
        </div>
      </div>
    </template>

    <!-- 打字动画 -->
    <div v-if="loading" class="message ai-msg">
      <div class="msg-avatar">AI</div>
      <div class="msg-content">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.messages-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 20px;
}

.welcome-icon {
  margin-bottom: 16px;
  opacity: 0.6;
}

.welcome-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.welcome-desc {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
  max-width: 360px;
}

.welcome-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 20px;
}

.suggestion-chip {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  white-space: nowrap;
}

.suggestion-chip:hover {
  border-color: var(--ink);
  color: var(--ink);
  background: var(--fog);
}

.message {
  display: flex;
  gap: 10px;
  animation: fadeIn 0.2s ease;
}

.user-msg {
  justify-content: flex-end;
}

.user-msg .msg-content {
  background: var(--apricot-wash);
  color: var(--ink);
  border-radius: 16px 4px 16px 16px;
  padding: 10px 16px;
  max-width: 80%;
}

.user-msg .msg-text {
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.ai-msg {
  justify-content: flex-start;
}

.msg-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--fog);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--rust);
}

.ai-msg .msg-content {
  background: var(--fog);
  border: 1px solid var(--border-light);
  border-radius: 4px 16px 16px 16px;
  padding: 12px 16px;
  max-width: 80%;
}

.ai-msg .msg-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
}

.ai-msg .msg-text :deep(pre) {
  background: rgba(23, 25, 28, 0.04);
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.5;
}

.ai-msg .msg-text :deep(code) {
  background: rgba(23, 25, 28, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: "SF Mono", "Fira Code", monospace;
}

.ai-msg .msg-text :deep(pre code) {
  background: none;
  padding: 0;
}

.ai-msg .msg-text :deep(strong) {
  font-weight: 600;
}

.ai-msg .msg-text :deep(li) {
  list-style: none;
  padding-left: 4px;
  margin: 2px 0;
}

.ai-msg .msg-text :deep(li::before) {
  content: "• ";
  color: var(--rust);
}

.typing-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.typing-indicator span {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--graphite);
  animation: typingBounce 1.4s ease-in-out infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes typingBounce {
  0%,
  80%,
  100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
