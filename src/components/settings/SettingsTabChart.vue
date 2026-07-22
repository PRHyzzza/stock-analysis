<script setup>
import { useSettings } from "../../composables/useSettings.js";

const { state } = useSettings();
</script>

<template>
  <div class="tab-content">
    <div class="setting-group">
      <p class="setting-group-title">K 线均线周期</p>
      <div class="ma-chips">
        <label v-for="p in [5,10,20,30,60,120,250]" :key="p" class="ma-chip" :class="{ active: state.klineMaPeriods.includes(p) }">
          <input type="checkbox" :value="p" v-model="state.klineMaPeriods" class="hidden-check" />
          MA{{ p }}
        </label>
      </div>
    </div>
    <div class="setting-group">
      <p class="setting-group-title">其他</p>
      <label class="setting-row">
        <span>显示 30 日最高/最低价参考线</span>
        <input type="checkbox" v-model="state.klineShow30DayHL" class="toggle" />
      </label>
    </div>
  </div>
</template>
