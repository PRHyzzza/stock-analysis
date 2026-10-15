import { ref, watch } from "vue";
import { getToday, isTradingHours, pruneHistory } from "../utils/marketTime.js";
import { sendAlertNotification } from "../utils/notify.js";

/**
 * 持仓止损/止盈提醒系统
 *
 * 功能：
 * - 按持仓成本设置「亏 N% 止损」「赚 M% 止盈」两类百分比阈值（正数表示幅度：
 *   stopLossPct 8 = 亏 8% 提醒；takeProfitPct 20 = 赚 20% 提醒）
 * - 浮盈亏比例触及阈值时发送 Windows 原生通知（仅交易时段）
 * - 每股票每类型每日只通知一次（按本地日期去重），次日自动重置
 * - 跨日重置内部状态基准，防止隔夜跳空造成的误报
 *
 * 阈值判定（profitPct = (price - buyPrice) / buyPrice * 100）：
 *   profitPct <= -stopLossPct   → 止损提醒（kind "position_stop_loss"）
 *   profitPct >= takeProfitPct  → 止盈提醒（kind "position_take_profit"）
 * 恰好等于阈值即触发（边界取闭区间）。
 *
 * 配置存储：localStorage "stock-analysis-position-alerts"
 *   { "600519": { stopLossPct: 8, takeProfitPct: 20 } }
 * 通知历史：localStorage "stock-analysis-position-notif-history"
 *   { "2026-07-22": { "600519": ["stop_loss"] } }（只保留最近 7 天）
 *
 * 注意：本 composable 为**单例**。行情轮询方（App.vue）与配置弹窗/持仓面板
 * 必须共享同一份状态，否则弹窗里新增/修改的阈值无法被检查器看到（重启前不生效），
 * 且启动快照回写还会覆盖掉本会话的新增内容（PROJECT.md §7.12）。
 *
 * 另外：本模块**只读**持仓数据（由调用方把 position 传进来），绝不写 usePositions 的状态；
 * 不新增 Rust 命令——落库由 notify.js 的 sendAlertNotification 内部完成。
 */

const STORAGE_KEY = "stock-analysis-position-alerts";
const HISTORY_KEY = "stock-analysis-position-notif-history";

/** 触发类型 key（稳定字符串，供每日去重与 alert_event 统计使用） */
const TYPE_STOP_LOSS = "stop_loss";
const TYPE_TAKE_PROFIT = "take_profit";

