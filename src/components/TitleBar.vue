<script setup>
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();
function windowMinimize() { appWindow.minimize(); }
function windowToggleMax() { appWindow.toggleMaximize(); }
function windowClose() { appWindow.close(); }
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-drag" data-tauri-drag-region>
      <div class="titlebar-title">stock-analysis</div>
    </div>
    <div class="titlebar-controls">
      <button type="button" class="win-btn win-min" @click="windowMinimize" title="最小化">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="1" y="4.5" width="8" height="1" fill="currentColor"/>
        </svg>
      </button>
      <button type="button" class="win-btn win-max" @click="windowToggleMax" title="最大化">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="1.5" y="1.5" width="7" height="7" rx="0.5" stroke="currentColor" stroke-width="1" fill="none"/>
        </svg>
      </button>
      <button type="button" class="win-btn win-close" @click="windowClose" title="关闭">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: stretch;
  height: 32px;
  background: var(--card-bg);
  flex-shrink: 0;
  user-select: none;
}

.titlebar-drag {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  padding-left: 16px;
}

.titlebar-title {
  font-size: 12px;
  color: var(--text-muted);
  pointer-events: none;
}

.titlebar-controls {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
}

.win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  line-height: 0;
}
.win-btn:hover {
  background: var(--fog);
  color: var(--text-primary);
}
.win-close:hover {
  background: #e81123;
  color: #fff;
}
</style>
