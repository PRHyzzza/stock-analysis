import { ref } from "vue";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

const STORAGE_KEY = "stock-analysis-notif-history";

/** 获取今日日期字符串 YYYY-MM-DD */
function getToday() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 判断当前是否在 A 股交易时段内
 * 交易日：周一至周五 9:30-11:30, 13:00-15:00
 * @returns {boolean}
 */
function isTradingHours() {
  const now = new Date();
  const day = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
  if (day === 0 || day === 6) return false;

  const h = now.getHours();
  const m = now.getMinutes();
  const t = h * 60 + m; // 当天分钟数

  // 上午 9:30-11:30 或 下午 13:00-15:00
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

/** 从 localStorage 加载通知历史 */
function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    // 只保留最近 7 天的记录，清理过期数据
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const cleaned = {};
    for (const [date, stocks] of Object.entries(data)) {
      if (date >= cutoffStr) cleaned[date] = stocks;
    }
    return cleaned;
  } catch {
    return {};
  }
}

/** 保存通知历史到 localStorage */
function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * 判断股票所属板块类型
 * @param {string} code - 股票代码
 * @returns {'main'|'cyb'|'kcb'}
 */
function getStockBoard(code) {
  if (code.startsWith("30")) return "cyb"; // 创业板 ±20%
  if (code.startsWith("68")) return "kcb"; // 科创板 ±20%
  return "main"; // 主板/中小板 ±10%
}

/**
 * 获取涨停/跌停阈值
 * @param {string} code
 * @returns {number}
 */
function getLimitThreshold(code) {
  const board = getStockBoard(code);
  return board === "main" ? 9.5 : 19.5;
}

/** 触发类型 → 通知文案 */
const TRIGGER_LABELS = {
  limit_up: "🚀 涨停",
  limit_down: "📉 跌停",
  "+7%": "📈 涨超 7%",
  "+5%": "📈 涨超 5%",
  "-7%": "📉 跌超 7%",
  "-5%": "📉 跌超 5%",
  fast_rise: "⚡ 快速拉升",
  fast_fall: "💥 快速下跌",
};

/**
 * 自选列表通知系统
 *
 * 功能：
 * - 涨停/跌停、±7%、±5% 阈值触发通知
 * - 快速拉升/快速下跌（30s 内价格变动 ≥2%）触发通知
 * - 每个触发类型每天每只股票只通知一次
 * - 使用 Windows 原生通知 (tauri-plugin-notification)
 */
export function useWatchlistNotifications() {
  // 上一轮价格记录，用于检测快速拉升/下跌
  const prevPrices = ref({});

  // 通知历史 { "2026-07-22": { "000001": ["limit_up", "+5%"] } }
  const history = ref(loadHistory());

  // 确保今日记录存在
  if (!history.value[getToday()]) {
    history.value = { ...history.value, [getToday()]: {} };
  }

  // defaults for when settings aren't provided yet
  const defaultSettings = {
    notifyEnabled: true,
    notifyUp5: true, notifyUp7: true, notifyLimitUp: true,
    notifyDown5: true, notifyDown7: true, notifyLimitDown: true,
    notifyFastRise: true, notifyFastFall: true,
    notifyFastThreshold: 2,
  };

  /** 指定股票+触发类型今天是否已通知过 */
  function hasTriggeredToday(code, type) {
    return history.value[getToday()]?.[code]?.includes(type) ?? false;
  }

  /** 标记为已触发 */
  function markTriggeredToday(code, type) {
    const t = getToday();
    const todayData = history.value[t] || {};
    const triggers = todayData[code] || [];
    if (!triggers.includes(type)) {
      history.value = {
        ...history.value,
        [t]: { ...todayData, [code]: [...triggers, type] },
      };
      saveHistory(history.value);
    }
  }

  /** 确保通知权限已授予 */
  async function ensurePermission() {
    let permitted = await isPermissionGranted();
    if (!permitted) {
      const result = await requestPermission();
      permitted = result === "granted";
    }
    return permitted;
  }

  /**
   * 检查单只股票的行情数据，按阈值触发通知。
   * 应在每次行情刷新后调用（当前每 30s 刷新一次）。
   *
   * @param {Object} quote - StockQuote 数据 { code, name, price, changePct, prevClose }
   * @param {Object} s - 设置对象 (useSettings().state)
   */
  async function checkAndNotify(quote, s) {
    if (!quote || !quote.code) return;

    // 非交易时段不通知
    if (!isTradingHours()) return;

    const settings = s || defaultSettings;
    if (!settings.notifyEnabled) return;

    const { code, name, price, changePct, prevClose } = quote;
    const limit = getLimitThreshold(code);
    const triggeredTypes = [];

    // ── 静态阈值检测 ──
    if (settings.notifyLimitUp && changePct >= limit) {
      triggeredTypes.push("limit_up");
    } else if (settings.notifyUp7 && changePct >= 7) {
      triggeredTypes.push("+7%");
    } else if (settings.notifyUp5 && changePct >= 5) {
      triggeredTypes.push("+5%");
    }

    if (settings.notifyLimitDown && changePct <= -limit) {
      triggeredTypes.push("limit_down");
    } else if (settings.notifyDown7 && changePct <= -7) {
      triggeredTypes.push("-7%");
    } else if (settings.notifyDown5 && changePct <= -5) {
      triggeredTypes.push("-5%");
    }

    // ── 快速拉升 / 快速下跌检测 ──
    const prevPrice = prevPrices.value[code];
    if (prevPrice && prevPrice > 0 && prevClose > 0) {
      const threshold = settings.notifyFastThreshold ?? 2;
      const rapidPct = ((price - prevPrice) / prevClose) * 100;
      if (settings.notifyFastRise && rapidPct >= threshold) {
        triggeredTypes.push("fast_rise");
      } else if (settings.notifyFastFall && rapidPct <= -threshold) {
        triggeredTypes.push("fast_fall");
      }
    }
    // 更新价格快照
    prevPrices.value = { ...prevPrices.value, [code]: price };

    // ── 过滤已触发项 ──
    const newTriggers = triggeredTypes.filter(
      (t) => !hasTriggeredToday(code, t)
    );
    if (newTriggers.length === 0) return;

    // ── 确保权限 ──
    const permitted = await ensurePermission();
    if (!permitted) return;

    // ── 发送通知（await 每条，防止 Windows Toast 排队延迟）──
    // 任务栏闪烁黄色（UserAttentionType.Critical），直到用户聚焦窗口
    await appWindow.requestUserAttention(UserAttentionType.Critical);

    for (const trigger of newTriggers) {
      const label = TRIGGER_LABELS[trigger] || trigger;
      const sign = changePct > 0 ? "+" : "";

      await sendNotification({
        title: `${label}: ${name} (${code})`,
        body: `当前价 ${price.toFixed(2)}  涨跌幅 ${sign}${changePct.toFixed(2)}%`,
      });

      markTriggeredToday(code, trigger);

      // 多条通知之间间隔 300ms，避免 Windows 通知系统节流合并
      if (newTriggers.length > 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  return { checkAndNotify, prevPrices };
}
