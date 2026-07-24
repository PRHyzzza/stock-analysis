import { ref } from 'vue'

/**
 * useT0Signals — 日内 T+0 交易信号系统（基于分时数据 + 日K趋势）
 *
 * 输入：
 *   - klineData: 日K数据（用于判断日线趋势、MA5、MACD背离等）
 *   - intradayData: 分时数据 { items: [{ time, price, avgPrice, volume, turnover, vwap }, ...], preClose, date }
 *
 * 输出：
 *   - signalMarkers: 分时图标记数组
 *   - summary: 综合信号摘要
 */

// ---- 工具函数 ----

function sma(arr, period) {
  const result = []
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += arr[j]
    result.push(sum / period)
  }
  return result
}

function ema(data, period) {
  const result = []
  const k = 2 / (period + 1)
  let prev = data[0]
  result.push(prev)
  for (let i = 1; i < data.length; i++) {
    const val = data[i] * k + prev * (1 - k)
    result.push(val)
    prev = val
  }
  return result
}

function calcMACD(closePrices) {
  if (closePrices.length < 26) return []
  const ema12 = ema(closePrices, 12)
  const ema26 = ema(closePrices, 26)
  const dif = ema12.map((v, i) => v - ema26[i])
  const dea = ema(dif, 9)
  return dif.map((v, i) => ({ dif: v, dea: dea[i], macd: 2 * (v - dea[i]) }))
}

function slope(arr, n = 5) {
  if (arr.length < n) return 0
  const vs = arr.slice(-n).filter(v => v !== null)
  if (vs.length < n) return 0
  const xs = Array.from({ length: n }, (_, i) => i)
  const xMean = (n - 1) / 2
  const yMean = vs.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - xMean) * (vs[i] - yMean); den += (xs[i] - xMean) ** 2 }
  return den === 0 ? 0 : num / den
}

/** 找局部峰值：值大于左右各 window 个邻居 */
function findLocalPeaks(arr, from, to, window = 3) {
  const peaks = []
  for (let i = from + window; i <= to - window; i++) {
    let isPeak = true
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && arr[j] >= arr[i]) { isPeak = false; break }
    }
    if (isPeak) peaks.push(i)
  }
  return peaks
}

/** 找局部谷值：值小于左右各 window 个邻居 */
function findLocalValleys(arr, from, to, window = 3) {
  const valleys = []
  for (let i = from + window; i <= to - window; i++) {
    let isValley = true
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && arr[j] <= arr[i]) { isValley = false; break }
    }
    if (isValley) valleys.push(i)
  }
  return valleys
}

// ---- 主入口 ----

