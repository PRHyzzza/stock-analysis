/**
 * 历史信号胜率 — 本地历史库「读」回路
 *
 * 背景：`signal_event` 自建库起就只写不读（`StockDetail.vue` 把日内量价陷阱/放量信号
 * 落库，但没有任何界面消费它）。本 composable 补上这条回路：把历史落库的信号取回来，
 * 与**之后真实走出的日 K** 对照，算出信号发出后实际是涨是跌。
 *
 * 与 `useSignalBacktest` 的区别（务必在 UI 中如实区分，见 PROJECT.md §7.26）：
 *   - `useSignalBacktest` 是**规则回测**：把 8 条日线规则在历史 K 线上重放，回答
 *     「这条规则过去表现如何」，与用户是否真的看过无关，样本是规则触发次数。
 *   - 本模块是**实盘记录统计**：只统计**真的被落库过**的信号（即用户当时确实打开过
 *     该股票的日内图并算出了信号），回答「这些真实记录下来的信号后来怎么样了」。
 *     样本天然稀疏、且存在选择偏差（用户看过的股票才留痕），因此**必须**标注样本量，
 *     不得当作策略胜率展示。
 *
 * 收益口径：`signal_event` 记录的是**日内**信号（带 time 锚点），但分时数据不落库，
 * 故无法回算日内收益。这里统一用**日 K 收盘价**计算信号发出日之后的表现，
 * 并明确标注为「按日 K 收盘估算」，不能声称是分时级收益。
 */
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";

/** 持有期（交易日）—— 与回测面板保持一致的 1/3/5/10 日 */
export const HOLD_PERIODS = [1, 3, 5, 10];

/**
 * 判断信号方向：`dir` 字段优先，缺失时按信号名推断。
 * 历史落库数据里 dir 可能是 bull/bear，也可能为空（旧行或缺字段），
 * 空值时不能默认成看涨——那会让胜率凭空偏向有利方向。
 * @returns {"bull"|"bear"|"unknown"}
 */
export function inferDirection(dir, name) {
  const d = String(dir || "").trim().toLowerCase();
  if (d === "bull" || d === "看涨" || d === "多") return "bull";
  if (d === "bear" || d === "看跌" || d === "空") return "bear";

  const n = String(name || "");
  // 名称中含明确看跌词（陷阱/背离顶/破位/诱多 等）判为 bear
  if (/诱多|顶背离|破位|看跌|卖出|减仓|警惕|风险|假突破/.test(n)) return "bear";
  if (/诱空|底背离|突破|看涨|买入|金叉|放量上涨/.test(n)) return "bull";
  return "unknown";
}

/**
 * 单条信号的远期收益。
 *
 * @param {{date:string,price:number}} signal 信号（date 为 YYYY-MM-DD）
 * @param {Array<{date:string,close:number}>} bars 该股票日 K（升序）
 * @param {number} holdDays 持有交易日数
 * @returns {{ ok:boolean, reason?:string, close?:number, retPct?:number, exitDate?:string, days?:number }}
 */
export function forwardReturn(signal, bars, holdDays) {
  const price = Number(signal?.price) || 0;
  const sigDate = String(signal?.date || "");
  if (price <= 0) return { ok: false, reason: "no_price" };
  if (!sigDate || !Array.isArray(bars) || bars.length === 0) {
    return { ok: false, reason: "no_bars" };
  }

  // 找到信号日当天或之后第一根 K 线作为基准（信号日当天即持有起点）
  let base = -1;
  for (let i = 0; i < bars.length; i++) {
    if (String(bars[i].date) >= sigDate) { base = i; break; }
  }
  if (base === -1) return { ok: false, reason: "no_bars" }; // 信号晚于最后一根 K 线

  const exitIdx = base + holdDays;
  if (exitIdx >= bars.length) return { ok: false, reason: "insufficient" };

  const exitBar = bars[exitIdx];
  const exitClose = Number(exitBar?.close) || 0;
  if (exitClose <= 0) return { ok: false, reason: "no_bars" };

  return {
    ok: true,
    close: exitClose,
    retPct: ((exitClose - price) / price) * 100,
    exitDate: String(exitBar.date || ""),
    days: exitIdx - base,
  };
}

