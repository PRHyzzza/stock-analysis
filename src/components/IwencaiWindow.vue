<script setup>
/**
 * 问财选股独立窗口
 *
 * 由主窗口顶部"选股"按钮以 ?iwencai=1 参数打开独立窗口（系统标题栏）。
 * 内部复用 useIwencaiRobot 全链路：WebView 内注入 chameleon.js 生成 Cookie v
 * → 调用 Rust get_iwencai_robot → 渲染结果表格。
 * 点击结果行 → 发送 iwencai-select-stock 事件给主窗口联动选中并聚焦，随后关闭自身。
 */
import { ref, computed, reactive, watch, onMounted, nextTick } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  useIwencaiRobot,
  normalizeIwencaiResult,
  parseIwencaiCode,
  pickPaperPoolCandidates,
} from "../composables/useIwencaiRobot";
import { useUserProfileSingleton } from "../composables/useUserProfile";
import { usePaperAccount } from "../composables/usePaperAccount.js";

const appWindow = getCurrentWindow();

const { data, loading, error, vError, search, warmV } = useIwencaiRobot();

const question = ref("");
const page = ref(1);
// 请求 perpage（服务端上限 100；实测 page 参数被忽略，翻页在本地进行）
const perpage = 50;
// 本地每页显示行数
const PAGE_SIZE = 20;
const inputRef = ref(null);
// "AI 分析这批股票"已发送标记（短暂显示 ✓ 后复位）
const aiSent = ref(false);
// "AI 优化"状态与提示
const aiOptimizing = ref(false);
const aiHint = ref("");

/** localStorage 安全读取（隐私模式/quota 异常时返回 null） */
function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** localStorage 安全写入（quota 满等异常静默忽略） */
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* ignore quota errors */ }
}

// ── 查询历史（快捷选股）：每次查询自动记录，可单条删除/清空 ──
const HISTORY_KEY = "stock-analysis-iwencai-history";
const HISTORY_MAX = 20; // 最多保留 20 条，超出丢弃最旧

