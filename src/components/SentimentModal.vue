<script setup>
/**
 * SentimentModal.vue — 个股社区情绪弹窗（东方财富股吧）
 *
 * 展示：情绪档位 + 看多/看空/中性占比 + 热度（阅读/回复）+ 最新热帖列表 + AI 情绪解读。
 * 帖子标题点击 → 系统浏览器打开原文。
 * AI 解读：帖子加载完成后**自动**流式生成，结果直接渲染在本弹窗内（无需按钮/跳转全局 AI）。
 */
import { ref, computed, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  useStockSentiment,
  deriveSentiment,
} from "../composables/useStockSentiment.js";
import { callLlmStream } from "../composables/llmClient.js";

const props = defineProps({
  show: { type: Boolean, default: false },
  stock: { type: Object, default: null },
});

const emit = defineEmits(["close"]);

const { posts, loading, error, load } = useStockSentiment();

const stats = computed(() => deriveSentiment(posts.value));

watch(
  () => [props.show, props.stock?.code],
  ([v]) => {
    if (v && props.stock) load(props.stock.code);
  }
);

// ─────────── AI 情绪解读（自动）───────────

/** localStorage 安全读取（与 useAiAnalysis 相同的 key） */
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const AI_API_KEY_KEY = "stock-analysis-ai-api-key";
const AI_MODEL_KEY = "stock-analysis-ai-model";
const AI_THINKING_KEY = "stock-analysis-ai-thinking";
const AI_EFFORT_KEY = "stock-analysis-ai-effort";

const aiText = ref("");
const aiLoading = ref(false);
const aiError = ref("");
let aiSeq = 0;          // 代际：股票切换时使在途流失效
let analyzedCode = "";  // 已分析完成的股票（同一股票不重复分析）

const sanitizedAiText = computed(() =>
  aiText.value ? DOMPurify.sanitize(marked.parse(aiText.value)) : ""
);

/** 构造解读请求（统计 + 最新 15 条帖子标题） */
function buildSentimentPrompt() {
  const s = stats.value;
  const ratioText = s.ratio != null ? Math.round(s.ratio * 100) + "%" : "--";
  const lines = posts.value
    .slice(0, 15)
    .map((p) => `- ${p.title}（${p.author} · 阅读 ${p.clickCount} · 回复 ${p.commentCount} · ${p.publishTime}）`)
    .join("\n");
  return (
    `股票 ${props.stock.name}(${props.stock.code}) 的东方财富股吧近况：\n` +
    `情绪统计：帖子 ${s.total ?? 0} 条（看多 ${s.bull ?? 0} / 中性 ${s.neutral ?? 0} / 看空 ${s.bear ?? 0} / 问句观望 ${s.questioning ?? 0}），` +
    `加权看多占比 ${ratioText}，情绪明确度 ${s.judgedRatio ?? "--"}，情绪档位「${s.level ?? "--"}」，热度 ${s.heat ?? 0}/100，总阅读 ${s.totalClicks ?? 0}。\n\n` +
    `最新热帖（前 ${Math.min(posts.value.length, 15)} 条）：\n${lines}\n\n` +
    `请解读：1) 社区整体是看多还是看空，情绪档位是否极端；2) 大家在讨论什么焦点（利好/利空/争议）；` +
    `3) 情绪与行情/基本面是否背离；4) 风险提示（股吧存在水军、反话、玩梗，情绪可能失真）。` +
    `情绪仅供参考，不构成投资建议。`
  );
}

const SENTIMENT_SYSTEM_PROMPT = `你是 A 股社区情绪分析助手，基于给定的股吧帖子统计与标题列表解读散户情绪。必须遵守：
- 统计是本地关键词启发式（短语表 + 否定词反转 + 问句识别 + 热度加权），可能误判反话、玩梗、隐喻、水军刷帖——请逐条审阅标题做语义判断，与统计交叉验证；两者冲突时以你的语义判断为准，并引用具体标题说明依据
- 情绪明确度（judgedRatio）低说明多数帖子无明确情绪（中性/问句多）→ 是观望/分歧氛围，不要按看多占比夸大情绪强度
- 问句帖多说明散户犹豫、分歧大
- 热帖（阅读量大）比普通帖更能代表主流情绪，解读时倾斜参考
- 输出 4 点结论即可，简洁（300 字内），不编造帖子内容`;

