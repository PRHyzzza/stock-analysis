<script setup>
import { computed, ref } from "vue";
import { useSettings } from "../../composables/useSettings.js";
import { useTradingCalendar } from "../../composables/useTradingCalendar.js";

const { state } = useSettings();

// ---- 数据源：同花顺交易日历 ----
const { apiKey, loaded, loading, error, setApiKey, refresh } = useTradingCalendar();
const keyInput = ref("");

const keyStatus = computed(() => {
  if (loading.value) return "正在拉取交易日历…";
  if (error.value) return error.value;
  if (loaded.value) {
    return apiKey.value
      ? "已生效：按交易日历判断节假日/调休"
      : "已清除 Key：本次运行仍用本地缓存日历";
  }
  return "未配置：按周一至周五判断（休市日会空转请求）";
});

async function saveKey() {
  setApiKey(keyInput.value);
  keyInput.value = ""; // 保存后不再回显明文
  await refresh();
}

function clearKey() {
  setApiKey("");
  keyInput.value = "";
}
</script>

<template>
  <div class="tab-content">
    <div class="setting-group">
      <p class="setting-group-title">模型</p>
      <label class="setting-row">
        <span>默认模型</span>
        <select v-model="state.aiModel" class="select">
          <option value="deepseek-v4-flash">DeepSeek V4 Flash (更快)</option>
          <option value="deepseek-v4-pro">DeepSeek V4 Pro (更准)</option>
        </select>
      </label>
    </div>
    <div class="setting-group">
      <p class="setting-group-title">推理</p>
      <label class="setting-row">
        <span>启用思考模式</span>
        <input type="checkbox" v-model="state.aiThinkingEnabled" class="toggle" />
      </label>
      <label class="setting-row">
        <span>推理深度</span>
        <select v-model="state.aiReasoningEffort" class="select">
          <option value="low">低 (快速)</option>
          <option value="high">高 (深入)</option>
          <option value="max">最大 (最深入)</option>
        </select>
      </label>
    </div>
    <div class="setting-group">
      <p class="setting-group-title">搜索</p>
      <label class="setting-row">
        <span>联网搜索</span>
        <span class="setting-hint">AI 可搜索最新财经新闻、公司公告等实时信息</span>
        <input type="checkbox" v-model="state.aiWebSearchEnabled" class="toggle" />
      </label>
    </div>
    <div class="setting-group">
      <p class="setting-group-title">数据源</p>
      <div class="setting-row">
        <span>
          同花顺交易日历
          <small class="setting-desc">识别法定节假日/调休，休市日不再空转请求；Key 仅本地保存</small>
        </span>
        <input
          v-model="keyInput"
          type="password"
          class="key-input"
          placeholder="粘贴 API Key"
          @keydown.enter="saveKey"
        />
      </div>
      <div class="setting-row">
        <span
          class="key-status"
          :class="{ 'is-ok': loaded && !error, 'is-error': !!error }"
          :title="keyStatus"
        >{{ keyStatus }}</span>
        <span class="key-btns">
          <button class="btn-key" :disabled="loading || !keyInput.trim()" @click="saveKey">保存并刷新</button>
          <button v-if="apiKey" class="btn-key" @click="clearKey">清除</button>
        </span>
      </div>
      <p class="setting-desc key-hint">Key 获取：fuyao.aicubes.cn/admin（同花顺账号登录后生成）</p>
    </div>
  </div>
</template>
