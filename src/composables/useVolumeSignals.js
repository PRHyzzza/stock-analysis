/**
 * useVolumeSignals — 分时量价信号标注（整线扫描）
 *
 * 纯函数模块：逐分钟扫描分时数据，在价格×量能的关键事件点打标记，
 * 覆盖"放量上涨"这类常规量价信号（区别于 useTrapSignals 的诱多/诱空陷阱识别）。
 *
 * 信号类型（含方向语义）：
 *   偏多：放量↑ / 缩量回踩（均价上方缩量回调）/ 突破↑ / 底背离（新低无量）
 *   偏空：放量↓ / 缩量反抽（均价下方缩量反弹）/ 破位↓ / 顶背离（新高无量）
 *   警示：天量↑ / 天量↓（单分钟量 ≥4× 基准）
 *
 * 防标记爆炸：同一分钟只保留一个标记（按优先级：天量 > 放量 > 突破/破位 > 背离 > 缩量），
 * 同类型信号 10 分钟内只标首个；开盘前 15 分钟跳过（集合竞价/开盘噪声）。
 *
 * 输入：intradayData = { items: [{ time, price, avgPrice, volume, turnover, vwap }], preClose, date }
 * 输出：{ signals: [{ time, name, type, desc }], markers: [{ time, position, color, shape, text, size }] }
 */

