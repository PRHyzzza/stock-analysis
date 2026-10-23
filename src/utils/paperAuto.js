/**
 * paperAuto — 模拟盘「每日定时自动选股 + 自动跑批」的纯逻辑
 *
 * 为什么单独一层：自动运行的判断全是时间/日期/集合运算，
 * 混进 composable 就只能靠真实时钟+真实网络才测得到。
 * 这里全部是纯函数（零 import、零副作用），`scripts/paper-auto.test.mjs` 直接锁死口径。
 *
 * 自动运行的三条硬前提（缺一不可，顺序即短路顺序）：
 *   1. 已启用，且至少有一条启用的问财策略语句
 *   2. 当天是交易日（A 股，判定只走 `utils/marketTime.js`，§7.15）
 *   3. 已过配置的运行时刻，且当天还没跑过
 *
 * 「每天向前累积」的兜底语义：应用没开时错过的那天不补跑，
 * 而是等下次真正运行时由 `runForward` 从 `lastRunDate` 之后把所有缺失交易日一次补齐
 * （引擎本身就是逐日累积的，所以这里不需要「补跑队列」）。
 */

/** 运行时刻默认值：收盘后 30 分钟。日 K 收盘价此时才稳定落库，
 *  早于收盘跑会拿到「当日还没收盘」的 K 线，等于用未来函数回填当天的开盘价。 */
export const DEFAULT_AUTO_CONFIG = Object.freeze({
  enabled: false,          // 默认关闭：自动改账户是有副作用的写操作，必须由用户显式打开
  time: "15:30",           // 每日运行时刻（本地时区 "HH:mm"）
  mode: "replace",         // 选股池更新方式："replace" 跟随策略（当日命中=当日池）| "merge" 只增不减
  strategies: [],          // [{ id, question, enabled }]
  perpage: 100,            // 每条策略取多少行（问财 perpage 上限 100）
  notify: true,            // 跑完是否发系统通知
});

/** 单条策略语句的长度上限（问财语句本身很短，超长几乎一定是误粘贴） */
const MAX_QUESTION_LEN = 120;
/** 最多保存多少条策略（防止 localStorage 被无界写入） */
const MAX_STRATEGIES = 10;

