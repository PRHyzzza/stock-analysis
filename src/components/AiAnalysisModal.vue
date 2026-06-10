<script setup>
import { ref, computed } from "vue";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

const props = defineProps({
  show: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  result: { type: String, default: "" },
  error: { type: String, default: "" },
  apiKey: { type: String, default: "" },
  showApiKeyInput: { type: Boolean, default: false },
});

const renderedResult = computed(() => {
  if (!props.result) return "";
  return md.render(props.result);
});

const emit = defineEmits(["close", "run-analysis", "save-api-key", "clear-api-key"]);

const localKey = ref(props.apiKey || "");
const editingKey = ref(false);

function closeModal() {
  emit("close");
}

function startEditKey() {
  localKey.value = props.apiKey || "";
  editingKey.value = true;
}

function saveKey() {
  emit("save-api-key", localKey.value.trim());
  editingKey.value = false;
}

function cancelEditKey() {
  editingKey.value = false;
}

function clearKey() {
  emit("clear-api-key");
  localKey.value = "";
  editingKey.value = false;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container ai-modal-container">
        <div class="modal-header">
          <div class="modal-header-left">
            <span class="ai-icon">🤖</span>
            <span class="modal-title">AI 智能分析</span>
            <span class="industry-badge">AI 分析</span>
          </div>
          <div class="modal-header-right">
            <button
              class="ai-run-btn"
              :class="{ loading }"
              :disabled="loading"
              @click="$emit('run-analysis')"
            >
              <span v-if="loading" class="ai-spinner"></span>
              <span v-else>⚡</span>
              <span>{{ loading ? "分析中..." : "生成分析" }}</span>
            </button>
            <button class="modal-close" @click="closeModal">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="modal-body">
          <!-- API 密钥配置 -->
          <div v-if="showApiKeyInput || editingKey" class="api-key-section">
            <div class="api-key-header">
              <span class="api-key-label">🔑 DeepSeek API 密钥</span>
              <span v-if="apiKey && !editingKey" class="api-key-masked">
                sk-****{{ apiKey.slice(-6) }}
              </span>
            </div>
            <div class="api-key-row">
              <input
                v-model="localKey"
                type="password"
                class="api-key-input"
                placeholder="输入你的 DeepSeek API 密钥 (sk-...)"
                @keyup.enter="saveKey"
              />
              <button class="api-key-save-btn" @click="saveKey">保存</button>
              <button v-if="editingKey" class="api-key-cancel-btn" @click="cancelEditKey">取消</button>
            </div>
            <div class="api-key-hint">
              密钥仅保存在本地浏览器缓存中，不会上传到任何第三方。
              <a href="https://platform.deepseek.com/api_keys" target="_blank" class="api-key-link">去 DeepSeek 获取密钥 →</a>
            </div>
          </div>

          <!-- 已保存密钥时显示管理按钮 -->
          <div v-else-if="apiKey" class="api-key-manage">
            <span class="api-key-masked">🔑 sk-****{{ apiKey.slice(-6) }}</span>
            <button class="api-key-change-btn" @click="startEditKey">更换密钥</button>
            <button class="api-key-clear-btn" @click="clearKey">清除</button>
          </div>

          <!-- 主体内容 -->
          <div v-if="loading" class="modal-loading">
            <span class="kline-icon">🧠</span>
            <span>AI 分析中，请稍候...</span>
          </div>

          <div v-else-if="result" class="ai-result">
            <div class="ai-result-content" v-html="renderedResult"></div>
            <div class="ai-result-footer">
              <span class="ai-disclaimer">⚠️ 分析结果由 AI 生成，仅供参考，不构成投资建议</span>
            </div>
          </div>

          <div v-else-if="error" class="ai-error">
            <span class="ai-error-icon">⚠️</span>
            <p class="ai-error-text">{{ error }}</p>
          </div>

          <div v-else class="ai-empty">
            <span class="ai-empty-icon">🧠</span>
            <p class="ai-empty-text">点击「生成分析」按钮，AI 将对该股票进行多维度的技术面与基本面分析</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal-container {
  background: var(--card-bg);
  border-radius: 16px;
  width: 780px;
  max-width: 92vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.ai-modal-container {
  width: 740px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.modal-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-icon {
  font-size: 20px;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
}

.industry-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 4px;
  background: var(--border);
  color: var(--text-secondary);
}

.modal-close {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.modal-close:hover {
  background: var(--border);
  color: var(--text-primary);
}

.modal-body {
  padding: 24px 28px;
  overflow-y: auto;
  flex: 1;
}

.modal-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-muted);
  font-size: 14px;
}

.kline-icon {
  font-size: 32px;
}

/* AI 分析按钮 */
.ai-run-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  background: linear-gradient(135deg, #1a1a2e, #2d2d4a);
  color: #fff;
  transition: all 0.15s;
}

.ai-run-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #2d2d4a, #3d3d5a);
}

