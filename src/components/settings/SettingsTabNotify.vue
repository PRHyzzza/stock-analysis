<script setup>
import { useSettings } from "../../composables/useSettings.js";

const { state } = useSettings();
</script>

<template>
  <div class="tab-content">
    <label class="setting-row">
      <span class="setting-label">启用通知</span>
      <input type="checkbox" v-model="state.notifyEnabled" class="toggle" />
    </label>
    <div class="setting-group" :class="{ disabled: !state.notifyEnabled }">
      <p class="setting-group-title">上涨触发</p>
      <label class="setting-row sub"><span>涨超 5%</span><input type="checkbox" v-model="state.notifyUp5" class="toggle" :disabled="!state.notifyEnabled" /></label>
      <label class="setting-row sub"><span>涨超 7%</span><input type="checkbox" v-model="state.notifyUp7" class="toggle" :disabled="!state.notifyEnabled" /></label>
      <label class="setting-row sub"><span>涨停</span><input type="checkbox" v-model="state.notifyLimitUp" class="toggle" :disabled="!state.notifyEnabled" /></label>
    </div>
    <div class="setting-group" :class="{ disabled: !state.notifyEnabled }">
      <p class="setting-group-title">下跌触发</p>
      <label class="setting-row sub"><span>跌超 5%</span><input type="checkbox" v-model="state.notifyDown5" class="toggle" :disabled="!state.notifyEnabled" /></label>
      <label class="setting-row sub"><span>跌超 7%</span><input type="checkbox" v-model="state.notifyDown7" class="toggle" :disabled="!state.notifyEnabled" /></label>
      <label class="setting-row sub"><span>跌停</span><input type="checkbox" v-model="state.notifyLimitDown" class="toggle" :disabled="!state.notifyEnabled" /></label>
    </div>
    <div class="setting-group" :class="{ disabled: !state.notifyEnabled }">
      <p class="setting-group-title">动态触发</p>
      <label class="setting-row sub"><span>快速拉升</span><input type="checkbox" v-model="state.notifyFastRise" class="toggle" :disabled="!state.notifyEnabled" /></label>
      <label class="setting-row sub"><span>快速下跌</span><input type="checkbox" v-model="state.notifyFastFall" class="toggle" :disabled="!state.notifyEnabled" /></label>
      <label class="setting-row sub">
        <span>快速变动阈值</span>
        <div class="slider-wrap">
          <input type="range" min="1" max="5" step="0.5" v-model.number="state.notifyFastThreshold" class="slider" :disabled="!state.notifyEnabled" />
          <span class="slider-val">{{ state.notifyFastThreshold }}%</span>
        </div>
      </label>
    </div>
  </div>
</template>
