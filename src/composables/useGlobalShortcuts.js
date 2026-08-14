/**
 * 全局快捷键 — Ctrl+K 搜索 / Ctrl+N 全局 AI
 * 子窗口（mini/iwencai）不注册；快捷键被占用或平台不支持时静默降级
 */
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";

const SHORTCUTS = [
  { accelerator: "CommandOrControl+K", handler: "onSearch" },
  { accelerator: "CommandOrControl+N", handler: "onGlobalAi" },
];

/** 子窗口不注册全局快捷键（避免与主窗口重复触发） */
function isChildWindow() {
  const params = new URLSearchParams(window.location.search);
  return ["mini", "iwencai"].some((k) => params.has(k));
}

/**
 * @param {{ onSearch?: () => void, onGlobalAi?: () => void }} handlers 快捷键回调
 */
export function useGlobalShortcuts(handlers = {}) {
  async function setupShortcuts() {
    if (isChildWindow()) return;
    try {
      for (const s of SHORTCUTS) {
        await register(s.accelerator, () => handlers[s.handler]?.());
      }
    } catch {
      /* 快捷键被占用或平台不支持时静默降级 */
    }
  }

  async function teardownShortcuts() {
    try {
      for (const s of SHORTCUTS) {
        await unregister(s.accelerator);
      }
    } catch {
      /* ignore */
    }
  }

  return { setupShortcuts, teardownShortcuts };
}