function median(arr) {
  const s = arr.filter((v) => v > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function pct(a, b) {
  return a > 0 ? ((b - a) / a) * 100 : 0;
}

/** 标记外观：方向语义（红=涨/偏多，绿=跌/偏空，橙=天量，蓝=回踩，灰=反抽，橙红=顶背离，青=底背离） */
const MARKER_STYLE = {
  "放量↑": { color: "#e74c3c", shape: "circle", position: "aboveBar" },
  "放量↓": { color: "#27ae60", shape: "circle", position: "belowBar" },
  "天量↑": { color: "#f39c12", shape: "circle", position: "aboveBar" },
  "天量↓": { color: "#f39c12", shape: "circle", position: "belowBar" },
  "天量": { color: "#f39c12", shape: "circle", position: "aboveBar" },
  "缩量回踩": { color: "#3498db", shape: "circle", position: "belowBar" },
  "缩量反抽": { color: "#7f8c8d", shape: "circle", position: "aboveBar" },
  "突破↑": { color: "#e74c3c", shape: "arrowUp", position: "aboveBar" },
  "破位↓": { color: "#27ae60", shape: "arrowDown", position: "belowBar" },
  "顶背离": { color: "#e67e22", shape: "square", position: "aboveBar" },
  "底背离": { color: "#1abc9c", shape: "square", position: "belowBar" },
};

export function calcVolumeSignals(intradayData) {
  const signals = [];
  if (!intradayData?.items || intradayData.items.length < 30) {
    return { signals, markers: [] };
  }
  const items = intradayData.items;
  const N = items.length;
  const prices = items.map((i) => i.price);
  const volumes = items.map((i) => i.volume);
  const avgPrices = items.map((i) => (i.vwap > 0 ? i.vwap : i.avgPrice > 0 ? i.avgPrice : i.price));

  // 无量能数据时无法做量价判断
  if (mean(volumes) <= 0) return { signals, markers: [] };

  // 量能基准：全分量能中位数（对集合竞价异常量稳健）
  const volBase = median(volumes) || mean(volumes);
  /** 第 i 分钟量比 */
  const vr = (i) => (volBase > 0 ? volumes[i] / volBase : 0);
  /** [from, to] 区间平均量 */
  const meanVol = (from, to) => mean(volumes.slice(Math.max(0, from), Math.min(N, to + 1)));

  /** 距均价偏离（%，正=上方） */
  const distAvg = (i) => (avgPrices[i] > 0 ? pct(avgPrices[i], prices[i]) : 0);

  // 去重状态
  const seenAt = new Set(); // 同一分钟已打标记
  const lastAt = {}; // 同类型最近标记时间（10 分钟间隔去重）

  /**
   * 打标记（调用顺序即优先级：先调用的先占分钟）
   * @param {number} i 分钟索引
   * @param {string} name 信号名（须在 MARKER_STYLE 中）
   * @param {string} type bull | bear | neutral
   * @param {string} desc 描述
   */
  const add = (i, name, type, desc) => {
    if (i < 15 || i >= N) return; // 跳过开盘噪声
    if (seenAt.has(i)) return; // 同分钟只留一个
    if (lastAt[name] != null && i - lastAt[name] < 10) return; // 同类型间隔去重
    const style = MARKER_STYLE[name];
    if (!style) return;
    seenAt.add(i);
    lastAt[name] = i;
    signals.push({ time: items[i].time, name, type, desc });
  };

  for (let i = 10; i < N; i++) {
    const chg5 = pct(prices[Math.max(0, i - 5)], prices[i]);
    const v = vr(i);
    const da = distAvg(i);
    const hi5 = Math.max(...prices.slice(Math.max(0, i - 5), i + 1));
    const lo5 = Math.min(...prices.slice(Math.max(0, i - 5), i + 1));

    // 1. 天量（最高优先级）
    if (v >= 4) {
      // 方向明确才带箭头，横盘巨量标中性"天量"
      const name = chg5 <= -0.5 ? "天量↓" : chg5 >= 0.5 ? "天量↑" : "天量";
      add(i, name, "neutral", `${items[i].time} 单分钟量达基准 ${v.toFixed(1)} 倍${chg5 >= 0.5 ? "，价格上行" : chg5 <= -0.5 ? "，价格下行" : "，价格横盘"}，异动需警惕`);
      continue;
    }

    // 2. 放量上涨 / 放量下跌
    if (v >= 2) {
      if (chg5 >= 0.5) {
        add(i, "放量↑", "bull", `${items[i].time} 起 5 分钟上涨 ${chg5.toFixed(1)}%，量达基准 ${v.toFixed(1)} 倍，量价齐升`);
        continue;
      }
      if (chg5 <= -0.5) {
        add(i, "放量↓", "bear", `${items[i].time} 起 5 分钟下跌 ${(-chg5).toFixed(1)}%，量达基准 ${v.toFixed(1)} 倍，放量杀跌`);
        continue;
      }
    }

    // 3. 放量突破 / 破位（30 分钟前高/前低）
    if (i >= 30 && v >= 1.5) {
      const prevHigh = Math.max(...prices.slice(i - 30, i - 4));
      const prevLow = Math.min(...prices.slice(i - 30, i - 4));
      if (prices[i] > prevHigh && chg5 >= 0.3) {
        add(i, "突破↑", "bull", `${items[i].time} 放量突破 30 分钟前高 ${prevHigh.toFixed(2)}（量 ${v.toFixed(1)}×）`);
        continue;
      }
      if (prices[i] < prevLow && chg5 <= -0.3) {
        add(i, "破位↓", "bear", `${items[i].time} 放量跌破 30 分钟前低 ${prevLow.toFixed(2)}（量 ${v.toFixed(1)}×）`);
        continue;
      }
    }

    // 4. 量价背离：新高无量（顶背离）/ 新低无量（底背离）
    if (i >= 15) {
      const isLocalHigh = prices[i] >= hi5 && prices[i] > Math.max(...prices.slice(Math.max(0, i - 30), i - 5));
      if (isLocalHigh && meanVol(i - 4, i) < meanVol(i - 14, i - 5) * 0.7) {
        add(i, "顶背离", "bear", `${items[i].time} 创 30 分钟新高但量能萎缩（${(meanVol(i - 4, i) / volBase).toFixed(1)}× vs 前段 ${(meanVol(i - 14, i - 5) / volBase).toFixed(1)}×），上涨动能不足`);
        continue;
      }
      const isLocalLow = prices[i] <= lo5 && prices[i] < Math.min(...prices.slice(Math.max(0, i - 30), i - 5));
      if (isLocalLow && meanVol(i - 4, i) < meanVol(i - 14, i - 5) * 0.7) {
        add(i, "底背离", "bull", `${items[i].time} 创 30 分钟新低但量能萎缩（${(meanVol(i - 4, i) / volBase).toFixed(1)}× vs 前段 ${(meanVol(i - 14, i - 5) / volBase).toFixed(1)}×），抛压衰竭`);
        continue;
      }
    }

    // 5. 缩量回踩（均价上方缩量回调，洗盘特征）/ 缩量反抽（均价下方缩量反弹，弱反弹）
    if (v <= 0.5) {
      if (chg5 < 0 && da > 0.2) {
        add(i, "缩量回踩", "bull", `${items[i].time} 回调 ${(-chg5).toFixed(1)}% 但量仅基准 ${v.toFixed(1)} 倍，且价格仍在均价上方，洗盘概率大`);
      } else if (chg5 > 0 && da < -0.2) {
        add(i, "缩量反抽", "bear", `${items[i].time} 反弹 ${chg5.toFixed(1)}% 但量仅基准 ${v.toFixed(1)} 倍，且价格仍在均价下方，反弹乏力`);
      }
    }
  }

  // 生成标记（signals 已按优先级/去重排序）
  const markers = signals.map((s) => {
    const style = MARKER_STYLE[s.name];
    return {
      time: s.time,
      position: style.position,
      color: style.color,
      shape: style.shape,
      text: s.name,
      size: 1,
    };
  });

  return { signals, markers };
}