/** 加载查询历史（数组，最新在前） */
function loadHistory() {
  try {
    const raw = safeGet(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

const searchHistory = ref(loadHistory());

/** 记录一次查询：去重（重复的移到最前）+ 上限裁剪 + 持久化 */
function recordSearch(q) {
  const text = String(q || "").trim();
  if (!text) return;
  const rest = searchHistory.value.filter((h) => h !== text);
  searchHistory.value = [text, ...rest].slice(0, HISTORY_MAX);
  safeSet(HISTORY_KEY, JSON.stringify(searchHistory.value));
}

/** 删除单条历史 */
function removeHistoryItem(q) {
  searchHistory.value = searchHistory.value.filter((h) => h !== q);
  safeSet(HISTORY_KEY, JSON.stringify(searchHistory.value));
}

/** 清空全部历史 */
function clearSearchHistory() {
  searchHistory.value = [];
  safeSet(HISTORY_KEY, JSON.stringify([]));
}

/** 点击历史条目：填入输入框并立即查询 */
function useHistory(q) {
  question.value = q;
  doSearch();
}

// 预置示例问句（点击快速填充输入框；查询历史见上方 searchHistory）
const examples = [
  "非ST ，现价与一年内最低价比从小到大排列，(9:25分至9:40分成交量÷自由流通股×100)>2，实际换手率,现价>开盘价，现价>均价,量比>1,5日均价/20日均价>1,5天日均成交量/20天日均成交量>1,3天内无涨停，集中度变小，二季报盈利或二季报预告盈利或年报盈利，现价与一年内最低价比从小到大排列，市值大于50亿",
];

const normalized = computed(() => normalizeIwencaiResult(data.value));
const rowCount = computed(() => data.value?.rowCount ?? 0);
// 服务端免费接口不支持 page 翻页（实测 page=2/3 返回内容与第 1 页完全相同），
// 因此采用本地分页：一次请求 perpage=50 拉回全部行，前端按 PAGE_SIZE 切片
const localRows = computed(() => {
  const rows = normalized.value.rows;
  const start = (page.value - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
});
const totalPages = computed(() => {
  const n = normalized.value.rows.length;
  return Math.max(1, Math.ceil(n / PAGE_SIZE));
});

onMounted(() => {
  nextTick(() => inputRef.value?.focus());
  // 进入窗口立即预热问财凭证 v（chameleon.js 持续刷新，有效约 30 分钟）：
  // 避免首次搜索时才注入导致的等待，也防止窗口闲置后凭证过期
  warmV().catch(() => {
    /* 预热失败不阻塞 UI，搜索时会自动重试 */
  });
});

/** 回车查询：IME 组词中（如拼音候选未上屏）不触发，避免吞掉候选词 */
function onEnterSearch(e) {
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  doSearch();
}

/** 执行搜索（第 1 页）；同时把本次查询记入历史（快捷选股区） */
function doSearch() {
  const q = question.value.trim();
  if (!q) return;
  page.value = 1;
  aiSent.value = false;
  recordSearch(q);
  search(q, 1, perpage);
}

/**
 * 清洗 AI 返回的优化查询：剥 markdown 围栏/常见前缀，换行压成 "; "
 */
function cleanOptimizedQuery(text) {
  let t = String(text || "").trim();
  // 剥 markdown 代码块围栏
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "");
  // 优先按 JSON 解析（{ "query": "..." }）
  const jsonMatch = t.match(/\{[\s\S]*"query"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.query && String(parsed.query).trim()) {
        t = String(parsed.query).trim();
      }
    } catch { /* 解析失败走文本清洗 */ }
  }
  // 剥常见前缀标签
  t = t.replace(/^(优化后(的)?(问财)?(查询|语句)?[:：]?|查询语句[:：]?|问财[:：]?|建议(查询|语句)[:：]?)\s*/i, "");
  // 换行 → 分号分隔（问财条件语法），连续空白压成单空格
  t = t.replace(/\s*\n\s*/g, "; ").replace(/[;；]\s*$/g, "").trim();
  return t;
}

/** "✨ AI 优化"：理解输入框内容的目的 + 结合用户画像风格，改写/补全为更专业的问财查询 */
async function optimizeQuery() {
  const raw = question.value.trim();
  if (!raw || aiOptimizing.value) return;

  const apiKey = safeGet("stock-analysis-ai-api-key");
  if (!apiKey) {
    aiHint.value = "⚠️ 请先在主窗口「AI 设置」中配置 API Key";
    return;
  }

  aiOptimizing.value = true;
  aiHint.value = "";
  try {
    // 读取用户画像（投资风格/关注方向/风险偏好）
    const { loadProfile, getProfileForContext } = useUserProfileSingleton();
    await loadProfile().catch(() => {});
    const profile = getProfileForContext() || "（未设置）";

    const model = safeGet("stock-analysis-ai-model") || "deepseek-v4-flash";
    const prompt =
      `你是问财选股查询优化助手。用户输入了选股条件，请理解他的意图，结合用户画像中的投资风格，` +
      `把条件改写为更专业、更完整的问财查询语句。\n\n` +
      `规则：\n` +
      `1. 只输出 JSON：{"query": "优化后的查询语句"}，不要输出任何其他内容、解释或 Markdown。\n` +
      `2. 条件之间用分号「;」分隔；用「大于/小于/不低于/不高于/等于」等明确表述。\n` +
      `3. 市值/成交额等带单位（亿/万），如「总市值大于100亿」。\n` +
      `4. 保留用户明确指定的条件；可结合画像风格补充常见维度（如换手率、量比、涨幅、市值区间、市盈率等），` +
      `但不要偏离用户意图，不要添加用户明确排除的内容。\n\n` +
      `用户画像：\n${profile}\n\n` +
      `用户输入：\n${raw}`;

    const result = await invoke("call_llm", {
      apiKey,
      model,
      messages: [{ role: "user", content: prompt }],
      tools: [],
      reasoningEffort: "low",
      thinkingEnabled: false,
      // 问财改写只需一句 JSON，256 tokens 足够（后端缺省 393216 太浪费）
      maxTokens: 256,
    });

    const optimized = cleanOptimizedQuery(result?.choices?.[0]?.message?.content || "");
    if (!optimized) {
      aiHint.value = "AI 未能生成有效查询，请手动调整或重试";
      return;
    }

    question.value = optimized;
    aiHint.value = "✅ 已按你的风格优化查询并开始搜索";
    doSearch();
  } catch (e) {
    aiHint.value = `AI 优化失败: ${e?.message || e}`;
  } finally {
    aiOptimizing.value = false;
  }
}

/** "AI 分析这批股票"：把当前查询 + 完整结果表发给主窗口全局 AI 解读（整个列表不截断） */
function onAiAnalyze() {
  if (!data.value || !normalized.value.rows.length) return;
  emit("iwencai-ai-analyze", {
    question: question.value.trim(),
    total: data.value.rowCount ?? normalized.value.rows.length,
    columns: normalized.value.columns.map((c) => ({
      key: c.key ?? c.label ?? c.name,
      name: c.name || c.key,
    })),
    rows: normalized.value.rows,
  });
  aiSent.value = true;
  setTimeout(() => { aiSent.value = false; }, 3000);
}

/** 翻页：本地切片切换，不再请求服务端（服务端 page 参数无效） */
function changePage(p) {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  page.value = p;
}

/** 点击行 → 通知主窗口选中股票并关闭自身 */
function onRowClick(row) {
  const parsed = parseIwencaiCode(row);
  if (!parsed) return;
  const name = String(row["股票简称"] ?? "");
  emit("iwencai-select-stock", { code: parsed.code, market: parsed.market, name });
  appWindow.close();
}

/** 本窗口会话内已加入自选的代码集合（防止重复加） */
const starred = reactive(new Set());

/** 行内股票代码（用于按钮状态判断） */
function rowCode(row) {
  const parsed = parseIwencaiCode(row);
  return parsed ? parsed.code : "";
}

/** 点击「自选」→ 通知主窗口加入自选并本地标记 */
function onAddWatchlist(row) {
  const parsed = parseIwencaiCode(row);
  if (!parsed || starred.has(parsed.code)) return;
  const name = String(row["股票简称"] ?? "");
  emit("iwencai-add-watchlist", { code: parsed.code, market: parsed.market, name });
  starred.add(parsed.code);
}

// ── 模拟盘自选 ──────────────────────────────────────
// 本窗口与主窗口共用同一个 localStorage key（stock-analysis-paper-pool），
// 直接写池即可，主窗口打开模拟盘面板时会 reloadPool() 同步。
const paper = usePaperAccount();
/** 本窗口会话内已加入模拟盘的代码集合（防重复加；初值取磁盘上已有的池） */
const inPaperPool = reactive(new Set((paper.pool.value || []).map((p) => p.code)));
/** 一次性提示文案（加池结果） */
const paperHint = ref("");

function markPaperHint(text) {
  paperHint.value = text;
  window.setTimeout(() => {
    if (paperHint.value === text) paperHint.value = "";
  }, 2600);
}

/** 行内「模拟盘」→ 单只加入选股池 */
function onAddPaper(row) {
  const parsed = parseIwencaiCode(row);
  if (!parsed) return;
  if (parsed.market !== "SH" && parsed.market !== "SZ" && parsed.market !== "BJ") {
    markPaperHint("模拟盘只做 A 股（沪深北），港股不入池");
    return;
  }
  if (inPaperPool.has(parsed.code)) return;
  const name = String(row["股票简称"] ?? "");
  const added = paper.addToPool([{ code: parsed.code, name, source: "iwencai" }]);
  for (const a of added) inPaperPool.add(a.code);
  if (added.length) markPaperHint(`已加入模拟盘自选：${name || parsed.code}`);
}

/** 整批加入（当前页所有行）→ 一次写池 */
function onAddPaperBatch() {
  const candidates = [];
  for (const row of localRows.value) {
    const parsed = parseIwencaiCode(row);
    if (!parsed) continue;
    if (parsed.market !== "SH" && parsed.market !== "SZ" && parsed.market !== "BJ") continue;
    if (inPaperPool.has(parsed.code)) continue;
    candidates.push({
      code: parsed.code,
      name: String(row["股票简称"] ?? ""),
      source: "iwencai",
    });
  }
  if (!candidates.length) {
    markPaperHint("本页标的都已在模拟盘自选中");
    return;
  }
  const added = paper.addToPool(candidates);
  for (const a of added) inPaperPool.add(a.code);
  markPaperHint(`已加入模拟盘自选 ${added.length} 只（池内共 ${paper.pool.value.length} 只）`);
}

// ── 覆盖模拟盘自选 ────────────────────────────────────
// 语义：把**本次查询的全部结果**（不只当前页）写进模拟盘自选，并清掉原有池。
// 会删用户已有数据，所以必须两段式确认 + 明确告知会清空多少只。
const paperOverwriteConfirm = ref(false);

/** 本次查询全部结果里的 A 股（去重；港股不参与，模拟盘只做沪深北） */
const paperCandidates = computed(() => pickPaperPoolCandidates(normalized.value.rows));

function cancelPaperOverwrite() {
  paperOverwriteConfirm.value = false;
}

/** 覆盖模拟盘自选：第一次点转确认态，第二次才真正写盘 */
function requestPaperOverwrite() {
  const list = paperCandidates.value;
  if (!list.length) {
    markPaperHint("本次结果里没有可入池的 A 股（模拟盘只做沪深北 6 位代码）");
    return;
  }
  if (!paperOverwriteConfirm.value) {
    // 跨窗口：主窗口可能刚改过池，先重读再报数，避免拿过期数字骗人
    const before = paper.reloadPool();
    paperOverwriteConfirm.value = true;
    markPaperHint(
      `覆盖会清空现有 ${before} 只、换成这 ${list.length} 只（含未显示的其他页）；再点一次确认`
    );
    return;
  }
  const res = paper.replacePool(list);
  inPaperPool.clear();
  for (const p of paper.pool.value) inPaperPool.add(p.code);
  paperOverwriteConfirm.value = false;
  markPaperHint(
    (res.before > 0
      ? `已覆盖模拟盘自选：${res.total} 只（原 ${res.before} 只已移除）`
      : `已把 ${res.total} 只写入模拟盘自选`) + "；主窗口下次打开模拟盘面板即可看到"
  );
}

/** 5 秒不点第二次自动取消，避免误触留着红色的确认按钮 */
watch(paperOverwriteConfirm, (v) => {
  if (!v) return;
  window.setTimeout(() => {
    if (paperOverwriteConfirm.value) paperOverwriteConfirm.value = false;
  }, 5000);
});

/** 重新查询时退出确认态（结果变了，确认的前提也就变了） */
watch(question, () => cancelPaperOverwrite());

/** 单元格显示：空值 → --；数值列按列类型/单位格式化（长小数、大数读起来更直观） */function cellText(v, col) {
  if (v === null || v === undefined || v === "") return "--";
  if (col?.type === "DOUBLE" || typeof v === "number") {
    const num = Number(v);
    if (Number.isFinite(num)) {
      const abs = Math.abs(num);
      if (abs >= 1e8) return (num / 1e8).toFixed(2) + "亿";
      if (abs >= 1e4) return (num / 1e4).toFixed(2) + "万";
      return Number.isInteger(num) ? String(num) : num.toFixed(2);
    }
  }
  return String(v);
}

/** 数值列右对齐（只认服务端给的 DOUBLE 类型；缺 type 时不靠列名猜，宁可左对齐也不误导） */
function isNumCol(col) {
  return col?.type === "DOUBLE";
}
</script>

<template>
  <div class="iwencai-window">
    <!-- 顶部工具条（无系统标题栏，整条可拖动窗口） -->
    <header class="toolbar" data-tauri-drag-region>
      <div class="toolbar-left" data-tauri-drag-region>
        <span class="toolbar-badge">问财</span>
        <span class="toolbar-title">智能选股</span>
      </div>
      <div class="toolbar-actions">
        <button
          class="ai-optimize-btn"
          :disabled="!question.trim() || aiOptimizing"
          :title="question.trim() ? 'AI 根据你的输入意图和画像风格优化选股条件' : '输入选股条件后才能优化'"
          @click="optimizeQuery"
        >
          <span v-if="aiOptimizing" class="ai-opt-spinner"></span>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L14.09 8.26L20 9.27L15.5 13.97L16.82 20L12 16.77L7.18 20L8.5 13.97L4 9.27L9.91 8.26L12 2Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>
          </svg>
          {{ aiOptimizing ? "优化中…" : "AI 优化" }}
        </button>
        <button
          class="search-btn"
          :disabled="loading || !question.trim()"
          @click="doSearch"
        >
          <span v-if="loading" class="spinner"></span>
          {{ loading ? "查询中…" : "查询" }}
        </button>
      </div>
    </header>

    <div class="iwencai-body">
      <!-- 问句输入区 -->
      <section class="query-card">
        <textarea
          ref="inputRef"
          v-model="question"
          class="query-input"
          rows="4"
          placeholder="输入选股条件，如：非ST，市值大于50亿，量比大于1…"
          @keydown.enter.exact="onEnterSearch"
        ></textarea>
        <div class="query-actions">
          <!-- 预置示例（点击填充输入框） -->
          <div class="query-examples">
            <span class="example-label">试试：</span>
            <button
              v-for="ex in examples"
              :key="ex"
              class="example-chip"
              :title="ex"
              @click="question = ex"
            >{{ ex }}</button>
          </div>
          <!-- 最近查询（自动记录，可单条删除/清空；点击直接重新查询） -->
          <div v-if="searchHistory.length" class="query-examples history-row">
            <span class="example-label">最近查询：</span>
            <span v-for="h in searchHistory" :key="h" class="history-chip">
              <button class="history-chip-btn" :title="h" @click="useHistory(h)">{{ h }}</button>
              <button class="history-chip-del" title="删除该记录" @click="removeHistoryItem(h)">×</button>
            </span>
            <button class="history-clear" title="清空全部查询记录" @click="clearSearchHistory">清空</button>
          </div>
        </div>
        <!-- AI 优化提示 -->
        <div v-if="aiHint" class="ai-hint" :class="{ ok: aiHint.startsWith('✅') }">{{ aiHint }}</div>
      </section>

      <!-- v 凭证错误提示 -->
      <div v-if="vError" class="error-banner">
        <span class="error-icon">⚠️</span>
        <span class="error-text">无法获取问财验证凭证，请检查网络后重试</span>
      </div>

      <!-- 查询错误提示 -->
      <div v-else-if="error" class="error-banner">
        <span class="error-icon">⚠️</span>
        <span class="error-text">{{ error }}</span>
      </div>

      <!-- 结果区 -->
      <section v-if="data" class="result-card">
        <div class="result-meta">
          <div class="result-info">
            <span class="result-count">共 <b>{{ rowCount }}</b> 条结果</span>
            <span class="meta-sep">·</span>
            <span class="result-page">第 {{ page }} / {{ totalPages }} 页</span>
            <span v-if="normalized.rows.length < rowCount" class="result-hint">
              仅加载前 {{ normalized.rows.length }} 条（免费接口限制）
            </span>
          </div>
          <div class="result-actions">
            <button
              class="meta-btn ai-analyze-btn"
              :class="{ sent: aiSent }"
              :disabled="!normalized.rows.length"
              title="把当前筛选结果发送给 AI 解读（打开全局 AI 分析）"
              @click="onAiAnalyze"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" v-if="!aiSent">
                <path d="M12 2L14.09 8.26L20 9.27L15.5 13.97L16.82 20L12 16.77L7.18 20L8.5 13.97L4 9.27L9.91 8.26L12 2Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>
              </svg>
              {{ aiSent ? "✓ 已发送 AI 分析" : "AI 分析这批股票" }}
            </button>
            <button
              class="meta-btn paper-batch-btn"
              :disabled="!normalized.rows.length"
              title="把本页所有 A 股加入模拟盘自选（不清空已有池；主窗口「模拟盘」面板可从这里快速下单）"
              @click="onAddPaperBatch"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="1.8" y="8.6" width="2.6" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
                <rect x="6" y="5.4" width="2.6" height="8.2" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
                <rect x="10.2" y="2.4" width="2.6" height="11.2" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
              </svg>
              本页加入模拟盘
            </button>
            <button
              class="meta-btn paper-replace-btn"
              :class="{ confirming: paperOverwriteConfirm }"
              :disabled="!normalized.rows.length"
              :title="`用本次全部 ${paperCandidates.length} 只 A 股覆盖模拟盘自选（会先清空原有自选池，需两次点击确认）`"
              @click="requestPaperOverwrite"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M13.2 6.4A5.4 5.4 0 0 0 3.6 4.2M2.8 9.6A5.4 5.4 0 0 0 12.4 11.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                <path d="M13.4 2.6v3.9h-3.9M2.6 13.4V9.5h3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              {{ paperOverwriteConfirm ? `确认覆盖 ${paperCandidates.length} 只` : "覆盖模拟盘自选" }}
            </button>
          </div>
        </div>
        <div v-if="paperHint" class="paper-hint-line">{{ paperHint }}</div>
        <div class="result-table-wrap">
          <table class="result-table">
            <thead>
              <tr>
                <th
                  v-for="col in normalized.columns"
                  :key="col.key"
                  :class="{ 'col-num': isNumCol(col) }"
                >
                  {{ col.name }}
                </th>
                <th class="th-sticky">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in localRows"
                :key="i"
                class="result-row"
                @click="onRowClick(row)"
              >
                <td
                  v-for="col in normalized.columns"
                  :key="col.key"
                  :class="{ 'col-num': isNumCol(col) }"
                >
                  {{ cellText(row[col.key], col) }}
                </td>
                <td class="td-sticky">
                  <button
                    class="star-btn"
                    :class="{ added: starred.has(rowCode(row)) }"
                    @click.stop="onAddWatchlist(row)"
                  >{{ starred.has(rowCode(row)) ? "✓ 已加" : "★ 自选" }}</button>
                  <button
                    class="star-btn paper-btn"
                    :class="{ added: inPaperPool.has(rowCode(row)) }"
                    :disabled="inPaperPool.has(rowCode(row))"
                    title="加入模拟盘自选（A 股，主窗口「模拟盘」面板可从这里快速下单）"
                    @click.stop="onAddPaper(row)"
                  >{{ inPaperPool.has(rowCode(row)) ? "✓ 已入池" : "模拟盘" }}</button>
                </td>
              </tr>
              <tr v-if="!localRows.length">
                <td :colspan="normalized.columns.length + 1" class="table-empty">
                  本次条件没有选出股票，试试放宽条件或换个问法
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- 分页（只有一页时不显示，页码信息已在标题行） -->
        <div v-if="totalPages > 1" class="pagination">
          <button class="page-btn" :disabled="page <= 1" @click="changePage(page - 1)">‹ 上一页</button>
          <span class="page-info">{{ page }} / {{ totalPages }}</span>
          <button class="page-btn" :disabled="page >= totalPages" @click="changePage(page + 1)">下一页 ›</button>
        </div>
      </section>

      <!-- 空状态 -->
      <div v-else-if="!loading && !error" class="empty-state">
        <div class="empty-icon">🔍</div>
        <p class="empty-title">输入选股条件开始查询</p>
        <p class="empty-sub">点击结果行可联动主窗口查看个股详情</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 浅色 Steep 设计系统（与主窗口一致） */
.iwencai-window {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--text-primary);
  font-size: 14px;
  letter-spacing: -0.009em;
  padding: 16px;
  gap: 14px;
}

/* ===== 顶部工具条 ===== */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toolbar-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--rust);
  background: var(--apricot-wash);
  padding: 3px 10px;
  border-radius: var(--radius-full);
}

