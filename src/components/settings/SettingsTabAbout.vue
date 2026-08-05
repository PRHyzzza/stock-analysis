<script setup>
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

const currentVersion = ref("--");
const checking = ref(false);
const updateInfo = ref(null);
const checkError = ref("");

onMounted(async () => {
  try {
    currentVersion.value = await invoke("get_app_version");
  } catch { /* 忽略：非 Tauri 环境 */ }
});

async function checkUpdate() {
  checking.value = true;
  checkError.value = "";
  updateInfo.value = null;
  try {
    updateInfo.value = await invoke("check_for_update");
  } catch (err) {
    checkError.value = String(err);
  } finally {
    checking.value = false;
  }
}

async function goDownload() {
  if (updateInfo.value?.url) await openUrl(updateInfo.value.url);
}
</script>

<template>
  <div class="tab-content">
    <div class="about-card">
      <div class="about-logo">📈</div>
      <p class="about-name">stock-analysis</p>
      <p class="about-version">当前版本 v{{ currentVersion }}</p>
      <p class="about-desc">A 股 / 港股行情监控 · 资金流向 · AI 分析</p>
    </div>

    <div class="setting-group">
      <p class="setting-group-title">检查更新</p>
      <div class="update-row">
        <button class="btn-check-update" :disabled="checking" @click="checkUpdate">
          {{ checking ? "检查中…" : "检查更新" }}
        </button>
      </div>

      <!-- 有更新 -->
      <div v-if="updateInfo?.has_update" class="update-result has-update">
        <p class="update-title">发现新版本 v{{ updateInfo.latest }} 🎉</p>
        <p class="update-sub">当前 v{{ updateInfo.current }} → 最新 v{{ updateInfo.latest }}</p>
        <button class="btn-download" @click="goDownload">前往下载</button>
      </div>

      <!-- 已是最新 -->
      <div v-else-if="updateInfo && !updateInfo.has_update" class="update-result up-to-date">
        <p class="update-title">已是最新版本 ✅</p>
        <p class="update-sub">当前 v{{ updateInfo.current }} 即为最新版本</p>
      </div>

      <!-- 检查失败 -->
      <div v-else-if="checkError" class="update-result check-failed">
        <p class="update-title">检查更新失败</p>
        <p class="update-sub">{{ checkError }}</p>
      </div>
    </div>

    <div class="setting-group">
      <p class="setting-group-title">链接</p>
      <div class="link-row">
        <a href="#" @click.prevent="openUrl('https://github.com/PRHyzzza/stock-analysis')">GitHub 仓库 ↗</a>
        <a href="#" @click.prevent="openUrl('https://github.com/PRHyzzza/stock-analysis/releases')">Releases ↗</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 20px 0 8px;
  text-align: center;
}
.about-logo {
  font-size: 40px;
  line-height: 1;
  margin-bottom: 4px;
}
.about-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}
.about-version {
  font-size: 12px;
  color: var(--text-muted);
}
.about-desc {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.8;
}

.update-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.btn-check-update {
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  background: var(--ink, #1d2129);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-check-update:hover { opacity: 0.85; }
.btn-check-update:disabled { opacity: 0.5; cursor: not-allowed; }

.update-result {
  margin-top: 8px;
  padding: 12px;
  border-radius: 10px;
  font-size: 12px;
}
.has-update {
  background: rgba(231, 76, 60, 0.08);
  border: 1px solid rgba(231, 76, 60, 0.25);
}
.up-to-date {
  background: rgba(39, 174, 96, 0.08);
  border: 1px solid rgba(39, 174, 96, 0.25);
}
.check-failed {
  background: rgba(241, 196, 15, 0.08);
  border: 1px solid rgba(241, 196, 15, 0.25);
}
.update-title {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.update-sub {
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}
.btn-download {
  margin-top: 8px;
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  background: var(--red, #e74c3c);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.btn-download:hover { opacity: 0.85; }

.link-row {
  display: flex;
  gap: 16px;
  font-size: 12px;
}
.link-row a {
  color: var(--red, #e74c3c);
  text-decoration: none;
}
.link-row a:hover { text-decoration: underline; }
</style>
