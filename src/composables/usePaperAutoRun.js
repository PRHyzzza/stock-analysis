/**
 * usePaperAutoRun — 模拟盘「每天定时自动选股 + 自动跑批」的调度器（单例）
 *
 * 与 `utils/paperAuto.js` 的分工：
 *   paperAuto  —— 纯逻辑（该不该跑、命中怎么合并、池怎么换），零依赖、可单测
 *   本文件     —— I/O 与定时器：问财查询、建池、跑批、系统通知、失败退避
 *
 * 为什么定时器放这里而不是 App.vue：
 *   App.vue 已经有四个行情轮询定时器，再塞一个业务定时器会让那一段难以维护；
 *   本文件自行订阅 `utils/refreshInterval.js` 的可见性变化重建间隔（§7.29），
 *   窗口不可见时 tick 间隔同样放大，但**到点仍会执行**——自动跑批不依赖窗口可见。
 *
 * 幂等与退避：
 *   - 成功：`lastAuto.date` 记当日日期，当天不再触发（跨重启有效，靠 localStorage）
 *   - 失败：不记日期，15 分钟后重试（`AUTO_RETRY_MS`）；连续失败不会每分钟打问财，
 *     避免把问财打到 403 限流
 *   - 关掉再开 / 改配置不会立刻重跑当天（日期守卫先于一切）
 *
 * 铁律：单例（§7.12）、失败保留旧数据（§7.16，池更新失败不清账户）、
 *       市场判定只走 marketTime（§7.15）、不假设跨窗口响应式同步。
 */
import { ref } from "vue";

import { usePaperAccount } from "./usePaperAccount.js";
import { queryIwencai } from "./iwencaiClient.js";
import { normalizeIwencaiResult, parseIwencaiCode } from "./useIwencaiRobot.js";
import { getMarketStatus, getToday } from "../utils/marketTime.js";
import { shouldRunAuto } from "../utils/paperAuto.js";
import { sendAlertNotification } from "../utils/notify.js";
import { effectiveInterval, onIntervalModeChange } from "../utils/refreshInterval.js";

/** tick 间隔：1 分钟（运行时刻精度到分钟，tick 再密也没意义） */
const TICK_MS = 60 * 1000;
/** 失败后的重试间隔（避免连续失败每分钟打问财） */
export const AUTO_RETRY_MS = 15 * 60 * 1000;

let _instance = null;