.ai-run-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.ai-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ai-spin 0.6s linear infinite;
}

@keyframes ai-spin {
  to { transform: rotate(360deg); }
}

/* AI 结果包装容器（保留在 scoped 中） */
.ai-result {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-result-footer {
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: center;
}

.ai-disclaimer {
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* AI 空状态 */
.ai-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 60px 20px;
}

.ai-empty-icon {
  font-size: 56px;
  opacity: 0.4;
}

.ai-empty-text {
  font-size: 14px;
  color: var(--text-muted);
  text-align: center;
  max-width: 360px;
  line-height: 1.6;
}

/* AI 错误状态 */
.ai-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 20px;
}

.ai-error-icon {
  font-size: 40px;
}

.ai-error-text {
  font-size: 13px;
  color: #e74c3c;
  text-align: center;
  max-width: 480px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  background: rgba(231, 76, 60, 0.08);
  border: 1px solid rgba(231, 76, 60, 0.2);
  border-radius: 8px;
  padding: 12px 16px;
}

/* ===== API 密钥配置 ===== */
.api-key-section {
  margin-bottom: 16px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.api-key-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.api-key-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.api-key-masked {
  font-size: 12px;
  color: var(--text-muted);
  font-family: monospace;
}

.api-key-row {
  display: flex;
  gap: 8px;
}

.api-key-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-primary);
  font-size: 13px;
  font-family: monospace;
  outline: none;
  transition: border-color 0.15s;
}

.api-key-input:focus {
  border-color: #4a6cf7;
}

.api-key-input::placeholder {
  color: var(--text-muted);
  font-size: 12px;
}

.api-key-save-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #4a6cf7;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.api-key-save-btn:hover {
  background: #3b5de7;
}

.api-key-cancel-btn {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.api-key-cancel-btn:hover {
  background: var(--border);
}

.api-key-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

.api-key-link {
  color: #4a6cf7;
  text-decoration: none;
  font-weight: 500;
}

.api-key-link:hover {
  text-decoration: underline;
}

/* 已保存密钥管理 */
.api-key-manage {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding: 10px 16px;
  background: rgba(74, 108, 247, 0.06);
  border: 1px solid rgba(74, 108, 247, 0.15);
  border-radius: 10px;
}

.api-key-change-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.api-key-change-btn:hover {
  background: var(--border);
  color: var(--text-primary);
}

.api-key-clear-btn {
  padding: 4px 12px;
  border: 1px solid rgba(231, 76, 60, 0.3);
  border-radius: 5px;
  background: transparent;
  color: #e74c3c;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.api-key-clear-btn:hover {
  background: rgba(231, 76, 60, 0.1);
}

/* ===== Markdown 渲染内容（非 scoped，穿透 v-html） ===== */
.ai-result-content {
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-primary);
}

.ai-result-content h1,
.ai-result-content h2,
.ai-result-content h3,
.ai-result-content h4 {
  font-weight: 700;
  line-height: 1.4;
  color: var(--text-primary);
}

.ai-result-content h1 {
  font-size: 1.35em;
  margin: 0 0 0.8em 0;
  padding-bottom: 0.4em;
  border-bottom: 2px solid var(--border);
}

.ai-result-content h2 {
  font-size: 1.1em;
  margin: 1.2em 0 0.6em 0;
  padding: 10px 14px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(59,130,246,0.06), rgba(99,102,241,0.04));
  border-left: 3.5px solid #3b82f6;
  color: #1a1a2e;
  letter-spacing: 0.01em;
}

.ai-result-content h2:first-child { margin-top: 0; }

.ai-result-content h3 {
  font-size: 1em;
  margin: 0.9em 0 0.4em 0;
  padding-left: 0;
  color: var(--text-primary);
}

.ai-result-content h4 {
  font-size: 0.95em;
  margin: 0.7em 0 0.3em 0;
  color: var(--text-secondary);
}

.ai-result-content p { margin: 0.45em 0; color: var(--text-primary); }

.ai-result-content ul,
.ai-result-content ol { margin: 0.4em 0; padding-left: 1.4em; }

