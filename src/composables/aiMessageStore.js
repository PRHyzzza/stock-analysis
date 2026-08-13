/**
 * aiMessageStore.js — AI 对话消息持久化存储
 * 按股票代码隔离存储，仅自选股才持久化。
 */
const MESSAGES_STORAGE_KEY = "stock-analysis-ai-messages";

function loadAllMessages() {
  try { return JSON.parse(localStorage.getItem(MESSAGES_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveAllMessages(map) {
  try {
    localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(map));
  } catch { /* 隐私模式/quota 满时静默忽略，避免写入异常打断 watcher */ }
}

/** 删除指定股票的 AI 对话记录（供外部调用） */
export function deleteStockMessages(code) {
  const map = loadAllMessages();
  delete map[code];
  saveAllMessages(map);
}

export function loadStockMessages(code) {
  if (!code) return [];
  const stored = loadAllMessages()[code];
  // 存储可能被外部损坏为非数组（如字符串），校验类型防止调用方 push 崩溃
  return Array.isArray(stored) ? stored : [];
}

export function saveStockMessages(code, messages) {
  if (!code) return;
  const map = loadAllMessages();
  map[code] = messages;
  saveAllMessages(map);
}

/** 检查股票是否在自选股中 */
export function isStockInWatchlist(code) {
  try {
    const raw = localStorage.getItem("stock-analysis-watchlist");
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.some((s) => s.code === code);
  } catch {
    return false;
  }
}
