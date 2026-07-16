<script setup>
/**
 * AiChatMessages — 对话消息列表（含欢迎屏 + 打字动画）
 */
import { ref, computed, nextTick, watch, onMounted } from "vue";
import { marked } from "marked";

// 配置 marked
marked.setOptions({
  breaks: true,       // 换行 => <br>
  gfm: true,          // GitHub 风格 Markdown（表格、任务列表等）
});

const props = defineProps({
  messages: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  selectedStock: { type: Object, default: null },
});

const emit = defineEmits(["suggestion"]);

const messagesContainer = ref(null);
const reasoningEl = ref(null);

// 是否已有流式占位消息（避免 loading 时出现双气泡）
const hasStreamingMessage = computed(() => {
  const last = props.messages[props.messages.length - 1];
  return last?._streaming === true;
});

// 挂载时滚动到底部（已有历史消息场景）
onMounted(async () => {
  await nextTick();
  scrollToBottom();
});

// 切换股票时，消息列表整体替换（引用变化），滚动到底部
watch(
  () => props.messages,
  async () => {
    await nextTick();
    scrollToBottom();
  }
);

// 新消息追加时滚动到底部（length 变化 + 非引用替换场景的兜底）
watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    scrollToBottom();
  }
);

// 自动滚动（流式内容更新时，包括深度思考的 reasoning 和正文 content）
watch(
  () => {
    const last = props.messages[props.messages.length - 1];
    if (!last?._streaming) return null;
    // 同时追踪 reasoning 和 content，确保深度思考内容增长时也能触发滚动
    return last._reasoning + "|||" + last.content;
  },
  async () => {
    await nextTick();
    scrollToBottom();
    // 深度思考内部滚动条也跟随到底部
    if (reasoningEl.value) {
      reasoningEl.value.scrollTop = reasoningEl.value.scrollHeight;
    }
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
  const raw = marked.parse(text);
  // marked 默认已做 HTML 转义，确保输出安全
  return raw;
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
      <p class="welcome-title">AI 分析助手</p>
      <p class="welcome-desc">
        选中一只 A 股个股，然后问我关于它的分析问题。
        <br />我会自动调用东方财富/Tencent 数据源获取实时行情，
        给你多维度的专业分析。
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
          @click="emit('suggestion', `${selectedStock.name}今日的走势分析如何？`)"
        >
          📉 今日走势
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
          <!-- 深度思考中：有推理内容但尚未输出正文 -->
          <div v-if="msg._streaming && !msg.content" class="thinking-state">
            <div class="thinking-header">
              <span class="thinking-dot"></span>
              <span>深度思考中...</span>
            </div>
            <div v-if="msg._reasoning" ref="reasoningEl" class="thinking-reasoning">{{ msg._reasoning }}</div>
          </div>
          <!-- 正常渲染 markdown -->
          <div v-else class="msg-text markdown-body" v-html="renderMarkdown(msg.content)"></div>
        </div>
      </div>
    </template>

    <!-- 打字动画（仅在无流式占位消息时显示，避免双气泡） -->
    <div v-if="loading && !hasStreamingMessage" class="message ai-msg">
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

.ai-msg .msg-text :deep(ul),
.ai-msg .msg-text :deep(ol) {
  margin: 0.75rem 0;
  padding-left: 20px;
}

.ai-msg .msg-text :deep(li) {
  margin: 0.3rem 0;
}

.ai-msg .msg-text :deep(blockquote) {
  border-left: 3px solid rgba(39, 174, 96, 0.4);
  padding-left: 12px;
  margin: 0.75rem 0;
  color: var(--text-muted);
}

.ai-msg .msg-text :deep(h1),
.ai-msg .msg-text :deep(h2),
.ai-msg .msg-text :deep(h3),
.ai-msg .msg-text :deep(h4) {
  margin: 1rem 0 0.5rem;
  font-weight: 600;
  line-height: 1.4;
}

.ai-msg .msg-text :deep(h1) { font-size: 1.25rem; }
.ai-msg .msg-text :deep(h2) { font-size: 1.15rem; }
.ai-msg .msg-text :deep(h3) { font-size: 1.05rem; }
.ai-msg .msg-text :deep(h4) { font-size: 1rem; }

.ai-msg .msg-text :deep(p) {
  margin: 0.5rem 0;
}

.ai-msg .msg-text :deep(p:first-child) {
  margin-top: 0;
}

.ai-msg .msg-text :deep(p:last-child) {
  margin-bottom: 0;
}

.ai-msg .msg-text :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1rem 0;
}

.ai-msg .msg-text :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 13px;
}

.ai-msg .msg-text :deep(th),
.ai-msg .msg-text :deep(td) {
  padding: 8px 10px;
  border: 1px solid var(--border);
  text-align: left;
}

.ai-msg .msg-text :deep(th) {
  font-weight: 600;
  background: var(--fog);
  color: var(--text-secondary);
  font-size: 12px;
}

.ai-msg .msg-text :deep(td) {
  color: var(--text-primary);
}

.ai-msg .msg-text :deep(tbody tr:hover) {
  background: rgba(0, 0, 0, 0.02);
}

.ai-msg .msg-text :deep(a) {
  color: var(--rust);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ai-msg .msg-text :deep(a:hover) {
  opacity: 0.8;
}

/* ── 深度思考状态 ── */
.thinking-state {
  min-width: 120px;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 0;
}

.thinking-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--rust);
  animation: thinkingPulse 1.2s ease-in-out infinite;
}

@keyframes thinkingPulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

.thinking-reasoning {
  margin-top: 10px;
  padding: 10px 12px;
  background: rgba(23, 25, 28, 0.03);
  border-left: 2px solid var(--border);
  border-radius: 0 6px 6px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
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