export function useT0Signals() {
  const signalMarkers = ref([])
  const summary = ref(null)

  /**
   * @param {Array} klineData - 日K 数组
   * @param {Object} intradayData - 分时数据对象
   */
  function compute(klineData, intradayData) {
    signalMarkers.value = []
    summary.value = null

    if (!intradayData?.items || intradayData.items.length === 0) return

    const items = intradayData.items
    const preClose = intradayData.preClose || 0
    const N = items.length

    // ======== 日K趋势 ========
    let trendDir = 'sideways'
    let ma5 = null, ma10 = null

    if (klineData && klineData.length >= 10) {
      const closes = klineData.map(k => k.close)
      const ma5Arr = sma(closes, 5)
      const ma10Arr = sma(closes, 10)
      ma5 = ma5Arr[ma5Arr.length - 1]
      ma10 = ma10Arr[ma10Arr.length - 1]
      const ma5Slope = slope(ma5Arr, 5)
      // 归一化：用相对百分比（% / 天）替代绝对值，适配不同股价
      const ma5SlopePct = ma5 > 0 ? (ma5Slope / ma5) * 100 : 0
      trendDir = ma5SlopePct > 0.05 ? 'up' : ma5SlopePct < -0.05 ? 'down' : 'sideways'
    }

    // ======== 分时数据提取 ========
    const prices = items.map(it => it.price)
    const volumes = items.map(it => it.volume)

    // 均价：优先 VWAP → avgPrice → 手算
    const avgPrices = items.map(it => {
      if (it.vwap > 0) return it.vwap
      if (it.avgPrice > 0) return it.avgPrice
      if (it.volume > 0 && it.turnover > 0) {
        const ap = it.turnover / (it.volume * 100)
        return (ap > it.price * 0.5 && ap < it.price * 1.5) ? ap : it.price
      }
      return it.price
    })

    const curPrice = prices[N - 1]
    const curAvgPrice = avgPrices[N - 1]

    // 日内高低
    const intradayHigh = Math.max(...prices)
    const intradayLow = Math.min(...prices)
    const highIdx = prices.indexOf(intradayHigh)
    const lowIdx = prices.indexOf(intradayLow)

    // 今开 = 第一分钟价格
    const todayOpen = prices[0]

    // 日内涨跌幅（相对昨收）
    const changePct = preClose > 0 ? ((curPrice - preClose) / preClose) * 100 : 0

    // ======== 分时均线偏离 ========
    const distFromAvg = curAvgPrice > 0 ? ((curPrice - curAvgPrice) / curAvgPrice) * 100 : 0

    // ======== 日内相对量比（近5分钟 vs 前半段均值，非标准量比） ========
    const halfN = Math.max(1, Math.floor(N / 2))
    const firstHalfAvgVol = volumes.slice(0, halfN).reduce((a, b) => a + b, 0) / halfN
    const recent5AvgVol = volumes.slice(-Math.min(5, N)).reduce((a, b) => a + b, 0) / Math.min(5, N)
    const intraVolRatio = firstHalfAvgVol > 0 ? recent5AvgVol / firstHalfAvgVol : 1

    // ======== MACD 背离（基于日K） ========
    let macdState = null, topDivergence = false, bottomDivergence = false

    if (klineData && klineData.length >= 35) {
      const kCloses = klineData.map(k => k.close)
      const kHighs = klineData.map(k => k.high)
      const kLows = klineData.map(k => k.low)
      const macdArr = calcMACD(kCloses)
      const K = klineData.length

      if (macdArr.length >= 30) {
        const lb = Math.min(20, K - 1)
        const start = K - lb

        // 顶背离：最近两个局部峰值，股价更高但 DIF 更低
        const peaks = findLocalPeaks(kHighs, start, K - 1)
        if (peaks.length >= 2) {
          const p1 = peaks[peaks.length - 2]
          const p2 = peaks[peaks.length - 1]
          if (kHighs[p2] > kHighs[p1] &&
              macdArr[p2] && macdArr[p1] && macdArr[p2].dif < macdArr[p1].dif) {
            topDivergence = true
          }
        }

        // 底背离：最近两个局部谷值，股价更低但 DIF 更高
        const valleys = findLocalValleys(kLows, start, K - 1)
        if (valleys.length >= 2) {
          const v1 = valleys[valleys.length - 2]
          const v2 = valleys[valleys.length - 1]
          if (kLows[v2] < kLows[v1] &&
              macdArr[v2] && macdArr[v1] && macdArr[v2].dif > macdArr[v1].dif) {
            bottomDivergence = true
          }
        }
      }

      const li = macdArr.length - 1
      if (macdArr[li]) {
        const cur = macdArr[li], prv = macdArr[li - 1]
        macdState = {
          dif: cur.dif, dea: cur.dea, macd: cur.macd,
          difTrend: prv ? (cur.dif > prv.dif ? 'up' : 'down') : 'flat',
          histogramTrend: prv ? (cur.macd > prv.macd ? 'up' : 'down') : 'flat',
          position: cur.dif > 0 ? 'aboveZero' : 'belowZero',
        }
      }
    }

    // ======== 信号检测 ========
    const signalList = []

    // 1. 价格 vs 均价偏离
    if (curAvgPrice > 0) {
      if (distFromAvg > 3) {
        signalList.push({
          name: '急拉远离均价',
          desc: `当前价偏离均价 ${distFromAvg.toFixed(1)}%（>3%），易回落`,
          action: '有底仓可考虑高抛做反T，不宜追高',
        })
      } else if (distFromAvg < -3) {
        signalList.push({
          name: '急跌远离均价',
          desc: `当前价偏离均价 ${distFromAvg.toFixed(1)}%（<-3%），易反抽`,
          action: '不宜恐慌杀跌，可关注反抽做反T回补机会',
        })
      }

      // 回踩均价（上升趋势中）— 使用各时刻对应的均价
      if (trendDir === 'up' && distFromAvg > -0.5 && distFromAvg < 0.5 &&
          prices.slice(-10).some((p, i) => {
            const aIdx = N - 10 + i
            const ap = avgPrices[aIdx]
            return ap > 0 && (p - ap) / ap > 0.5
          })) {
        signalList.push({
          name: '回踩均价不破',
          desc: `当前价 ${curPrice.toFixed(2)} 回踩均价 ${curAvgPrice.toFixed(2)} 获支撑`,
          action: '上升趋势 + 回踩均价 → 正T低吸观察点，仓位不超过底仓 50%',
        })
      }

      // 反弹均价（下降趋势中）— 使用各时刻对应的均价
      if (trendDir === 'down' && distFromAvg > -0.5 && distFromAvg < 0.5 &&
          prices.slice(-10).some((p, i) => {
            const aIdx = N - 10 + i
            const ap = avgPrices[aIdx]
            return ap > 0 && (ap - p) / ap > 0.5
          })) {
        signalList.push({
          name: '反弹均价受阻',
          desc: `当前价 ${curPrice.toFixed(2)} 反弹至均价 ${curAvgPrice.toFixed(2)} 遇阻`,
          action: '下降趋势 + 反弹均价受阻 → 反T高抛观察点',
        })
      }
    }

    // 2. 量能异常
    if (intraVolRatio > 2.0) {
      const chg = curPrice - (prices[Math.max(0, N - 6)] || curPrice)
      signalList.push({
        name: '分时放量异动',
        desc: `近5分钟量能为前半段 ${intraVolRatio.toFixed(1)} 倍`,
        action: chg >= 0
          ? '放量急拉 → 日内高点概率大，适合高抛做反T'
          : '放量急跌 → 恐慌抛售中，不宜急于接回',
      })
    }

    if (intraVolRatio < 0.4 && N > 30) {
      signalList.push({
        name: '分时极度缩量',
        desc: `近5分钟量能仅为前半段 ${(intraVolRatio * 100).toFixed(0)}%`,
        action: '缩量窄幅整理，低吸安全度较高，可等待方向选择',
      })
    }

    // 3. 日内涨跌幅极端情况
    if (changePct > 7) {
      signalList.push({
        name: '接近涨停',
        desc: `当日涨幅 ${changePct.toFixed(1)}%，接近涨停板`,
        action: '追高风险极大，不宜做正T买入；有底仓可考虑高抛做反T',
      })
    } else if (changePct < -7) {
      signalList.push({
        name: '接近跌停',
        desc: `当日跌幅 ${changePct.toFixed(1)}%，接近跌停板`,
        action: '恐慌杀跌风险大，不宜做反T卖出；企稳后可关注正T低吸',
      })
    }

    // 4. MACD 背离
    if (topDivergence) {
      signalList.push({
        name: '日K MACD 顶背离',
        desc: '股价创近期新高但 DIF 未跟进，上涨动能减弱',
        action: '高位注意回调风险，可考虑分批高抛',
      })
    }
    if (bottomDivergence) {
      signalList.push({
        name: '日K MACD 底背离',
        desc: '股价创近期新低但 DIF 未跟进，下跌动能减弱',
        action: '关注超跌反弹机会，可考虑分批低吸',
      })
    }

    // ======== 方向判断 ========
    let direction = '观望'
    const directionReason = []

    // 日内极端涨跌覆盖趋势判断
    if (changePct > 7) {
      direction = '反T为主'
      directionReason.push(`日内大涨 ${changePct.toFixed(1)}%，接近涨停 → 不宜追高，偏反T高抛`)
    } else if (changePct < -7) {
      direction = '正T为主'
      directionReason.push(`日内大跌 ${changePct.toFixed(1)}%，接近跌停 → 不宜杀跌，偏正T低吸`)
    } else if (trendDir === 'up') {
      direction = '正T为主'
      directionReason.push('日线 MA5 向上，上升趋势')
      if (distFromAvg > 0 && distFromAvg < 1.5) directionReason.push('股价在均价上方，回踩均价不破为低吸点')
    } else if (trendDir === 'down') {
      direction = '反T为主'
      directionReason.push('日线 MA5 向下，下降趋势')
      if (distFromAvg < 0 && distFromAvg > -1.5) directionReason.push('股价在均价下方，反弹均价受阻为高抛点')
    } else {
      direction = '观望'
      directionReason.push('日线 MA5 走平，横盘震荡')
    }

    // ======== 目标与止损 ========
    const targets = [], stops = []

    if (direction === '正T为主') {
      targets.push(`反弹至均价 ${curAvgPrice?.toFixed(2)} 或日内高 ${intradayHigh.toFixed(2)} 附近高抛`)
      targets.push('放量急拉至偏离均价 3%+ 时止盈')
      stops.push(`跌破均价 ${curAvgPrice?.toFixed(2)} 且反抽不上 → 止损`)
      stops.push(`跌破日内低点 ${intradayLow.toFixed(2)} → 止损`)
    } else if (direction === '反T为主') {
      targets.push(`回落至均价 ${curAvgPrice?.toFixed(2)} 或日内低 ${intradayLow.toFixed(2)} 附近回补`)
      targets.push('缩量企稳后择机接回')
      stops.push(`突破均价 ${curAvgPrice?.toFixed(2)} 并站稳 → 止损回补`)
      stops.push(`突破日内高点 ${intradayHigh.toFixed(2)} → 止损回补`)
    } else {
      targets.push('等待趋势明朗')
      stops.push('观望不操作')
    }

    // ======== 风险提示 ========
    const risks = []
    if (trendDir === 'sideways') risks.push('横盘震荡，差价空间缩小，假突破概率高')
    if (topDivergence && direction === '正T为主') risks.push('顶背离+上升趋势，追高需谨慎')
    if (bottomDivergence && direction === '反T为主') risks.push('底背离+下降趋势，杀跌需谨慎')
    if (intraVolRatio > 2) risks.push('分时放量明显，警惕主力对倒出货')
    if (intraVolRatio < 0.3 && N > 30) risks.push('极度缩量，流动性可能影响 T+0 执行')
    if (N < 30) risks.push('开盘数据量不足，信号可靠性低')
    if (changePct > 9) risks.push('已逼近涨停板，追涨挂单可能成交后回落')
    if (changePct < -9) risks.push('已逼近跌停板，明日可能继续低开')
    risks.push('A 股 T+1 制度，做T需依托底仓，分析仅供参考')

    // ======== 图表标记 ========
    const markers = []
    if (curAvgPrice > 0 && distFromAvg > 3 && N > 0) {
      markers.push({
        time: items[N - 1].time, position: 'aboveBar',
        color: '#e74c3c', shape: 'arrowDown', text: '偏离>3%', size: 2,
      })
    }
    if (curAvgPrice > 0 && distFromAvg < -3 && N > 0) {
      markers.push({
        time: items[N - 1].time, position: 'belowBar',
        color: '#27ae60', shape: 'arrowUp', text: '偏离<-3%', size: 2,
      })
    }
    signalMarkers.value = markers

    summary.value = {
      direction, directionReason: directionReason.join('；'),
      hasSignal: signalList.length > 0, signals: signalList,
      targets, stops, risks,
      raw: {
        price: curPrice, avgPrice: curAvgPrice, todayOpen, preClose,
        intradayHigh, intradayLow,
        highTime: items[highIdx]?.time, lowTime: items[lowIdx]?.time,
        distFromAvg: distFromAvg.toFixed(2),
        volRatio: intraVolRatio.toFixed(2),
        trend: trendDir === 'up' ? '上升' : trendDir === 'down' ? '下降' : '横盘',
        changePct: changePct.toFixed(2),
        ma5, ma10, macdState, dataPoints: N,
      },
    }
  }

  return { signalMarkers, summary, compute }
}
