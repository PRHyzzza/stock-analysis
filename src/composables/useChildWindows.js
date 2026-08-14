/**
 * 子窗口管理 — 迷你盯盘小窗 / 问财选股窗口
 * 打开或聚焦已存在窗口（Tauri 单实例子窗口按 label 复用）
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export function useChildWindows() {
  /** 打开/聚焦迷你盯盘小窗 */
  async function openMiniWindow() {
    // getByLabel 是 async 方法，必须 await（否则拿到的是 Promise）
    const existing = await WebviewWindow.getByLabel("mini");
    if (existing) {
      existing.setFocus();
      return;
    }
    await new WebviewWindow("mini", {
      url: `${window.location.origin}${window.location.pathname}?mini=1`,
      title: "盯盘小窗",
      width: 280,
      height: 300,
      decorations: false,
      alwaysOnTop: true,
      resizable: true,
    });
  }

  /** 打开/聚焦问财选股窗口 */
  async function openIwencaiWindow() {
    const existing = await WebviewWindow.getByLabel("iwencai");
    if (existing) {
      existing.setFocus();
      return;
    }
    await new WebviewWindow("iwencai", {
      url: `${window.location.origin}${window.location.pathname}?iwencai=1`,
      title: "问财选股",
      width: 960,
      height: 720,
      minWidth: 640,
      minHeight: 480,
      resizable: true,
    });
  }

  return { openMiniWindow, openIwencaiWindow };
}
