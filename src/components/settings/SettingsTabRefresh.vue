<script setup>
import { useSettings } from "../../composables/useSettings.js";

const { state } = useSettings();

const intervalOptions = [
  { value: 10000, label: "10 秒" },
  { value: 30000, label: "30 秒" },
  { value: 60000, label: "1 分钟" },
  { value: 120000, label: "2 分钟" },
  { value: 300000, label: "5 分钟" },
  { value: 0, label: "关闭" },
];
</script>

<template>
  <div class="tab-content">
    <div class="setting-group">
      <p class="setting-group-title">自动刷新间隔</p>
      <label class="setting-row">
        <span>大盘指数</span>
        <select v-model.number="state.indicesRefreshMs" class="select">
          <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </label>
      <label class="setting-row">
        <span>自选行情</span>
        <select v-model.number="state.quotesRefreshMs" class="select">
          <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </label>
      <label class="setting-row">
        <span>K 线数据</span>
        <select v-model.number="state.klineRefreshMs" class="select">
          <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </label>
    </div>
  </div>
</template>