/** 自动触发 AI 解读（帖子加载完成后调用；同一股票只分析一次） */
async function autoAnalyze() {
  if (!props.stock || !posts.value.length || aiLoading.value) return;
  const code = props.stock.code;
  if (analyzedCode === code && aiText.value) return; // 已分析过同一股票，保留结果
  const seq = ++aiSeq;
  aiLoading.value = true;
  aiError.value = "";
  aiText.value = "";

  const apiKey = safeGetItem(AI_API_KEY_KEY);
  if (!apiKey) {
    aiLoading.value = false;
    aiError.value = "未配置 API Key：请先在「AI 分析」弹窗或设置中配置后重新打开本弹窗";
    return;
  }
  const model = safeGetItem(AI_MODEL_KEY) || "deepseek-v4-flash";
  const thinkingEnabled = safeGetItem(AI_THINKING_KEY) !== "false";
  const reasoningEffort = safeGetItem(AI_EFFORT_KEY) || "high";

  try {
    await callLlmStream({
      apiKey,
      model,
      thinkingEnabled,
      reasoningEffort,
      messages: [
        { role: "system", content: SENTIMENT_SYSTEM_PROMPT },
        { role: "user", content: buildSentimentPrompt() },
      ],
      tools: [],
      onDelta: (content) => {
        if (seq !== aiSeq) return; // 已切换股票：丢弃旧流
        aiText.value = content;
      },
    });
    if (seq !== aiSeq) return;
    analyzedCode = code;
  } catch (e) {
    if (seq !== aiSeq) return;
    aiError.value = `AI 解读失败: ${e.message || e}`;
  } finally {
    if (seq === aiSeq) aiLoading.value = false;
  }
}

// 帖子加载完成（含 5 分钟缓存命中）→ 自动分析
watch(
  () => [loading.value, posts.value],
  ([l, p]) => {
    if (!l && p && p.length) autoAnalyze();
  }
);

// 切换股票 → 清空旧解读，若弹窗开着且有数据则重新分析
watch(
  () => props.stock?.code,
  () => {
    aiSeq++;
    analyzedCode = "";
    aiText.value = "";
    aiError.value = "";
    aiLoading.value = false;
    if (props.show && posts.value.length) autoAnalyze();
  }
);

/** 情绪档位 → 颜色/文案 */
const LEVEL_STYLE = {
  狂热: { cls: "lv-red", icon: "🔥" },
  偏多: { cls: "lv-warm", icon: "📈" },
  中性: { cls: "lv-gray", icon: "➖" },
  偏空: { cls: "lv-cool", icon: "📉" },
  极度恐慌: { cls: "lv-green", icon: "🥶" },
  冷淡: { cls: "lv-gray", icon: "💤" },
};

function fmtNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(2) + "万";
  return String(n);
}

function fmtTime(t) {
  if (!t) return "";
  return String(t).slice(5, 16); // MM-DD HH:MM
}

function openPost(post) {
  const url = `https://guba.eastmoney.com/news,${props.stock?.code ?? ""},${post.id}.html`;
  openUrl(url).catch(() => {
    /* 打开失败静默 */
  });
}