/**
 * 聚合一组「已算出收益」的样本。
 *
 * 判定胜负的口径：**按信号方向**。bull 信号涨了算胜、跌了算负；bear 信号跌了算胜。
 * 方向 unknown 的样本不计入胜率（无法判断对错），但计入 `unknownDir` 单独披露，
 * 避免它们悄悄拉低或抬高胜率。
 *
 * @param {Array<{dir:string, retPct:number}>} samples
 */
export function summarizeSamples(samples) {
  const judged = samples.filter((s) => s.dir === "bull" || s.dir === "bear");
  const unknownDir = samples.length - judged.length;

  if (judged.length === 0) {
    return {
      samples: samples.length, judged: 0, wins: 0, losses: 0,
      winRatePct: null, avgRetPct: null, avgWinPct: null, avgLossPct: null,
      profitFactor: null, bestPct: null, worstPct: null, unknownDir,
    };
  }

  let wins = 0, sum = 0, winSum = 0, lossSum = 0, best = -Infinity, worst = Infinity;
  for (const s of judged) {
    // 方向对齐后的收益：bear 信号跌了才是赚
    const aligned = s.dir === "bear" ? -s.retPct : s.retPct;
    sum += aligned;
    if (aligned > 0) { wins++; winSum += aligned; } else { lossSum += -aligned; }
    if (aligned > best) best = aligned;
    if (aligned < worst) worst = aligned;
  }

  const n = judged.length;
  return {
    samples: samples.length,
    judged: n,
    wins,
    // 平盘（aligned == 0）既不算胜也不算负，故 losses 用减法保证 wins+losses <= judged
    losses: n - wins,
    winRatePct: (wins / n) * 100,
    avgRetPct: sum / n,
    avgWinPct: wins > 0 ? winSum / wins : null,
    avgLossPct: lossSum > 0 ? lossSum / (n - wins) : null,
    // 盈亏比 = 总盈利 / 总亏损。无亏损时不可为 Infinity，无盈利时为 0（全是亏损，不是"不亏不赚"）。
    // 两者都用 null 表示"该比值无意义"，避免 UI 把 Infinity/0 当成真实比率展示。
    profitFactor: winSum > 0 && lossSum > 0 ? winSum / lossSum : null,
    bestPct: best,
    worstPct: worst,
    unknownDir,
  };
}

