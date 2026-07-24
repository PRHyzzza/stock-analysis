<script setup>
import { ref, watch, computed } from "vue";
import { useUserProfileSingleton } from "../composables/useUserProfile.js";
import { marked } from "marked";

const props = defineProps({
  show: { type: Boolean, default: false },
});

const emit = defineEmits(["close"]);

const { profileContent, saveProfile } = useUserProfileSingleton();

const editText = ref("");
const saving = ref(false);
const savedHint = ref(false);

// 弹窗打开时同步最新画像内容
watch(() => props.show, (val) => {
  if (val) {
    editText.value = profileContent.value || "";
  }
});

const previewHtml = computed(() => {
  const text = editText.value;
  if (!text || !text.trim()) return "<p style='color:var(--text-muted)'>暂无画像内容，等待 AI 自动生成或手动编写…</p>";
  return marked.parse(text);
});

async function handleSave() {
  saving.value = true;
  try {
    await saveProfile(editText.value);
    savedHint.value = true;
    setTimeout(() => { savedHint.value = false; }, 2000);
  } finally {
    saving.value = false;
  }
}

function closeModal() {
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay">
      <div class="modal-container">
        <!-- 头部 -->
        <div class="modal-header">
          <div class="modal-header-left">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--ink)" stroke-width="1.5">
              <circle cx="10" cy="7" r="4"/>
              <path d="M4 18c0-3.6 2.7-6.5 6-6.5s6 2.9 6 6.5" stroke-linecap="round"/>
            </svg>
            <span class="modal-title">用户画像</span>
            <span class="profile-badge">AI 自动总结</span>
          </div>
          <div class="modal-header-right">
            <span v-if="savedHint" class="saved-hint">✓ 已保存</span>
            <button class="btn-save" :disabled="saving" @click="handleSave">
              {{ saving ? "保存中…" : "保存" }}
            </button>
            <button class="modal-close" @click="closeModal">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- 主体：左编辑 + 右预览 -->
        <div class="modal-body">
          <div class="split-pane">
            <!-- 左侧编辑 -->
            <div class="pane pane-edit">
              <div class="pane-label">编辑</div>
              <textarea
                v-model="editText"
                class="edit-textarea"
                placeholder="AI 会根据你的对话自动总结投资画像…"
                spellcheck="false"
              ></textarea>
            </div>
            <!-- 右侧预览 -->
            <div class="pane pane-preview">
              <div class="pane-label">预览</div>
              <div class="preview-content markdown-body" v-html="previewHtml"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
@import "../assets/modal.css";
</style>

<style scoped>

/* ProfileModal 特有覆盖 */
.modal-overlay {
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
  animation: none;
}

.modal-container {
  width: 1100px;
  max-height: 80vh;
  animation: none;
}

.modal-header {
  padding: 16px 24px;
}

.modal-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.profile-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--fog);
  color: var(--text-muted);
}

.saved-hint {
  font-size: 12px;
  color: var(--green);
  font-weight: 500;
}

.btn-save {
  padding: 6px 18px;
  border: 1px solid var(--ink);
  border-radius: var(--radius-full);
  background: var(--ink);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-save:hover { opacity: 0.85; }
.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

.modal-close {
  border-radius: 8px;
}

/* ===== 主体 ===== */
.modal-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.split-pane {
  display: flex;
  height: 100%;
  min-height: 480px;
}

.pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pane-edit {
  border-right: 1px solid var(--border);
}

.pane-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 10px 16px 6px;
  flex-shrink: 0;
}

/* ===== 编辑区 ===== */
.edit-textarea {
  flex: 1;
  width: 100%;
  padding: 12px 16px;
  border: none;
  outline: none;
  resize: none;
  overflow-y: auto;
  font-family: "JetBrains Mono", "Cascadia Code", "Fira Code", monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  background: transparent;
}
.edit-textarea::placeholder {
  color: var(--text-muted);
  opacity: 0.5;
}

/* ===== 预览区 ===== */
.preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 16px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
}

/* markdown 基础样式 */
.markdown-body :deep(h1) {
  font-size: 20px;
  font-weight: 700;
  margin: 16px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.markdown-body :deep(h2) {
  font-size: 16px;
  font-weight: 700;
  margin: 14px 0 6px;
}
.markdown-body :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  margin: 10px 0 4px;
}
.markdown-body :deep(p) { margin: 4px 0 8px; }
.markdown-body :deep(ul), .markdown-body :deep(ol) {
  padding-left: 18px;
  margin: 4px 0 8px;
}
.markdown-body :deep(li) { margin: 2px 0; }
.markdown-body :deep(strong) { font-weight: 700; color: var(--ink); }
.markdown-body :deep(em) { font-style: italic; }
.markdown-body :deep(code) {
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  background: var(--fog);
  padding: 1px 6px;
  border-radius: 4px;
}
.markdown-body :deep(pre) {
  background: var(--fog);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}
.markdown-body :deep(pre code) {
  background: none;
  padding: 0;
}
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 12px;
  color: var(--text-muted);
  margin: 8px 0;
}
.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
</style>