function closeModal() {
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="closeModal">
      <div class="modal-container">
        <!-- 头部 -->
        <div class="modal-header">
          <div class="modal-title-row">
            <span class="flame-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 22c4.4 0 7-2.8 7-6.5 0-3.2-2-5.5-3.5-7.5-.5 1.5-1.2 2.6-2.5 3.5.3-3-1-6.5-3.5-8.5.2 3-1.5 5-2.8 6.7C5.2 11.4 5 13 5 15.5 5 19.2 7.6 22 12 22Z" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="modal-title">社区情绪</span>
            <span class="modal-badge" v-if="stock">{{ stock.name }} ({{ stock.code }})</span>
          </div>
          <button class="btn-close" @click="closeModal">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class="modal-body se-body">
          <!-- 加载中 -->
          <div v-if="loading" class="se-loading">
            <span class="se-spinner"></span>
            <span>正在抓取股吧讨论…</span>
          </div>

          <!-- 错误 -->
          <div v-else-if="error" class="se-empty">
            <p class="se-empty-title">⚠️ {{ error }}</p>
            <button class="se-retry" @click="stock && load(stock.code)">重试</button>
          </div>

          <!-- 空（港股/无帖子） -->
          <div v-else-if="!posts.length" class="se-empty">
            <p class="se-empty-title">暂无股吧帖子</p>
            <p class="se-empty-sub">港股暂不支持社区情绪，或该股讨论较少</p>
          </div>

          <template v-else>
            <!-- 情绪概览 -->
            <div class="se-overview">
              <div class="se-level-row">
                <span class="se-level" :class="(LEVEL_STYLE[stats.level] || {}).cls">
                  {{ (LEVEL_STYLE[stats.level] || {}).icon }} {{ stats.level }}
                </span>
                <span class="se-heat">热度 {{ stats.heat }}/100</span>
              </div>

              <!-- 看多/看空/中性占比条 -->
              <div class="se-bar">
                <span class="se-bar-bull" :style="{ width: stats.bullPct + '%' }"></span>
                <span class="se-bar-neutral" :style="{ width: stats.neutralPct + '%' }"></span>
                <span class="se-bar-bear" :style="{ width: stats.bearPct + '%' }"></span>
              </div>
              <div class="se-legend">
                <span class="se-legend-item"><i class="dot-bull"></i>看多 {{ stats.bull }}（{{ stats.bullPct }}%）</span>
                <span class="se-legend-item"><i class="dot-neutral"></i>中性 {{ stats.neutral }}（{{ stats.neutralPct }}%）</span>
                <span class="se-legend-item"><i class="dot-bear"></i>看空 {{ stats.bear }}（{{ stats.bearPct }}%）</span>
              </div>

              <div class="se-metrics">
                <div class="se-metric">
                  <span class="se-metric-val">{{ stats.total }}</span>
                  <span class="se-metric-label">帖子</span>
                </div>
                <div class="se-metric">
                  <span class="se-metric-val">{{ fmtNum(stats.totalClicks) }}</span>
                  <span class="se-metric-label">总阅读</span>
                </div>
                <div class="se-metric">
                  <span class="se-metric-val">{{ stats.avgComments }}</span>
                  <span class="se-metric-label">平均回复</span>
                </div>
              </div>
            </div>

            <!-- AI 情绪解读（帖子加载后自动生成，无需按钮） -->
            <div class="se-ai-section">
              <p class="setting-group-title">AI 情绪解读</p>
              <div v-if="aiLoading" class="se-ai-loading">
                <span class="se-spinner"></span>
                <span>AI 正在解读社区情绪…</span>
              </div>
              <div v-else-if="aiError" class="se-ai-error">
                <span>⚠️ {{ aiError }}</span>
                <button class="se-retry" @click="autoAnalyze">重试</button>
              </div>
              <div v-else-if="aiText" class="se-ai-content" v-html="sanitizedAiText"></div>
              <div v-else class="se-ai-empty">暂无解读</div>
            </div>

            <!-- 热帖列表 -->
            <div class="se-posts">
              <p class="setting-group-title">最新热帖</p>
              <div v-for="p in posts" :key="p.id" class="se-post" @click="openPost(p)">
                <div class="se-post-title">{{ p.title }}</div>
                <div class="se-post-meta">
                  <span class="se-post-author">{{ p.author }}</span>
                  <span class="se-post-time">{{ fmtTime(p.publishTime) }}</span>
                  <span class="se-post-stats">阅读 {{ fmtNum(p.clickCount) }} · 回复 {{ p.commentCount }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
@import "../assets/modal.css";
</style>

<style scoped>
.modal-container {
  width: 560px;
  height: 620px;
}

.modal-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.flame-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--apricot-wash);
  color: var(--rust);
}