.toolbar-title {
  font-size: 16px;
  font-weight: 600;
}

.search-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 24px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--ink);
  color: var(--white);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition:
    background-color var(--transition-fast),
    opacity var(--transition-fast),
    transform var(--transition-fast);
}

.search-btn:hover:not(:disabled) {
  background: #2a2d31;
}

.search-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.search-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ===== AI 优化按钮 ===== */
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ai-optimize-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: var(--radius-full);
  border: 1px solid var(--rust);
  background: var(--apricot-wash);
  color: var(--rust);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}
.ai-optimize-btn:hover:not(:disabled) {
  background: var(--rust);
  color: #fff;
}
.ai-optimize-btn:active:not(:disabled) {
  transform: scale(0.98);
}
.ai-optimize-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ai-opt-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--rust);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}
.ai-optimize-btn:hover:not(:disabled) .ai-opt-spinner {
  border-color: #fff;
  border-top-color: transparent;
}

/* ===== AI 优化提示 ===== */
.ai-hint {
  margin-top: 10px;
  padding: 7px 12px;
  border-radius: var(--radius-xs);
  background: rgba(220, 38, 38, 0.06);
  border: 1px solid rgba(220, 38, 38, 0.18);
  color: var(--danger-ink);
  font-size: 12px;
  line-height: 1.5;
}
.ai-hint.ok {
  background: rgba(39, 174, 96, 0.06);
  border-color: rgba(39, 174, 96, 0.25);
  color: var(--green);
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* ===== 主体 ===== */
.iwencai-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

/* ===== 问句输入卡 ===== */
.query-card {
  padding: 14px 16px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  flex-shrink: 0;
}

.query-input {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  min-height: 96px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
  font-family: inherit;
  letter-spacing: -0.009em;
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.query-input:focus {
  border-color: var(--rust);
  background: var(--card-bg);
  box-shadow: var(--focus-glow);
}

.query-input::placeholder {
  color: var(--slate);
}

.query-actions {
  margin-top: 10px;
}

.query-examples {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.example-label {
  color: var(--text-muted);
  font-size: 12px;
}

.example-chip {
  max-width: 100%;
  padding: 4px 14px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  /* 预置示例是一整句长条件，单行省略 + title 悬浮看全文，避免把输入卡撑成一堵墙 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.example-chip:hover {
  border-color: var(--rust);
  color: var(--rust);
  background: var(--apricot-wash);
}

.example-chip:active {
  transform: scale(0.98);
  background: var(--apricot-wash);
}

/* ── 最近查询历史 ── */
.history-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.history-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
}

.history-chip-btn {
  max-width: 320px;
  padding: 4px 6px 4px 14px;
  border-radius: var(--radius-full) 0 0 var(--radius-full);
  border: 1px solid var(--border);
  border-right: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all var(--transition-fast);
}
.history-chip-btn:hover {
  border-color: var(--rust);
  color: var(--rust);
  background: var(--apricot-wash);
}
.history-chip-btn:active {
  transform: scale(0.98);
}

.history-chip-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 24px;
  padding: 0;
  border-radius: 0 var(--radius-full) var(--radius-full) 0;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.history-chip-del:hover {
  border-color: rgba(220, 38, 38, 0.4);
  color: var(--danger-ink);
  background: rgba(220, 38, 38, 0.06);
}

.history-clear {
  padding: 4px 12px;
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.history-clear:hover {
  color: var(--danger-ink);
  background: rgba(220, 38, 38, 0.06);
}

/* ===== 错误横幅（复用 modal.css 视觉） ===== */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(220, 38, 38, 0.06);
  border: 1px solid rgba(220, 38, 38, 0.18);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.error-icon {
  font-size: 13px;
}

.error-text {
  font-size: 13px;
  color: var(--danger-ink);
  line-height: 1.4;
}

/* ===== 结果卡 ===== */
.result-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px 16px 12px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.result-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 12px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
}

/* 左侧信息组：条数 / 页码 / 接口限制提示 */
.result-info {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.result-count b {
  color: var(--text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.meta-sep {
  color: var(--border);
}

.result-page {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.result-hint {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--apricot-wash);
  color: var(--rust);
  font-size: 11.5px;
}

/* ===== 结果区批量操作（AI 分析 / 本页加入 / 覆盖） ===== */
.result-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 三个按钮统一尺寸与形态，只靠颜色区分轻重 */
.meta-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.meta-btn:hover:not(:disabled) {
  border-color: var(--rust);
  color: var(--rust);
  background: var(--apricot-wash);
}
.meta-btn:active:not(:disabled) {
  transform: scale(0.98);
}
.meta-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.meta-btn svg {
  flex-shrink: 0;
}

/* 主操作：AI 分析这批股票 */
.ai-analyze-btn {
  border-color: var(--rust);
  background: var(--apricot-wash);
  color: var(--rust);
  font-weight: 600;
}
.ai-analyze-btn:hover:not(:disabled) {
  background: var(--rust);
  color: #fff;
}
.ai-analyze-btn.sent {
  border-color: rgba(39, 174, 96, 0.35);
  background: rgba(39, 174, 96, 0.06);
  color: var(--green);
}

/* 危险操作：覆盖会先清空原有自选池，默认红描边，确认态实心 */
.paper-replace-btn {
  border-color: rgba(220, 38, 38, 0.32);
  color: var(--danger-ink);
}
.paper-replace-btn:hover:not(:disabled) {
  border-color: var(--danger-ink);
  background: rgba(220, 38, 38, 0.06);
  color: var(--danger-ink);
}
.paper-replace-btn.confirming,
.paper-replace-btn.confirming:hover:not(:disabled) {
  border-color: var(--danger-ink);
  background: var(--danger-ink);
  color: #fff;
  font-weight: 600;
}

/* 加池/覆盖结果提示：独占一行，不挤按钮 */
.paper-hint-line {
  margin: -4px 0 10px;
  padding: 7px 12px;
  border-radius: var(--radius-xs);
  background: var(--apricot-wash);
  color: var(--rust);
  font-size: 12px;
  line-height: 1.5;
  flex-shrink: 0;
}

.result-table-wrap {
  flex: 1;
  overflow: auto;
  min-height: 0;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.result-table {
  /* 内容不足时撑满容器，内容超宽时自然扩展（外层 wrap 横向滚动） */
  width: max-content;
  min-width: 100%;
  /* collapse 与 sticky 不兼容（滚动时边框错位），改用 separate */
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12.5px;
}

.result-table th {
  position: sticky;
  top: 0;
  /* 高于 td-sticky(z1)：垂直滚动时表头不被数据行覆盖 */
  z-index: 2;
  background: var(--fog);
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.01em;
  text-align: left;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.result-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-light);
  white-space: nowrap;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* 数值列右对齐：小数点位对齐后更容易上下比较（列类型由服务端 DOUBLE 判定） */
.result-table th.col-num,
.result-table td.col-num {
  text-align: right;
}

/* 首列（股票名/代码）横向滚动时吸附在左侧：列很多时滚到右边不会丢掉「这是哪只股」 */
.result-table thead th:first-child {
  left: 0;
  z-index: 4;
  box-shadow: 1px 0 0 var(--border-light);
}

.result-table tbody .result-row > td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--card-bg);
  box-shadow: 1px 0 0 var(--border-light);
}

.result-table tbody .result-row:hover > td:first-child {
  background: rgba(93, 42, 26, 0.05);
}

.result-table tbody .result-row:active > td:first-child {
  background: rgba(93, 42, 26, 0.08);
}

/* 空结果行（查询有返回但一行都没选中） */
.result-table td.table-empty {
  padding: 36px 12px;
  text-align: center;
  white-space: normal;
  color: var(--text-muted);
  font-size: 12.5px;
}

.result-table tbody tr:last-child td {
  border-bottom: none;
}

.result-row {
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.result-row:hover {
  background: rgba(93, 42, 26, 0.05);
}

.result-row:active {
  background: rgba(93, 42, 26, 0.08);
}

/* ===== 固定操作列（加入自选） ===== */
/* 层级：th(2) < th-sticky(3)（表头最高，水平+垂直滚动都不被盖）；td-sticky(1) 仅水平滚动粘右 */
.th-sticky {
  position: sticky;
  right: 0;
  z-index: 3;
  background: var(--fog);
  box-shadow: -1px 0 0 var(--border-light);
}

.td-sticky {
  position: sticky;
  right: 0;
  z-index: 1;
  background: var(--card-bg);
  box-shadow: -1px 0 0 var(--border-light);
}

.result-row:hover .td-sticky {
  background: rgba(93, 42, 26, 0.05);
}

.result-row:active .td-sticky {
  background: rgba(93, 42, 26, 0.08);
}

.star-btn {
  padding: 3px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.star-btn:hover {
  border-color: var(--rust);
  color: var(--rust);
  background: var(--apricot-wash);
}

.star-btn:active {
  transform: scale(0.96);
}

.star-btn.added {
  border-color: rgba(39, 174, 96, 0.35);
  color: var(--green);
  background: rgba(39, 174, 96, 0.06);
  cursor: default;
}

/* 行内「模拟盘」按钮：与「★ 自选」并排，间距 6px */
.paper-btn {
  margin-left: 6px;
}
.paper-btn:disabled {
  cursor: default;
}

/* ===== 分页 ===== */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding-top: 12px;
  flex-shrink: 0;
}

.page-btn {
  padding: 5px 16px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.page-btn:hover:not(:disabled) {
  border-color: var(--rust);
  color: var(--rust);
  background: var(--apricot-wash);
}

.page-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.page-info {
  color: var(--text-muted);
  font-size: 12px;
}

/* ===== 空状态 ===== */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 240px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.empty-icon {
  font-size: 30px;
  margin-bottom: 6px;
  opacity: 0.85;
}

.empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-sub {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