/** "HH:mm" → 当日分钟数；非法返回 null */
export function minutesOfDay(text) {
  const m = String(text ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 规范化 "HH:mm"：合法返回补零后的字符串，非法返回 "" */
export function normalizeTime(text) {
  const total = minutesOfDay(text);
  if (total == null) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 规范化单条策略；非法返回 null（由调用方过滤） */
export function normalizeStrategy(raw, index = 0) {
  const question = String(raw?.question ?? "").trim().slice(0, MAX_QUESTION_LEN);
  if (!question) return null;
  const id = String(raw?.id ?? "").trim() || `s${index + 1}`;
  return { id, question, enabled: raw?.enabled !== false };
}

/**
 * 规范化自动运行配置（localStorage 可能被旧版本/手工编辑写坏）
 * 以 DEFAULT_AUTO_CONFIG 为 schema：类型不符一律回退默认值。
 */
export function normalizeAutoConfig(raw) {
  const out = { ...DEFAULT_AUTO_CONFIG, strategies: [] };
  if (!raw || typeof raw !== "object") return out;

  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  if (typeof raw.notify === "boolean") out.notify = raw.notify;
  const t = normalizeTime(raw.time);
  if (t) out.time = t;
  if (raw.mode === "replace" || raw.mode === "merge") out.mode = raw.mode;

  const pp = Number(raw.perpage);
  if (Number.isFinite(pp)) out.perpage = Math.min(100, Math.max(1, Math.round(pp)));

  if (Array.isArray(raw.strategies)) {
    const seen = new Set();
    const list = [];
    for (const item of raw.strategies) {
      const s = normalizeStrategy(item, list.length);
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      list.push(s);
      if (list.length >= MAX_STRATEGIES) break;
    }
    out.strategies = list;
  }
  return out;
}

/** 启用的策略语句（去重后） */
export function activeStrategies(config) {
  const list = (config?.strategies || []).filter(
    // 空白语句必须过滤掉：本地存储可能被手工改坏，带着空语句打问财等于白跑一轮
    (s) => s && s.enabled !== false && String(s.question ?? "").trim()
  );
  const seen = new Set();
  return list.filter((s) => {
    const q = s.question.trim();
    if (seen.has(q)) return false;
    seen.add(q);
    return true;
  });
}

/**
 * 现在是否该自动跑一次
 *
 * @param {object} config normalizeAutoConfig 的结果
 * @param {{ now: Date, lastAutoDate: string, status: object }} ctx
 *   status 来自 `marketTime.getMarketStatus()`（A 股，不传 code）
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldRunAuto(config, ctx) {
  const cfg = config || DEFAULT_AUTO_CONFIG;
  const { now, lastAutoDate, status } = ctx || {};

  if (!cfg.enabled) return { run: false, reason: "未启用" };
  if (!activeStrategies(cfg).length) return { run: false, reason: "未配置问财策略" };
  if (!now || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    return { run: false, reason: "时刻无效" };
  }
  if (status && status.isTradingDay === false) {
    return { run: false, reason: status.holidayName ? `非交易日（${status.holidayName}）` : "非交易日" };
  }

  const target = minutesOfDay(cfg.time);
  if (target == null) return { run: false, reason: "运行时刻非法" };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < target) return { run: false, reason: `未到运行时刻（${cfg.time}）` };

  const today = status?.dateStr || localDate(now);
  if (lastAutoDate === today) return { run: false, reason: "今日已自动运行" };

  return { run: true, reason: `到达运行时刻（${cfg.time}）` };
}

/** Date → "YYYY-MM-DD"（本地时区；禁止 toISOString()，§7.13） */
export function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 把多条策略的命中合并成去重的候选列表
 *
 * @param {Array<{ strategyId: string, rows: Array<{code,name}> }>} results
 * @returns {Array<{ code: string, name: string, strategies: string[] }>}
 */
export function mergeStrategyHits(results) {
  const map = new Map();
  for (const item of results || []) {
    const sid = String(item?.strategyId ?? "");
    for (const row of item?.rows || []) {
      const code = String(row?.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) continue; // 模拟盘只做 A 股 6 位裸码
      const name = String(row?.name ?? "").trim();
      let hit = map.get(code);
      if (!hit) {
        hit = { code, name, strategies: [] };
        map.set(code, hit);
      } else if (!hit.name && name) {
        hit.name = name; // 先到的可能没有名称，后到的补上
      }
      if (sid && !hit.strategies.includes(sid)) hit.strategies.push(sid);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * 按模式计算新的选股池
 *
 * replace：当日命中即当日池（跟随策略，池会自动新陈代谢）
 * merge  ：只增不减（策略漏选时不会把还在持有逻辑里的票踢出池）
 *
 * 注意：两种模式都**不会退回空池覆盖**——hits 为空时原样返回旧池，
 * 因为「策略今天命中 0 只」和「问财今天挂了」在调用侧可能无法区分，
 * 拿空集合覆盖会让引擎把整个池当成池外（只卖不买），代价太大。
 *
 * @param {Array} hits mergeStrategyHits 的结果
 * @param {Array} existing 当前池
 * @param {{ mode: string, date: string }} opts
 * @returns {{ pool: Array, added: string[], removed: string[], skipped: boolean }}
 */
export function applyPoolMode(hits, existing, opts) {
  const mode = opts?.mode === "merge" ? "merge" : "replace";
  const date = String(opts?.date ?? "");
  const old = Array.isArray(existing) ? existing.filter((p) => p && p.code) : [];

  if (!hits || !hits.length) {
    return { pool: old, added: [], removed: [], skipped: true };
  }

  const oldCodes = new Set(old.map((p) => p.code));
  const newEntries = hits.map((h) => ({
    code: h.code,
    name: h.name || "",
    addedAt: date,
    source: "auto",
  }));

  if (mode === "replace") {
    const newCodes = new Set(newEntries.map((p) => p.code));
    return {
      pool: newEntries,
      added: newEntries.filter((p) => !oldCodes.has(p.code)).map((p) => p.code),
      removed: old.filter((p) => !newCodes.has(p.code)).map((p) => p.code),
      skipped: false,
    };
  }

  // merge：保留旧池原有顺序（追加语义），只补新增
  const fresh = newEntries.filter((p) => !oldCodes.has(p.code));
  return {
    pool: [...old, ...fresh],
    added: fresh.map((p) => p.code),
    removed: [],
    skipped: false,
  };
}

/** 结果文案（UI/通知共用，保证口径一致） */
export function describeAutoResult(res) {
  if (!res) return "";
  const parts = [];
  if (res.skipped) parts.push("策略无命中，选股池保持不变");
  else {
    parts.push(`池 ${res.poolSize ?? "—"} 只`);
    if (res.added?.length) parts.push(`新进 ${res.added.length}`);
    if (res.removed?.length) parts.push(`移出 ${res.removed.length}`);
  }
  if (res.days > 0) parts.push(`累积 ${res.days} 个交易日`);
  else if (res.upToDate) parts.push("无新交易日");
  if (res.failed?.length) parts.push(`${res.failed.length} 只取数失败`);
  return parts.join(" · ");
}