/** 归一化单项阈值：非正数 / 非数字一律视为未启用（返回 null） */
function normalizePct(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 加载止损止盈配置 { code: { stopLossPct, takeProfitPct } } */
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 加载通知历史 { date: { code: ["stop_loss"] } }，只保留最近 7 天 */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? pruneHistory(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** 单例实例（与配置弹窗共享，见文件头注释） */
let _instance = null;

export function usePositionAlerts() {
  if (_instance) return _instance;

  /** 配置 { code: { stopLossPct: number|null, takeProfitPct: number|null } } */
  const configs = ref(loadConfig());
  /** 通知历史 { date: { code: ["stop_loss"|"take_profit"] } } */
  const history = ref(loadHistory());

  // 上次检查日期：跨日时重置内部状态基准，防止隔夜跳空被误判为刚刚触及阈值
  // （止损/止盈按浮盈亏比例判定，比价穿越稳定，无每股票价格基准需维护；
  //  此处保留日期标记并触发清零逻辑，保证与 useMaAlerts/usePriceAlerts 口径一致）
  let lastCheckDate = getToday();
  /** 跨日清零用的内部基准快照（记录当日已判定过的股票，跨日即作废） */
  const stateBaseline = ref({});

  // 配置自动持久化
  watch(configs, (val) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    } catch { /* ignore */ }
  }, { deep: true });

  /** 保存通知历史（写入前顺带裁剪 7 天前的记录） */
  function saveHistory() {
    history.value = pruneHistory(history.value);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
    } catch { /* ignore */ }
  }

  /** 获取某只持仓的止损止盈配置（未配置返回 null） */
  function getConfig(code) {
    return configs.value[code] || null;
  }

  /**
   * 写入某只持仓的止损止盈配置。
   * 两项都未启用（null / <= 0）时视为删除该条目。
   * @param {string} code
   * @param {{stopLossPct?: number|null, takeProfitPct?: number|null}} cfg
   */
  function setConfig(code, cfg) {
    if (!code) return;
    const stopLossPct = normalizePct(cfg?.stopLossPct);
    const takeProfitPct = normalizePct(cfg?.takeProfitPct);
    if (stopLossPct == null && takeProfitPct == null) {
      removeConfig(code);
      return;
    }
    configs.value = { ...configs.value, [code]: { stopLossPct, takeProfitPct } };
  }

  /** 删除某只持仓的配置，并清理其全部通知历史（含历史日期里的残留记录） */
  function removeConfig(code) {
    const { [code]: _removed, ...rest } = configs.value;
    configs.value = rest;
    const cleaned = {};
    for (const [date, day] of Object.entries(history.value)) {
      if (!day?.[code]) {
        cleaned[date] = day;
        continue;
      }
      const { [code]: _drop, ...others } = day;
      cleaned[date] = others;
    }
    history.value = cleaned;
    saveHistory();
  }

  /** 指定股票 + 类型今日是否已通知过（跨日自动失效，天然重置） */
  function hasTriggeredToday(code, type) {
    return history.value[getToday()]?.[code]?.includes(type) ?? false;
  }

  /** 标记已通知（写入时顺带裁剪 7 天前的记录，避免运行期间 localStorage 持续增长） */
  function markTriggeredToday(code, type) {
    const t = getToday();
    const todayData = history.value[t] || {};
    const triggers = todayData[code] || [];
    if (!triggers.includes(type)) {
      history.value = pruneHistory({
        ...history.value,
        [t]: { ...todayData, [code]: [...triggers, type] },
      });
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
      } catch { /* ignore */ }
    }
  }

  /**
   * 检查单只持仓的止损/止盈阈值，触发时发送 Windows 通知。
   * 应在每次行情刷新后对每只持仓调用一次。
   *
   * @param {Object} quote - 实时行情 { code, name, price }
   * @param {Object} position - 持仓 { code, name, buyPrice, quantity }（只读，不回写）
   * @param {Object} s - 设置对象 (useSettings().state)，全局通知关闭时不检测
   */
  async function checkPositionAlerts(quote, position, s) {
    if (!quote?.code) return;
    if (!s?.notifyEnabled) return;

    const code = quote.code;
    const cfg = configs.value[code];
    if (!cfg) return;

    const stopLossPct = normalizePct(cfg.stopLossPct);
    const takeProfitPct = normalizePct(cfg.takeProfitPct);
    if (stopLossPct == null && takeProfitPct == null) return;

    // 持仓必须齐备：成本与数量缺失时无法计算盈亏比例
    const buyPrice = Number(position?.buyPrice) || 0;
    const quantity = Number(position?.quantity) || 0;
    if (buyPrice <= 0 || quantity <= 0) return;

    // 行情缺失（停牌/请求失败）不判定
    const price = Number(quote.price) || 0;
    if (price <= 0) return;

    // 跨日重置：次日首次检测清零内部基线（含记录已判定过股票的集合），避免隔夜跳空误报
    const today = getToday();
    if (lastCheckDate !== today) {
      lastCheckDate = today;
      stateBaseline.value = {};
    }

    // 非交易时段不通知（A 股/港股/节假日判定统一走 marketTime）
    if (!isTradingHours(code)) return;

    const name = quote.name || position?.name || code;
    const profitPct = ((price - buyPrice) / buyPrice) * 100;

    // 记录本只股票今日已被判定过（跨日由上面的清零逻辑作废）
    stateBaseline.value = { ...stateBaseline.value, [code]: today };

    // ── 阈值判定（边界取闭区间：恰好等于阈值同样触发）──
    const hits = [];
    if (stopLossPct != null && profitPct <= -stopLossPct) {
      hits.push({ type: TYPE_STOP_LOSS, kind: "position_stop_loss", pct: stopLossPct });
    }
    if (takeProfitPct != null && profitPct >= takeProfitPct) {
      hits.push({ type: TYPE_TAKE_PROFIT, kind: "position_take_profit", pct: takeProfitPct });
    }
    if (hits.length === 0) return;

    // ── 过滤今日已通知项 ──
    const fresh = hits.filter((h) => !hasTriggeredToday(code, h.type));
    if (fresh.length === 0) return;

    // ── 发送通知（await 每条，防止 Windows Toast 排队延迟）──
    for (const h of fresh) {
      const isStopLoss = h.type === TYPE_STOP_LOSS;
      const emoji = isStopLoss ? "🛑" : "🎯";
      const label = isStopLoss ? "止损提醒" : "止盈提醒";
      const pctText = profitPct >= 0 ? `赚 ${profitPct.toFixed(2)}%` : `亏 ${Math.abs(profitPct).toFixed(2)}%`;
      const thresholdText = `${isStopLoss ? "-" : "+"}${h.pct}%`;
      const sent = await sendAlertNotification(
        `${emoji} ${label}: ${name} (${code})`,
        `现价 ${price.toFixed(2)} 已${pctText}（成本 ${buyPrice.toFixed(2)}，阈值 ${thresholdText}）`,
        { code, kind: h.kind, price, target: buyPrice }
      );
      // 权限被拒时中止后续发送
      if (!sent) return;
      markTriggeredToday(code, h.type);
      // 多条通知之间间隔 300ms，避免 Windows 通知系统节流合并
      if (fresh.length > 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  _instance = {
    configs,
    getConfig,
    setConfig,
    removeConfig,
    checkPositionAlerts,
    hasTriggeredToday,
  };
  return _instance;
}