.ai-result-content li { margin: 0.2em 0; line-height: 1.7; }

.ai-result-content ul > li { list-style: none; position: relative; padding-left: 0.2em; }

.ai-result-content ul > li::before {
  content: "•";
  position: absolute;
  left: -1em;
  color: #3b82f6;
  font-weight: 700;
  font-size: 1.1em;
}

.ai-result-content ol > li::marker { color: #3b82f6; font-weight: 600; }

.ai-result-content strong { font-weight: 700; color: #1a1a2e; }

.ai-result-content code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'JetBrains Mono', monospace;
  font-size: 0.88em;
  padding: 1px 6px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.12);
  border-radius: 4px;
  color: #2563eb;
}

.ai-result-content pre {
  margin: 0.7em 0;
  padding: 14px 16px;
  background: #1a1a2e;
  border-radius: 10px;
  overflow-x: auto;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.ai-result-content pre code {
  padding: 0;
  background: none;
  border: none;
  font-size: 0.85em;
  line-height: 1.7;
  color: #e2e8f0;
}

.ai-result-content blockquote {
  margin: 0.7em 0;
  padding: 10px 14px;
  border-left: 3.5px solid #f59e0b;
  background: linear-gradient(135deg, rgba(245,158,11,0.06), rgba(245,158,11,0.02));
  border-radius: 0 8px 8px 0;
  color: #92400e;
  font-size: 0.93em;
  line-height: 1.7;
}

.ai-result-content blockquote strong { color: #92400e; }

.ai-result-content hr {
  margin: 1em 0;
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--border), transparent);
}

.ai-result-content table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 0.7em 0;
  font-size: 0.9em;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.ai-result-content th,
