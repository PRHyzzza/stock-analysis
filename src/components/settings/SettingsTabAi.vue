<script setup>
import { useSettings } from "../../composables/useSettings.js";

const { state } = useSettings();
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
  </div>
</template>
