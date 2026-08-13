import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

/**
 * 个股均线提醒系统
 *
 * 功能：
 * - 每只股票独立配置监控周期（5/10/20/30/60 日）与触发方向（上穿/下穿/双向）
 * - 股价穿越均线时发送 Windows 原生通知（仅交易时段）
 * - 每股票每周期每日只通知一次（按本地日期去重）
 * - 日 K 线 5 分钟内存缓存，避免 30s 行情刷新触发高频 K 线请求
 *
 * 配置存储：localStorage "stock-analysis-ma-alerts"
 *   { "300750": { periods: [5, 10], direction: "both" } }
 */

const STORAGE_KEY = "stock-analysis-ma-alerts";
const HISTORY_KEY = "stock-analysis-ma-notif-history";
const KLINE_CACHE_TTL = 5 * 60 * 1000; // 日 K 缓存 5 分钟

const appWindow = getCurrentWindow();

/** 可监控的均线周期 */
export const MA_PERIODS = [5, 10, 20, 30, 60];

/** 今日日期字符串 YYYY-MM-DD（本地时区，避免 UTC 导致跨日重复通知） */
function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 交易时段判断（与 useWatchlistNotifications 同规则；5 位代码 = 港股） */
function isTradingHours(code) {
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

/** 加载均线提醒配置 { code: { periods, direction } } */
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 加载通知历史 { date: { code: ["ma5_up"] } }，只保留最近 7 天 */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const cleaned = {};
    for (const [date, stocks] of Object.entries(data)) {
      if (date >= cutoff) cleaned[date] = stocks;
    }
    return cleaned;
  } catch {
    return {};
  }
}

// K 线缓存（模块级，跨实例共享）：{ code: { data, fetchedAt } }
const klineCache = new Map();

