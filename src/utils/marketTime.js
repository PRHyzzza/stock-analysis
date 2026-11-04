/**
 * 市场时间工具 — 交易日历/时段判断（自选通知、均线提醒、价格提醒、状态胶囊共用）
 */
import { isHKHoliday, getHKHolidayName } from "./hkHolidays.js";
import { isBJCode, isHKCode } from "./market.js";

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
function isAShareTradingDay(dateStr) {
  if (!aShareTradingDays) return null;
  if (dateStr > aShareCalendarThrough) return null;
  return aShareTradingDays.has(dateStr);
}

/** 各市场交易时段（分钟数，含两端边界）：[上午开, 上午收] / [下午开, 下午收] */
const SESSIONS = {
  A: { morning: [570, 690], afternoon: [780, 900] }, // 09:30-11:30 / 13:00-15:00
  HK: { morning: [570, 720], afternoon: [780, 960] }, // 09:30-12:00 / 13:00-16:00
};

/**
 * 盘后固定价格交易（2026-07-06 沪深交易新规）
 *
 * - 成交窗口 **15:05-15:30**（用户说的「15-15:30」，前 5 分钟交易所处理收盘数据，不撮合）
 * - 成交价**恒为当日收盘价**，不接受自主定价、不设滑点（买入申报价不得低于收盘价、
 *   卖出申报价不得高于收盘价，否则为无效申报）
 * - 按时间优先逐笔撮合，委托不可撤销，未成交部分 15:30 自动作废
 * - 适用范围由「科创板 / 创业板」扩至**沪深全部 A 股 + 沪深 ETF**；ETF 不在本项目模拟盘范围内
 * - 北交所虽在 2026 版交易规则中推出该机制，但具体实施时间「另行通知」（8/31 落地的只是
 *   风险警示股相关条款），故本项目暂不开放；港股无此机制
 *
 * 注意：这是**独立的成交时段**，不属于连续竞价。因此不改 `getMarketStatus().state`
 * （15:05 之后仍是 `post`），也不改 `isTradingHours()`（盘外零请求的轮询口径不受影响）。
 */
export const AFTER_HOURS = Object.freeze({
  startMinute: 15 * 60 + 5, // 905 = 15:05
  endMinute: 15 * 60 + 30, // 930 = 15:30
  startAt: "15:05",
  endAt: "15:30",
  /** 状态刷新需要加密的窗口（收盘 → 盘后结束后 5 分钟），供 UI 排定时器用 */
  refreshFromMinute: 15 * 60,
  refreshToMinute: 15 * 60 + 35,
});

/**
 * 日期 → YYYY-MM-DD（本地时区）
 * 统一走本地时区：toISOString() 走 UTC，在东八区会导致 08:00 之前算出的日期比实际早一天。
 */
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 今日日期字符串 YYYY-MM-DD（本地时区，避免 UTC 导致跨日重复通知） */
export function getToday() {
  return toDateStr(new Date());
}

