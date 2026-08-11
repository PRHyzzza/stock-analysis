<script setup>
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useAiAnalysis } from "../composables/useAiAnalysis";
import AiApiKeySetup from "./ai/AiApiKeySetup.vue";
import AiChatMessages from "./ai/AiChatMessages.vue";
import AiChatFooter from "./ai/AiChatFooter.vue";
import AiModelControls from "./ai/AiModelControls.vue";

const props = defineProps({
  show: { type: Boolean, default: false },
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
  sendGlobalMessage,
  clearHistory,
  switchGlobal,
} = useAiAnalysis(true);

// 弹窗打开时加载全局对话
watch(() => props.show, (val) => {
  if (val) {
    switchGlobal();
  }
});

const inputText = ref("");
const showApiKeyInput = ref(!apiKey.value);
const apiKeyInput = ref(apiKey.value);

// 热榜选股：遍历热榜股票时的扫描状态
const hotScanning = ref(false);

/** 并发限制工具：以 limit 并发执行 fn，返回结果数组（失败项为 null） */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        results[i] = null;
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * 热榜选股：遍历热榜全部股票（批量行情 + 资金流向 + 日K线），
 * 数据注入 AI 上下文，让 AI 只总结哪些值得买入
 */
async function analyzeHotList() {
  if (hotScanning.value || loading.value) return;
  if (!apiKey.value) {
    showApiKeyInput.value = true;
    return;
  }
  hotScanning.value = true;
  error.value = "";
  try {
    // 1. 获取热榜（全部股票）
    const hot = await invoke("get_hot_list");
    const list = hot.stock_list || [];
    if (!list.length) {
      error.value = "热榜数据为空，请稍后重试";
      return;
    }
    const codes = list.map((s) => s.code);

    // 2. 批量实时行情（腾讯批量接口，一次请求）
    let quotes = [];
    try {
      quotes = (await invoke("get_stock_quotes_batch", { codes })) || [];
    } catch { /* 行情失败则跳过该维度 */ }
    const quoteMap = new Map(quotes.map((q) => [q.code, q]));

    // 3. 主力资金流向 + 日K线（并发 6，单只失败不影响整体）
    const flows = await mapLimit(codes, 6, (code) =>
      invoke("get_stock_money_flow", { code })
    );
    const flowMap = new Map(codes.map((c, i) => [c, flows[i]]));

    const klines = await mapLimit(codes, 6, (code) =>
      invoke("get_stock_kline", { code, period: "day" })
    );
    const klineMap = new Map(codes.map((c, i) => [c, klines[i]]));

    // 4. 组装热榜上下文（行情 + 资金流 + K线摘要）
    const hotStocks = list.map((item) => {
      const quote = quoteMap.get(item.code);
      const flow = flowMap.get(item.code);
      const kline = klineMap.get(item.code) || [];
      return {
        rank: item.order,
        code: item.code,
        name: item.name,
        hot: item.rate,
        changePct: item.rise_and_fall,
        rankChg: item.hot_rank_chg,
        tags: item.tags || [],
        price: quote?.price ?? null,
        turnoverRate: quote?.turnoverRate ?? null,
        turnover: quote?.turnover ?? null,
        amplitude: quote?.amplitude ?? null,
        mainNetInflow: flow?.mainNetInflow ?? null,
        mainNetPct: flow?.mainNetPct ?? null,
        superLargeNet: flow?.superLargeNet ?? null,
        largeNet: flow?.largeNet ?? null,
        // K 线摘要：最近 10 根日K + MA5/MA10/MA20（控制 token，AI 无需再调工具）
        kline: kline.length ? buildKlineSummary(kline) : null,
      };
    });

    // 5. 发送给 AI 分析（热榜数据已注入系统上下文）
    inputText.value = "";
    await sendGlobalMessage(
      `请遍历热榜全部 ${hotStocks.length} 只股票，找出其中值得买入的股票。\n` +
      `热榜排名、实时行情、主力资金流向、日K线（含均线）已随对话预加载（见系统数据），直接分析即可，无需重复调用工具。\n` +
      `要求：\n` +
      `1. 结合主力资金净流入、换手率、热度排名变化、涨跌幅、概念题材、K线趋势与均线位置综合判断\n` +
      `2. **只输出值得买入的股票**，按代码+名称列出，每只说明买入逻辑（资金面 / 人气面 / 题材面 / 技术面）\n` +
      `3. 没有值得买入的股票时，直接回复「当前热榜无符合买入条件的标的」即可\n` +
      `4. **不要输出观望、回避的股票**，只输出推荐买入的\n` +
      `5. 最后提示追高风险与仓位建议（仅供参考，不构成投资建议）`,
      null,
      { indices: props.indices, positions: props.positions, hotStocks },
      true // 跳过用户画像更新（系统自动生成的分析指令，不反映用户偏好）
    );
  } catch (e) {
    error.value = `热榜分析失败: ${e.message || e}`;
  } finally {
    hotScanning.value = false;
  }
}

/** 计算简单移动平均 */
function calcMA(values, period) {
  if (values.length < period) return null;
  const sum = values.slice(-period).reduce((s, v) => s + v, 0);
  return Math.round((sum / period) * 100) / 100;
}

/** 构建 K 线摘要：最近 10 根日K + MA5/MA10/MA20（紧凑格式，控制 token） */
function buildKlineSummary(kline) {
  const closes = kline.map((k) => k.close);
  const recent = kline.slice(-10).map((k) => ({
    date: k.date,
    close: k.close,
    high: k.high,
    low: k.low,
    vol: Math.round(k.volume || 0),
  }));
  return {
    recent,
    ma5: calcMA(closes, 5),
    ma10: calcMA(closes, 10),
    ma20: calcMA(closes, 20),
  };
}

// @代码 快捷引用的股票（发送时作为上下文注入，AI 直接分析无需现查行情）
const quickStock = ref(null);

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

/** 解析文本中的 @代码（支持 sh/sz/hk 前缀，如 @600519 / @sh600519 / @00700） */
function parseAtCode(text) {
  const m = text.match(/@\s*(?:sh|sz|hk)?\s*(\d{5,6})/i);
  return m ? m[1] : null;
}

/** 代码 → 市场推断（5 位=港股，6 开头=沪市，其余=深市） */
function inferMarket(code) {
  if (/^\d{5}$/.test(code)) return "HK";
  return code.startsWith("6") ? "SH" : "SZ";
}

async function handleSend() {
  const text = inputText.value.trim();
  if (!text || loading.value) return;

  // 解析 @代码 → 拉取实时行情作为快捷引用上下文
  const atCode = parseAtCode(text);
  if (atCode && quickStock.value?.code !== atCode) {
    try {
      const quote = await invoke("get_stock_quote", { code: atCode });
      if (quote) {
        quickStock.value = { market: inferMarket(atCode), ...quote };
      }
    } catch {
      // 获取失败则不带股票上下文，仍按全局回答
    }
  }

  inputText.value = "";

  try {
    // 注入大盘指数 + 用户持仓 + 快捷股票上下文
    await sendGlobalMessage(text, quickStock.value, {
      indices: props.indices,
      positions: props.positions,
    });
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

function removeQuickStock() {
  quickStock.value = null;
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
            <span class="ai-badge">助手</span>

            <span class="ctrl-divider"></span>

            <AiModelControls />
          </div>
          <div class="modal-header-actions">
            <button
              v-if="!showApiKeyInput"
              class="hot-scan-btn"
              :disabled="hotScanning || loading"
              @click="analyzeHotList"
              title="遍历热榜全部股票，AI 只推荐值得买入的标的"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" v-if="!hotScanning">
                <path d="M8 1C5 4.5 2.5 6.2 2.5 9.3A5.5 5.5 0 0 0 8 15a5.5 5.5 0 0 0 5.5-5.7C13.5 6.2 11 4.5 8 1Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                <path d="M8 15c0-2.8 1.8-4.6 3.6-6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
              <span v-if="hotScanning" class="hot-scan-spinner"></span>
              <span class="hot-scan-label">{{ hotScanning ? "分析中…" : "热榜选股" }}</span>
            </button>
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
            :selected-stock="null"
            :global-mode="true"
            @suggestion="doSuggestion"
          />
        </div>

        <!-- 底部输入 -->
        <AiChatFooter
          v-if="!showApiKeyInput"
          :input-text="inputText"
          :disabled="loading"
          :selected-stock="quickStock"
          :loading="loading"
          :global-mode="true"
          @send="handleSend"
          @update:input-text="inputText = $event"
          @remove-context="removeQuickStock"
        />
      </div>
    </div>
  </Teleport>
</template>

<style>
@import "../assets/modal.css";
</style>

<style scoped>

/* GlobalAiModal 特有样式：覆盖宽高（与 AiAnalysisModal 保持一致） */
.modal-container {
  width: 900px;
  height: 680px;
}

/* 热榜选股按钮 */
.hot-scan-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--rust);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  white-space: nowrap;
}

.hot-scan-btn:hover:not(:disabled) {
  border-color: var(--rust);
  background: var(--apricot-wash);
  color: var(--rust);
}

.hot-scan-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hot-scan-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--rust);
  border-top-color: transparent;
  border-radius: 50%;
  animation: hotSpin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes hotSpin {
  to { transform: rotate(360deg); }
}
</style>
