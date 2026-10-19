import { calcTrapSignals } from "../src/composables/useTrapSignals.js";
import { calcVolumeSignals } from "../src/composables/useVolumeSignals.js";
import { useT0Signals } from "../src/composables/useT0Signals.js";

/** 生成合成分时数据：N 分钟，基准量 vol，价格按段构造 */
function makeData(priceFn, volFn, { N = 240, preClose = 10.0, avgPrice = 10.0 } = {}) {
  const items = [];
  for (let i = 0; i < N; i++) {
    const price = +priceFn(i).toFixed(2);
    const volume = volFn(i);
    items.push({
      time: `${String(9 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`,
      price,
      avgPrice,
      volume,
      turnover: volume * price * 100,
      vwap: avgPrice,
    });
  }
  return { items, preClose, date: "20260820" };
}

const BASE = 1000;
let pass = 0, fail = 0;
function expect(name, traps, cond) {
  const names = traps.map((t) => t.name);
  if (cond) { pass++; console.log(`✅ ${name} → ${names.join("、") || "无"}`); }
  else { fail++; console.log(`❌ ${name} → 期望命中，实际: ${names.join("、") || "无"}`); }
}

// 场景1: 放量冲高回落（诱多）—— 100~110 分钟放量拉升 +3%，随后跌破启动位（实时确认点）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : i <= 110 ? 10.0 + (i - 100) * 0.03 : Math.max(9.98, 10.3 - (i - 110) * 0.04),
    (i) => (i >= 95 && i <= 125) ? 3000 : BASE
  );
  const { traps } = calcTrapSignals(d);
  expect("放量冲高回落", traps, traps.some((t) => t.name === "放量冲高回落" && t.type === "bull"));
}

// 场景2: 尾盘无量急拉（诱多）
{
  const d = makeData(
    (i) => i < 225 ? 10.0 : 10.0 + (i - 224) * 0.01,
    (i) => (i >= 225) ? 300 : BASE
  );
  const { traps } = calcTrapSignals(d);
  expect("尾盘无量急拉", traps, traps.some((t) => t.name === "尾盘无量急拉" && t.type === "bull"));
}

// 场景3: 放量急跌后收复（诱空）—— 放量下跌后收复启动位（实时确认点）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : i <= 110 ? 10.0 - (i - 100) * 0.02 : Math.min(10.02, 9.8 + (i - 110) * 0.03),
    (i) => (i >= 95 && i <= 125) ? 3000 : BASE
  );
  const { traps } = calcTrapSignals(d);
  expect("放量急跌后收复", traps, traps.some((t) => t.name === "放量急跌后收复" && t.type === "bear"));
}

// 场景4: 高开冲高破均价（诱多）
{
  const d = makeData(
    (i) => i === 0 ? 10.2 : i <= 20 ? 10.2 + (i) * 0.0075 : Math.max(10.15, 10.35 - (i - 20) * 0.01),
    (i) => (i >= 5 && i <= 30) ? 2500 : BASE,
    { avgPrice: 10.25 }
  );
  const { traps } = calcTrapSignals(d);
  expect("高开冲高破均价", traps, traps.some((t) => t.name === "高开冲高破均价" && t.type === "bull"));
}

// 场景5: 平淡行情（不应触发任何陷阱）
{
  const d = makeData(() => 10.0, () => BASE);
  const { traps, markers } = calcTrapSignals(d);
  expect("平淡行情无信号", traps, traps.length === 0 && markers.length === 0);
}

// 场景6: 数据不足
{
  const { traps } = calcTrapSignals({ items: [{ time: "09:30", price: 1, avgPrice: 1, volume: 1 }], preClose: 1 });
  expect("数据不足返回空", traps, traps.length === 0);
}

// 场景7: 放量强势拉升但不回落（不应报放量冲高回落）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : 10.0 + (i - 99) * 0.005,
    (i) => (i >= 95) ? 3000 : BASE
  );
  const { traps } = calcTrapSignals(d);
  expect("放量拉升无回落不误报", traps, !traps.some((t) => t.name === "放量冲高回落"));
}

