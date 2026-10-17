/**
 * indicator-tightness.test.mjs — 指标松紧度量化测试
 *
 * 目的：验证 useTrapSignals / useVolumeSignals 的阈值是否过松（白噪声误报率）
 * 与方法：构造三类输入跑检测器，统计信号数量
 *   A. 白噪声：随机游走价格 + 对数正态量能（无任何真实信号）→ 误报数应趋近 0
 *   B. 真实量能形态：上午放量/午后缩量 + 小幅波动 → 信号应很少
 *   C. 持续满足条件场景（高位横盘 10 分钟）→ 检查同类型信号是否重复打标（去重缺失）
 */
import { calcTrapSignals } from "../src/composables/useTrapSignals.js";
import { calcVolumeSignals } from "../src/composables/useVolumeSignals.js";

let pass = 0, fail = 0;
function report(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name} ${detail ?? ""}`); }
  else { fail++; console.log(`❌ ${name} ${detail ?? ""}`); }
}

/** 伪随机（mulberry32，可复现） */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 构造分时数据 */
function makeData(prices, volumes, { preClose = 10.0 } = {}) {
  const items = prices.map((price, i) => ({
    time: `${String(9 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`,
    price: +price.toFixed(3),
    avgPrice: preClose,
    volume: Math.max(0, Math.round(volumes[i])),
    turnover: Math.max(0, Math.round(volumes[i])) * price * 100,
    vwap: preClose,
  }));
  return { items, preClose, date: "20260820" };
}

const N = 240;

// ═══ A. 白噪声：随机游走 + 对数正态量能，跑 20 轮统计误报 ═══
{
  const rounds = 20;
  let trapTotal = 0, volTotal = 0, maxTrap = 0, maxVol = 0;
  const trapNameCount = {};
  const volNameCount = {};
  for (let seed = 1; seed <= rounds; seed++) {
    const r = rng(seed);
    const prices = [10.0];
    for (let i = 1; i < N; i++) prices.push(prices[i - 1] * (1 + (r() - 0.5) * 0.006)); // 日内 ±0.3%/分钟
    const volumes = Array.from({ length: N }, () => 1000 * Math.exp((r() - 0.5) * 1.2)); // 对数正态
    const d = makeData(prices, volumes);
    const t = calcTrapSignals(d);
    const v = calcVolumeSignals(d);
    trapTotal += t.traps.length;
    volTotal += v.signals.length;
    maxTrap = Math.max(maxTrap, t.traps.length);
    maxVol = Math.max(maxVol, v.signals.length);
    for (const x of t.traps) trapNameCount[x.name] = (trapNameCount[x.name] || 0) + 1;
    for (const x of v.signals) volNameCount[x.name] = (volNameCount[x.name] || 0) + 1;
  }
  const avgTrap = trapTotal / rounds, avgVol = volTotal / rounds;
  console.log(`\n[A] 白噪声 ${rounds} 轮（无真实信号）:`);
  console.log(`    陷阱信号: 平均 ${avgTrap.toFixed(1)} 个/轮（最大 ${maxTrap}）| 量价信号: 平均 ${avgVol.toFixed(1)} 个/轮（最大 ${maxVol}）`);
  console.log(`    陷阱明细: ${JSON.stringify(trapNameCount)}`);
  console.log(`    量价明细: ${JSON.stringify(volNameCount)}`);
  report("白噪声陷阱误报 ≤ 1/轮", avgTrap <= 1, `(实际 ${avgTrap.toFixed(2)})`);
  report("白噪声量价误报 ≤ 3/轮", avgVol <= 3, `(实际 ${avgVol.toFixed(2)})`);
}

// ═══ B. 真实量能形态：上午 1.6× / 午后 0.7×，小幅波动 ═══
{
  const r = rng(42);
  const prices = [10.0];
  for (let i = 1; i < N; i++) prices.push(prices[i - 1] * (1 + (r() - 0.5) * 0.002)); // 更小的波动
  const volumes = Array.from({ length: N }, (_, i) => {
    const session = i < 60 ? 1.6 : i < 120 ? 1.0 : 0.7; // 上午放量 → 午后缩量
    return 1000 * session * Math.exp((r() - 0.5) * 0.4);
  });
  const d = makeData(prices, volumes);
  const t = calcTrapSignals(d);
  const v = calcVolumeSignals(d);
  console.log(`\n[B] 真实量能形态（上午 1.6×/午后 0.7×，小幅波动）:`);
  console.log(`    陷阱 ${t.traps.length} 个（${t.traps.map((x) => x.name).join("、") || "无"}）| 量价 ${v.signals.length} 个（${v.signals.map((x) => x.name).join("、") || "无"}）`);
  report("真实形态陷阱 ≤ 1", t.traps.length <= 1, `(实际 ${t.traps.length})`);
  report("真实形态量价 ≤ 3", v.signals.length <= 3, `(实际 ${v.signals.length})`);
}

// ═══ C. 持续满足条件场景：高位横盘 + 放量持续到最后 15 分钟（滞涨条件连续满足）═══
{
  // 价格爬升至 10.5 后维持 10.5 不动（190 分钟起），225 分钟起放量 2.2× 直至收盘
  const prices = Array.from({ length: N }, (_, i) =>
    i < 190 ? 10.0 + Math.min(i * 0.0026, 0.5) : 10.5
  );
  const volumes = Array.from({ length: N }, (_, i) => (i >= 225 ? 2200 : 1000));
  const d = makeData(prices, volumes, { preClose: 9.8 });
  const t = calcTrapSignals(d);
  const stallTraps = t.traps.filter((x) => x.name === "高位放量滞涨");
  console.log(`\n[C] 高位放量滞涨条件连续满足 15 分钟:`);
  console.log(`    高位滞涨信号数: ${stallTraps.length}（条件连续满足，15 分钟间隔去重后应为 1）`);
  report("高位滞涨不重复打标（=1）", stallTraps.length === 1, `(实际 ${stallTraps.length})`);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
