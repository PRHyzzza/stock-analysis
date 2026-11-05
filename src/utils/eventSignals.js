/**
 * eventSignals — 短线事件口径（**纯函数**）
 *
 * 为什么单独成一模块：`paperScore` 的日 K 因子与短期收益的 IC 只有 -0.04（2026-11 实测，
 * 见 §7.35），继续调权重没有意义。真正带信息量的是**事件**：
 * 连板能不能晋级、竞价有没有异动。这两个量都能被直接统计和证伪，不依赖「因子强度」这种间接代理。
 *
 * 口径约束（必须原样体现在 UI 上）：
 * - 晋级率只统计**已有次日结果**的样本（`seal_nextday != null`）。最近一个交易日的票
 *   还没有「次日」，把它们当成「没晋级」会把晋级率系统性压低估。
 * - 样本 < `minSamples` 时标 `reliable: false`，不允许据此下结论。
 * - 竞价涨幅缺失（`bid_change_pct == null`）不得当 0% 展示，要显示 `--`。
 *
 * 这里只做统计与展示口径，不产生任何交易指令。
 */

/** 连板档位（与同花顺天梯的六个板位对齐后合并成 4 档，便于统计） */
export const BOARD_BUCKETS = Object.freeze([
  { id: "b2", label: "2 板", min: 2, max: 2 },
  { id: "b3", label: "3 板", min: 3, max: 3 },
  { id: "b4", label: "4 板", min: 4, max: 4 },
  { id: "b5p", label: "5 板+", min: 5, max: 99 },
]);

/** 单档最小可信样本数 */
export const MIN_PROMOTION_SAMPLES = 10;

/**
 * 连板晋级率
 *
 * @param {Array<{date: string, stocks: Array<{code, name, board_num, seal_nextday}>}>} days
 *   连板天梯（顺序不限，函数内部按日期自行判断最新日）
 * @param {{ minSamples?: number }} [opts]
 * @returns {{
 *   levels: Array<{ id, label, samples, promoted, ratePct, todayCount, reliable }>,
 *   newestDate: string, oldestDate: string, totalSamples: number
 * }}
 */
export function promotionStats(days, opts = {}) {
  const minSamples = Number(opts.minSamples) || MIN_PROMOTION_SAMPLES;
  const list = Array.isArray(days) ? days.filter((d) => d && d.date) : [];

  let newestDate = "";
  let oldestDate = "";
  for (const d of list) {
    const date = String(d.date);
    if (!newestDate || date > newestDate) newestDate = date;
    if (!oldestDate || date < oldestDate) oldestDate = date;
  }

  const acc = BOARD_BUCKETS.map((b) => ({
    ...b,
    samples: 0,
    promoted: 0,
    todayCount: 0,
  }));

  for (const day of list) {
    const isNewest = String(day.date) === newestDate;
    for (const s of Array.isArray(day.stocks) ? day.stocks : []) {
      const n = Number(s?.board_num);
      const bucket = acc.find((b) => n >= b.min && n <= b.max);
      if (!bucket) continue;
      // 今日在板数：含还没有次日结果的票（这是「今天的梯队高度」）
      if (isNewest) bucket.todayCount += 1;
      // 晋级统计：只算已经有次日结果的样本
      if (s?.seal_nextday == null) continue;
      bucket.samples += 1;
      if (s.seal_nextday === true) bucket.promoted += 1;
    }
  }

  const levels = acc.map((b) => ({
    id: b.id,
    label: b.label,
    samples: b.samples,
    promoted: b.promoted,
    todayCount: b.todayCount,
    ratePct: b.samples > 0 ? Math.round((b.promoted / b.samples) * 1000) / 10 : null,
    reliable: b.samples >= minSamples,
  }));

  return {
    levels,
    newestDate,
    oldestDate,
    totalSamples: levels.reduce((sum, b) => sum + b.samples, 0),
  };
}

/**
 * 竞价异动按代码归组
 *
 * 一只票可能同时命中多种异动（涨停试盘 + 大单买入…），这里保留全部，
 * 并挑出「最强」的一条给列表展示（按竞价涨幅绝对值，同幅度取更早的）。
 *
 * @param {Array} items `get_auction_opportunities` 的 items
 * @returns {Map<string, { all: Array, primary: object }>}
 */
export function auctionFlagsOf(items) {
  const grouped = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const code = String(it?.code ?? "").trim();
    if (!code) continue;
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(it);
  }

  const out = new Map();
  for (const [code, list] of grouped) {
    const sorted = list.slice().sort((a, b) => {
      const av = Math.abs(Number(a.bid_change_pct) || 0);
      const bv = Math.abs(Number(b.bid_change_pct) || 0);
      if (bv !== av) return bv - av;
      return String(a.at || "").localeCompare(String(b.at || ""));
    });
    out.set(code, { all: list, primary: sorted[0] });
  }
  return out;
}

/**
 * 竞价异动 → 一句话（tooltip 用）
 *
 * 格式固定为「异动名（竞价 X%）时间」。实测里存在「急速下跌 +1.78%」这种组合
 * （异动类型说的是分时走势，竞价涨幅是另一个量），不加括号和「竞价」二字会被读成
 * 「跌了 +1.78%」这种自相矛盾的表述。
 */
export function describeAuction(entry) {
  const p = entry?.primary || entry;
  if (!p) return "";
  const name = p.warn_name || p.warn_type || "竞价异动";
  const pct =
    p.bid_change_pct == null || !Number.isFinite(Number(p.bid_change_pct))
      ? "--"
      : `${Number(p.bid_change_pct) > 0 ? "+" : ""}${Number(p.bid_change_pct).toFixed(2)}%`;
  return `${name}（竞价 ${pct}${p.at ? `，${p.at}` : ""}）`;
}

/**
 * 晋级率的一句话结论（UI 摘要）
 * 样本不足、无数据都要说清楚，不能只给一个百分数。
 */
export function describePromotion(stats) {
  if (!stats || !stats.totalSamples) {
    return "近期没有可统计的连板晋级样本（需要至少两个交易日的天梯数据）";
  }
  const parts = stats.levels
    .filter((b) => b.samples > 0)
    .map((b) => `${b.label} ${b.ratePct}%(${b.promoted}/${b.samples})`);
  return parts.join(" · ");
}