// 场景8: 盘中无量上涨（非尾盘，不触发尾盘无量急拉；也无放量冲高回落）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : 10.0 + (i - 99) * 0.005,
    (i) => 300
  );
  const { traps } = calcTrapSignals(d);
  expect("盘中无量上涨不误报", traps, traps.length === 0);
}

// 场景9: 高位放量滞涨（近5分钟放量但价格几乎不动）
{
  const d = makeData(
    (i) => i < 200 ? 10.0 + Math.min(i * 0.002, 0.5) : 10.5,
    (i) => (i >= 235) ? 2500 : BASE,
    { avgPrice: 10.3 }
  );
  const { traps } = calcTrapSignals(d);
  expect("高位放量滞涨", traps, traps.some((t) => t.name === "高位放量滞涨" && t.type === "bull"));
}

// 场景10: 完整 T0 管线（回归：曾因 risks 声明时序抛 TDZ ReferenceError 打崩渲染队列）
{
  const intraday = makeData(
    (i) => i < 100 ? 10.0 : i <= 110 ? 10.0 + (i - 100) * 0.03 : Math.max(9.98, 10.3 - (i - 110) * 0.04),
    (i) => (i >= 95 && i <= 125) ? 3000 : BASE
  );
  // 日K：至少 10 根供 MA 趋势判断
  const kline = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 10, high: 10.5, low: 9.8, close: 10 + Math.sin(i / 3) * 0.3, volume: 100000,
  }));
  const { compute, signalMarkers, summary } = useT0Signals();
  let threw = false;
  try {
    compute(kline, intraday, { code: "300750", name: "宁德时代" });
  } catch (e) {
    threw = true;
    console.error("compute 抛异常:", e);
  }
  expect("T0 管线不抛异常", [], !threw);
  expect("T0 摘要含陷阱信号", summary.value?.signals || [], (summary.value?.signals || []).some((s) => s.trap && s.name.includes("诱多")));
  expect("分时图标记含诱多?", [], signalMarkers.value.some((m) => m.text === "诱多?"));
  expect("风险区含诱多提示", summary.value?.risks || [], (summary.value?.risks || []).some((r) => r.includes("诱多嫌疑")));
  expect("raw.trapCount 正确", [], summary.value?.raw?.trapCount >= 1);
}

// 场景11: 温和放量（不达预警阈值，不应有信号；验证"普通放量不触发"）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : i <= 104 ? 10.0 + (i - 99) * 0.008 : 10.04,
    (i) => (i >= 100 && i <= 104) ? 2200 : BASE
  );
  const { signals } = calcVolumeSignals(d);
  expect("温和放量无信号", signals, signals.length === 0);
}

// 场景12: 放量急拉预警（5 分钟动能 ≥0.6% + 量 ≥2.5×，当下可判）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : i <= 104 ? 10.0 + (i - 99) * 0.016 : 10.08,
    (i) => (i >= 100 && i <= 104) ? 3000 : BASE
  );
  const { signals } = calcVolumeSignals(d);
  expect("放量急拉预警", signals, signals.some((s) => s.name === "放量急拉⚠" && s.level === "warn"));
}

// 场景13: 缩量回踩已移除（弱二次确认信号，不再标注）
{
  const d = makeData(
    (i) => i < 100 ? 10.2 : i <= 104 ? 10.2 - (i - 99) * 0.01 : 10.15,
    (i) => (i >= 100 && i <= 104) ? 300 : BASE,
    { avgPrice: 10.05 }
  );
  const { signals } = calcVolumeSignals(d);
  expect("缩量信号已移除", signals, !signals.some((s) => s.name === "缩量回踩" || s.name === "缩量反抽"));
}

// 场景14: 天量已移除（无方向事件标注不再标记）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : i <= 100 ? 10.05 : 10.05,
    (i) => i === 100 ? 7000 : BASE
  );
  const { signals } = calcVolumeSignals(d);
  expect("天量已移除", signals, !signals.some((s) => s.name.startsWith("天量")));
}

