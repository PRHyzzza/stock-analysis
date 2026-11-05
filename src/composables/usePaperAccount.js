/**
 * usePaperAccount — 手动模拟盘账户（**单例**）
 *
 * 定位：把 `utils/paperEngine.js` 的纯函数接到「实时行情 + localStorage」上。
 * 纯函数层零依赖，本文件只负责 I/O 与状态。
 *
 * 运行模型（v2）：
 *   用户自己决定买卖 → 取**当前实时价** → `previewOrder` 校验（资金/手数/涨跌停/T+1）→
 *   `applyOrder` 立即成交 → `recordNav` 记当日净值。没有信号、没有委托队列、没有自动平仓、
 *   没有定时任务——「什么时候买、买多少」完全由用户决定。
 *   15:05-15:30 盘后固定价格交易：成交价恒为**当日收盘价**、不加滑点（`session: "afterHours"`）。
 *
 * 铁律遵守：
 *   - 单例（§7.12）：多组件共享同一份 ref，避免两处各记一套账
 *   - 失败保留旧数据（§7.16）：取价/下单失败不清空账户，只回错误文案
 *   - 本地日期（§7.13）：日期一律走 `marketTime.getToday()`，禁止 `toISOString()`
 *   - 交易时段只走 `marketTime`（§7.15）：连续竞价用 `getMarketStatus`，
 *     盘后固定价用 `getAfterHoursStatus`，不在组件里手写 9:30/15:05/15:30
 *   - 金额/百分比口径走 `utils/format.js`（组件层），本文件只出数值
 */
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getFuyaoKey } from "../utils/fuyao.js";

import { getAfterHoursStatus, getMarketStatus, getToday } from "../utils/marketTime.js";
import {
  ACCOUNT_VERSION,
  applyOrder,
  createAccount,
  dayChange,
  migrateAccount,
  normalizeConfig,
  previewOrder,
  recordNav,
  summarizeAccount,
  valuePositions,
} from "../utils/paperEngine.js";
import { overnightGaps, summarizeMatches } from "../utils/paperReview.js";
import { describeScore, scoreBars } from "../utils/paperScore.js";
import { sentimentOf, sectorBoostOf } from "../utils/marketSentiment.js";
import { auctionFlagsOf, promotionStats } from "../utils/eventSignals.js";

/** 账户与自选池的持久化键（与项目其它 key 保持一致） */
const ACCOUNT_KEY = "stock-analysis-paper-account";
/** 池单独存一份：问财窗口与主窗口共用，账户重置时不应连带清空自选池 */
const POOL_KEY = "stock-analysis-paper-pool";

/** 单票最少 K 线根数（与 scoreBars 一致；不足则不给参考分） */
const MIN_BARS = 60;
/** 拉取日 K 的条数上限 */
const KLINE_LIMIT = 2000;
/** 净值补点的最小间隔（主窗口轮询时避免每分钟写一次 localStorage） */
const NAV_THROTTLE_MS = 5 * 60 * 1000;
/** 隔夜复盘最多取多少只标的的日 K（逐只串行，太多会很慢） */
const REVIEW_MAX_CODES = 20;

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
    /* quota 满时静默：宁可本次不落盘，也不让下单流程抛错 */
  }
}

function loadPool() {
  const raw = readJson(POOL_KEY, []);
  return Array.isArray(raw) ? raw.filter((p) => p && p.code) : [];
}

