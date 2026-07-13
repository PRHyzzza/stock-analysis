/**
 * useChipDistribution — 筹码峰计算 composable
 *
 * 从 K 线数据（OHLCV + volume）计算筹码分布。
 * 算法：将每根 K 线的成交量按三角形分布分配至价格区间，
 * 累积所有 K 线后归一化得出每个价格层级的筹码集中度。
 *
 * 返回数据结构：
 * {
 *   distribution: [{ price, ratio }, ...],  // 每个价格层级的筹码比例
 *   peakPrice: number,                        // 筹码峰价格（集中度最高）
 *   peakRatio: number,                        // 峰值集中度
 *   currentPrice: number,                     // 当前价
 *   costLevels: { COST5, COST15, COST50, COST85, COST95 },  // 分位成本
 *   avgCost: number,                          // 平均持仓成本
 * }
 */

/**
 * 纯函数：从 K 线数据计算筹码分布
 * @param {Array} klineData - K 线数据 [{ date, open, high, low, close, volume }]
 * @param {Object} options
 * @param {number} options.steps - 价格分段数（默认 60）
 * @param {number} options.smoothWindow - 平滑窗口（默认 3）
 * @returns {Object|null}
 */
export function calcChipDistribution(klineData, options = {}) {
  const { steps = 60, smoothWindow = 3 } = options;

  if (!klineData || klineData.length < 5) return null;

  // 取最近 N 根 K 线（筹码分布通常看最近 1-2 年）
  const maxBars = Math.min(480, klineData.length);
  const data = klineData.slice(-maxBars);

  // 找到价格范围
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const k of data) {
    if (k.low < minPrice) minPrice = k.low;
    if (k.high > maxPrice) maxPrice = k.high;
  }

  if (maxPrice - minPrice < 0.001) return null;

  // 添加边距（上下各 5%）
  const padding = (maxPrice - minPrice) * 0.05;
  minPrice -= padding;
  maxPrice += padding;

  const priceStep = (maxPrice - minPrice) / steps;
  const distribution = new Float64Array(steps);

  // ---- 对每根 K 线分配成交量 ----
  for (const k of data) {
    const { high, low, close, volume } = k;
    if (!volume || volume <= 0) continue;
    if (high - low < 0.001) continue;

    const lowIdx = Math.max(0, Math.min(steps - 1, Math.floor((low - minPrice) / priceStep)));
    const highIdx = Math.max(0, Math.min(steps - 1, Math.floor((high - minPrice) / priceStep)));
    const closeIdx = Math.max(0, Math.min(steps - 1, Math.floor((close - minPrice) / priceStep)));

    const range = highIdx - lowIdx;
    if (range === 0) {
      distribution[closeIdx] += volume;
      continue;
    }

    // 三角形分布：权重在收盘价附近最高，向两端递减
    const halfRange = Math.max(1, range / 2);
    let totalWeight = 0;
    const weights = [];

    for (let i = lowIdx; i <= highIdx; i++) {
      const dist = Math.abs(i - closeIdx) / halfRange;
      const weight = Math.max(0.1, 1 - dist * 0.45);
      weights.push(weight);
      totalWeight += weight;
    }

    // 按权重分配该 K 线的成交额（金额比手数更能反映资金沉淀）
    const turnover = k.turnover || volume * close;
    const allocValue = turnover > 0 ? turnover : volume;

    for (let i = 0; i < weights.length; i++) {
      distribution[lowIdx + i] += (weights[i] / totalWeight) * allocValue;
    }
  }

  // ---- 归一化 ----
  const total = distribution.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const raw = Array.from(distribution, (v, i) => ({
    price: +(minPrice + i * priceStep).toFixed(2),
    ratio: v / total,
  }));

  // ---- 平滑处理 ----
  const smoothed = raw.map((item, i) => {
    let sum = 0;
    let count = 0;
    const half = Math.floor(smoothWindow / 2);
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < raw.length) {
        sum += raw[j].ratio;
        count++;
      }
    }
    return { price: item.price, ratio: sum / count };
  });

  // ---- 查找峰值 ----
  let maxRatio = 0;
  let peakIdx = 0;
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i].ratio > maxRatio) {
      maxRatio = smoothed[i].ratio;
      peakIdx = i;
    }
  }

  // ---- 计算 COST 分位价格 ----
  const sorted = [...smoothed].sort((a, b) => a.price - b.price);
  let cumulative = 0;
  const costLevels = {};
  const costTargets = [5, 15, 50, 85, 95];
  let targetIdx = 0;

  for (const item of sorted) {
    cumulative += item.ratio;
    while (targetIdx < costTargets.length && cumulative >= costTargets[targetIdx] / 100) {
      costLevels[`COST${costTargets[targetIdx]}`] = item.price;
      targetIdx++;
    }
  }

  // ---- 计算平均成本（加权平均） ----
  let weightedSum = 0;
  let weightTotal = 0;
  for (const item of smoothed) {
    weightedSum += item.price * item.ratio;
    weightTotal += item.ratio;
  }
  const avgCost = weightTotal > 0 ? weightedSum / weightTotal : 0;

  return {
    distribution: smoothed,
    peakPrice: smoothed[peakIdx].price,
    peakRatio: maxRatio,
    currentPrice: data[data.length - 1].close,
    costLevels,
    avgCost: +avgCost.toFixed(2),
  };
}