// 场景15: 平淡行情无量价信号 + 同分钟去重（每分钟最多一个信号）
{
  const d1 = makeData(() => 10.0, () => BASE);
  const { signals: s1 } = calcVolumeSignals(d1);
  expect("平淡行情无量价信号", s1, s1.length === 0);

  const d2 = makeData(
    (i) => i < 100 ? 10.0 : i <= 104 ? 10.0 + (i - 99) * 0.012 : 10.06,
    (i) => (i >= 100 && i <= 104) ? 6000 : BASE
  );
  const { signals: s2 } = calcVolumeSignals(d2);
  // 每分钟最多一个信号（i=100 天量已移除，i=104 的急拉预警是独立信号）
  const times = s2.map((s) => s.time);
  const dupTimes = times.filter((t, idx) => times.indexOf(t) !== idx);
  expect("同分钟不重复标信号", s2, dupTimes.length === 0);
  expect("急拉预警存在", s2, s2.some((s) => s.name === "放量急拉⚠"));
  expect("普通放量已移除", s2, !s2.some((s) => s.name === "放量↑" || s.name === "放量↓"));
}

// 场景16: T0 管线合并量价标记（与陷阱标记共存、同分钟陷阱优先）
{
  const intraday = makeData(
    (i) => i < 100 ? 10.0 : i <= 110 ? 10.0 + (i - 100) * 0.03 : Math.max(9.98, 10.3 - (i - 110) * 0.04),
    (i) => (i >= 95 && i <= 125) ? 3000 : BASE
  );
  const kline = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 10, high: 10.5, low: 9.8, close: 10 + Math.sin(i / 3) * 0.3, volume: 100000,
  }));
  const { compute, signalMarkers, summary } = useT0Signals();
  compute(kline, intraday, { code: "300750", name: "宁德时代" });
  const texts = signalMarkers.value.map((m) => m.text);
  expect("管线含诱多标记", [], texts.includes("诱多?"));
  expect("管线含量价标记", [], texts.includes("放量急拉⚠") || texts.includes("突破↑") || texts.includes("天量↑"));
  expect("量价计数写入 raw", [], summary.value?.raw?.volumeSignalCount >= 1);
  expect("陷阱/量价同分钟不重叠", [], signalMarkers.value.every((m, idx) =>
    signalMarkers.value.findIndex((x) => x.time === m.time) === idx ||
    signalMarkers.value.slice(0, idx).some((x) => x.time === m.time && (x.text.includes("诱") || m.text.includes("诱")))
  ));
}

// 场景17: 放量急拉预警（5 分钟动能 ≥0.6% + 量 ≥2.5×，当下可判、不依赖后续数据）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : i <= 104 ? 10.0 + (i - 99) * 0.016 : 10.08,
    (i) => (i >= 100 && i <= 104) ? 3000 : BASE
  );
  const { signals } = calcVolumeSignals(d);
  expect("放量急拉预警", signals, signals.some((s) => s.name === "放量急拉⚠" && s.level === "warn"));
}

// 场景18: 无量拉升预警（急拉但量 ≤0.4×，无承接虚涨）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : i <= 104 ? 10.0 + (i - 99) * 0.018 : 10.09,
    (i) => (i >= 100 && i <= 104) ? 300 : BASE
  );
  const { signals } = calcVolumeSignals(d);
  expect("无量拉升预警", signals, signals.some((s) => s.name === "无量拉升⚠" && s.level === "warn"));
}

// 场景19: 放量急跌预警（对称）
{
  const d = makeData(
    (i) => i < 100 ? 10.0 : i <= 104 ? 10.0 - (i - 99) * 0.016 : 9.92,
    (i) => (i >= 100 && i <= 104) ? 3000 : BASE
  );
  const { signals } = calcVolumeSignals(d);
  expect("放量急跌预警", signals, signals.some((s) => s.name === "放量急跌⚠" && s.level === "warn"));
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
