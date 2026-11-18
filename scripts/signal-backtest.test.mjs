import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzeBars,
  benchmarkFor,
  wilsonLower,
  HOLD_PERIODS,
  RULE_GROUPS,
  RULES,
} from "../src/composables/useSignalBacktest.js";

/* ---------------------------------------------------------------- 构造工具 */

/** 生成日 K：open 取前收，high/low 按 wick 比例外扩（wick=0 时 high/low 贴住实体，用于模拟封板） */
function mkBars(closes, { wick = 0.01, volume = () => 1000 } = {}) {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const hi = Math.max(open, close);
    const lo = Math.min(open, close);
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000);
    return {
      date: d.toISOString().slice(0, 10),
      open,
      close,
      high: +(hi * (1 + wick)).toFixed(4),
      low: +(lo * (1 - wick)).toFixed(4),
      volume: volume(i),
    };
  });
}

/** 60 根横盘 + 指定尾部序列（回测从第 60 根起算，前面留给指标预热） */
function withWarmup(tail, base = 10) {
  return [...new Array(60).fill(base), ...tail];
}

const ruleOf = (res, id) => res.rules.find((r) => r.id === id);

/* ---------------------------------------------------------------- 结构 */

test("持有期含 20 / 30 日且升序（回测与实盘统计同口径）", () => {
  assert.deepEqual(HOLD_PERIODS, [1, 3, 5, 10, 20, 30]);
});

test("规则覆盖三个类别且全部带 id/hint/group", () => {
  assert.ok(RULES.length >= 18, `规则数应 ≥ 18，实际 ${RULES.length}`);
  const groups = new Set(RULE_GROUPS.map((g) => g.id));
  for (const r of RULES) {
    assert.ok(r.id && r.name && r.hint, `规则字段缺失: ${r.id}`);
    assert.ok(groups.has(r.group), `规则 ${r.id} 的 group 不在 RULE_GROUPS 内: ${r.group}`);
  }
  const ids = new Set(RULES.map((r) => r.id));
  assert.equal(ids.size, RULES.length, "规则 id 必须唯一");
  // 每个类别至少一条，否则筛选按钮会出现空分组
  for (const g of groups) {
    assert.ok(RULES.some((r) => r.group === g), `类别 ${g} 没有任何规则`);
  }
});

test("样本不足 60 根时 give up，不返回假统计", () => {
  const res = analyzeBars(mkBars(new Array(30).fill(10)), "600519");
  assert.equal(res.enough, false);
  assert.deepEqual(res.rules, []);
  assert.deepEqual(res.benchmark, {});
  // 空输入 / 脏输入也不应抛异常
  assert.equal(analyzeBars([], "600519").enough, false);
  assert.equal(analyzeBars(null, "600519").enough, false);
});

/* ---------------------------------------------------------------- 超短线规则 */

test("首板涨停：封板算、创业板 10% 不算、冲高回落不算", () => {
  // 60 根横盘后 +10% 且 wick=0 → 收盘 = 最高价 = 封板
  const bars = mkBars(withWarmup([11, 11, 11, 11, 11]), { wick: 0 });
  const main = analyzeBars(bars, "600519"); // 主板 ±10%
  const first = ruleOf(main, "limit_up_first");
  assert.equal(first.signalCount, 1, "主板 +10% 封板应识别为首板涨停");
  assert.equal(first.lastHitDate, bars[60].date);

  // 同一组 K 线，换成创业板（±20%）：10% 只是普通上涨
  const gem = analyzeBars(bars, "300750");
  assert.equal(ruleOf(gem, "limit_up_first").signalCount, 0);

  // 涨幅够但收盘没贴住最高价（冲高回落）→ 不算封板
  const fading = mkBars(withWarmup([11, 11, 11, 11, 11]), { wick: 0 });
  fading[60].high = +(11 * 1.03).toFixed(4);
  assert.equal(ruleOf(analyzeBars(fading, "600519"), "limit_up_first").signalCount, 0);
});

