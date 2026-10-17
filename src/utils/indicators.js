/**
 * 技术指标基础函数 — 单一实现，供 useTechIndicators / useT0Signals / 回测共用
 *
 * 为什么集中：此前 `useTechIndicators.js` 与 `useT0Signals.js` 各有一份 EMA，
 * 且都以 `data[0]` 作为种子（首值权重异常、无预热期），MACD 背离与均线判断因此偏移。
 *
 * 口径约定：
 * - `sma` / `ema` 返回与输入等长的数组，未进入有效区间的位置为 `null`（不做假值填充）
 * - `ema` 以前 `period` 根的 SMA 作为种子，第 `period-1` 位为第一个有效值
 * - `emaFilled` 是兼容旧调用方的全长度数值版本（有效区前用可得均值填充）
 */

/** 简单移动平均；不足 period 根时为 null */
export function sma(values, period) {
  const src = Array.isArray(values) ? values : [];
  const out = new Array(src.length).fill(null);
  if (!(period > 0)) return out;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const v = Number(src[i]);
    if (!Number.isFinite(v)) return out; // 含非法值直接放弃，避免静默偏移
    sum += v;
    if (i >= period) sum -= Number(src[i - period]);
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均；以 SMA(period) 为种子，之前为 null */
export function ema(values, period) {
  const src = Array.isArray(values) ? values : [];
  const out = new Array(src.length).fill(null);
  if (!(period > 0) || src.length < period) return out;
  const seed = sma(src.slice(0, period), period)[period - 1];
  if (seed === null) return out;
  const k = 2 / (period + 1);
  out[period - 1] = seed;
  for (let i = period; i < src.length; i++) {
    const v = Number(src[i]);
    if (!Number.isFinite(v)) break;
    out[i] = v * k + out[i - 1] * (1 - k);
  }
  return out;
}

/**
 * 全长度数值版 EMA（兼容旧消费方）：有效区前用逐段扩大的均值填充
 * @returns {number[]} 与输入等长，元素均为数字
 */
export function emaFilled(values, period) {
  const src = Array.isArray(values) ? values : [];
  const full = ema(src, period);
  const out = new Array(src.length).fill(0);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const v = Number(src[i]);
    const safe = Number.isFinite(v) ? v : 0;
    sum += safe;
    if (full[i] !== null) out[i] = full[i];
    else out[i] = sum / (i + 1); // 预热段：可得的简单均值
  }
  return out;
}

/**
 * MACD（12/26/9）
 * @param {number[]} closes 收盘价序列（按时间正序）
 * @returns {{ dif: number[], dea: number[], hist: number[], validFrom: number }}
 *   `dif`/`dea`/`hist` 与输入等长且全为数值；`validFrom` 之前的值为预热态，不可用于信号判定
 */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const src = Array.isArray(closes) ? closes : [];
  const emaFast = emaFilled(src, fast);
  const emaSlow = emaFilled(src, slow);
  const dif = src.map((_, i) => emaFast[i] - emaSlow[i]);
  const dea = emaFilled(dif, signal);
  const hist = dif.map((v, i) => (v - dea[i]) * 2);
  const validFrom = Math.max(fast, slow) + signal - 2;
  return { dif, dea, hist, validFrom };
}
