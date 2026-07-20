/**
 * 支撑/阻力位计算模块（从 KlineChart.vue 拆分）
 * 纯函数，无 Vue 依赖
 */

/**
 * 聚类合并相近价格
 */
function cluster(prices, thresholdRatio = 0.005) {
  if (prices.length === 0) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const avg = clusters[clusters.length - 1].reduce((s, v) => s + v, 0) / clusters[clusters.length - 1].length;
    if (Math.abs(sorted[i] - avg) / avg <= thresholdRatio) {
      clusters[clusters.length - 1].push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }
  return clusters
    .map((c) => ({
      price: c.reduce((s, v) => s + v, 0) / c.length,
      strength: c.length,
    }))
    .sort((a, b) => b.strength - a.strength);
}

/**
 * 计算支撑与阻力位 — 波段高低点 + 聚类 + 斐波那契补充
 * @param {Array} candleData - K 线数据 [{ high, low, close }]
 * @returns {{ support: Array<{price, strength, fib?}>, resistance: Array<{price, strength, fib?}> }}
 */
export function calcSupportResistance(candleData) {
  if (candleData.length < 30) return { support: [], resistance: [] };

  const latestPrice = candleData[candleData.length - 1].close;
  const lookback = 3;

  // 1. 寻找波段高点/低点
  const swingHighs = [];
  const swingLows = [];

  for (let i = lookback; i < candleData.length - lookback; i++) {
    const seg = candleData.slice(i - lookback, i + lookback + 1);
    const maxHigh = Math.max(...seg.map((c) => c.high));
    const minLow = Math.min(...seg.map((c) => c.low));

    if (candleData[i].high === maxHigh) swingHighs.push(candleData[i].high);
    if (candleData[i].low === minLow) swingLows.push(candleData[i].low);
  }

  // 2. 聚类合并相近价格
  const resistanceClusters = cluster(swingHighs, 0.005);
  const supportClusters = cluster(swingLows, 0.005);

  const priceRange = latestPrice * 0.25;

  let topResistance = resistanceClusters
    .filter((r) => r.price >= latestPrice && r.price - latestPrice <= priceRange)
    .slice(0, 3)
    .sort((a, b) => a.price - b.price);

  let topSupport = supportClusters
    .filter((s) => s.price <= latestPrice && latestPrice - s.price <= priceRange)
    .slice(0, 3)
    .sort((a, b) => b.price - a.price);

  // 3. 斐波那契补充
  const total = topResistance.length + topSupport.length;
  if (total < 3) {
    const recent = candleData.slice(-60);
    const fibHigh = Math.max(...recent.map((c) => c.high));
    const fibLow = Math.min(...recent.map((c) => c.low));
    const diff = fibHigh - fibLow;

    if (diff > 0.001) {
      const fibRatios = [0.236, 0.382, 0.5, 0.618, 0.786];
      const fibLevels = fibRatios.map((r) => ({ price: fibHigh - diff * r, ratio: r }));

      const needR = Math.max(0, 3 - topResistance.length);
      const needS = Math.max(0, 3 - topSupport.length);

      const fibResistances = fibLevels
        .filter((f) => f.price > latestPrice)
        .sort((a, b) => a.price - b.price)
        .slice(0, needR)
        .map((f) => ({ price: f.price, strength: 0, fib: f.ratio }));

      const fibSupports = fibLevels
        .filter((f) => f.price < latestPrice)
        .sort((a, b) => b.price - a.price)
        .slice(0, needS)
        .map((f) => ({ price: f.price, strength: 0, fib: f.ratio }));

      topResistance = [...topResistance, ...fibResistances].slice(0, 3);
      topSupport = [...topSupport, ...fibSupports].slice(0, 3);
    }
  }

  return { support: topSupport, resistance: topResistance };
}