/** 本地 HH:mm（成交时间，仅用于流水展示） */
function hhmm(at = new Date()) {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** 单例 */
let _instance = null;

export function usePaperAccount() {
  if (_instance) return _instance;

  const pool = ref(loadPool());
  const loaded = migrateAccount(readJson(ACCOUNT_KEY, null));
  if (loaded) loaded.pool = pool.value;
  const account = ref(loaded || createAccount({}, { createdAt: getToday(), pool: pool.value }));
  /** 从 v1（选股跑批）迁移过来的账户：UI 提示一次 */
  const migrated = ref(!!loaded?.migratedFrom);
  // 迁移结果立刻落盘：否则每次启动都会重新迁移同一份 v1 数据、反复弹提示
  if (loaded?.migratedFrom) persist();

  const error = ref("");
  /** 下单进行中（防重复点击） */
  const busy = ref(false);
  /** 持仓最新价：code → price（实时报价，不是记账价） */
  const prices = ref({});
  /** 持仓昨收：code → prevClose（用于「今日盈亏」，与成本浮盈区分） */
  const prevCloses = ref({});
  /** 行情取数失败/缺价的代码（UI 要标注，不能假装有价） */
  const missingPrices = ref([]);
  /** 交易时段状态（`marketTime.getMarketStatus()` 的结果） */
  const marketStatus = ref(getMarketStatus());

  /** 下单票据：代码 + 实时行情 */
  const ticket = ref({
    code: "",
    name: "",
    price: null,
    prevClose: null,
    high: null,
    low: null,
    volume: null,
    changePct: null,
    loading: false,
    error: "",
  });
  /** 参考打分（只做参考，不参与买卖判定） */
  const scoreInfo = ref({ code: "", loading: false, res: null, text: "", error: "" });
  /** 隔夜缺口复盘（按需加载：会逐只拉日 K，不在打开面板时自动跑） */
  const overnight = ref({ loading: false, data: null, error: "" });
  /** 自选池参考分：code → { res, text, error, at }（at = 计算日期，跨日重算） */
  const poolScores = ref({});
  /** 自选打分进行中（逐只串行，避免并发打接口） */
  const poolScoreBusy = ref(false);
  /** 打分进度（UI 显示「打分中 3/12」） */
  const poolScoreProgress = ref({ done: 0, total: 0 });
  /** 当日市场情绪（原始数据 + 计算后的分/标签/系数）；无 Key 时为 null */
  const sentiment = ref(null);
  const sentimentInfo = computed(() => sentimentOf(sentiment.value));
  const sentimentError = ref("");
  const sentimentLoading = ref(false);
  /** 情绪缓存：交易日 + 拉取时间（盘中 5 分钟过期，盘后沿用当日） */
  let sentimentDate = "";
  let sentimentFetchedAt = 0;
  /** 自选池个股→板块映射与板块涨幅（题材强度用） */
  const sectorStrength = ref({ quotes: [], by_stock: [] });
  const sectorError = ref("");
  const sectorLoading = ref(false);
  /** thscode → 当日涨跌幅（板块快照），由 sectorStrength 派生 */
  const sectorQuoteMap = computed(() => {
    const map = new Map();
    for (const q of sectorStrength.value?.quotes || []) {
      map.set(q.thscode, q.change_pct);
    }
    return map;
  });
  /** 上次记录净值的时间戳（节流用） */
  let lastNavAt = 0;

  /** 连板天梯（近 30 交易日）与晋级率 */
  const ladder = ref(null);
  const ladderError = ref("");
  const ladderLoading = ref(false);
  const ladderInfo = computed(() => promotionStats(ladder.value?.days || []));
  let ladderFetchedAt = 0;
  /** 竞价异动：code → { all, primary } */
  const auctionFlags = ref(new Map());
  const auctionError = ref("");
  const auctionLoading = ref(false);
  let auctionFetchedAt = 0;

  function nzShares(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function persist() {
    writeJson(ACCOUNT_KEY, account.value);
  }

  function persistPool() {
    writeJson(POOL_KEY, pool.value);
  }

  const summary = computed(() => summarizeAccount(account.value));
  const today = computed(() => dayChange(account.value));

  /** 持仓估值（实时价；缺价时退化为成本价并标记） */
  const valuation = computed(() => valuePositions(account.value, prices.value));
  const positionRows = computed(() =>
    valuation.value.rows.map((p) => {
      const prev = Number(prevCloses.value[p.code]);
      const hasPrev = Number.isFinite(prev) && prev > 0 && p.price != null;
      // 今日盈亏看昨收，与「浮动盈亏（对成本）」是两个完全不同的视角，不能混用
      const dayPnl = hasPrev ? (p.price - prev) * nzShares(p.shares) : null;
      return {
        ...p,
        name: p.name || pool.value.find((x) => x.code === p.code)?.name || "",
        prevClose: hasPrev ? prev : null,
        dayPnl,
        dayPnlPct: hasPrev ? ((p.price - prev) / prev) * 100 : null,
      };
    })
  );

  /** 实时总权益（现金 + 实时市值），与净值曲线口径区分：前者是「此刻」，后者是「昨日收盘」 */
  const liveEquity = computed(() => summary.value.cash + valuation.value.marketValue);

  /** 今日是否可下单（只认 marketTime，状态为 open 才允许） */
  /**
   * 当前时刻该标的允许的交易会话（**实时读时钟**，不依赖缓存）
   * @returns {"continuous"|"afterHours"|""} "" = 不可下单
   */
  function currentSession(code, at = new Date()) {
    const s = getMarketStatus(code, at);
    if (s.state === "open") return "continuous";
    if (s.state !== "post") return "";
    return getAfterHoursStatus(code, at).available ? "afterHours" : "";
  }

  /** 当前会话（响应式；依赖 marketStatus，由面板的状态定时器刷新） */
  const tradeSession = computed(() => {
    if (!marketStatus.value) return "";
    return currentSession(ticket.value.code || "");
  });

  const canTrade = computed(() => tradeSession.value !== "");

  /** 盘后窗口信息（UI 显示剩余时间 / 不适用原因），判定只走 marketTime */
  const afterHoursInfo = computed(() => {
    if (!marketStatus.value) return getAfterHoursStatus("");
    return getAfterHoursStatus(ticket.value.code || "");
  });

  /** 不可下单的原因（UI 直接展示） */
  const tradeBlockedReason = computed(() => {
    const s = marketStatus.value;
    if (!s) return "交易时段未知";
    if (s.state === "open") return "";
    if (s.state === "holiday") return `今日非交易日${s.holidayName ? `（${s.holidayName}）` : ""}`;
    if (s.state === "pre") return `未开盘（${s.openAt} 开盘）`;
    if (s.state === "break") return `午间休市（${s.resumeAt} 恢复）`;
    if (s.state === "post") {
      const ah = afterHoursInfo.value;
      if (ah.available) return "";
      return ah.reason || `已收盘（${s.closeAt} 收盘）`;
    }
    return "当前不可交易";
  });

  function refreshStatus() {
    marketStatus.value = getMarketStatus();
    return marketStatus.value;
  }

  // ── 自选池 ────────────────────────────────────────────
  /**
   * 加入自选池（去重；模拟盘只做 A 股 6 位裸码）
   * @param {Array|object} items { code, name, source? }
   */
  function addToPool(items) {
    const list = Array.isArray(items) ? items : [items];
    const existing = new Set(pool.value.map((p) => p.code));
    const added = [];
    for (const item of list) {
      const code = String(item?.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) continue;
      if (existing.has(code)) continue;
      existing.add(code);
      added.push({
        code,
        name: String(item?.name ?? "").trim(),
        addedAt: getToday(),
        source: item?.source || "manual",
      });
    }
    if (!added.length) return [];
    pool.value = [...pool.value, ...added];
    persistPool();
    account.value = { ...account.value, pool: pool.value };
    persist();
    return added;
  }

  function removeFromPool(code) {
    const before = pool.value.length;
    pool.value = pool.value.filter((p) => p.code !== code);
    if (pool.value.length === before) return false;
    persistPool();
    account.value = { ...account.value, pool: pool.value };
    persist();
    return true;
  }

  /**
   * 批量移出自选池（一次持久化，供列表勾选删除用）
   * @param {Array<string>} codes
   * @returns {number} 实际移除的只数（不存在的代码直接忽略，不报错）
   */
  function removeFromPoolBatch(codes) {
    const list = (Array.isArray(codes) ? codes : [codes]).map((c) => String(c ?? "").trim());
    const drop = new Set(list.filter(Boolean));
    if (!drop.size) return 0;
    const next = pool.value.filter((p) => !drop.has(String(p.code)));
    const removed = pool.value.length - next.length;
    if (!removed) return 0;
    pool.value = next;
    persistPool();
    account.value = { ...account.value, pool: next };
    persist();
    return removed;
  }

  /**
   * 用一批标的**整体覆盖**自选池（问财选股「覆盖模拟盘自选」用）
   *
   * 直接赋新数组而不是「先 clearPool 再 addToPool」：那样会写两次盘，
   * 中途异常就会留下半套池（用户以为覆盖成功，其实只剩一半）。
   *
   * @param {Array|object} items { code, name }
   * @returns {{ total: number, before: number, dropped: number }} 覆盖后只数 / 覆盖前只数 / 被过滤掉的非法项数
   */
  function replacePool(items) {
    const list = Array.isArray(items) ? items : [items];
    const seen = new Set();
    const next = [];
    let dropped = 0;
    for (const item of list) {
      const code = String(item?.code ?? "").trim();
      // 模拟盘只做 A 股 6 位裸码，与 addToPool 同一口径
      if (!/^\d{6}$/.test(code) || seen.has(code)) {
        dropped += 1;
        continue;
      }
      seen.add(code);
      next.push({
        code,
        name: String(item?.name ?? "").trim(),
        addedAt: getToday(),
        source: item?.source || "manual",
      });
    }
    const before = pool.value.length;
    pool.value = next;
    persistPool();
    // 只落池、不落账户：问财是独立窗口，本窗口的 account 是打开时的快照，
    // 若此时 persist() 整份账户，会把主窗口期间成交/净值补点回滚成旧值。
    // 账户里的 pool 副本只是内存镜像，下次初始化会用 POOL_KEY 覆盖（见 usePaperAccount 开头）。
    account.value = { ...account.value, pool: next };
    return { total: next.length, before, dropped };
  }

  function clearPool() {
    pool.value = [];
    persistPool();
    account.value = { ...account.value, pool: [] };
    persist();
  }

  /**
   * 从 localStorage 重新读自选池
   *
   * 问财是**独立窗口**，它写入同一个 key 后本窗口的单例 ref 不会自动更新
   * （Tauri 下跨窗口没有响应式同步），因此打开面板前调一次即可，无需轮询。
   */
  function reloadPool() {
    const disk = loadPool();
    const same =
      disk.length === pool.value.length && disk.every((p, i) => p.code === pool.value[i]?.code);
    if (!same) {
      pool.value = disk;
      account.value = { ...account.value, pool: disk };
      persist();
    }
    return pool.value.length;
  }

  // ── 行情 ──────────────────────────────────────────────
  async function fetchQuote(code) {
    try {
      const q = await invoke("get_stock_quote", { code });
      if (!q || !(Number(q.price) > 0)) return null;
      return q;
    } catch (e) {
      return null;
    }
  }

  /** 刷新下单票据的实时行情（输入代码后调用） */
  async function loadTicket(code) {
    const c = String(code ?? "").trim();
    ticket.value = {
      code: c, name: "", price: null, prevClose: null, high: null, low: null, volume: null,
      changePct: null, loading: true, error: "",
    };
    if (!/^\d{6}$/.test(c)) {
      ticket.value = { ...ticket.value, loading: false, error: "请输入 6 位 A 股代码" };
      return null;
    }
    const q = await fetchQuote(c);
    if (!q) {
      ticket.value = { ...ticket.value, loading: false, error: "取不到实时行情（停牌或代码不存在）" };
      return null;
    }
    ticket.value = {
      code: c,
      name: q.name || "",
      price: Number(q.price) || null,
      prevClose: Number(q.prev_close) || null,
      high: Number(q.high) || null,
      low: Number(q.low) || null,
      volume: Number.isFinite(Number(q.volume)) ? Number(q.volume) : null,
      changePct: Number.isFinite(Number(q.change_pct)) ? Number(q.change_pct) : null,
      loading: false,
      error: "",
    };
    return q;
  }

  /**
   * 按当前票据预估一笔委托（**不下单**，UI 用来显示成交价/金额/费用/上限）
   * @param {"buy"|"sell"} side
   * @param {number} shares
   * @param {"continuous"|"afterHours"|""} [session] 当前会话（由 UI 传入，保证时段切换时预估重算）
   */
  function preview(side, shares, session) {
    const t = ticket.value;
    if (!t?.code || !(Number(t.price) > 0)) return null;
    return previewOrder(account.value, {
      side,
      code: t.code,
      name: t.name,
      quote: { price: t.price, prevClose: t.prevClose, high: t.high, low: t.low, volume: t.volume },
      shares,
      date: getToday(),
      // 盘后窗口的预估必须用收盘价（不滑点），否则预览价与实际成交价对不上
      session: session || currentSession(t.code) || "continuous",
    });
  }

  /** 刷新持仓最新价（批量接口，一次请求） */
  async function refreshPrices() {
    const codes = (account.value.positions || []).map((p) => p.code);
    if (!codes.length) {
      prices.value = {};
      prevCloses.value = {};
      missingPrices.value = [];
      return {};
    }
    try {
      const list = await invoke("get_stock_quotes_batch", { codes });
      const map = {};
      const prevMap = {};
      for (const q of Array.isArray(list) ? list : []) {
        const px = Number(q?.price);
        const prev = Number(q?.prev_close);
        if (q?.code && Number.isFinite(px) && px > 0) {
          map[q.code] = px;
          if (Number.isFinite(prev) && prev > 0) prevMap[q.code] = prev;
        }
      }
      prices.value = map;
      prevCloses.value = prevMap;
      missingPrices.value = codes.filter((c) => !(map[c] > 0));
      return map;
    } catch (e) {
      missingPrices.value = codes;
      return prices.value;
    }
  }

  /**
   * 记录当日净值
   *
   * 只在**交易日**记点（周末/节假日不产生平线）；持仓有缺价时**不记**，
   * 避免把成本价当成市价写进曲线（宁可少一个点，也不要假数据）。
   */
  async function refreshNav() {
    refreshStatus();
    const map = await refreshPrices();
    if (!marketStatus.value?.isTradingDay) return { recorded: false, reason: "非交易日" };
    const positions = account.value.positions || [];
    const missing = positions.filter((p) => !(map[p.code] > 0));
    if (positions.length && missing.length) {
      return { recorded: false, reason: `${missing.length} 只持仓缺报价，本次不记净值` };
    }
    const res = recordNav(account.value, { date: getToday(), prices: map, at: hhmm() });
    if (res.account) {
      account.value = res.account;
      persist();
    }
    lastNavAt = Date.now();
    return { recorded: !!res.nav, nav: res.nav };
  }

  /**
   * 节流版净值补点（主窗口轮询时调用）
   *
   * 为什么需要：净值只在「打开面板 / 成交」时记录，用户几天不开面板曲线就断档。
   * 这里只**记账**、不下单，不违背手动交易的前提；5 分钟内重复调用直接跳过，
   * 避免每分钟写一次 localStorage。
   */
  async function maybeRecordNav(force = false) {
    const st = refreshStatus();
    if (!st?.isTradingDay) return { recorded: false, reason: "非交易日" };
    const today = getToday();
    const todayNav = (account.value.nav || []).find((r) => r.date === today);
    // 「收盘点已记」= 今天已有 at >= 15:00 的快照。晚上才打开应用也能补上这一天的收盘点，
    // 且只补一次——之后每次 tick 直接跳过，不会整晚反复打行情接口。
    const closeRecorded = !!todayNav?.at && todayNav.at >= "15:00";

    if (st.state === "post") {
      if (closeRecorded) return { recorded: false, reason: "今日已记收盘点" };
      return refreshNav();
    }
    if (st.state !== "open") return { recorded: false, reason: "盘外不记点" };
    if (!force && Date.now() - lastNavAt < NAV_THROTTLE_MS) {
      return { recorded: false, reason: "节流中" };
    }
    return refreshNav();
  }

  // ── 参考打分（只读，不参与买卖）────────────────────────
  /**
   * 取一只票的日 K：先读本地历史库，样本不足再走网络
   * @returns {Promise<Array>}
   */
  async function fetchBars(code) {
    let bars = [];
    try {
      const local = await invoke("get_kline_history", { code, period: "day", limit: KLINE_LIMIT });
      if (Array.isArray(local)) bars = local;
    } catch {
      /* 库未初始化属正常情况，继续尝试网络 */
    }
    if (bars.length >= MIN_BARS) return bars;
    try {
      const remote = await invoke("get_stock_kline", { code, period: "day", apiKey: getFuyaoKey() });
      if (Array.isArray(remote) && remote.length > bars.length) return remote;
      return bars;
    } catch {
      return bars;
    }
  }

  // ── 情绪与题材（短线环境；没有 Key 就不参与打分）──────
  /** 情绪缓存有效期：盘中涨停家数会变，5 分钟后重拉；盘后同一交易日基本不再变 */
  const SENTIMENT_TTL_MS = 5 * 60 * 1000;

  /**
   * 拉当日市场情绪（涨停统计 + 连板高度 + 涨停题材热度 + 跌停家数）
   *
   * 失败不抛：写 `sentimentError` 并让情绪**不参与**打分（factor=1）。
   * 宁可分数退回旧口径，也不要拿昨天的或过期的情绪去调节今天的分。
   */
  async function loadSentiment(force = false) {
    const key = getFuyaoKey();
    if (!key) {
      sentiment.value = null;
      sentimentDate = "";
      sentimentError.value = "未配置同花顺 API Key，情绪与题材不参与打分";
      return sentimentInfo.value;
    }
    const today = getToday();
    const fresh =
      !force &&
      sentimentDate === today &&
      !!sentiment.value &&
      Date.now() - sentimentFetchedAt < SENTIMENT_TTL_MS;
    if (fresh) return sentimentInfo.value;
    if (sentimentLoading.value) return sentimentInfo.value;

    sentimentLoading.value = true;
    try {
      const data = await invoke("get_market_sentiment", { date: today, apiKey: key });
      sentiment.value = data || null;
      sentimentDate = data ? today : "";
      sentimentFetchedAt = Date.now();
      sentimentError.value = data ? "" : "情绪接口返回空数据";
    } catch (e) {
      // 明确失败：清空数据，避免用过期情绪调节今天的分
      sentiment.value = null;
      sentimentDate = "";
      sentimentError.value = String(e?.message || e);
    } finally {
      sentimentLoading.value = false;
    }
    return sentimentInfo.value;
  }

  /**
   * 拉个股所属板块 + 板块当日涨幅（题材强度）
   *
   * `merge`：单票打分时只补自己那一只，**不能整体替换**——否则会把自选池刚批量拉好的
   * 全池映射冲掉，自选页的题材加成会突然集体消失（且下次重算才恢复）。
   *
   * @param {string[]} codes 6 位 A 股代码
   * @param {{ merge?: boolean }} [opts]
   */
  async function loadSectorStrength(codes, opts = {}) {
    const merge = !!opts.merge;
    const list = (Array.isArray(codes) ? codes : [])
      .map((c) => String(c ?? "").trim())
      .filter((c) => /^\d{6}$/.test(c));
    if (!list.length) return null;
    const key = getFuyaoKey();
    if (!key) {
      sectorStrength.value = { quotes: [], by_stock: [] };
      sectorError.value = "未配置同花顺 API Key，题材强度不可用";
      return null;
    }
    sectorLoading.value = true;
    try {
      const data = await invoke("get_sector_strength", { codes: list, apiKey: key });
      const prev = sectorStrength.value || { quotes: [], by_stock: [] };
      const byMap = new Map((merge ? prev.by_stock || [] : []).map((x) => [x.code, x]));
      for (const x of data?.by_stock || []) byMap.set(x.code, x);
      const quoteMap = new Map(
        (merge ? prev.quotes || [] : []).map((q) => [q.thscode, q.change_pct])
      );
      for (const q of data?.quotes || []) quoteMap.set(q.thscode, q.change_pct);
      sectorStrength.value = {
        quotes: [...quoteMap.entries()].map(([thscode, change_pct]) => ({ thscode, change_pct })),
        by_stock: [...byMap.values()],
      };
      sectorError.value = "";
      return data;
    } catch (e) {
      if (!merge) sectorStrength.value = { quotes: [], by_stock: [] };
      sectorError.value = String(e?.message || e);
      return null;
    } finally {
      sectorLoading.value = false;
    }
  }

  /**
   * 某只票的题材加成
   * @returns {{ available: boolean, boost: number, best: object|null, reason: string }}
   */
  function sectorBoostFor(code) {
    const c = String(code ?? "");
    const hit = (sectorStrength.value?.by_stock || []).find((x) => x.code === c);
    if (!hit) return { available: false, boost: 0, best: null, reason: "无板块数据" };
    return sectorBoostOf(hit.sectors, sectorQuoteMap.value);
  }

  /**
   * 基准指数日 K（上证综指）—— 相对强度用
   *
   * 只有 21 根以上才能算 20 日涨幅；拿不到就返回空数组，打分自动回退绝对涨幅。
   * 按交易日缓存：指数日 K 一天只变一次，没必要每次打分都打接口。
   */
  const benchBars = ref([]);
  let benchDate = "";
  async function loadBench() {
    const today = getToday();
    if (benchDate === today && benchBars.value.length >= 21) return benchBars.value;
    try {
      const bars = await invoke("get_stock_kline", {
        code: "sh000001",
        period: "day",
        apiKey: getFuyaoKey(),
      });
      if (Array.isArray(bars) && bars.length >= 21) {
        benchBars.value = bars;
        benchDate = today;
      }
    } catch (e) {
      // 基准缺失不是错误：动量因子退回绝对涨幅，其余照常打分
      console.warn("[paper] 基准指数获取失败，动量回退绝对涨幅:", e);
    }
    return benchBars.value;
  }

  /** 基准近 20 日涨幅（%）；不足 21 根返回 null */
  function benchRet20PctNow() {
    const bars = benchBars.value;
    if (!Array.isArray(bars) || bars.length < 21) return null;
    const last = Number(bars[bars.length - 1]?.close);
    const prev = Number(bars[bars.length - 21]?.close);
    if (!(prev > 0) || !(last > 0)) return null;
    return (last / prev - 1) * 100;
  }

  /**
   * 计算参考打分（6 因子 + 风险扣分 + 战法），**仅供参考**
   * 明确不影响买卖：用户点「买入」就成交，不看分数。
   */
  async function loadScore(code) {
    const c = String(code ?? "").trim();
    scoreInfo.value = { code: c, loading: true, res: null, text: "", error: "", sector: null };
    if (!/^\d{6}$/.test(c)) {
      scoreInfo.value = { ...scoreInfo.value, loading: false, error: "代码不合法" };
      return null;
    }
    const bars = await fetchBars(c);
    if (!bars.length) {
      scoreInfo.value = { ...scoreInfo.value, loading: false, error: "没有日 K 数据，无法打分" };
      return null;
    }
    // 情绪与题材是可选增益：拿不到就按中性算，日 K 打分本身照常出分
    await loadSentiment();
    await loadSectorStrength([c], { merge: true });
    await loadBench();
    const boost = sectorBoostFor(c);
    const res = scoreBars(bars.slice(-200), c, {
      regimeFactor: sentimentInfo.value?.factor ?? 1,
      sectorBoost: boost.boost,
      benchRet20Pct: benchRet20PctNow(),
    });
    scoreInfo.value = {
      code: c,
      loading: false,
      res,
      text: describeScore(res),
      error: res.enough ? "" : `日 K 仅 ${res.bars} 根（不足 60 根），无法打分`,
      sector: boost,
    };
    return res;
  }

  /**
   * 给自选池逐只算参考分（串行；已算过的当天跳过）
   *
   * 为什么要缓存到日期：日 K 一天只变一次，重复算既慢又浪费；
   * 跨日后自动重算，避免拿昨天的分看今天的票。
   *
   * @param {boolean} [force] 忽略当天缓存强制重算
   */
  async function loadPoolScores(force = false) {
    if (poolScoreBusy.value) return;
    const codes = pool.value.map((p) => p.code);
    if (!codes.length) {
      poolScores.value = {};
      // 池空也要显示市场情绪与连板晋级：它们都是全市场的，与有没有自选无关
      loadSentiment(force).catch(() => {});
      loadLadder(force).catch(() => {});
      return;
    }
    const today = getToday();
    // 清掉已移出自选的缓存，再挑出需要算的
    const keep = new Set(codes);
    const base = {};
    for (const [code, entry] of Object.entries(poolScores.value)) {
      if (keep.has(code)) base[code] = entry;
    }
    poolScores.value = base;
    const todo = codes.filter((c) => force || poolScores.value[c]?.at !== today);
    if (!todo.length) return;

    poolScoreBusy.value = true;
    poolScoreProgress.value = { done: 0, total: todo.length };
    try {
      // 情绪与题材各拉一次就够：情绪是全市场的，板块一次批量反查（100 只上限）
      await loadSentiment(force);
      await loadSectorStrength(codes);
      await loadBench();
      await loadLadder(force);
      await loadAuction(codes, force);
      const regime = sentimentInfo.value?.factor ?? 1;
      const benchRet = benchRet20PctNow();
      for (let i = 0; i < todo.length; i++) {
        const code = todo[i];
        const bars = await fetchBars(code);
        let entry;
        if (!bars.length) {
          entry = { res: null, text: "", error: "没有日 K 数据，无法打分", at: today, sector: null };
        } else {
          const boost = sectorBoostFor(code);
          const res = scoreBars(bars.slice(-200), code, {
            regimeFactor: regime,
            sectorBoost: boost.boost,
            benchRet20Pct: benchRet,
          });
          entry = {
            res,
            text: describeScore(res),
            error: res.enough ? "" : `日 K 仅 ${res.bars} 根（不足 60 根）`,
            at: today,
            sector: boost,
          };
        }
        poolScores.value = { ...poolScores.value, [code]: entry };
        poolScoreProgress.value = { done: i + 1, total: todo.length };
      }
    } finally {
      poolScoreBusy.value = false;
    }
  }

  // ── 短线事件（连板晋级率 / 竞价异动）──────────────────
  /** 连板天梯缓存：30 日窗口日内基本不变，10 分钟足够 */
  const LADDER_TTL_MS = 10 * 60 * 1000;
  /** 竞价异动缓存：盘中会新增，5 分钟刷新 */
  const AUCTION_TTL_MS = 5 * 60 * 1000;

  /**
   * 拉连板天梯并算晋级率
   *
   * 晋级率的分母只包含「已有次日结果」的样本（`seal_nextday != null`），
   * 最近交易日的票还没有次日，混进去会把晋级率系统性压低估。
   */
  async function loadLadder(force = false) {
    const key = getFuyaoKey();
    if (!key) {
      ladder.value = null;
      ladderError.value = "未配置同花顺 API Key，连板晋级不可用";
      return ladderInfo.value;
    }
    if (!force && ladder.value && Date.now() - ladderFetchedAt < LADDER_TTL_MS) {
      return ladderInfo.value;
    }
    if (ladderLoading.value) return ladderInfo.value;
    ladderLoading.value = true;
    try {
      const data = await invoke("get_limit_up_ladder", { apiKey: key });
      ladder.value = data || null;
      ladderFetchedAt = Date.now();
      ladderError.value = data?.days?.length ? "" : "连板天梯返回空数据";
    } catch (e) {
      ladder.value = null;
      ladderError.value = String(e?.message || e);
    } finally {
      ladderLoading.value = false;
    }
    return ladderInfo.value;
  }

  /**
   * 拉一批股票当日的集合竞价异动
   * @param {string[]} codes 6 位代码
   */
  async function loadAuction(codes, force = false) {
    const list = (Array.isArray(codes) ? codes : [])
      .map((c) => String(c ?? "").trim())
      .filter((c) => /^\d{6}$/.test(c));
    if (!list.length) {
      auctionFlags.value = new Map();
      return null;
    }
    const key = getFuyaoKey();
    if (!key) {
      auctionFlags.value = new Map();
      auctionError.value = "未配置同花顺 API Key，竞价异动不可用";
      return null;
    }
    if (!force && auctionFetchedAt && Date.now() - auctionFetchedAt < AUCTION_TTL_MS) {
      return auctionFlags.value;
    }
    if (auctionLoading.value) return auctionFlags.value;
    auctionLoading.value = true;
    try {
      const data = await invoke("get_auction_opportunities", {
        codes: list,
        date: getToday(),
        apiKey: key,
      });
      auctionFlags.value = auctionFlagsOf(data?.items || []);
      auctionFetchedAt = Date.now();
      auctionError.value = "";
      return auctionFlags.value;
    } catch (e) {
      auctionFlags.value = new Map();
      auctionError.value = String(e?.message || e);
      return null;
    } finally {
      auctionLoading.value = false;
    }
  }

  /** 某只票的竞价异动（没有则 null） */
  function auctionOf(code) {
    return auctionFlags.value.get(String(code ?? "")) || null;
  }

  // ── 下单 ──────────────────────────────────────────────
  /**
   * 下单（买/卖）
   *
   * 顺序很重要：**先判交易时段（连续竞价 / 盘后固定价），再取最新价，再校验，最后成交**。
   * 用「下单这一刻」的报价算成交价——拿面板打开时的旧价成交就是自欺欺人。
   * 盘后窗口取到的 `price` 就是当日收盘价（腾讯收盘后不再变动），引擎按固定价成交。
   *
   * @param {"buy"|"sell"} side
   * @param {{ code: string, shares: number, name?: string }} req
   * @returns {Promise<{ ok: boolean, reason: string, trade?: object, order?: object }>}
   */
  async function placeOrder(side, req = {}) {
    if (busy.value) return { ok: false, reason: "上一笔委托还在处理中" };
    const code = String(req.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) return { ok: false, reason: "请输入 6 位 A 股代码" };

    refreshStatus();
    // 用**真实代码 + 真实时刻**判会话：票据可能指向别的标的，且 15:05/15:30 是硬边界，
    // 不能拿面板 computed 的缓存结果（北交所还要单独排除）。
    const session = currentSession(code);
    if (!session) {
      const reason =
        marketStatus.value?.state === "post"
          ? getAfterHoursStatus(code).reason || tradeBlockedReason.value
          : tradeBlockedReason.value;
      return { ok: false, reason: reason || "当前不在交易时段" };
    }

    busy.value = true;
    error.value = "";
    try {
      const q = await fetchQuote(code);
      if (!q) return { ok: false, reason: "取不到实时行情，本次未成交" };

      const date = getToday();
      const order = previewOrder(account.value, {
        side,
        code,
        name: q.name || req.name || "",
        quote: { price: q.price, prevClose: q.prev_close, high: q.high, low: q.low, volume: q.volume },
        shares: req.shares,
        date,
        session,
        // 买入时把「参考分 + 命中战法」附在流水上，复盘才能按战法归因
        meta: req.meta || null,
      });
      if (!order.ok) return { ok: false, reason: order.reason, maxShares: order.maxShares };

      const res = applyOrder(account.value, order, { date, time: hhmm() });
      if (!res.account) return { ok: false, reason: res.error || "下单失败" };

      account.value = res.account;
      persist();
      // 成交后立刻刷新持仓价与净值（实时价，不写假数据）
      await refreshNav();
      ticket.value = { ...ticket.value, price: Number(q.price) || ticket.value.price };
      return { ok: true, reason: "", trade: res.trade, order };
    } catch (e) {
      const msg = String(e?.message || e || "下单失败");
      return { ok: false, reason: msg };
    } finally {
      busy.value = false;
    }
  }

  const buy = (req) => placeOrder("buy", req);
  const sell = (req) => placeOrder("sell", req);

  // ── 复盘 ──────────────────────────────────────────────
  /** FIFO 归因（持有期 / 战法 / 参考分）——纯计算，随账户变化自动更新 */
  const review = computed(() => summarizeMatches(account.value));

  /**
   * 加载隔夜缺口复盘（按需触发：逐只拉日 K，串行避免打爆接口）
   * @param {boolean} [force] 已加载过是否重算
   */
  async function loadOvernightReview(force = false) {
    if (overnight.value.loading) return overnight.value.data;
    if (overnight.value.data && !force) return overnight.value.data;
    const buys = (account.value.trades || []).filter((t) => t.side === "buy");
    if (!buys.length) {
      overnight.value = { loading: false, data: overnightGaps([], {}), error: "" };
      return overnight.value.data;
    }
    const codes = Array.from(new Set(buys.map((t) => t.code))).slice(0, REVIEW_MAX_CODES);
    overnight.value = { loading: true, data: overnight.value.data, error: "" };
    const barsByCode = {};
    const failed = [];
    for (const code of codes) {
      const bars = await fetchBars(code);
      if (bars.length) barsByCode[code] = bars;
      else failed.push(code);
    }
    const data = overnightGaps(account.value.trades, barsByCode);
    overnight.value = {
      loading: false,
      data,
      error: failed.length ? `${failed.length} 只标的取不到日 K，已从样本中排除` : "",
    };
    return data;
  }

  // ── 账本导入导出 ──────────────────────────────────────
  /** 导出账本 JSON（账户 + 自选 + 版本 + 导出时间），用于备份/换机 */
  function exportLedger() {
    return JSON.stringify(
      {
        app: "stock-analysis",
        type: "paper-ledger",
        version: ACCOUNT_VERSION,
        exportedAt: new Date().toISOString(),
        account: account.value,
        pool: pool.value,
      },
      null,
      2
    );
  }

  /**
   * 导入账本（**覆盖**当前账户）
   *
   * 只认 `migrateAccount` 认识的版本；不合法一律整份拒绝，不做「部分导入」——
   * 半套数据比没有数据更危险（持仓对不上成交，净值就会说谎）。
   */
  function importLedger(text) {
    let raw;
    try {
      raw = JSON.parse(String(text || ""));
    } catch {
      return { ok: false, reason: "不是合法的 JSON" };
    }
    const acctRaw = raw && typeof raw === "object" && raw.account ? raw.account : raw;
    const next = migrateAccount(acctRaw);
    if (!next) return { ok: false, reason: "账户结构不认识（版本不符或缺字段），已拒绝导入" };
    if (!Array.isArray(next.positions) || !Array.isArray(next.trades)) {
      return { ok: false, reason: "账户缺少持仓/成交字段，已拒绝导入" };
    }
    account.value = next;
    if (raw && Array.isArray(raw.pool)) {
      pool.value = raw.pool.filter((p) => p && p.code);
      account.value = { ...account.value, pool: pool.value };
      persistPool();
    }
    prices.value = {};
    prevCloses.value = {};
    missingPrices.value = [];
    overnight.value = { loading: false, data: null, error: "" };
    poolScores.value = {};
    persist();
    return {
      ok: true,
      reason: "",
      counts: {
        positions: next.positions.length,
        trades: next.trades.length,
        nav: next.nav.length,
      },
    };
  }

  // ── 配置与生命周期 ────────────────────────────────────
  function updateConfig(patch) {
    account.value = {
      ...account.value,
      config: normalizeConfig({ ...account.value.config, ...(patch || {}) }),
    };
    persist();
  }

  /** 重置账户（保留自选池，不保留流水） */
  function resetAccount(config) {
    const cfg = config || account.value.config;
    account.value = createAccount(cfg, { createdAt: getToday(), pool: pool.value });
    error.value = "";
    prices.value = {};
    missingPrices.value = [];
    poolScores.value = {};
    persist();
  }

  /** 全部重置（账户 + 自选池） */
  function clearAll() {
    account.value = createAccount({}, { createdAt: getToday() });
    pool.value = [];
    error.value = "";
    prices.value = {};
    missingPrices.value = [];
    persist();
    persistPool();
  }

  /** 一次性消费迁移提示 */
  function ackMigrated() {
    migrated.value = false;
  }

  _instance = {
    // 状态
    account,
    pool,
    positionRows,
    valuation,
    prices,
    prevCloses,
    missingPrices,
    summary,
    today,
    liveEquity,
    error,
    busy,
    migrated,
    ticket,
    scoreInfo,
    marketStatus,
    tradeSession,
    afterHoursInfo,
    canTrade,
    tradeBlockedReason,
    // 自选池
    addToPool,
    removeFromPool,
    removeFromPoolBatch,
    replacePool,
    clearPool,
    reloadPool,
    // 行情
    refreshStatus,
    refreshPrices,
    refreshNav,
    maybeRecordNav,
    // 复盘
    review,
    overnight,
    loadOvernightReview,
    // 账本
    exportLedger,
    importLedger,
    // 参考打分
    loadScore,
    poolScores,
    poolScoreBusy,
    poolScoreProgress,
    // 情绪与题材（短线环境；无 Key 时不参与打分）
    sentiment,
    sentimentInfo,
    sentimentError,
    sentimentLoading,
    loadSentiment,
    sectorStrength,
    sectorError,
    sectorLoading,
    loadSectorStrength,
    sectorBoostFor,
    // 短线事件（连板晋级率 / 竞价异动）
    ladder,
    ladderInfo,
    ladderError,
    ladderLoading,
    loadLadder,
    auctionFlags,
    auctionError,
    auctionLoading,
    loadAuction,
    auctionOf,
    loadPoolScores,
    // 交易
    loadTicket,
    preview,
    buy,
    sell,
    // 配置与生命周期
    updateConfig,
    resetAccount,
    clearAll,
    ackMigrated,
  };
  return _instance;
}