export function usePaperAutoRun() {
  if (_instance) return _instance;

  const paper = usePaperAccount();
  const { autoConfig, lastAuto, autoRunning } = paper;

  /** 上一次 tick 的判断结果（UI 用来回答「为什么今天还没跑」） */
  const lastCheck = ref({ at: 0, reason: "" });
  /** 上一次尝试跑的时间戳（成功或失败都记，用于失败退避） */
  let lastAttemptTs = 0;
  let lastAttemptOk = false;

  let timer = null;
  let unsubscribe = null;
  let started = false;

  /**
   * 查一条策略 → 规范化成 `{ code, name }[]`
   * 只收 A 股 6 位裸码（模拟盘不做港股；问财返回常带 .SH/.SZ 后缀，必须剥离）
   */
  async function fetchStrategyHits(question, perpage) {
    const result = await queryIwencai(question, 1, perpage);
    const { rows } = normalizeIwencaiResult(result);
    const out = [];
    for (const row of rows) {
      const parsed = parseIwencaiCode(row); // 唯一解析入口（含后缀剥离 + inferMarket）
      if (!parsed) continue;
      if (parsed.market !== "SH" && parsed.market !== "SZ" && parsed.market !== "BJ") continue;
      out.push({
        code: parsed.code,
        name: String(row["股票简称"] ?? row["股票名称"] ?? row.name ?? "").trim(),
      });
    }
    return out;
  }

  /** 判断现在该不该跑（纯逻辑在 paperAuto.shouldRunAuto，这里只做退避） */
  function evaluate(now = new Date()) {
    const status = getMarketStatus(); // 不传 code → A 股口径
    const today = status.dateStr || getToday();
    // 成功后 autoDoneOn 为真，把日期传进去让 shouldRunAuto 直接拒绝
    const lastDoneDate = paper.autoDoneOn(today) ? today : "";
    const base = shouldRunAuto(autoConfig.value, { now, lastAutoDate: lastDoneDate, status });
    if (!base.run) return base;

    // 失败退避：上一次尝试失败且未过重试间隔 → 暂不重试
    if (!lastAttemptOk && lastAttemptTs && now.getTime() - lastAttemptTs < AUTO_RETRY_MS) {
      const left = Math.ceil((AUTO_RETRY_MS - (now.getTime() - lastAttemptTs)) / 60000);
      return { run: false, reason: `上次失败，${left} 分钟后重试` };
    }
    return base;
  }

  /**
   * 跑一次（失败退避、成功通知）
   *
   * @param {Date} now 当前时刻
   * @param {boolean} manual 面板里「立即执行一次」= true。
   *   手动运行**不占用当天的定时名额**（`lastAuto.manual`），否则上午手动跑一次，
   *   收盘后那次定时任务会被幂等守卫挡掉。
   */
  async function trigger(now = new Date(), manual = false) {
    if (autoRunning.value) return null;
    lastAttemptTs = now.getTime();
    const res = await paper.runAuto({
      fetchStrategyHits,
      now,
      date: getToday(),
      manual,
    });
    lastAttemptOk = !!(res && res.ran);
    lastCheck.value = { at: Date.now(), reason: res?.reason || res?.error || "" };

    // 手动运行由面板就地提示，不再额外弹系统通知（用户正看着屏幕）
    if (lastAttemptOk && !manual && autoConfig.value.notify) {
      const body = res.error
        ? `自动选股完成，但${res.error}`
        : describeForNotify(res);
      // meta 不传：自动运行不是行情提醒，不该往 alert_event 里写一条假价格提醒
      await sendAlertNotification("模拟盘 · 每日自动运行", body);
    }
    return res;
  }

  /** 通知文案（与 paperAuto.describeAutoResult 同源，这里只补日期前缀） */
  function describeForNotify(res) {
    const parts = [];
    if (res.skipped) parts.push("策略无命中，选股池保持不变");
    else {
      parts.push(`选股池 ${res.poolSize} 只`);
      if (res.added?.length) parts.push(`新进 ${res.added.length} 只`);
      if (res.removed?.length) parts.push(`移出 ${res.removed.length} 只`);
    }
    if (res.days > 0) parts.push(`累积 ${res.days} 个交易日`);
    else if (res.upToDate) parts.push("无新交易日");
    if (res.failed?.length) parts.push(`${res.failed.length} 只取数失败`);
    return parts.join("，");
  }

  async function tick() {
    try {
      const now = new Date();
      const verdict = evaluate(now);
      lastCheck.value = { at: now.getTime(), reason: verdict.reason };
      if (!verdict.run) return;
      await trigger(now);
    } catch (e) {
      // tick 内任何异常都不能让定时器停摆
      lastCheck.value = { at: Date.now(), reason: String(e?.message || e || "调度异常") };
    }
  }

  /** 按当前可见性重建 tick 间隔（不可见时放大，但到点仍会跑） */
  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, effectiveInterval(TICK_MS));
  }

  /**
   * 启动调度（App.vue 主窗口 onMounted 调用，子窗口不调）
   *
   * 启动即先 tick 一次：应用在 15:30 之后才打开时，当天该跑的那次会立刻补上
   * （这不算「回放历史」——`runForward` 本身会从 `lastRunDate` 之后逐日补齐）。
   */
  function start() {
    if (started) return;
    started = true;
    schedule();
    unsubscribe = onIntervalModeChange(schedule);
    tick();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    started = false;
  }

  _instance = {
    autoConfig,
    autoRunning,
    lastAuto,
    lastCheck,
    start,
    stop,
    trigger, // 手动「立即自动跑一次」用（跳过时刻判断，但仍受失败退避外的一切守卫）
    evaluate,
  };
  return _instance;
}