.ai-result-content td {
  padding: 8px 12px;
  border: none;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.ai-result-content th {
  background: #f8fafc;
  font-weight: 700;
  color: #1a1a2e;
  font-size: 0.95em;
  border-bottom: 2px solid #e2e8f0;
}

.ai-result-content td { color: var(--text-primary); }
.ai-result-content tr:last-child td { border-bottom: none; }
.ai-result-content tr:hover td { background: rgba(59,130,246,0.02); }

.ai-result-content a { color: #3b82f6; text-decoration: none; font-weight: 500; }
.ai-result-content a:hover { color: #2563eb; text-decoration: underline; }

.ai-result-content img { max-width: 100%; border-radius: 8px; margin: 0.5em 0; }

@media (prefers-color-scheme: dark) {
  .ai-result-content h2 {
    background: linear-gradient(135deg, rgba(59,130,246,0.12), rgba(99,102,241,0.06));
    color: #e2e8f0;
    border-left-color: #60a5fa;
  }
  .ai-result-content strong { color: #e2e8f0; }
  .ai-result-content code {
    background: rgba(96, 165, 250, 0.1);
    border-color: rgba(96, 165, 250, 0.15);
    color: #93c5fd;
  }
  .ai-result-content pre { background: #0f0f1a; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
  .ai-result-content pre code { color: #cbd5e1; }
  .ai-result-content blockquote {
    background: linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.04));
    color: #fbbf24;
    border-left-color: #f59e0b;
  }
  .ai-result-content blockquote strong { color: #fbbf24; }
  .ai-result-content th {
    background: rgba(255,255,255,0.04);
    color: #e2e8f0;
    border-bottom-color: rgba(255,255,255,0.08);
  }
  .ai-result-content tr:hover td { background: rgba(59,130,246,0.04); }
  .ai-result-content a { color: #60a5fa; }
  .ai-result-content a:hover { color: #93c5fd; }
  .ai-result-content ul > li::before { color: #60a5fa; }
  .ai-result-content ol > li::marker { color: #60a5fa; }
}
</style>

.ai-result-content h1,
.ai-result-content h2,
.ai-result-content h3,
.ai-result-content h4 {
  font-weight: 700;
  line-height: 1.4;
  color: var(--text-primary);
}

.ai-result-content h1 {
  font-size: 1.35em;
  margin: 0 0 0.8em 0;
  padding-bottom: 0.4em;
  border-bottom: 2px solid var(--border);
}

.ai-result-content h2 {
  font-size: 1.1em;
  margin: 1.2em 0 0.6em 0;
  padding: 10px 14px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(59,130,246,0.06), rgba(99,102,241,0.04));
  border-left: 3.5px solid #3b82f6;
  color: #1a1a2e;
  letter-spacing: 0.01em;
}

.ai-result-content h2:first-child {
  margin-top: 0;
}

.ai-result-content h3 {
  font-size: 1em;
  margin: 0.9em 0 0.4em 0;
  padding-left: 0;
  color: var(--text-primary);
}

.ai-result-content h4 {
  font-size: 0.95em;
  margin: 0.7em 0 0.3em 0;
  color: var(--text-secondary);
}

.ai-result-content p {
  margin: 0.45em 0;
  color: var(--text-primary);
}

.ai-result-content ul,
.ai-result-content ol {
  margin: 0.4em 0 0.4em 0;
  padding-left: 1.4em;
}

.ai-result-content li {
  margin: 0.2em 0;
  line-height: 1.7;
}

.ai-result-content ul > li {
  list-style: none;
  position: relative;
  padding-left: 0.2em;
}

.ai-result-content ul > li::before {
  content: "•";
  position: absolute;
  left: -1em;
  color: #3b82f6;
  font-weight: 700;
  font-size: 1.1em;
}

.ai-result-content ol > li::marker {
  color: #3b82f6;
  font-weight: 600;
}

.ai-result-content strong {
  font-weight: 700;
  color: #1a1a2e;
}

.ai-result-content code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'JetBrains Mono', monospace;
  font-size: 0.88em;
  padding: 1px 6px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.12);
  border-radius: 4px;
  color: #2563eb;
}

.ai-result-content pre {
  margin: 0.7em 0;
  padding: 14px 16px;
  background: #1a1a2e;
  border-radius: 10px;
  overflow-x: auto;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.ai-result-content pre code {
  padding: 0;
  background: none;
  border: none;
  font-size: 0.85em;
  line-height: 1.7;
  color: #e2e8f0;
}

.ai-result-content blockquote {
  margin: 0.7em 0;
  padding: 10px 14px;
  border-left: 3.5px solid #f59e0b;
  background: linear-gradient(135deg, rgba(245,158,11,0.06), rgba(245,158,11,0.02));
  border-radius: 0 8px 8px 0;
  color: #92400e;
  font-size: 0.93em;
  line-height: 1.7;
}

.ai-result-content blockquote strong {
  color: #92400e;
}

.ai-result-content hr {
  margin: 1em 0;
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--border), transparent);
}

.ai-result-content table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 0.7em 0;
  font-size: 0.9em;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.ai-result-content th,
.ai-result-content td {
  padding: 8px 12px;
  border: none;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.ai-result-content th {
  background: #f8fafc;
  font-weight: 700;
  color: #1a1a2e;
  font-size: 0.95em;
  border-bottom: 2px solid #e2e8f0;
}

.ai-result-content td {
  color: var(--text-primary);
}

.ai-result-content tr:last-child td {
  border-bottom: none;
}

.ai-result-content tr:hover td {
  background: rgba(59,130,246,0.02);
}

.ai-result-content a {
  color: #3b82f6;
  text-decoration: none;
  font-weight: 500;
}

.ai-result-content a:hover {
  color: #2563eb;
  text-decoration: underline;
}

.ai-result-content img {
  max-width: 100%;
  border-radius: 8px;
  margin: 0.5em 0;
}

@media (prefers-color-scheme: dark) {
  .ai-result-content h2 {
    background: linear-gradient(135deg, rgba(59,130,246,0.12), rgba(99,102,241,0.06));
    color: #e2e8f0;
    border-left-color: #60a5fa;
  }
  .ai-result-content strong {
    color: #e2e8f0;
  }
  .ai-result-content code {
    background: rgba(96, 165, 250, 0.1);
    border-color: rgba(96, 165, 250, 0.15);
    color: #93c5fd;
  }
  .ai-result-content pre {
    background: #0f0f1a;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .ai-result-content pre code {
    color: #cbd5e1;
  }
  .ai-result-content blockquote {
    background: linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.04));
    color: #fbbf24;
    border-left-color: #f59e0b;
  }
  .ai-result-content blockquote strong {
    color: #fbbf24;
  }
  .ai-result-content th {
    background: rgba(255,255,255,0.04);
    color: #e2e8f0;
    border-bottom-color: rgba(255,255,255,0.08);
  }
  .ai-result-content tr:hover td {
    background: rgba(59,130,246,0.04);
  }
  .ai-result-content a {
    color: #60a5fa;
  }
  .ai-result-content a:hover {
    color: #93c5fd;
  }
  .ai-result-content ul > li::before {
    color: #60a5fa;
  }
  .ai-result-content ol > li::marker {
    color: #60a5fa;
  }
}
