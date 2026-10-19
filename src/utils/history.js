/**
 * 本地历史库写入 — Rust 端 db.rs 的落库旁路
 *
 * 全部为 fire-and-forget：非 Tauri 环境、库未初始化或写盘失败都只静默忽略，
 * 绝不影响调用方主流程（与后端 db::silent 的设计一致）。
 */
import { invoke } from "@tauri-apps/api/core";
import { num } from "./format.js";

/** 静默发送，忽略一切失败 */
function fire(cmd, args) {
  invoke(cmd, args).catch(() => {});
}

/** 已落库信号的方向别名 → 库口径（bull/bear） */
const DIR_ALIASES = {
  up: "bull", bull: "bull", "看涨": "bull", "多": "bull",
  down: "bear", bear: "bear", "看跌": "bear", "空": "bear",
};

/** `type` 回退映射表：`useVolumeSignals` 的 `type` 就是真实方向（bull/bear） */
const TYPE_DIR = { bull: "bull", bear: "bear" };

/**
 * 取信号方向（**不再**用中文正则猜，生产方必须显式传 dir）。
 *
 * 顺序：`dir`（支持 up/down 别名 → bull/bear）→ `type` 映射表。
 * `type` 回退是必需的：`useVolumeSignals` 只产出 `{time,name,type,desc,level}`，
 * `type` 就是真实方向；修复前把整句 `action`（如「追高风险极大…」）当方向落库，
 * 导致方向全部变成 unknown、胜率面板永远算不出。
 */
function pickDir(s) {
  const explicit = DIR_ALIASES[String(s?.dir ?? "").trim().toLowerCase()];
  if (explicit) return explicit;
  return TYPE_DIR[String(s?.type ?? "").trim().toLowerCase()] || "";
}

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

/** 北京时间的日期（YYYY-MM-DD，与后端 SQL `date('now','+8 hours')` 同口径） */
function beijingDay(now = Date.now()) {
  return new Date(now + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 清洗信号 → 待落库事件（纯函数，便于本地合成数据验证）。
 *
 * 缺 `name` 的信号跳过（前端约定：信号必须自带稳定 name）；**缺有效价格也跳过**——
 * `signal_event.price` 是 `REAL NOT NULL DEFAULT 0`，前端无法传 null，若把缺失写成 0，
 * 胜率面板会把它当无效样本（`no_price`）静默排除，且无法与「价格真的是 0」区分。
 *
 * @param {string} code 股票代码
 * @param {string} kind 来源分类，如 trap / volume / ma / t0
 * @param {Array<object>} signals 计算得到的信号数组（取 name/time/price/desc 等字段）
 */
export function buildSignalEvents(code, kind, signals) {
  if (!code || !Array.isArray(signals)) return [];
  const events = [];
  for (const s of signals) {
    const name = typeof s?.name === "string" ? s.name.trim() : "";
    if (!name) continue;
    const price = num(s?.price);
    if (price === null || price <= 0) continue;
    events.push({
      code,
      kind: kind || "",
      name,
      time: typeof s?.time === "string" ? s.time : "",
      dir: pickDir(s),
      detail: typeof s?.detail === "string" ? s.detail : (typeof s?.desc === "string" ? s.desc : ""),
      price,
    });
  }
  return events;
}

/**
 * 当日已记录过的信号键（跨 kind）。后端 UNIQUE 含 `kind`，同一分钟的同名信号会被
 * volume / trap 两条链路各写一行；这里在 JS 侧按 (code, name, time) 去重。
 * 日期变化时清空，集合规模 = 单日信号数（有界）。
 */
let seenDay = "";
let seenKeys = new Set();

/**
 * 落信号事件。后端按 (code, 日期, 类型, 名称, 时间锚点) 去重，重复调用是安全的。
 * @param {string} code 股票代码
 * @param {string} kind 来源分类，如 trap / volume / ma / t0
 * @param {Array<object>} signals 计算得到的信号数组（取 name/time/price/desc 等字段，缺失即跳过）
 */
export function recordSignalEvents(code, kind, signals) {
  const day = beijingDay();
  if (day !== seenDay) {
    seenDay = day;
    seenKeys = new Set();
  }
  const events = buildSignalEvents(code, kind, signals).filter((e) => {
    const key = `${e.code}|${e.name}|${e.time}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  if (events.length === 0) return;
  fire("record_signal_events", { events });
}

/**
 * 落提醒事件（通知成功发送后调用；后端不去重，同一提醒多次触发都会记录）
 * @param {{code:string,kind:string,title?:string,body?:string,price?:number,target?:number}} meta
 */
export function recordAlertEvent(meta) {
  const code = meta?.code;
  if (!code) return;
  const message = [meta.title, meta.body].filter(Boolean).join(" ");
  fire("record_alert_events", {
    events: [
      {
        code,
        kind: meta.kind || "",
        message,
        price: Number(meta.price) || 0,
        target: Number(meta.target) || 0,
      },
    ],
  });
}

/**
 * 落自选变更
 * @param {"add"|"remove"} action
 * @param {string} code
 * @param {string} [name]
 */
export function recordWatchlistChange(action, code, name = "") {
  if (!action || !code) return;
  fire("record_watchlist_change", { action, code, name: name || "" });
}
