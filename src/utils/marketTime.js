/**
 * 市场时间工具 — 交易日历/时段判断（自选通知、均线提醒、价格提醒共用）
 */

/** 今日日期字符串 YYYY-MM-DD（本地时区，避免 UTC 导致跨日重复通知） */
export function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 判断当前是否在交易时段内
 * A 股：周一至周五 9:30-11:30, 13:00-15:00
 * 港股：周一至周五 9:30-12:00, 13:00-16:00（收市竞价 16:00-16:10 不单独处理）
 * @param {string} [code] 股票代码（5 位数字 = 港股），不传按 A 股
 * @returns {boolean}
 */
export function isTradingHours(code) {
  const now = new Date();
  const day = now.getDay(); // 0=周日, 6=周六
  if (day === 0 || day === 6) return false;

  const t = now.getHours() * 60 + now.getMinutes();
  if (/^\d{5}$/.test(code || "")) {
    // 港股：9:30-12:00 或 13:00-16:00
    return (t >= 570 && t <= 720) || (t >= 780 && t <= 960);
  }
  // A 股：9:30-11:30 或 13:00-15:00
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

/** 距今 N 天前的日期字符串 YYYY-MM-DD（用于裁剪历史记录） */
export function daysAgoISO(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/**
 * 裁剪过期历史记录，仅保留最近 N 天，返回新对象（不修改入参）。
 * 结构约定：{ "YYYY-MM-DD": {...} }，key 为日期字符串，按字典序比较裁剪。
 */
export function pruneHistory(history, days = 7) {
  const cutoff = daysAgoISO(days);
  const cleaned = {};
  for (const [date, val] of Object.entries(history || {})) {
    if (date >= cutoff) cleaned[date] = val;
  }
  return cleaned;
}