export function useMaAlerts() {
  /** 配置 { code: { periods: [5,10], direction: "both"|"cross_up"|"cross_down" } } */
  const configs = ref(loadConfig());
  /** 通知历史 */
  const history = ref(loadHistory());
  /** 上一轮价格快照（穿越检测基准，首轮仅记录） */
  const lastPrices = ref({});

  // 配置自动持久化
  watch(configs, (val) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    } catch { /* ignore */ }
  }, { deep: true });

  /** 获取某股票的提醒配置（未配置返回 null） */
  function getConfig(code) {
    return configs.value[code] || null;
  }

  /** 切换某股票某均线周期的启用状态；取消最后一个周期时自动删除配置 */
  function togglePeriod(code, period) {
    const cfg = configs.value[code] || { periods: [], direction: "both" };
    const has = cfg.periods.includes(period);
    const periods = has
      ? cfg.periods.filter((p) => p !== period)
      : [...cfg.periods, period].sort((a, b) => a - b);
    applyConfig(code, { ...cfg, periods });
  }

  /** 设置触发方向（上穿 / 下穿 / 双向） */
  function setDirection(code, direction) {
    const cfg = configs.value[code];
    if (!cfg) return;
    applyConfig(code, { ...cfg, direction });
  }

  /** 删除某股票的全部均线提醒 */
  function removeConfig(code) {
    const { [code]: _removed, ...rest } = configs.value;
    configs.value = rest;
  }

  /** 写入配置（无周期时视为删除） */
  function applyConfig(code, cfg) {
    if (!cfg.periods || cfg.periods.length === 0) {
      removeConfig(code);
    } else {
      configs.value = { ...configs.value, [code]: cfg };
    }
  }

  /** 获取日 K 线（5 分钟缓存，命中时零请求） */
  async function fetchDayKline(code) {
    const cached = klineCache.get(code);
    if (cached && Date.now() - cached.fetchedAt < KLINE_CACHE_TTL) {
      return cached.data;
    }
    try {
      const data = await invoke("get_stock_kline", { code, period: "day" });
      if (Array.isArray(data) && data.length > 0) {
        klineCache.set(code, { data, fetchedAt: Date.now() });
        return data;
      }
    } catch (e) {
      console.error("均线提醒: 获取日K失败", code, e);
    }
    return null;
  }

  /** 指定股票+周期+方向今日是否已通知过 */
  function hasTriggeredToday(code, type) {
    return history.value[getToday()]?.[code]?.includes(type) ?? false;
  }

  /** 标记已通知 */
  function markTriggeredToday(code, type) {
    const t = getToday();
    const todayData = history.value[t] || {};
    const triggers = todayData[code] || [];
    if (!triggers.includes(type)) {
      history.value = {
        ...history.value,
        [t]: { ...todayData, [code]: [...triggers, type] },
      };
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
      } catch { /* ignore */ }
    }
  }

  /** 确保通知权限已授予 */
  async function ensurePermission() {
    let permitted = await isPermissionGranted();
    if (!permitted) {
      permitted = (await requestPermission()) === "granted";
    }
    return permitted;
  }

  /**
   * 检查单只股票的均线穿越，触发时发送 Windows 通知。
   * 应在每次行情刷新后调用（内部使用日 K 缓存，不会高频请求 K 线）。
   *
   * @param {Object} quote - StockQuote 数据 { code, name, price }
   * @param {Object} s - 设置对象 (useSettings().state)，全局通知关闭时不检测
   */
  async function checkMaAlerts(quote, s) {
    if (!quote?.code) return;
    if (!s?.notifyEnabled) return;
    const cfg = configs.value[quote.code];
    if (!cfg?.periods?.length) return;
    // 非交易时段不通知
    if (!isTradingHours(quote.code)) return;

    const kline = await fetchDayKline(quote.code);
    if (!kline || kline.length < 5) return;
    const closes = kline.map((k) => k.close);

    const { code, name, price } = quote;
    // 首轮只记录价格基准，从第二轮起检测穿越
    const prev = lastPrices.value[code];
    lastPrices.value = { ...lastPrices.value, [code]: price };
    if (prev == null || prev <= 0) return;

    // ── 穿越检测：上穿（prev ≤ MA < price）/ 下穿（prev ≥ MA > price）──
    const triggered = [];
    for (const p of cfg.periods) {
      if (closes.length < p) continue;
      const ma = closes.slice(-p).reduce((a, b) => a + b, 0) / p;
      if (ma <= 0) continue;
      if (cfg.direction !== "cross_down" && prev <= ma && price > ma) {
        triggered.push({ period: p, dir: "up", ma });
      } else if (cfg.direction !== "cross_up" && prev >= ma && price < ma) {
        triggered.push({ period: p, dir: "down", ma });
      }
    }
    if (triggered.length === 0) return;

    // ── 过滤今日已通知项 ──
    const fresh = triggered.filter(
      (t) => !hasTriggeredToday(code, `ma${t.period}_${t.dir}`)
    );
    if (fresh.length === 0) return;

    // ── 确保权限并发送通知（await 每条，防止 Windows Toast 排队延迟）──
    const permitted = await ensurePermission();
    if (!permitted) return;
    await appWindow.requestUserAttention(UserAttentionType.Critical);

    for (const t of fresh) {
      const dirLabel = t.dir === "up" ? "上穿" : "下穿";
      const emoji = t.dir === "up" ? "📈" : "📉";
      await sendNotification({
        title: `${emoji} ${dirLabel} MA${t.period}: ${name} (${code})`,
        body: `现价 ${price.toFixed(2)} 已${dirLabel} MA${t.period}(${t.ma.toFixed(2)})`,
      });
      markTriggeredToday(code, `ma${t.period}_${t.dir}`);
      // 多条通知之间间隔 300ms，避免 Windows 通知系统节流合并
      if (fresh.length > 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  return {
    configs,
    getConfig,
    togglePeriod,
    setDirection,
    removeConfig,
    checkMaAlerts,
  };
}
