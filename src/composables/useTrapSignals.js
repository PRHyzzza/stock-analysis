/**
 * useTrapSignals — 分时量价陷阱识别（诱多 / 诱空）
 *
 * 纯函数模块：基于分时数据（价格 × 量能）检测日内"诱多/诱空"嫌疑。
 * "诱"是前瞻性判断（陷阱是否成立需后续走势确认），因此每个信号都附带
 * 强度分级与确认条件，输出为"嫌疑 + 确认信号"，不输出确定性结论。
 *
 * 检测规则：
 *   诱多（bull trap，红↓）：放量冲高回落 / 高位放量滞涨 / 尾盘无量急拉 / 高开冲高破均价
 *   诱空（bear trap，绿↑）：放量急跌后收复 / 低位放量反转 / 尾盘放量急砸（低位）
 *
 * 输入：intradayData = { items: [{ time, price, avgPrice, volume, turnover, vwap }], preClose, date }
 * 输出：{ traps: [{ type, name, time, price, severity, desc, action, confirm }], markers: [...] }
 */

/** 中位数（过滤异常量，对开收盘集合竞价噪声稳健） */
function median(arr) {
  const s = arr.filter((v) => v > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/** 百分比变动 a→b */
function pct(a, b) {
  return a > 0 ? ((b - a) / a) * 100 : 0;
}

/** 在已排序索引数组中找 i 之前的最近一个 */
function nearestBefore(arr, i) {
  for (let k = arr.length - 1; k >= 0; k--) {
    if (arr[k] < i) return arr[k];
  }
  return null;
}

/** 在已排序索引数组中找 i 之后的最近一个 */
function nearestAfter(arr, i) {
  for (let k = 0; k < arr.length; k++) {
    if (arr[k] > i) return arr[k];
  }
  return null;
}

export function calcTrapSignals(intradayData) {
  const traps = [];
  const markers = [];

  if (!intradayData?.items || intradayData.items.length < 30) {
    return { traps, markers };
  }
  const items = intradayData.items;
  const N = items.length;
  const prices = items.map((i) => i.price);
  const volumes = items.map((i) => i.volume);
  const avgPrices = items.map((i) => (i.vwap > 0 ? i.vwap : i.avgPrice > 0 ? i.avgPrice : i.price));
  const preClose = intradayData.preClose || 0;

  // 无任何量能数据时无法做量价判断，全部跳过
  if (mean(volumes) <= 0) return { traps, markers };

  // 量能基准：全分量能中位数（稳健），异常时退化为均值
  const volBase = median(volumes) || mean(volumes);
  /** 截至索引 i 的前 w 分钟平均量 / 基准 */
  const vRatio = (i, w) => {
    const s = volumes.slice(Math.max(0, i - w + 1), i + 1);
    const m = mean(s);
    return volBase > 0 ? m / volBase : 1;
  };

  // 局部极值（带最小波动幅度约束）：窗口 ±W，突出度（相对窗口内最值）≥0.5% 才算有效摆动点。
  // 纯严格比较在"平台期"（连续同价）会失效——平坦段既非峰也非谷，摆动起点会丢失；
  // 突出度约束天然跳过盘整平台，只保留真实摆动
  const W = 5;
  const MIN_MOVE = 0.005;
  const peaks = [];
  const valleys = [];
  for (let i = W; i < N - W; i++) {
    const p = prices[i];
    let isMax = true;
    let isMin = true;
    for (let j = i - W; j <= i + W; j++) {
      if (j === i) continue;
      if (prices[j] > p) isMax = false;
      if (prices[j] < p) isMin = false;
    }
    if (isMax) {
      const lo = Math.min(...prices.slice(i - W, i + W + 1));
      if ((p - lo) / p >= MIN_MOVE) peaks.push(i);
    }
    if (isMin) {
      const hi = Math.max(...prices.slice(i - W, i + W + 1));
      if ((hi - p) / p >= MIN_MOVE) valleys.push(i);
    }
  }

  const addTrap = (t) => {
    // 同名称同时间去重
    if (traps.some((x) => x.name === t.name && x.time === t.time)) return;
    traps.push(t);
    markers.push({
      time: t.time,
      position: t.type === "bull" ? "aboveBar" : "belowBar",
      color: t.type === "bull" ? "#e74c3c" : "#27ae60",
      shape: t.type === "bull" ? "arrowDown" : "arrowUp",
      text: t.type === "bull" ? "诱多⚠" : "诱空⚠",
      size: t.severity === "强" ? 2 : 1,
    });
  };

  const intradayHigh = Math.max(...prices);
  const intradayLow = Math.min(...prices);
  const highIdx = prices.indexOf(intradayHigh);
  const lowIdx = prices.indexOf(intradayLow);

  // ═══ A. 放量冲高回落（诱多）═══
  for (const p of peaks) {
    if (p < 12 || p > N - 8) continue; // 跳过开盘噪声与未完成的摆动
    const pv = nearestBefore(valleys, p);
    const nv = nearestAfter(valleys, p);
    if (pv == null || nv == null || p - pv > 40 || nv - p > 40) continue;
    const rise = pct(prices[pv], prices[p]);
    const drop = pct(prices[p], prices[nv]);
    if (rise < 1.2 || drop > -0.15) continue; // 有像样的拉升，且已回落
    const volRise = vRatio(p, p - pv + 1);
    if (volRise < 1.5) continue; // 拉升必须放量
    if (-drop < 0.5 * rise) continue; // 回落不足拉升一半，不构成陷阱
    const backPct = pct(prices[pv], prices[nv]);
    const confirmed = backPct <= 0 || prices[nv] < avgPrices[nv];
    addTrap({
      type: "bull",
      name: "放量冲高回落",
      time: items[p].time,
      price: prices[p],
      severity: rise >= 2.5 && volRise >= 2 ? "强" : confirmed ? "中" : "弱",
      desc: `${items[p].time} 起 ${p - pv} 分钟内从 ${prices[pv].toFixed(2)} 拉升至 ${prices[p].toFixed(2)}（+${rise.toFixed(1)}%），量能达基准 ${volRise.toFixed(1)} 倍，随后回落 ${(-drop).toFixed(1)}%${confirmed ? "并跌破启动位/均价" : "，尚未跌破启动位"}`,
      action: "诱多风险：冲高买入者被套概率大；反弹至前高附近减仓，跌破日内低点离场",
      confirm: confirmed ? "已确认" : `确认信号：跌破启动位 ${prices[pv].toFixed(2)} 或均价`,
    });
  }

  // ═══ B. 放量急跌后收复（诱空）═══
  for (const v of valleys) {
    if (v < 12 || v > N - 8) continue;
    const pp = nearestBefore(peaks, v);
    const np = nearestAfter(peaks, v);
    if (pp == null || np == null || v - pp > 40 || np - v > 40) continue;
    const fall = pct(prices[pp], prices[v]);
    const riseBack = pct(prices[v], prices[np]);
    if (fall > -1.2 || riseBack < 0.15) continue;
    const volFall = vRatio(v, v - pp + 1);
    if (volFall < 1.5) continue;
    if (riseBack < 0.5 * -fall) continue;
    const backPct = pct(prices[pp], prices[np]);
    const confirmed = backPct >= 0 || prices[np] > avgPrices[np];
    addTrap({
      type: "bear",
      name: "放量急跌后收复",
      time: items[v].time,
      price: prices[v],
      severity: -fall >= 2.5 && volFall >= 2 ? "强" : confirmed ? "中" : "弱",
      desc: `${items[v].time} 前 ${v - pp} 分钟内从 ${prices[pp].toFixed(2)} 跌至 ${prices[v].toFixed(2)}（${fall.toFixed(1)}%），量能达基准 ${volFall.toFixed(1)} 倍，随后反弹 ${riseBack.toFixed(1)}%${confirmed ? "并收复启动位/均价" : "，尚未收复"}`,
      action: "诱空嫌疑：恐慌卖出者可能卖飞；回踩不破新低可关注低吸，站稳均价再加码",
      confirm: confirmed ? "已确认" : `确认信号：收复 ${prices[pp].toFixed(2)} 或站上均价`,
    });
  }

  // ═══ C. 高位放量滞涨（诱多）═══
  if (highIdx > N * 0.2 && highIdx < N - 3) {
    const distHigh = pct(prices[highIdx], prices[N - 1]); // 当前价距日内高
    const distAvg = avgPrices[N - 1] > 0 ? pct(avgPrices[N - 1], prices[N - 1]) : 0;
    const last5 = prices.slice(-5);
    const chg5 = last5.length > 1 ? pct(last5[0], last5[last5.length - 1]) : 0;
    const vol5 = vRatio(N - 1, 5);
    if (distHigh > -0.8 && distAvg > 1.2 && vol5 >= 1.8 && Math.abs(chg5) <= 0.3) {
      addTrap({
        type: "bull",
        name: "高位放量滞涨",
        time: items[N - 1].time,
        price: prices[N - 1],
        severity: "中",
        desc: `价格维持日内高位（距最高 ${distHigh.toFixed(1)}%），近 5 分钟量能达基准 ${vol5.toFixed(1)} 倍但价格几乎不动（${chg5.toFixed(2)}%）`,
        action: "量价背离、出货嫌疑：不宜追高；持仓可逢高分批兑现",
        confirm: `确认信号：跌破均价 ${avgPrices[N - 1].toFixed(2)}`,
      });
    }
  }

  // ═══ D. 尾盘 15 分钟量价检查（诱多 / 诱空）═══
  if (N >= 30) {
    const s = N - 15;
    const move15 = pct(prices[s], prices[N - 1]);
    const vol15 = vRatio(N - 1, 15);

    // D1. 尾盘无量急拉（诱多）
    if (move15 >= 1.2 && vol15 <= 0.6) {
      addTrap({
        type: "bull",
        name: "尾盘无量急拉",
        time: items[N - 1].time,
        price: prices[N - 1],
        severity: "中",
        desc: `尾盘 15 分钟拉升 ${move15.toFixed(1)}% 但量能仅为基准 ${vol15.toFixed(1)} 倍`,
        action: "虚拉诱多嫌疑：无资金承接，次日低开/回落风险高；不宜尾盘追买",
        confirm: "确认信号：次日开盘走弱或低开",
      });
    }

    // D2. 尾盘放量急砸：低位砸 = 诱空/恐慌；高位砸 = 出货（对多头不利）
    if (move15 <= -1 && vol15 >= 1.5) {
      const nearLow = prices[N - 1] <= intradayLow * 1.008;
      if (nearLow) {
        addTrap({
          type: "bear",
          name: "尾盘低位放量急砸",
          time: items[N - 1].time,
          price: prices[N - 1],
          severity: "中",
          desc: `尾盘 15 分钟下跌 ${(-move15).toFixed(1)}%，量能达基准 ${vol15.toFixed(1)} 倍，价格处于日内低位`,
          action: "诱空/恐慌嫌疑：杀跌盘集中涌出；低位割肉风险大，已持仓不宜尾盘割肉",
          confirm: "确认信号：次日高开或盘中快速反弹站上均价",
        });
      } else {
        addTrap({
          type: "bull",
          name: "尾盘高位放量砸盘",
          time: items[N - 1].time,
          price: prices[N - 1],
          severity: "中",
          desc: `尾盘 15 分钟下跌 ${(-move15).toFixed(1)}% 且放量（${vol15.toFixed(1)} 倍基准），价格仍在日内中高位`,
          action: "高位出货嫌疑：资金夺路而逃，次日惯性低开概率大；不接飞刀",
          confirm: "确认信号：跌破日内均价/前低",
        });
      }
    }
  }

  // ═══ E. 高开冲高破均价（诱多）═══
  const open = prices[0];
  const gap = pct(preClose, open);
  if (gap >= 1.5 && N > 30) {
    const early = prices.slice(0, Math.min(30, N));
    const peak = Math.max(...early);
    const peakIdx = prices.indexOf(peak);
    if (peakIdx >= 5 && pct(open, peak) >= 1) {
      let breakIdx = -1;
      for (let i = peakIdx + 1; i < N; i++) {
        if (avgPrices[i] > 0 && prices[i] < avgPrices[i]) {
          breakIdx = i;
          break;
        }
      }
      if (breakIdx > 0) {
        addTrap({
          type: "bull",
          name: "高开冲高破均价",
          time: items[breakIdx].time,
          price: prices[breakIdx],
          severity: gap >= 3 ? "强" : "中",
          desc: `高开 ${gap.toFixed(1)}%，冲高 ${pct(open, peak).toFixed(1)}% 后于 ${items[breakIdx].time} 跌破均价`,
          action: "高开诱多嫌疑：开盘追高者被套；反抽均价不过则减仓",
          confirm: "已确认（跌破均价）",
        });
      }
    }
  }

  // ═══ F. 低位放量反转（诱空）═══
  if (lowIdx > N * 0.25 && lowIdx < N - 5) {
    const recovered = avgPrices[N - 1] > 0 && prices[N - 1] > avgPrices[N - 1];
    const vol10 = vRatio(N - 1, 10);
    const riseFromLow = pct(prices[lowIdx], prices[N - 1]);
    if (recovered && vol10 >= 1.8 && riseFromLow >= 1) {
      addTrap({
        type: "bear",
        name: "低位放量反转",
        time: items[lowIdx].time,
        price: prices[lowIdx],
        severity: "中",
        desc: `日内低点 ${items[lowIdx].time} 后放量（近 10 分钟 ${vol10.toFixed(1)} 倍基准）拉升 ${riseFromLow.toFixed(1)}%，重新站上均价`,
        action: "诱空嫌疑：早盘割肉者踏空；回踩不破新低可关注，跌破新低止损",
        confirm: "已确认（收复均价）",
      });
    }
  }

  return { traps, markers };
}