/** 分钟数 → "HH:mm" */
function formatMinute(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * 市场状态（交易时段判断 + 「今日市场状态」胶囊共用，单一真源）
 * 交易日判定：
 *   A 股 — 优先用已注入的交易日历（识别法定节假日/调休）；日历未加载或超出覆盖范围时
 *          退回「周一至周五」（dayUnknown = true）
 *   港股 — 静态公众假期表（utils/hkHolidays.js）；未收录年份退回「周一至周五」（dayUnknown = true）
 *   周末一律休市（不查表）
 * 注：港股收市竞价时段不单独处理，仍算作「已收盘」。
 *
 * @param {string} [code] 股票代码（5 位数字 = 港股），不传按 A 股
 * @param {Date} [at] 基准时刻，默认当前（便于测试/回放）
 * @returns {{ market: "A"|"HK", dateStr: string, isTradingDay: boolean, dayUnknown: boolean,
 *             holidayName: string, state: "pre"|"open"|"break"|"post"|"holiday",
 *             minutesToClose: number|null, openAt: string, morningEndAt: string,
 *             resumeAt: string, closeAt: string, afterHours: boolean,
 *             afterHoursStartAt: string, afterHoursEndAt: string }}
 */
export function getMarketStatus(code, at = new Date()) {
  const market = /^\d{5}$/.test(code || "") ? "HK" : "A";
  const [morningOpen, morningClose] = SESSIONS[market].morning;
  const [afternoonOpen, afternoonClose] = SESSIONS[market].afternoon;

  const dateStr = toDateStr(at);
  const day = at.getDay(); // 0=周日, 6=周六
  const t = at.getHours() * 60 + at.getMinutes();

  let isTradingDay;
  let dayUnknown = false;
  let holidayName = "";

  if (day === 0 || day === 6) {
    isTradingDay = false;
    holidayName = "周末";
  } else if (market === "HK") {
    const holiday = isHKHoliday(dateStr); // null = 该年份未收录
    if (holiday === null) {
      isTradingDay = true;
      dayUnknown = true;
    } else {
      isTradingDay = !holiday;
      if (holiday) holidayName = getHKHolidayName(dateStr) || "公众假期";
    }
  } else {
    const calendarDay = isAShareTradingDay(dateStr); // null = 日历未加载/超出覆盖
    if (calendarDay === null) {
      isTradingDay = true;
      dayUnknown = true;
    } else {
      isTradingDay = calendarDay;
      if (!calendarDay) holidayName = "非交易日";
    }
  }

  let state;
  if (!isTradingDay) state = "holiday";
  else if (t < morningOpen) state = "pre";
  else if (t <= morningClose) state = "open";
  else if (t < afternoonOpen) state = "break";
  else if (t <= afternoonClose) state = "open";
  else state = "post";

  // 盘后固定价格交易窗口（A 股交易日 15:05-15:30）。只作为附加字段暴露，
  // 不改 state：状态胶囊/降频逻辑仍按「已收盘」处理，模拟盘单独消费此字段。
  const afterHours =
    market === "A" &&
    isTradingDay &&
    t >= AFTER_HOURS.startMinute &&
    t <= AFTER_HOURS.endMinute;

  return {
    market,
    dateStr,
    isTradingDay,
    dayUnknown,
    holidayName,
    state,
    // 午休同样显示距收盘倒计时（午休结束即进入下午盘）
    minutesToClose: state === "open" || state === "break" ? afternoonClose - t : null,
    openAt: formatMinute(morningOpen),
    morningEndAt: formatMinute(morningClose),
    resumeAt: formatMinute(afternoonOpen),
    closeAt: formatMinute(afternoonClose),
    afterHours,
    afterHoursStartAt: AFTER_HOURS.startAt,
    afterHoursEndAt: AFTER_HOURS.endAt,
  };
}

/**
 * 判断当前是否在交易时段内（含午休，与「盘外零请求」的轮询口径一致）
 * @param {string} [code] 股票代码（5 位数字 = 港股），不传按 A 股
 * @param {Date} [at] 基准时刻，默认当前
 * @returns {boolean}
 */
export function isTradingHours(code, at = new Date()) {
  const { state } = getMarketStatus(code, at);
  return state === "open" || state === "break";
}

/**
 * 该标的是否适用盘后固定价格交易
 *
 * 沪深全部 A 股（6 位裸码、非北交所）适用；港股与北交所不适用。
 * 未指定代码时返回 true（按沪深 A 股默认），调用方仍须在下单时用真实代码复核。
 *
 * @param {string} [code] 股票代码（模拟盘只收 6 位裸码）
 * @returns {boolean}
 */
export function supportsAfterHours(code) {
  const c = String(code ?? "").trim();
  if (!c) return true;
  if (isHKCode(c) || isBJCode(c)) return false;
  return /^\d{6}$/.test(c);
}

/**
 * 当前是否处于「可下单的盘后固定价格交易」窗口（模拟盘唯一判据）
 *
 * 与 `getMarketStatus` 的 `afterHours` 字段区别：这里还叠加**标的适用范围**与
 * 明确的原因文案，`state` 保持 `post` 不变。调用方（usePaperAccount）只认这里的结果，
 * 禁止在组件里手写 15:05 / 15:30。
 *
 * @param {string} [code] 股票代码
 * @param {Date} [at] 基准时刻，默认当前（便于测试/回放）
 * @returns {{ available: boolean, reason: string, session: "afterHours"|"closed",
 *             startAt: string, endAt: string, minutesLeft: number|null,
 *             nearWindow: boolean, dateStr: string }}
 */
export function getAfterHoursStatus(code, at = new Date()) {
  const s = getMarketStatus(code, at);
  const t = at.getHours() * 60 + at.getMinutes();
  const base = {
    available: false,
    reason: "",
    session: "closed",
    startAt: AFTER_HOURS.startAt,
    endAt: AFTER_HOURS.endAt,
    minutesLeft: null,
    nearWindow: t >= AFTER_HOURS.refreshFromMinute && t <= AFTER_HOURS.refreshToMinute,
    dateStr: s.dateStr,
  };

  if (s.market === "HK" || isHKCode(code)) {
    return { ...base, reason: "港股没有盘后固定价格交易" };
  }
  if (!s.isTradingDay) {
    return { ...base, reason: `今日非交易日${s.holidayName ? `（${s.holidayName}）` : ""}` };
  }
  if (!supportsAfterHours(code)) {
    if (isBJCode(String(code ?? "").trim())) {
      return { ...base, reason: "北交所盘后固定价格交易尚未实施（具体时间待交易所通知）" };
    }
    return { ...base, reason: "该标的不适用盘后固定价格交易" };
  }
  if (t < AFTER_HOURS.startMinute) {
    return { ...base, reason: `盘后固定价交易 ${AFTER_HOURS.startAt} 开始` };
  }
  if (t > AFTER_HOURS.endMinute) {
    return { ...base, reason: `盘后固定价交易已于 ${AFTER_HOURS.endAt} 结束` };
  }
  return {
    ...base,
    available: true,
    session: "afterHours",
    minutesLeft: AFTER_HOURS.endMinute - t,
  };
}

/**
 * 距今 N 天前的日期字符串 YYYY-MM-DD（用于裁剪历史记录）
 * 必须与 getToday() 一致使用本地时区：toISOString() 走 UTC，
 * 在东八区会导致 08:00 之前算出的日期比 getToday() 早一天，历史记录被提前裁掉。
 */
function daysAgoISO(days) {
  return toDateStr(new Date(Date.now() - days * 86400000));
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
