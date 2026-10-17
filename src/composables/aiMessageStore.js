/**
 * aiMessageStore.js — AI 对话消息持久化存储
 * 按股票代码隔离存储，仅自选股才持久化。
 *
 * 安全提示（P2，已知风险）：对话内容以明文 JSON 存在 localStorage，未加密；
 * API Key 同样明文存储（见 useAiAnalysis.js 的 API_KEY_KEY），
 * 本机同用户下的其它页面/进程可读取，暂无更好的本地密钥保护方案。
 */
const MESSAGES_STORAGE_KEY = "stock-analysis-ai-messages";
/** 单会话消息条数与单条字符上限：localStorage 约 5MB，不设限会被长对话写爆 quota */
const MAX_MESSAGES_PER_SESSION = 200;
const MAX_MESSAGE_CHARS = 20000;

/** 裁剪到存储上限：保留最近 N 条，单条超长内容截断并显式标注 */
function capMessages(list) {
  return (Array.isArray(list) ? list : []).slice(-MAX_MESSAGES_PER_SESSION).map((m) => {
    if (typeof m?.content !== "string" || m.content.length <= MAX_MESSAGE_CHARS) return m;
    return { ...m, content: m.content.slice(0, MAX_MESSAGE_CHARS) + "\n…（超出本地存储上限，已截断）" };
  });
}

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
  map[code] = capMessages(messages);
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