test("连板：昨日今日都封板才算二板", () => {
  const bars = mkBars(withWarmup([11, 12.1, 12.1, 12.1]), { wick: 0 });
  const res = analyzeBars(bars, "600519");
  assert.equal(ruleOf(res, "limit_up_first").signalCount, 1);
  assert.equal(ruleOf(res, "limit_up_second").signalCount, 1);
});

test("三连阴后首阳 / 阳包阴：超跌反抽形态可被识别", () => {
  const closes = withWarmup([9.9, 9.8, 9.7, 9.8, 9.8, 9.8]);
  const bars = mkBars(closes, { wick: 0 });
  const res = analyzeBars(bars, "600519");
  assert.ok(ruleOf(res, "three_down_then_up").signalCount >= 1, "三连阴后首阳应命中");
  assert.ok(ruleOf(res, "bullish_engulf").signalCount >= 1, "阳包阴应命中");
});

/* ---------------------------------------------------------------- 统计口径 */

test("30 日持有期：单笔收益按「信号日收盘买、第 30 根收盘卖」精确计", () => {
  // 第 60 根封板 11 元，其后每根 +1%
  const tail = [11];
  for (let i = 1; i < 40; i++) tail.push(+(11 * 1.01 ** i).toFixed(6));
  const bars = mkBars(withWarmup(tail), { wick: 0 });
  const res = analyzeBars(bars, "600519");
  const first = ruleOf(res, "limit_up_first");

  assert.equal(first.signalCount, 1);
  assert.equal(first.byPeriod[1].trades, 1);
  assert.equal(first.byPeriod[30].trades, 1);

  const expect1 = (bars[61].close / bars[60].close - 1) * 100;
  const expect30 = (bars[90].close / bars[60].close - 1) * 100;
  assert.ok(Math.abs(first.byPeriod[1].avgRet - expect1) < 1e-6, "1 日收益应为 1%");
  assert.ok(Math.abs(first.byPeriod[30].avgRet - expect30) < 1e-6, "30 日收益应为 1.01^30-1");
  assert.ok(first.byPeriod[30].avgRet > 30, "30 日复利下收益应明显大于 20 日");
});

test("非重叠交易：持有期内不再开仓，笔数显著少于信号数", () => {
  // 单边上涨 100 根：5 日新高几乎每根触发
  const closes = new Array(100).fill(10).map((v, i) => +(10 * 1.01 ** i).toFixed(6));
  const bars = mkBars(closes, { wick: 0 });
  const res = analyzeBars(bars, "600519");
  const brk = ruleOf(res, "high_5d_break");
  assert.ok(brk.signalCount > 20, `信号数应很多，实际 ${brk.signalCount}`);
  assert.ok(
    brk.byPeriod[5].trades < brk.signalCount / 4,
    `非重叠后笔数应远小于信号数（trades=${brk.byPeriod[5].trades}, signals=${brk.signalCount}）`
  );
});

test("基准：单边 1% 复利下，5 日持有基准 = 每笔 5 日收益，超额趋近 0", () => {
  const closes = new Array(100).fill(10).map((v, i) => +(10 * 1.01 ** i).toFixed(6));
  const bars = mkBars(closes, { wick: 0 });
  const res = analyzeBars(bars, "600519");

  const bench = res.benchmark[5];
  assert.equal(bench.samples, 35, "基准样本 = 根数 - 预热 60 根 - 持有期（与规则区间对齐）");
  const expect = (1.01 ** 5 - 1) * 100;
  assert.ok(Math.abs(bench.avgRet - expect) < 1e-6);

  // 该规则每天都在上涨起点买入，收益与基准完全一致 → 超额 ≈ 0（不是「有 edge」）
  const brk = ruleOf(res, "high_5d_break");
  assert.ok(Math.abs(brk.byPeriod[5].excess) < 1e-6, `超额应≈0，实际 ${brk.byPeriod[5].excess}`);
  assert.equal(brk.byPeriod[5].excessWin, 0, "胜率差也应为 0");
});