.modal-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--fog);
  padding: 2px 10px;
  border-radius: var(--radius-full);
}

.se-body {
  padding: 20px;
  overflow-y: auto;
  gap: 16px;
  display: flex;
  flex-direction: column;
}

/* ── 加载 / 空态 ── */
.se-loading,
.se-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 13px;
}
.se-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--rust);
  border-radius: 50%;
  animation: seSpin 0.7s linear infinite;
}
@keyframes seSpin {
  to { transform: rotate(360deg); }
}
.se-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}
.se-empty-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}
.se-retry {
  padding: 6px 20px;
  border-radius: var(--radius-full);
  border: 1px solid var(--rust);
  background: var(--apricot-wash);
  color: var(--rust);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}

/* ── 情绪概览 ── */
.se-overview {
  padding: 16px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--card-bg);
}

.se-level-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.se-level {
  font-size: 16px;
  font-weight: 700;
  padding: 4px 14px;
  border-radius: var(--radius-full);
}
.se-level.lv-red { background: rgba(231, 76, 60, 0.12); color: #c0392b; }
.se-level.lv-warm { background: var(--apricot-wash); color: var(--rust); }
.se-level.lv-gray { background: var(--fog); color: var(--text-secondary); }
.se-level.lv-cool { background: rgba(39, 174, 96, 0.08); color: #1e8449; }
.se-level.lv-green { background: var(--green-bg); color: var(--green); }
.se-heat {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

/* 占比条 */
.se-bar {
  display: flex;
  height: 8px;
  border-radius: var(--radius-full);
  overflow: hidden;
  margin: 14px 0 8px;
  background: var(--fog);
}
.se-bar-bull { background: var(--red); transition: width 0.3s; }
.se-bar-neutral { background: #b8bcc4; transition: width 0.3s; }
.se-bar-bear { background: var(--green); transition: width 0.3s; }

.se-legend {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}
.se-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dot-bull,
.dot-neutral,
.dot-bear {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot-bull { background: var(--red); }
.dot-neutral { background: #b8bcc4; }
.dot-bear { background: var(--green); }

/* 指标 */
.se-metrics {
  display: flex;
  gap: 24px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.se-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.se-metric-val {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.se-metric-label {
  font-size: 11px;
  color: var(--text-muted);
}

/* AI 解读区块 */
.se-ai-section {
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--card-bg);
}
.se-ai-section .setting-group-title {
  margin-bottom: 8px;
}
.se-ai-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  padding: 6px 0;
}
.se-ai-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--rust);
  padding: 6px 0;
}
.se-ai-empty {
  font-size: 12px;
  color: var(--text-muted);
  padding: 6px 0;
}
.se-ai-content {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  word-break: break-word;
}
.se-ai-content :deep(p) {
  margin: 6px 0;
}
.se-ai-content :deep(ul),
.se-ai-content :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}
.se-ai-content :deep(li) {
  margin: 3px 0;
}
.se-ai-content :deep(strong) {
  font-weight: 700;
}
.se-ai-content :deep(h1),
.se-ai-content :deep(h2),
.se-ai-content :deep(h3) {
  font-size: 14px;
  font-weight: 700;
  margin: 10px 0 4px;
}

/* ── 热帖列表 ── */
.se-posts {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.se-posts .setting-group-title {
  margin-bottom: 8px;
}
.se-post {
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.12s;
}
.se-post:hover {
  border-color: var(--rust);
  background: rgba(93, 42, 26, 0.03);
}
.se-post-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}
.se-post-meta {
  display: flex;
  gap: 10px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
  flex-wrap: wrap;
}
.se-post-author {
  color: var(--rust);
  font-weight: 500;
}
.se-post-stats {
  margin-left: auto;
}
</style>
