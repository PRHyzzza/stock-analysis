/**
 * paperAuto 纯函数单测（模拟盘「每日定时自动选股」的口径锁）
 *
 * 只测纯逻辑：时间解析、配置规范化、该不该跑的判定、多策略命中合并、池更新模式。
 * 网络/定时器/问财查询不在本文件的范围内（那是 composable 的 I/O 层）。
 *
 * 跑法：pnpm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_AUTO_CONFIG,
  activeStrategies,
  applyPoolMode,
  describeAutoResult,
  localDate,
  mergeStrategyHits,
  minutesOfDay,
  normalizeAutoConfig,
  normalizeStrategy,
  normalizeTime,
  shouldRunAuto,
} from "../src/utils/paperAuto.js";

describe("minutesOfDay / normalizeTime", () => {
  it("解析合法时刻", () => {
    assert.equal(minutesOfDay("15:30"), 930);
    assert.equal(minutesOfDay("09:30"), 570);
    assert.equal(minutesOfDay("0:05"), 5);
    assert.equal(minutesOfDay(" 23:59 "), 1439);
  });

  it("非法输入一律 null（不抛异常，交给上层降级）", () => {
    assert.equal(minutesOfDay("24:00"), null);
    assert.equal(minutesOfDay("12:60"), null);
    assert.equal(minutesOfDay("1530"), null);
    assert.equal(minutesOfDay("15:3"), null, "分钟必须两位，避免把 15:3 猜成 15:03");
    assert.equal(minutesOfDay(""), null);
    assert.equal(minutesOfDay(null), null);
    assert.equal(minutesOfDay(undefined), null);
    assert.equal(minutesOfDay("ab:cd"), null);
  });

  it("normalizeTime 补零小时位，非法返回空串", () => {
    assert.equal(normalizeTime("9:05"), "09:05");
    assert.equal(normalizeTime("15:30"), "15:30");
    assert.equal(normalizeTime("9:5"), "", "分钟缺位不接受（防止猜成 09:05）");
    assert.equal(normalizeTime("bad"), "");
  });
});

describe("normalizeStrategy / normalizeAutoConfig", () => {
  it("无语句的策略被丢弃", () => {
    assert.equal(normalizeStrategy({ question: "   " }), null);
    assert.equal(normalizeStrategy(null), null);
  });

  it("缺 id 时按下标补，enabled 默认 true", () => {
    assert.deepEqual(normalizeStrategy({ question: "ROE>15%" }, 2), {
      id: "s3",
      question: "ROE>15%",
      enabled: true,
    });
    assert.equal(normalizeStrategy({ question: "x", enabled: false }).enabled, false);
  });

  it("语句超长被截断到 120 字", () => {
    const long = "策".repeat(200);
    assert.equal(normalizeStrategy({ question: long }).question.length, 120);
  });

  it("坏输入回退默认值", () => {
    assert.deepEqual(normalizeAutoConfig(null), { ...DEFAULT_AUTO_CONFIG, strategies: [] });
    assert.deepEqual(normalizeAutoConfig("nope"), { ...DEFAULT_AUTO_CONFIG, strategies: [] });
  });

  it("逐字段校验：mode/perpage/time/布尔", () => {
    const out = normalizeAutoConfig({
      enabled: true,
      notify: false,
      time: "9:05",
      mode: "merge",
      perpage: 999,
      strategies: [{ id: "a", question: "ROE>15%" }],
    });
    assert.equal(out.enabled, true);
    assert.equal(out.notify, false);
    assert.equal(out.time, "09:05");
    assert.equal(out.mode, "merge");
    assert.equal(out.perpage, 100, "perpage 上限 100");
    assert.equal(out.strategies.length, 1);

    assert.equal(normalizeAutoConfig({ mode: "append" }).mode, "replace", "未知 mode 回退");
    assert.equal(normalizeAutoConfig({ time: "25:00" }).time, DEFAULT_AUTO_CONFIG.time);
    assert.equal(normalizeAutoConfig({ perpage: 0 }).perpage, 1, "下限 1");
    assert.equal(normalizeAutoConfig({ perpage: 12.6 }).perpage, 13, "取整");
  });

  it("策略去重 id 且上限 10 条", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: "same", question: `q${i}` }));
    const out = normalizeAutoConfig({ strategies: many });
    assert.equal(out.strategies.length, 1, "同 id 只保留第一条");

    const uniq = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, question: `q${i}` }));
    assert.equal(normalizeAutoConfig({ strategies: uniq }).strategies.length, 10);
  });

  it("配置里没有的 key 不会被带出来（localStorage 被写脏也不污染）", () => {
    const out = normalizeAutoConfig({ enabled: true, hacker: "x" });
    assert.equal("hacker" in out, false);
  });
});

describe("activeStrategies", () => {
  it("过滤停用/空语句，并按语句去重", () => {
    const cfg = {
      strategies: [
        { id: "a", question: "ROE>15%", enabled: true },
        { id: "b", question: "ROE>15%", enabled: true },
        { id: "c", question: "  ", enabled: true },
        { id: "d", question: "MACD金叉", enabled: false },
      ],
    };
    const list = activeStrategies(cfg);
    assert.equal(list.length, 1);
    assert.equal(list[0].question, "ROE>15%");
  });

  it("空配置安全返回空数组", () => {
    assert.deepEqual(activeStrategies(null), []);
    assert.deepEqual(activeStrategies({}), []);
  });
});

describe("shouldRunAuto", () => {
  const baseCfg = normalizeAutoConfig({
    enabled: true,
    time: "15:30",
    strategies: [{ id: "s1", question: "ROE>15%" }],
  });
  const tradingDay = { isTradingDay: true, dateStr: "2026-10-23", holidayName: null };
  // 2026-10-23 是周五，本地时间 16:00（已过 15:30）
  const afterTime = new Date(2026, 9, 23, 16, 0, 0);
  const beforeTime = new Date(2026, 9, 23, 14, 0, 0);

  it("未启用不跑", () => {
    const r = shouldRunAuto({ ...baseCfg, enabled: false }, { now: afterTime, status: tradingDay });
    assert.equal(r.run, false);
    assert.equal(r.reason, "未启用");
  });

  it("没有启用策略不跑（避免空转打问财）", () => {
    const r = shouldRunAuto({ ...baseCfg, strategies: [] }, { now: afterTime, status: tradingDay });
    assert.equal(r.run, false);
    assert.match(r.reason, /策略/);
  });

  it("非交易日不跑，且带上节假日名", () => {
    const r = shouldRunAuto(baseCfg, {
      now: afterTime,
      status: { isTradingDay: false, holidayName: "国庆节", dateStr: "2026-10-01" },
    });
    assert.equal(r.run, false);
    assert.match(r.reason, /国庆节/);
  });

  it("未到运行时刻不跑", () => {
    const r = shouldRunAuto(baseCfg, { now: beforeTime, status: tradingDay });
    assert.equal(r.run, false);
    assert.match(r.reason, /未到运行时刻/);
  });

  it("到点且当天没跑过 → 跑", () => {
    const r = shouldRunAuto(baseCfg, { now: afterTime, lastAutoDate: "", status: tradingDay });
    assert.equal(r.run, true);
  });

  it("当天已跑过 → 不跑（幂等，跨重启有效）", () => {
    const r = shouldRunAuto(baseCfg, {
      now: afterTime,
      lastAutoDate: "2026-10-23",
      status: tradingDay,
    });
    assert.equal(r.run, false);
    assert.match(r.reason, /今日已/);
  });

  it("status 缺日期时用本地日期兜底比对", () => {
    const r = shouldRunAuto(baseCfg, {
      now: afterTime,
      lastAutoDate: "2026-10-23",
      status: { isTradingDay: true },
    });
    assert.equal(r.run, false);
  });

  it("now 非法不跑（不抛异常）", () => {
    const r = shouldRunAuto(baseCfg, { now: new Date("bad"), status: tradingDay });
    assert.equal(r.run, false);
    assert.equal(r.reason, "时刻无效");
  });

  it("status 为 undefined 时按「不知道是不是交易日」放行（宁跑不错过）", () => {
    const r = shouldRunAuto(baseCfg, { now: afterTime, lastAutoDate: "", status: null });
    assert.equal(r.run, true);
  });

  it("运行时刻非法不跑", () => {
    const r = shouldRunAuto(
      { ...baseCfg, time: "99:99" },
      { now: afterTime, lastAutoDate: "", status: tradingDay }
    );
    assert.equal(r.run, false);
  });
});

describe("localDate", () => {
  it("本地时区拼接，不经过 UTC（跨时区不偏移日期）", () => {
    assert.equal(localDate(new Date(2026, 0, 5, 0, 30)), "2026-01-05");
    assert.equal(localDate(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
  });
});

describe("mergeStrategyHits", () => {
  it("合并多策略、同票只留一条并记录来源策略", () => {
    const hits = mergeStrategyHits([
      { strategyId: "s1", rows: [{ code: "600000", name: "浦发银行" }, { code: "000001", name: "" }] },
      { strategyId: "s2", rows: [{ code: "600000", name: "浦发银行" }, { code: "000002", name: "万科A" }] },
    ]);
    assert.deepEqual(hits.map((h) => h.code), ["000001", "000002", "600000"]);
    const pufa = hits.find((h) => h.code === "600000");
    assert.deepEqual(pufa.strategies, ["s1", "s2"]);
  });

  it("非 6 位代码一律丢弃（模拟盘只做 A 股）", () => {
    const hits = mergeStrategyHits([
      { strategyId: "s1", rows: [{ code: "00700", name: "腾讯" }, { code: "600000.SH" }, { code: "" }] },
    ]);
    assert.equal(hits.length, 0);
  });

  it("先到无名称时由后到补名称", () => {
    const hits = mergeStrategyHits([
      { strategyId: "s1", rows: [{ code: "600000", name: "" }] },
      { strategyId: "s2", rows: [{ code: "600000", name: "浦发银行" }] },
    ]);
    assert.equal(hits[0].name, "浦发银行");
  });

  it("空输入安全", () => {
    assert.deepEqual(mergeStrategyHits(null), []);
    assert.deepEqual(mergeStrategyHits([]), []);
    assert.deepEqual(mergeStrategyHits([{ strategyId: "s1", rows: null }]), []);
  });
});

describe("applyPoolMode", () => {
  const old = [
    { code: "600000", name: "浦发银行", addedAt: "2026-10-01", source: "iwencai" },
    { code: "000001", name: "平安银行", addedAt: "2026-10-01", source: "iwencai" },
  ];
  const hits = [
    { code: "000001", name: "平安银行", strategies: ["s1"] },
    { code: "300750", name: "宁德时代", strategies: ["s1"] },
  ];

  it("replace：当日命中即当日池，统计进出", () => {
    const r = applyPoolMode(hits, old, { mode: "replace", date: "2026-10-23" });
    assert.deepEqual(r.pool.map((p) => p.code), ["000001", "300750"]);
    assert.deepEqual(r.added, ["300750"]);
    assert.deepEqual(r.removed, ["600000"]);
    assert.equal(r.skipped, false);
    assert.equal(r.pool[1].addedAt, "2026-10-23");
    assert.equal(r.pool[1].source, "auto");
  });

  it("merge：只增不减，保留旧池顺序", () => {
    const r = applyPoolMode(hits, old, { mode: "merge", date: "2026-10-23" });
    assert.deepEqual(r.pool.map((p) => p.code), ["600000", "000001", "300750"]);
    assert.deepEqual(r.added, ["300750"]);
    assert.deepEqual(r.removed, []);
  });

  it("命中为空 → 原样返回旧池并标记 skipped（绝不清空）", () => {
    for (const mode of ["replace", "merge"]) {
      const r = applyPoolMode([], old, { mode, date: "2026-10-23" });
      assert.deepEqual(r.pool.map((p) => p.code), ["600000", "000001"]);
      assert.deepEqual(r.added, []);
      assert.deepEqual(r.removed, [], "空命中不能算「移出」");
      assert.equal(r.skipped, true);
    }
  });

  it("未知 mode 按 replace 处理", () => {
    const r = applyPoolMode(hits, old, { mode: "weird", date: "2026-10-23" });
    assert.deepEqual(r.pool.map((p) => p.code), ["000001", "300750"]);
  });

  it("旧池含脏数据时不崩", () => {
    const r = applyPoolMode(hits, [null, { code: "" }, { code: "600000" }], {
      mode: "replace",
      date: "2026-10-23",
    });
    assert.deepEqual(r.pool.map((p) => p.code), ["000001", "300750"]);
    assert.deepEqual(r.removed, ["600000"]);
  });

  it("existing 非数组时视为空池", () => {
    const r = applyPoolMode(hits, null, { mode: "merge", date: "2026-10-23" });
    assert.equal(r.pool.length, 2);
  });
});

describe("describeAutoResult", () => {
  it("空结果返回空串", () => {
    assert.equal(describeAutoResult(null), "");
  });

  it("完整结果拼接各段", () => {
    const text = describeAutoResult({
      poolSize: 12,
      added: ["a", "b"],
      removed: ["c"],
      days: 3,
      failed: ["d"],
      skipped: false,
    });
    assert.match(text, /12/);
    assert.match(text, /新进 2/);
    assert.match(text, /移出 1/);
    assert.match(text, /累积 3 个交易日/);
    assert.match(text, /1 只取数失败/);
  });

  it("skipped 时明确说明池不变", () => {
    assert.match(describeAutoResult({ skipped: true, poolSize: 5 }), /池保持不变/);
  });

  it("无新交易日单独分支", () => {
    assert.match(describeAutoResult({ days: 0, upToDate: true }), /无新交易日/);
  });
});
