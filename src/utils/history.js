/**
 * 本地历史库写入 — Rust 端 db.rs 的落库旁路
 *
 * 全部为 fire-and-forget：非 Tauri 环境、库未初始化或写盘失败都只静默忽略，
 * 绝不影响调用方主流程（与后端 db::silent 的设计一致）。
 */
import { invoke } from "@tauri-apps/api/core";

/** 静默发送，忽略一切失败 */
function fire(cmd, args) {
  invoke(cmd, args).catch(() => {});
}

/**
 * 落信号事件。后端按 (code, 日期, 类型, 名称, 时间锚点) 去重，重复调用是安全的。
 * @param {string} code 股票代码
 * @param {string} kind 来源分类，如 trap / volume / ma / t0
 * @param {Array<object>} signals 计算得到的信号数组（取 name/time/desc/action 等字段，缺失即留空）
 */
export function recordSignalEvents(code, kind, signals) {
  if (!code || !Array.isArray(signals) || signals.length === 0) return;
  const events = [];
  for (const s of signals) {
    const name = typeof s?.name === "string" ? s.name.trim() : "";
    if (!name) continue;
    events.push({
      code,
      kind: kind || "",
      name,
      time: typeof s?.time === "string" ? s.time : "",
      dir: pickDir(s),
      detail: typeof s?.detail === "string" ? s.detail : (typeof s?.desc === "string" ? s.desc : ""),
      price: Number(s?.price) || 0,
    });
  }
  if (events.length === 0) return;
  fire("record_signal_events", { events });
}

/**
 * 取信号方向：dir → action → type。
 *
 * `type` 回退是必需的：`useVolumeSignals` 只产出 `{time,name,type,desc,level}`，
 * 其中 `type` 就是真实方向（bull/bear），没有 dir/action；`useT0Signals.js:499`
 * 透传的 volumeSignals 也只有 time/name/type。修复前只认 dir → action，导致
 * `放量急拉⚠` / `放量急跌⚠` / `无量拉升⚠` 三个 `level="warn"` 的前瞻预警方向被
 * 静默丢弃，落库 `dir=""` → 计入 unknownDir → 永远进不了胜率。实测（用真实
 * `calcVolumeSignals` + 真实 `recordSignalEvents`，见修复期临时探针）：
 * volume 链路 unknown 3/7 → 修复后 0/7；`突破↑`/`破位↓`/`顶背离`/`底背离`
 * 仅因名称含关键词才侥幸救回，不能依赖。
 *
 * 安全性：两条落库链路的形状互斥——trap 链路（`useT0Signals.js:359`）产出的是
 * `action` + `trapType`，**没有** `type` 字段，所以这里不会误把 trapType 当方向；
 * 且 volume 链路的 `type` 实测恒为 bull/bear（JSDoc 虽允许 neutral，但无调用点使用）。
 * 若将来有信号同时带 `type` 与非方向语义，须改为按 kind 区分而非继续依赖回退顺序。
 */
function pickDir(s) {
  for (const v of [s?.dir, s?.action, s?.type]) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "";
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
