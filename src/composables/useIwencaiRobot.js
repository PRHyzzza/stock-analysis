/**
 * useIwencaiRobot — 问财自然语言选股（get-robot-data）
 *
 * 关键机制：问财接口需要 Cookie `v`（chameleon.js 本地生成）。
 * Tauri WebView 是真实浏览器环境，动态注入本地打包的 chameleon.js
 * 即可生成有效 v（已实测：浏览器生成 v + 长问句 → HTTP 200）。
 *
 * 流程：
 *   1. ensureV() — 注入 chameleon.js → 轮询 document.cookie 读取 v
 *      （v 有效期约 30 分钟，本地缓存 10 分钟避免重复注入）
 *   2. search(question, page) — 携带 v 调用 Rust 端 get_iwencai_robot
 */

import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

/** v cookie 缓存（值 + 时间戳），TTL 10 分钟 */
let vCache = { value: "", ts: 0 };
const V_TTL = 10 * 60 * 1000;

/** chameleon.js 注入幂等标记 */
let chameleonInjected = false;

/** 从 document.cookie 提取 v 值 */
function readVCookie() {
  const m = document.cookie.match(/(?:^|;\s*)v=([^;]+)/);
  return m ? m[1] : "";
}

/**
 * 确保 chameleon.js 已执行并返回有效 v
 * chameleon.js 加载后即开始轮询写入 v（~300ms 刷新一次）
 */
async function ensureV() {
  // 命中缓存直接用
  if (vCache.value && Date.now() - vCache.ts < V_TTL) return vCache.value;

  // 注入 chameleon.js（本地静态资源，CSP script-src 'self' 允许）
  if (!chameleonInjected) {
    const s = document.createElement("script");
    s.src = "/chameleon.js";
    s.async = true;
    document.head.appendChild(s);
    chameleonInjected = true;
  }

  // 轮询等待 v 出现（最多 8 秒）
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const v = readVCookie();
    if (v) {
      vCache = { value: v, ts: Date.now() };
      return v;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("无法获取问财验证凭证（v），请检查网络后重试");
}

/**
 * 重置 v 缓存与注入标记。
 * 下次 ensureV 会重新注入 chameleon.js 并读取最新 cookie（v 失效后调用）。
 */
function resetV() {
  vCache = { value: "", ts: 0 };
  chameleonInjected = false;
}

/** 判断错误是否为风控/限流（Nginx 403 或 -9138 业务码），此类错误换新 v 重试可恢复。
 *  Rust 端已对风控场景附加结构化标记 [RATE_LIMITED]，优先匹配标记；
 *  不再匹配裸 "v"（invoke 错误文案几乎总含字母 v，会导致误判并重置凭证缓存） */
function isRateLimited(msg) {
  return (
    msg.includes("RATE_LIMITED") ||
    msg.includes("403") ||
    msg.includes("forbidden") ||
    msg.includes("限流") ||
    msg.includes("-9138")
  );
}

/**
 * 问财自然语言选股
 * @returns {{ data, loading, error, search }}
 */
export function useIwencaiRobot() {
  const data = ref(null); // { columns, datas, condition, token, rowCount, question }
  const loading = ref(false);
  const error = ref("");
  const vError = ref(false); // v 获取失败标记（用于 UI 提示）

  let requestSeq = 0; // 竞态保护：只接受最后一次请求结果

  async function search(question, page = 1, perpage = 50) {
    if (!question || !question.trim()) return;
    const seq = ++requestSeq;
    loading.value = true;
    error.value = "";
    vError.value = false;
    try {
      let result;
      try {
        const v = await ensureV();
        if (seq !== requestSeq) return;
        result = await invoke("get_iwencai_robot", {
          question,
          page,
          perpage,
          v,
        });
      } catch (e) {
        const msg = String(e);
        // 风控 403：同一 v 连续请求多次会触发 Nginx 限流（实测约 4-6 次后 403），
        // 换新 v 立即恢复。重置凭证 + 短暂延迟后重试一次。
        if (isRateLimited(msg)) {
          resetV();
          await new Promise((r) => setTimeout(r, 1500));
          if (seq !== requestSeq) return;
          const v2 = await ensureV();
          if (seq !== requestSeq) return;
          result = await invoke("get_iwencai_robot", {
            question,
            page,
            perpage,
            v: v2,
          });
        } else {
          throw e;
        }
      }
      if (seq !== requestSeq) return;
      data.value = result;
    } catch (e) {
      if (seq !== requestSeq) return;
      const msg = String(e);
      if (msg.includes("验证凭证") || msg.includes("v")) {
        vError.value = true;
        // v 可能已过期：重置缓存，下次搜索重新注入 chameleon.js 生成新凭证
        resetV();
      }
      error.value = msg;
      data.value = null;
    } finally {
      if (seq === requestSeq) loading.value = false;
    }
  }

  return { data, loading, error, vError, search, warmV: ensureV };
}

/**
 * 从问财结果中提取关键信息
 * 真实结构：columns 为列定义，datas 为对象数组（每行是 中文列名 → 值 的 map）
 * @param {object} result — { columns, datas }
 * @returns {{ columns: Array<{label, key, name, unit, type}>, rows: Array<Record<string, any>> }}
 */
export function normalizeIwencaiResult(result) {
  if (!result?.columns || !result?.datas) return { columns: [], rows: [] };
  // 按列标识去重：问财偶发返回重复列（如同名条件出现两次），按 key 保首个
  const seen = new Set();
  const columns = result.columns.filter((col) => {
    const id = col.key ?? col.label ?? col.name;
    if (id == null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { columns, rows: result.datas };
}

/**
 * 从行数据中解析股票代码
 * 问财格式："股票代码": "301565.SZ"（带后缀），"code": "301565"（6 位纯数字）
 * @returns {{ code: string, market: string } | null}
 */
export function parseIwencaiCode(row) {
  // 优先取带后缀的 股票代码 字段，回退 6 位纯数字 code
  const raw = String(row["股票代码"] ?? row.code ?? "");
  if (!raw) return null;
  const clean = raw.trim();
  const m = clean.match(/^(\d{6})(?:\.(SH|SZ|BJ))?$/i);
  if (!m) return null;
  const code = m[1];
  const suffix = m[2] ? m[2].toUpperCase() : null;
  let market = suffix ? (suffix === "SH" ? "SH" : "SZ") : code.startsWith("6") ? "SH" : "SZ";
  if (suffix === "BJ") market = "BJ";
  return { code, market };
}
