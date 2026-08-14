/**
 * useTrapSignals — 分时量价陷阱识别（诱多 / 诱空）
 *
 * 纯函数模块：基于分时数据（价格 × 量能）检测日内"诱多/诱空"嫌疑。
 * "诱"是前瞻性判断（陷阱是否成立需后续走势确认），因此每个信号都附带
 * 强度分级与确认条件，输出为"嫌疑 + 确认信号"，不输出确定性结论。
 *
 * 检测规则：
 *   诱多嫌疑（bull，红↓）：放量冲高回落 / 高位放量滞涨 / 尾盘无量急拉 / 高开冲高破均价
 *   诱空嫌疑（bear，绿↑）：放量急跌后收复 / 低位放量反转 / 尾盘放量急砸（低位）
 *
 * ⚠️ 定性说明（反后视镜）：跌破/收复关键位只证明"形态破坏"这一观测事实；
 * "诱多/诱空"是**疑似定性**，成立与否需后续走势验证（见每个信号的 confirm 字段）。
 * 标记文本用"诱多?"/"诱空?"表达未确认的怀疑，不输出确定结论。
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

  // 量能基准：滚动基准（前 30 分钟中位数）+ 全局兜底。
  // A 股上午量能显著大于下午，用全天中位数做基准会导致上下午系统性偏差
  // （上午正常分钟量偏高被误判"放量"，下午正常分钟量偏低被误判"缩量"）
  const globalBase = median(volumes) || mean(volumes);
  /** 第 i 分钟的滚动基准：i-30..i-11 中位数（滞后 10 分钟）。
   *  滞后设计：当前与最近 10 分钟的放量不影响基准，放量事件起点必然被捕捉；
   *  放量持续超过 10 分钟后基准自然含入放量段，量比回归 1（持续的放量已是常态，不再误报）。
   *  样本不足时用全局兜底 */
  const baseAt = (i) => {
    const from = Math.max(0, i - 30);
    const to = Math.max(0, i - 10);
    if (to - from < 5) return globalBase;
    const m = median(volumes.slice(from, to));
    return m > 0 ? m : globalBase;
  };
  /** 截至索引 i 的前 w 分钟平均量 / 滚动基准 */
  const vRatio = (i, w) => {
    const s = volumes.slice(Math.max(0, i - w + 1), i + 1);
    const m = mean(s);
    const b = baseAt(i);
    return b > 0 ? m / b : 1;
  };

  /** [from, to] 区间内最大连续 win 分钟均量（捕捉"最后几分钟突然放量"的脉冲形态；
   *  全区间平均会被上升途中的普通量稀释，导致真实放量冲高被漏检） */
  const maxWinMean = (from, to, win) => {
    let best = 0;
    const w = Math.min(win, to - from + 1);
    if (w <= 0) return 0;
    for (let s = from; s <= to - w + 1; s++) {
      const m = mean(volumes.slice(s, s + w));
      if (m > best) best = m;
    }
    return best;
  };

  // 局部极值（带最小波动幅度约束）：窗口 ±W，突出度（相对窗口内最值）≥0.5% 才算有效摆动点。
  // 纯严格比较在"平台期"（连续同价）会失效——平坦段既非峰也非谷，摆动起点会丢失；
  // 突出度约束天然跳过盘整平台，只保留真实摆动。
  // 开盘不整体跳过：09:31 起的开盘放量急拉是全天最重要的信号（09:30 集合竞价分钟由 add 剔除）
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

  // 同类型陷阱最近一次触发的分钟索引（15 分钟间隔去重，防连续满足条件时重复打标）
  const lastTrapMinute = {};

  const addTrap = (t) => {
    // 同名称同时间去重
    if (traps.some((x) => x.name === t.name && x.time === t.time)) return;
    // 同类型 15 分钟间隔去重：条件连续满足（如高位滞涨持续 10 分钟）时只报首个，
    // 否则同一形态会在连续分钟上重复打标，图上标记堆积
    const m = t.minute ?? -999;
    if (lastTrapMinute[t.name] != null && m - lastTrapMinute[t.name] < 15) return;
    lastTrapMinute[t.name] = m;
    traps.push(t);
    // 标记文本用"诱多?"而非"诱多⚠"：跌破/收复关键位只证明形态破坏，
    // "诱多/诱空"的定性需后续走势验证（见 confirm 字段）——用问号表达未确认的怀疑
    markers.push({
      time: t.time,
      position: t.type === "bull" ? "aboveBar" : "belowBar",
      color: t.type === "bull" ? "#e74c3c" : "#27ae60",
      shape: t.type === "bull" ? "arrowDown" : "arrowUp",
      text: t.type === "bull" ? "诱多?" : "诱空?",
      size: t.severity === "强" ? 2 : 1,
    });
  };

  const intradayHigh = Math.max(...prices);
  const intradayLow = Math.min(...prices);
  const highIdx = prices.indexOf(intradayHigh);
  const lowIdx = prices.indexOf(intradayLow);

  // ═══ A. 放量冲高回落（诱多）═══
  // 反后视镜设计：不等"回落 ≥50%"事后确认，而是找峰后**第一个跌破启动位或均价的分钟**
  // （跌破当下即可判定，且是更明确的转弱信号）——时间戳打在跌破点，盘中实时可见
  for (const p of peaks) {
    if (p < 6 || p > N - 8) continue; // 只跳过 09:30 集合竞价附近的未完成摆动（开盘放量急拉是重要信号，不得整体跳过开盘段）
    const pv = nearestBefore(valleys, p);
    const nv = nearestAfter(valleys, p);
    if (pv == null || nv == null || p - pv > 40 || nv - p > 40) continue;
    const rise = pct(prices[pv], prices[p]);
    if (rise < 1.2) continue; // 有像样的拉升
    // 放量强度 = 上升区间内最大连续 5 分钟均量 / 基准（脉冲放量不被区间平均稀释）
    const volRise = maxWinMean(pv, p, 5) / baseAt(p);
    if (volRise < 1.5) continue; // 拉升必须放量
    // 峰后第一个跌破启动位或均价的分钟（实时确认点）
    let brokeIdx = -1;
    for (let i = p + 1; i <= Math.min(nv ?? N - 1, N - 1); i++) {
      if (prices[i] < prices[pv] || (avgPrices[i] > 0 && prices[i] < avgPrices[i])) {
        brokeIdx = i;
        break;
      }
    }
    if (brokeIdx < 0) continue;
    addTrap({
      type: "bull",
      name: "放量冲高回落",
      time: items[brokeIdx].time,
      minute: brokeIdx,
      price: prices[brokeIdx],
      severity: rise >= 2.5 && volRise >= 2 ? "强" : "中",
      desc: `${items[p].time} 放量拉升 ${rise.toFixed(1)}%（量 ${volRise.toFixed(1)}× 基准，${items[pv].time} ${prices[pv].toFixed(2)} 起）后于 ${items[brokeIdx].time} 跌破${prices[brokeIdx] < prices[pv] ? `启动位 ${prices[pv].toFixed(2)}` : `均价 ${avgPrices[brokeIdx].toFixed(2)}`}，冲高买入者被套`,
      action: "诱多风险：反弹至前高附近减仓，跌破日内低点离场",
      confirm: "已确认（跌破启动位/均价，实时信号）",
    });
  }

  // ═══ B. 放量急跌后收复（诱空）═══
  // 反后视镜设计：不等"反弹 ≥50%"事后确认，找谷后**第一个收复启动位或站上均价的分钟**
  for (const v of valleys) {
    if (v < 6 || v > N - 8) continue; // 只跳过 09:30 集合竞价附近的未完成摆动
    const pp = nearestBefore(peaks, v);
    const np = nearestAfter(peaks, v);
    if (pp == null || np == null || v - pp > 40 || np - v > 40) continue;
    const fall = pct(prices[pp], prices[v]);
    if (fall > -1.2) continue;
    // 放量强度 = 下跌区间内最大连续 5 分钟均量 / 基准
    const volFall = maxWinMean(pp, v, 5) / baseAt(v);
    if (volFall < 1.5) continue;
    // 谷后第一个收复启动位或站上均价的分钟（实时确认点）
    let recoverIdx = -1;
    for (let i = v + 1; i <= Math.min(np ?? N - 1, N - 1); i++) {
      if (prices[i] > prices[pp] || (avgPrices[i] > 0 && prices[i] > avgPrices[i])) {
        recoverIdx = i;
        break;
      }
    }
    if (recoverIdx < 0) continue;
    addTrap({
      type: "bear",
      name: "放量急跌后收复",
      time: items[recoverIdx].time,
      minute: recoverIdx,
      price: prices[recoverIdx],
      severity: -fall >= 2.5 && volFall >= 2 ? "强" : "中",
      desc: `${items[v].time} 前 ${v - pp} 分钟内放量下跌 ${fall.toFixed(1)}%（量 ${volFall.toFixed(1)}× 基准）后于 ${items[recoverIdx].time} 收复${prices[recoverIdx] > prices[pp] ? `启动位 ${prices[pp].toFixed(2)}` : `均价 ${avgPrices[recoverIdx].toFixed(2)}`}，恐慌卖出者踏空`,
      action: "诱空嫌疑：回踩不破新低可关注低吸，站稳均价再加码",
      confirm: "已确认（收复启动位/站上均价，实时信号）",
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
        minute: N - 1,
        price: prices[N - 1],
        severity: "中",
        desc: `价格维持日内高位（距最高 ${distHigh.toFixed(1)}%），近 5 分钟量能达基准 ${vol5.toFixed(1)} 倍但价格几乎不动（${chg5.toFixed(2)}%）`,
        action: "量价背离、出货嫌疑：不宜追高；持仓可逢高分批兑现",
        confirm: `确认信号：跌破均价 ${avgPrices[N - 1].toFixed(2)}`,
      });
    }
  }

  // ═══ D. 尾盘 15 分钟量价检查（诱多 / 诱空）═══
  // 反后视镜设计：滚动窗口而非固定"最后 15 分钟"——尾盘段（最后 30 分钟）内
  // 任一窗口结束点出现满足条件的 15 分钟形态立即标注（快照式实时预警），
  // 不必等收盘才判定；同类型 15 分钟间隔去重控制数量
  if (N >= 30) {
    const tailStart = Math.max(15, N - 30);
    for (let i = tailStart + 14; i < N; i++) {
      const s = i - 14;
      const move15 = pct(prices[s], prices[i]);
      const vol15 = vRatio(i, 15);

      // D1. 无量急拉（诱多）
      if (move15 >= 1.2 && vol15 <= 0.6) {
        addTrap({
          type: "bull",
          name: "尾盘无量急拉",
          time: items[i].time,
          minute: i,
          price: prices[i],
          severity: "中",
          desc: `${items[s].time}-${items[i].time} 拉升 ${move15.toFixed(1)}% 但量能仅为基准 ${vol15.toFixed(1)} 倍`,
          action: "虚拉诱多嫌疑：无资金承接，回落/次日低开风险高；不宜追买",
          confirm: "确认信号：跌破拉升起点或次日开盘走弱",
        });
      }

      // D2. 放量急砸：低位砸 = 诱空/恐慌；高位砸 = 出货（对多头不利）
      if (move15 <= -1 && vol15 >= 1.5) {
        const nearLow = prices[i] <= intradayLow * 1.008;
        if (nearLow) {
          addTrap({
            type: "bear",
            name: "尾盘低位放量急砸",
            time: items[i].time,
            minute: i,
            price: prices[i],
            severity: "中",
            desc: `${items[s].time}-${items[i].time} 下跌 ${(-move15).toFixed(1)}%，量能达基准 ${vol15.toFixed(1)} 倍，价格处于日内低位`,
            action: "诱空/恐慌嫌疑：杀跌盘集中涌出；低位割肉风险大，已持仓不宜低位割肉",
            confirm: "确认信号：次日高开或盘中快速反弹站上均价",
          });
        } else {
          addTrap({
            type: "bull",
            name: "尾盘高位放量砸盘",
            time: items[i].time,
            minute: i,
            price: prices[i],
            severity: "中",
            desc: `${items[s].time}-${items[i].time} 下跌 ${(-move15).toFixed(1)}% 且放量（${vol15.toFixed(1)} 倍基准），价格仍在日内中高位`,
            action: "高位出货嫌疑：资金夺路而逃，次日惯性低开概率大；不接飞刀",
            confirm: "确认信号：跌破日内均价/前低",
          });
        }
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
          minute: breakIdx,
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
        minute: lowIdx,
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