test("基准函数对无效输入返回空统计而不是 NaN", () => {
  assert.deepEqual(benchmarkFor([], 5), { samples: 0, avgRet: null, winRate: null });
  assert.deepEqual(benchmarkFor(mkBars([10, 11]), 5), { samples: 0, avgRet: null, winRate: null });
});

test("平盘不进胜率分母：横盘下 1 笔 0% 收益 → 胜率为 null、flats 计 1", () => {
  const bars = mkBars(withWarmup([11, 11, 11, 11, 11, 11]), { wick: 0 });
  const stat = ruleOf(analyzeBars(bars, "600519"), "limit_up_first").byPeriod[1];
  assert.equal(stat.trades, 1);
  assert.equal(stat.flats, 1);
  assert.equal(stat.decided, 0);
  assert.equal(stat.winRate, null);
  assert.equal(stat.winRateLower, null);
});

test("Wilson 下界：小样本全胜远低于点估计，样本变多才收敛", () => {
  assert.equal(wilsonLower(0, 0), null);
  assert.equal(wilsonLower(0, 10), 0);
  const three = wilsonLower(3, 3);
  assert.ok(three > 40 && three < 47, `3 笔全胜下界应约 43.8%，实际 ${three}`);
  const ten = wilsonLower(10, 10);
  assert.ok(ten > three && ten < 75, `10 笔全胜下界应更高但远低于 100%，实际 ${ten}`);
  assert.ok(wilsonLower(30, 30) > ten, "样本越多下界越高");
});

test("平均浮盈 / 平均浮亏：只看入场之后，且浮亏 ≤ 收益 ≤ 浮盈", () => {
  const closes = new Array(100).fill(10).map((v, i) => +(10 * 1.01 ** i).toFixed(6));
  const res = analyzeBars(mkBars(closes, { wick: 0 }), "600519");
  const stat = ruleOf(res, "high_5d_break").byPeriod[5];
  // 单边上涨：最低价仍高于入场价，故 avgMae > 0（等于「一次浮亏都没出现」）
  assert.ok(stat.avgMae > 0, `单边上涨时不应有浮亏，实际 ${stat.avgMae}`);
  assert.ok(stat.avgMfe > stat.avgRet, "持有窗口内最高价高于卖出收盘价，浮盈应更大");
  assert.ok(stat.avgMfe >= stat.avgRet && stat.avgRet >= stat.avgMae);

  // 涨停后逐日阴跌：持有期内应记录到真实浮亏
  const tail = [11];
  for (let i = 1; i < 35; i++) tail.push(+(11 * 0.99 ** i).toFixed(6));
  const sinking = ruleOf(analyzeBars(mkBars(withWarmup(tail), { wick: 0 }), "600519"), "limit_up_first");
  const st30 = sinking.byPeriod[30];
  assert.equal(st30.trades, 1);
  assert.ok(st30.avgMae < 0, `阴跌行情应记录浮亏，实际 ${st30.avgMae}`);
  assert.ok(st30.avgMfe >= 0, "入场后仍有一根冲高，浮盈不应为负");
  assert.ok(st30.avgMae <= st30.avgRet, "浮亏应不大于最终收益");
});

test("每条规则 × 每个持有期都有完整统计对象（UI 直接取 byPeriod[hold]）", () => {
  const closes = new Array(100).fill(10).map((v, i) => +(10 * (1 + (i % 7) * 0.004)).toFixed(6));
  const res = analyzeBars(mkBars(closes), "600519");
  for (const r of res.rules) {
    for (const h of HOLD_PERIODS) {
      const st = r.byPeriod[h];
      assert.ok(st, `规则 ${r.id} 缺少持有期 ${h}`);
      assert.equal(typeof st.trades, "number");
      assert.ok("excess" in st && "winRateLower" in st && "avgMfe" in st);
    }
  }
  for (const h of HOLD_PERIODS) assert.ok(res.benchmark[h], `缺少基准 ${h}`);
});
