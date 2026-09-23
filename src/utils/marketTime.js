/**
 * 市场时间工具 — 交易日历/时段判断（自选通知、均线提醒、价格提醒共用）
 */

/**
 * A 股交易日历（由 composables/useTradingCalendar.js 拉取后注入）
 * - null 表示未加载
 * - Set 内元素为 "yyyy-MM-dd"
 * - 日历仅覆盖 A 股，且只对 aShareCalendarThrough（拉取当日）及之前有效
 *   （接口窗口为 [今日-1年, 今日]，超出右端即为未知）
 */
let aShareTradingDays = null;
let aShareCalendarThrough = "";

/** 注入 A 股交易日历（dates: "yyyy-MM-dd" 数组；through: 该日历的覆盖截止日） */
export function setAShareTradingDays(dates, through) {
  aShareTradingDays = new Set(dates || []);
  aShareCalendarThrough = through || "";
}

/**
 * 判断指定日期是否为 A 股交易日（仅本文件内使用）
 * @param {string} dateStr "yyyy-MM-dd"
 * @returns {boolean|null} null = 未知（日历未加载 / 超出日历覆盖范围）
 */
function isTradingDay(dateStr) {
  if (!aShareTradingDays) return null;
  if (dateStr > aShareCalendarThrough) return null;
  return aShareTradingDays.has(dateStr);
}

/** 今日日期字符串 YYYY-MM-DD（本地时区，避免 UTC 导致跨日重复通知） */
export function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 判断当前是否在交易时段内
 * A 股：9:30-11:30, 13:00-15:00；港股：9:30-12:00, 13:00-16:00（收市竞价不单独处理）
 * 交易日判定：A 股优先用已注入的交易日历（识别法定节假日/调休），
 *             日历未加载或超出覆盖范围时退回「周一至周五」；港股无日历，始终按周末判断
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
    // 注意：Fuyao 日历只有 A 股，港股休市日与之不同（如佛诞、圣诞），不可复用，仍按周末兜底
    return (t >= 570 && t <= 720) || (t >= 780 && t <= 960);
  }
  // A 股：9:30-11:30 或 13:00-15:00
  // 已加载日历时以日历为准（识别法定节假日/调休）；未加载或超出覆盖范围则退回周末判断
  if (isTradingDay(getToday()) === false) return false;
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

/** 距今 N 天前的日期字符串 YYYY-MM-DD（用于裁剪历史记录） */
function daysAgoISO(days) {
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