export function useSignalHistory() {
  const events = ref([]);        // 原始信号事件（本地库）
  const loading = ref(false);
  const error = ref("");
  const loadedAt = ref(0);
  const barsCache = ref({});     // { [code]: bars[] } —— 日K缓存，避免重复 IPC
  const barsFailed = ref([]);    // 取不到日K的代码（如实披露，不静默丢弃）
  const scopedCode = ref("");    // 当前查看的股票（空 = 全库汇总）

  /**
   * 拉取历史信号。`code` 为空则取全库（跨股票汇总）。
   * 失败时保留旧数据并置 error（PROJECT.md §7.16：刷新失败不清空）。
   */
  async function loadSignals({ code = "", kind = "", limit = 500 } = {}) {
    loading.value = true;
    error.value = "";
    try {
      const rows = await invoke("get_signal_events", {
        code: code || null,
        kind: kind || null,
        limit,
      });
      events.value = Array.isArray(rows) ? rows : [];
      scopedCode.value = code || "";
      loadedAt.value = Date.now();
    } catch (e) {
      error.value = String(e?.message || e || "读取历史信号失败");
    } finally {
      loading.value = false;
    }
  }

  /** 取某只股票的日 K（本地库优先），带缓存 */
  async function ensureBars(code) {
    if (!code) return null;
    if (barsCache.value[code]) return barsCache.value[code];
    try {
      const bars = await invoke("get_kline_history", { code, period: "day", limit: 500 });
      const arr = Array.isArray(bars) ? bars : [];
      if (arr.length === 0) {
        if (!barsFailed.value.includes(code)) barsFailed.value = [...barsFailed.value, code];
        return null;
      }
      barsCache.value = { ...barsCache.value, [code]: arr };
      return arr;
    } catch {
      if (!barsFailed.value.includes(code)) barsFailed.value = [...barsFailed.value, code];
      return null;
    }
  }

  /** 为当前事件涉及的代码补齐日 K */
  async function ensureAllBars() {
    const codes = [...new Set(events.value.map((e) => e.code).filter(Boolean))];
    for (const c of codes) await ensureBars(c);
  }

  /**
   * 按持有期统计胜率。
   * 依赖 events 与 barsCache，故是 computed；调用前需先 await ensureAllBars()。
   */
  const statsByPeriod = computed(() => {
    const out = {};
    for (const p of HOLD_PERIODS) out[p] = summarizeSamples([]);
    if (events.value.length === 0) return out;

    const acc = {};
    for (const p of HOLD_PERIODS) acc[p] = [];

    for (const ev of events.value) {
      const bars = barsCache.value[ev.code];
      if (!bars) continue; // 无日K：已记入 barsFailed，单独披露
      const dir = inferDirection(ev.dir, ev.name);
      for (const p of HOLD_PERIODS) {
        const r = forwardReturn(ev, bars, p);
        if (!r.ok) continue; // 样本不足/无价格：不计入，避免用不完整数据充数
        acc[p].push({ dir, retPct: r.retPct });
      }
    }
    for (const p of HOLD_PERIODS) out[p] = summarizeSamples(acc[p]);
    return out;
  });

  /**
   * 事件总数与可统计样本数（用于如实披露「有多少条因为缺数据没算」）。
   *
   * 注意 `evaluable` 的口径：它只表示「价格齐备 **且** 拿到了该股日 K」，即**至少有可能**
   * 算出某个持有期的收益；它**不等于**任一具体持有期的 `judged`——信号若发生在日 K 末端，
   * 持有期越长越可能因「之后没有足够 K 线」被排除（`insufficient`），此时 `judged < evaluable`。
   * 因此 UI 必须把这两个数分开呈现，不能把 `evaluable` 说成「实际统计条数」；
   * 每个持有期真实参与统计的条数一律以 `statsByPeriod[p].judged` 为准。
   */
  const coverage = computed(() => {
    const total = events.value.length;
    const noPrice = events.value.filter((e) => !(Number(e.price) > 0)).length;
    const noBars = events.value.filter((e) => !barsCache.value[e.code]).length;
    const evaluable = total - noPrice - noBars;
    return {
      total,
      noPrice,
      noBars,
      evaluable: evaluable > 0 ? evaluable : 0,
      codes: new Set(events.value.map((e) => e.code)).size,
    };
  });

  /** 按信号名分组（回答「哪类信号历史上更靠谱」） */
  const byName = computed(() => {
    const groups = new Map();
    for (const ev of events.value) {
      const key = ev.name || "(未命名)";
      if (!groups.has(key)) {
        groups.set(key, { name: key, kind: ev.kind, dir: inferDirection(ev.dir, ev.name), count: 0, samples: [] });
      }
      const g = groups.get(key);
      g.count++;
      const bars = barsCache.value[ev.code];
      if (!bars) continue;
      const r = forwardReturn(ev, bars, 3); // 分组用 3 日口径（与回测面板默认一致）
      if (r.ok) g.samples.push({ dir: g.dir, retPct: r.retPct });
    }
    return [...groups.values()]
      .map((g) => ({ ...g, stats: summarizeSamples(g.samples) }))
      .sort((a, b) => b.count - a.count);
  });

  /** 按股票分组 */
  const byCode = computed(() => {
    const groups = new Map();
    for (const ev of events.value) {
      if (!groups.has(ev.code)) {
        groups.set(ev.code, { code: ev.code, count: 0, samples: [], lastDate: "" });
      }
      const g = groups.get(ev.code);
      g.count++;
      if (ev.date > g.lastDate) g.lastDate = ev.date;
      const bars = barsCache.value[ev.code];
      if (!bars) continue;
      const dir = inferDirection(ev.dir, ev.name);
      const r = forwardReturn(ev, bars, 3);
      if (r.ok) g.samples.push({ dir, retPct: r.retPct });
    }
    return [...groups.values()]
      .map((g) => ({ ...g, stats: summarizeSamples(g.samples) }))
      .sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
  });

  function reset() {
    events.value = [];
    barsCache.value = {};
    barsFailed.value = [];
    error.value = "";
    loadedAt.value = 0;
    scopedCode.value = "";
  }

  return {
    events, loading, error, loadedAt, scopedCode,
    barsCache, barsFailed,
    statsByPeriod, byName, byCode, coverage,
    loadSignals, ensureBars, ensureAllBars, reset,
  };
}
