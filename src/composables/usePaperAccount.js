/**
 * usePaperAccount — 模拟盘账户（选股驱动 · 每日向前累积）
 *
 * 定位：把 `utils/paperEngine.js` 的纯函数接到「本地历史库 + 问财选股池 + localStorage」上。
 * 纯函数层零依赖，本文件只负责 I/O 与状态。
 *
 * 运行模型（重要）：
 *   1. 选股池 = 用户在问财窗口「加入选股池」的股票（落 localStorage，跨窗口共享）
 *   2. 每次运行把池内日 K 灌进引擎，从 `lastRunDate` 的**下一个交易日**跑到最新一根 K 线
 *      —— 交易日历**由数据本身给出**（各票日 K 日期的并集），不依赖本地日历表，
 *         避免「节假日把某天当成交易日」导致撮合错位
 *   3. 每个交易日按 `paperEngine.stepDay` 走三步：撮合昨日委托 → 记净值 → 出次日委托
 *
 * 铁律遵守：
 *   - 单例（§7.12）：多组件共享同一份 ref，避免重复跑出两套账
 *   - 竞态（§7.2）：`runSeq` 代际守卫，旧运行的响应一律丢弃
 *   - 失败保留旧数据（§7.16）：拉 K 线失败不清空账户，只置 `stale` + 错误文案
 *   - 本地日期（§7.13）：日期一律走 `marketTime.getToday()`，禁止 `toISOString()`
 *   - 回测口径（§7.19）：`summarize` 里 `enough=false` 时 UI 必须标「样本不足」
 */
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";

import { getToday } from "../utils/marketTime.js";
import { analyzeBars } from "./useSignalBacktest.js";
import {
  ACCOUNT_VERSION,
  createAccount,
  dayChange,
  normalizeConfig,
  stepDay,
  summarizeAccount,
} from "../utils/paperEngine.js";
import {
  activeStrategies,
  applyPoolMode,
  localDate,
  mergeStrategyHits,
  minutesOfDay,
  normalizeAutoConfig,
} from "../utils/paperAuto.js";

/** 账户与选股池的持久化键（前缀与项目其它 key 保持一致） */
const ACCOUNT_KEY = "stock-analysis-paper-account";
/** 池单独存一份：问财窗口与主窗口共用，账户重置时不应连带清空选股池 */
const POOL_KEY = "stock-analysis-paper-pool";
/** 自动选股配置（策略语句 + 运行时刻 + 池更新模式） */
const AUTO_CONFIG_KEY = "stock-analysis-paper-auto";
/** 最近一次自动运行结果（用于「今日是否已跑」的幂等判断，跨重启有效） */
const AUTO_RESULT_KEY = "stock-analysis-paper-auto-result";

/** 单票最少 K 线根数（与 useSignalBacktest 的 MIN_BARS 一致；不足则规则无法判定） */
const MIN_BARS = 60;
/** 拉取日 K 的条数上限 */
const KLINE_LIMIT = 2000;
/** 单次运行最多向前累积的交易日数（防止首次运行从很久以前开始跑几千天） */
const MAX_CATCHUP_DAYS = 250;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota 满时静默：宁可本次不落盘，也不让记账流程抛错 */
  }
}

function loadPool() {
  const raw = readJson(POOL_KEY, []);
  return Array.isArray(raw) ? raw.filter((p) => p && p.code) : [];
}

