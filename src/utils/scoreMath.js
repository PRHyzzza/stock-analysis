/**
 * scoreMath — 打分体系共用的数学工具（**纯函数**）
 *
 * 为什么单独成文件：`paperScore.js`（6 因子 + 风险扣分）与 `paperPatterns.js`（战法识别）
 * 曾经各写一份 `clamp` / `round1` / 分段插值 / ATR，改一处忘另一处就会让两套口径悄悄漂移。
 * 这里统一收口，两个模块都从这里 import。
 */

/** 夹在 [lo, hi]；非法值返回 lo */
export function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** 保留 1 位小数（排序需要区分度，整数会把大量标的压成同分） */
export function round1(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/**
 * 分段线性插值：给定折线控制点，返回 x 处的 y（两端按端点值截断）
 *
 * 控制点就是业务口径，所以曲线本身可解释；相邻档位之间连续，不会出现
 * 「差 0.1% 掉 10 分」的台阶。
 *
 * @param {number} x
 * @param {Array<[number, number]>} points 按 x 升序的 [x, y] 控制点
 */
export function curve(x, points) {
  const v = Number(x);
  if (!Number.isFinite(v) || !Array.isArray(points) || !points.length) return 0;
  if (v <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (v <= x1) {
      const [x0, y0] = points[i - 1];
      const t = x1 === x0 ? 0 : (v - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return points[points.length - 1][1];
}

/**
 * ATR（真实波幅均值）占价格百分比——波动/隔夜风险的统一代理
 * @returns {number|null} 不足 period+1 根返回 null
 */
export function atrPctOf(highs, lows, closes, i, period = 14) {
  if (!Array.isArray(closes) || i < period) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const prevClose = closes[k - 1];
    const tr = Math.max(
      Number(highs[k]) - Number(lows[k]),
      Math.abs(Number(highs[k]) - Number(prevClose)),
      Math.abs(Number(lows[k]) - Number(prevClose))
    );
    if (!Number.isFinite(tr)) return null;
    sum += tr;
  }
  const close = Number(closes[i]);
  if (!(close > 0)) return null;
  return ((sum / period) / close) * 100;
}