/** 从 localStorage 读账户；结构不认识就返回 null（由调用方决定新建还是迁移） */
function loadAccount() {
  const raw = readJson(ACCOUNT_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  if (raw.version !== ACCOUNT_VERSION) {
    // 版本不符：不猜结构，退回「保留选股池 + 新建账户」，并由 UI 提示
    return null;
  }
  // 兜底补齐可能缺失的数组字段（旧数据/手工改坏）
  for (const key of ["positions", "pending", "trades", "runs", "nav", "pool"]) {
    if (!Array.isArray(raw[key])) raw[key] = [];
  }
  raw.config = normalizeConfig(raw.config);
  return raw;
}

/** 单例 */
let _instance = null;

export function usePaperAccount() {
  if (_instance) return _instance;

  const pool = ref(loadPool());
  // 账户里的 `pool` 与独立的池 key 必须同源：引擎按 `account.pool` 判定「池内」
  // （见 paperEngine.stepDay）。加载旧账户时以池 key 为准回填，避免两处不一致
  // 让池判定退化成「全放行」。
  const loaded = loadAccount();
  if (loaded) loaded.pool = pool.value;
  const account = ref(loaded || createAccount({}, { createdAt: getToday(), pool: pool.value }));
  const running = ref(false);
  const error = ref("");
  /** 上次运行失败/数据缺失时为 true，UI 需标注（§7.16） */
  const stale = ref(false);
  /** 每只票的取数诊断：{ code: { bars, source, error } } */
  const diagnostics = ref({});
  /** 自动选股配置（策略语句 / 运行时刻 / 池更新模式），落 AUTO_CONFIG_KEY */
  const autoConfig = ref(normalizeAutoConfig(readJson(AUTO_CONFIG_KEY, null)));
  /** 自动运行进行中（与手动 `running` 分开：手动按钮的禁用态不该被定时任务改写） */
  const autoRunning = ref(false);

  /** 代际守卫：重置账户/换池时旧运行的写入一律丢弃 */
  let runSeq = 0;

  function persist() {
    writeJson(ACCOUNT_KEY, account.value);
  }

  function persistPool() {
    writeJson(POOL_KEY, pool.value);
  }

  /** 汇总（纯函数计算，computed 缓存） */
  const summary = computed(() => summarizeAccount(account.value));
  const today = computed(() => dayChange(account.value));

  /**
   * 持仓（原始字段 + 名称兜底）
   *
   * 刻意**不在这里算市值/浮盈**：模拟盘的市值只认「记账当日收盘价」，而当日收盘价
   * 只存在于引擎跑过的那个交易日。用实时行情算浮盈会和净值曲线口径打架（§7.24），
   * 因此浮盈统一看 `nav`（账户净值序列），持仓表只展示成本与股数。
   */
  const positions = computed(() => {
    const map = new Map(pool.value.map((p) => [p.code, p]));
    return (account.value.positions || []).map((p) => ({
      ...p,
      name: p.name || map.get(p.code)?.name || "",
    }));
  });

  /** 设置配置（部分更新，非法值由 normalizeConfig 夹住） */
  function updateConfig(patch) {
    account.value = {
      ...account.value,
      config: normalizeConfig({ ...account.value.config, ...(patch || {}) }),
    };
    persist();
  }

  /** 重置账户（保留选股池，不保留流水） */
  function resetAccount(config) {
    runSeq += 1; // 让在途运行失效
    const cfg = config || account.value.config;
    account.value = createAccount(cfg, { createdAt: getToday(), pool: pool.value });
    error.value = "";
    stale.value = false;
    diagnostics.value = {};
    persist();
  }

  /** 加入选股池（去重；name 缺省时用代码占位，后续取 K 线不依赖名称） */
  function addToPool(items) {
    const list = Array.isArray(items) ? items : [items];
    const existing = new Set(pool.value.map((p) => p.code));
    const added = [];
    for (const item of list) {
      const code = String(item?.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) continue; // 模拟盘只做 A 股 6 位
      if (existing.has(code)) continue;
      existing.add(code);
      added.push({ code, name: String(item?.name ?? "").trim(), addedAt: getToday(), source: item?.source || "iwencai" });
    }
    if (!added.length) return [];
    pool.value = [...pool.value, ...added];
    persistPool();
    account.value = { ...account.value, pool: pool.value };
    persist();
    return added;
  }

  /** 移出选股池（持仓仍在，卖出逻辑照常管它 —— 引擎对池外持仓只卖不买） */
  function removeFromPool(code) {
    const before = pool.value.length;
    pool.value = pool.value.filter((p) => p.code !== code);
    if (pool.value.length === before) return false;
    persistPool();
    account.value = { ...account.value, pool: pool.value };
    persist();
    return true;
  }

  function clearPool() {
    pool.value = [];
    persistPool();
    account.value = { ...account.value, pool: [] };
    persist();
  }

  /**
   * 整池替换（自动选股用：每日策略命中集合 = 当日池）
   *
   * 与 `addToPool` 的区别：这里允许「变少」，因此调用方必须自己保证
   * `items` 是**可信的命中结果**而不是「取数失败后的空集合」——
   * 拿空数组覆盖会让引擎把全部持仓视为池外（只卖不买），代价很大。
   * 空数组在此处直接拒绝，返回 false，交调用方决定要不要显式 `clearPool()`。
   *
   * @param {Array<{code: string, name?: string, source?: string}>} items
   * @param {string} [source] 来源标记，缺省 "auto"
   * @returns {boolean} 是否写入
   */
  function setPool(items, source = "auto") {
    const list = Array.isArray(items) ? items : [];
    const seen = new Set();
    const next = [];
    for (const item of list) {
      const code = String(item?.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) continue; // 模拟盘只做 A 股 6 位
      if (seen.has(code)) continue;
      seen.add(code);
      next.push({
        code,
        name: String(item?.name ?? "").trim(),
        addedAt: String(item?.addedAt ?? "") || getToday(),
        source: String(item?.source ?? "") || source,
      });
    }
    if (!next.length) return false;
    pool.value = next;
    persistPool();
    account.value = { ...account.value, pool: next };
    persist();
    return true;
  }

  /**
   * 取一只票的日 K：先读本地历史库，样本不足再走网络（Rust 端会旁路落库）
   * @returns {Promise<{ code: string, bars: Array, source: "local"|"remote"|"none", error: string }>}
   */
  async function fetchBars(code) {
    let bars = [];
    try {
      const local = await invoke("get_kline_history", { code, period: "day", limit: KLINE_LIMIT });
      if (Array.isArray(local)) bars = local;
    } catch (e) {
      // 库未初始化属正常情况，继续尝试网络
    }
    if (bars.length >= MIN_BARS) return { code, bars, source: "local", error: "" };
    try {
      const remote = await invoke("get_stock_kline", { code, period: "day" });
      if (Array.isArray(remote) && remote.length > bars.length) {
        return { code, bars: remote, source: "remote", error: "" };
      }
      return { code, bars, source: bars.length ? "local" : "none", error: bars.length ? "" : "无日 K 数据" };
    } catch (e) {
      return {
        code,
        bars,
        source: bars.length ? "local" : "none",
        error: String(e?.message || e || "取 K 线失败"),
      };
    }
  }

  /**
   * 拉齐池内所有票的日 K
   * @returns {Promise<{ barsByCode: object, diag: object, failed: string[] }>}
   */
  async function loadAllBars() {
    const diag = {};
    const barsByCode = {};
    const failed = [];
    // 顺序拉取：池通常只有几十只，并发打腾讯接口容易被限流
    for (const item of pool.value) {
      const res = await fetchBars(item.code);
      diag[item.code] = { bars: res.bars.length, source: res.source, error: res.error };
      if (res.bars.length) barsByCode[item.code] = res.bars;
      if (res.error) failed.push(item.code);
    }
    return { barsByCode, diag, failed };
  }

  /**
   * 从 K 线并集推出交易日列表（升序），用于「每日向前累积」
   * 只用数据里真实存在的日期，天然跳过节假日与停牌日。
   */
  function tradingDates(barsByCode) {
    const set = new Set();
    for (const bars of Object.values(barsByCode || {})) {
      for (const b of bars || []) if (b?.date) set.add(b.date);
    }
    return Array.from(set).sort();
  }

  /**
   * 向前累积跑一天或多天
   *
   * @param {{ force?: boolean }} [options] force=true 时即使「已是最新」也重跑最后一天（用于手动刷新）
   * @returns {Promise<{ days: number, reports: Array, failed: string[], upToDate: boolean }>}
   */
  async function runForward(options = {}) {
    if (running.value) return { days: 0, reports: [], failed: [], upToDate: false, busy: true };
    // 运行前先同步磁盘上的选股池：问财是独立窗口，可能在本面板打开后又加了票
    reloadPool();
    if (!pool.value.length) {
      error.value = "选股池为空：请先在问财选股窗口把标的加入模拟盘选股池";
      stale.value = true;
      return { days: 0, reports: [], failed: [], upToDate: false };
    }

    const mySeq = ++runSeq;
    running.value = true;
    error.value = "";
    try {
      const { barsByCode, diag, failed } = await loadAllBars();
      if (mySeq !== runSeq) return { days: 0, reports: [], failed: [], upToDate: false };
      diagnostics.value = diag;

      if (!Object.keys(barsByCode).length) {
        error.value = "选股池内所有标的都没取到日 K（本地库为空且远端失败），本次未运行";
        stale.value = true; // §7.16：不清空账户，只标 stale
        return { days: 0, reports: [], failed, upToDate: false };
      }

      // 交易日 = 池内 K 线日期的并集；从 lastRunDate 之后开始
      const all = tradingDates(barsByCode);
      const last = account.value.lastRunDate;
      let dates = last ? all.filter((d) => d > last) : all;
      if (options.force && last) dates = all.filter((d) => d >= last);

      if (!dates.length) {
        stale.value = failed.length > 0;
        return { days: 0, reports: [], failed, upToDate: true };
      }

      // 首次运行（lastRunDate 为空）只跑最近 MAX_CATCHUP_DAYS 个交易日，避免从库里最老一天开始
      if (!last && dates.length > MAX_CATCHUP_DAYS) {
        dates = dates.slice(-MAX_CATCHUP_DAYS);
      }

      let acct = account.value;
      const reports = [];
      for (const date of dates) {
        if (mySeq !== runSeq) return { days: 0, reports, failed, upToDate: false };
        const res = stepDay(acct, { date, barsByCode, analyze: analyzeBars });
        acct = res.account;
        reports.push(res.report);
      }

      if (mySeq !== runSeq) return { days: 0, reports: [], failed: [], upToDate: false };
      account.value = acct;
      persist();
      stale.value = failed.length > 0;
      if (failed.length) {
        error.value = `${failed.length} 只标的取数失败：${failed.slice(0, 5).join("、")}${failed.length > 5 ? " 等" : ""}（已用其余标的数据继续，结果可能不完整）`;
      }
      return { days: reports.length, reports, failed, upToDate: reports.length === 0 };
    } catch (e) {
      if (mySeq !== runSeq) return { days: 0, reports: [], failed: [], upToDate: false };
      error.value = String(e?.message || e || "模拟盘运行失败");
      stale.value = true; // 保留旧账户，只标注
      return { days: 0, reports: [], failed: [], upToDate: false };
    } finally {
      if (mySeq === runSeq) running.value = false;
    }
  }

  /**
   * 用池内日 K 的最新收盘价刷新「持仓浮盈」（只读渲染用，不改账户状态）
   * @returns {Promise<Object<string, number>>} code → 最新收盘价
   */
  async function latestCloses() {
    const out = {};
    for (const item of pool.value) {
      try {
        const bars = await invoke("get_kline_history", { code: item.code, period: "day", limit: 5 });
        const lastBar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
        if (lastBar && Number(lastBar.close) > 0) out[item.code] = Number(lastBar.close);
      } catch {
        /* 单只失败不影响其它 */
      }
    }
    return out;
  }

  /** 全部重置（账户 + 选股池），用于「彻底重来」 */
  function clearAll() {
    runSeq += 1;
    account.value = createAccount({}, { createdAt: getToday() });
    pool.value = [];
    error.value = "";
    stale.value = false;
    diagnostics.value = {};
    persist();
    persistPool();
  }

  /**
   * 从 localStorage 重新读选股池。
   *
   * 为什么需要：问财选股是**独立窗口**（`?iwencai=1`），它往同一个 localStorage key
   * 写入选股池后，本窗口的单例 ref 不会自动更新（Tauri 下跨窗口没有响应式同步）。
   * 打开模拟盘面板前调一次即可，无需轮询。
   *
   * @returns {number} 读到的池大小
   */
  function reloadPool() {
    const disk = loadPool();
    const same =
      disk.length === pool.value.length &&
      disk.every((p, i) => p.code === pool.value[i]?.code);
    if (!same) {
      pool.value = disk;
      account.value = { ...account.value, pool: disk };
      persist();
    }
    return pool.value.length;
  }

  // ── 自动运行（每日定时跑问财策略 → 更新选股池 → 向前累积）──────────────
  // 为什么配置放这个 composable 而不是 useSettings：它只服务模拟盘，
  // 且 useSettings 的 sanitize 以 DEFAULTS 为 schema 会把嵌套对象整个丢掉（§7.9 之外的原因）。

  /** 最近的自动运行结果（UI 展示用，随账户一起存） */
  const lastAuto = ref(readJson(AUTO_RESULT_KEY, null) || null);

  /** 更新自动运行配置（部分更新，非法值由 normalizeAutoConfig 夹住） */
  function updateAutoConfig(patch) {
    const merged = normalizeAutoConfig({ ...autoConfig.value, ...(patch || {}) });
    autoConfig.value = merged;
    writeJson(AUTO_CONFIG_KEY, merged);
  }

  /** 策略增删改 */
  function setStrategies(list) {
    updateAutoConfig({ strategies: Array.isArray(list) ? list : [] });
  }

  /**
   * 跑一次「自动选股 + 向前累积」
   *
   * 顺序是硬要求：**先更新池，再跑批**。反过来的话今天新选出的票要等到明天
   * 才会被引擎看到，自动化的意义就丢了一半。
   *
   * @param {{ fetchStrategyHits: Function, now?: Date, date?: string, manual?: boolean }} opts
   *   fetchStrategyHits(question, perpage) → rows，由调用方注入（本文件不 import 问财，
   *   避免 composable 层出现 Tauri/网络依赖，纯函数层与 I/O 层保持分离）
   *   manual=true 表示用户在面板里手动点「立即执行一次」：结果照常记录，
   *   但**不占用当天的自动运行名额**（否则 10:00 手动跑一次，15:30 收盘后的
   *   那次定时任务就被幂等守卫挡掉，当天收盘数据永远进不了账）
   * @returns {Promise<{ ran: boolean, reason: string, poolSize: number, added: string[],
   *                     removed: string[], skipped: boolean, days: number, failed: string[],
   *                     upToDate: boolean, error: string, manual: boolean }>}
   */
  async function runAuto(opts = {}) {
    const manual = !!opts.manual;
    const empty = {
      ran: false, reason: "", poolSize: pool.value.length, added: [], removed: [],
      skipped: false, days: 0, failed: [], upToDate: false, error: "", manual,
    };
    if (running.value) return { ...empty, reason: "正在运行中" };

    const date = String(opts.date ?? "") || getToday();
    const fetchHits = opts.fetchStrategyHits;
    if (typeof fetchHits !== "function") {
      return { ...empty, reason: "未注入选股函数" };
    }

    const strategies = activeStrategies(autoConfig.value);
    if (!strategies.length) return { ...empty, reason: "未配置问财策略" };

    autoRunning.value = true;
    try {
      // 1) 逐条策略查问财（顺序执行：并发打问财极易触发 403 限流）
      const results = [];
      const strategyErrors = [];
      for (const s of strategies) {
        try {
          const rows = await fetchHits(s.question, autoConfig.value.perpage);
          results.push({ strategyId: s.id, rows: Array.isArray(rows) ? rows : [] });
        } catch (e) {
          strategyErrors.push(`${s.question}：${String(e?.message || e || "查询失败")}`);
        }
      }

      // 一条都没成功 → 不能拿空结果去覆盖池（那会让全部持仓变「池外」）
      if (!results.length) {
        const msg = strategyErrors.length
          ? `问财策略全部查询失败：${strategyErrors.slice(0, 2).join("；")}`
          : "问财策略无返回";
        lastAuto.value = { date, ran: false, error: msg, manual, ts: Date.now() };
        writeJson(AUTO_RESULT_KEY, lastAuto.value);
        return { ...empty, reason: msg, error: msg };
      }

      // 2) 合并命中 → 按模式更新池
      const hits = mergeStrategyHits(results);
      const applied = applyPoolMode(hits, pool.value, { mode: autoConfig.value.mode, date });
      if (!applied.skipped) setPool(applied.pool, "auto");
      else reloadPool(); // 未命中也要把账户 pool 与磁盘对齐

      // 3) 向前累积（池刚更新过，reloadPool 会读到新池）
      const run = await runForward({});

      const summaryOut = {
        date,
        ran: true,
        reason: strategyErrors.length ? `部分策略失败：${strategyErrors[0]}` : "",
        poolSize: pool.value.length,
        added: applied.added,
        removed: applied.removed,
        skipped: applied.skipped,
        days: run.days || 0,
        failed: run.failed || [],
        upToDate: !!run.upToDate,
        error: error.value || "",
        manual,
        ts: Date.now(),
      };
      lastAuto.value = summaryOut;
      writeJson(AUTO_RESULT_KEY, summaryOut);
      return summaryOut;
    } catch (e) {
      const msg = String(e?.message || e || "自动运行失败");
      lastAuto.value = { date, ran: false, error: msg, manual, ts: Date.now() };
      writeJson(AUTO_RESULT_KEY, lastAuto.value);
      return { ...empty, reason: msg, error: msg };
    } finally {
      autoRunning.value = false;
    }
  }

  /**
   * 今天是否已经跑过「当天该跑的那次」（幂等守卫，跨重启有效）
   *
   * 定时任务跑过 → 直接算完成。
   * 手动「立即执行一次」→ **只有发生在运行时刻之后**才算完成当天任务：
   *   - 上午手动验证策略（如 10:00）不该顶替收盘后那次跑批，否则当天收盘数据永远进不了账；
   *   - 收盘后手动跑过（如 16:00）则等价于当天任务，不必再让定时器重复打一遍问财、
   *     重复拉一遍全池日 K（那次 `runForward` 必然只会返回 `upToDate`）。
   */
  function autoDoneOn(date, now = new Date()) {
    const r = lastAuto.value;
    if (!date || !r?.ran || r.date !== date) return false;
    if (!r.manual) return true;

    // 手动运行：仅当它发生在当天运行时刻之后，才视为完成
    const target = minutesOfDay(autoConfig.value.time);
    if (target == null) return false;
    const at = r.ts ? new Date(r.ts) : now;
    const sameDay = localDate(at) === date;
    const stamp = sameDay ? at : now;
    const minutes = stamp.getHours() * 60 + stamp.getMinutes();
    return minutes >= target;
  }

  _instance = {
    // 状态
    account,
    pool,
    positions,
    summary,
    today,
    running,
    error,
    stale,
    diagnostics,
    autoConfig,
    autoRunning,
    lastAuto,
    // 配置与池
    updateConfig,
    addToPool,
    setPool,
    removeFromPool,
    clearPool,
    reloadPool,
    // 运行
    runForward,
    latestCloses,
    // 自动运行
    updateAutoConfig,
    setStrategies,
    runAuto,
    autoDoneOn,
    // 生命周期
    resetAccount,
    clearAll,
  };
  return _instance;
}
