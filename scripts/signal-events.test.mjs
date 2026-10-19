/**
 * 信号落库清洗单测 — 覆盖 `src/utils/history.js` 的 `buildSignalEvents`（纯函数）。
 *
 * 背景：修复前 `utils/history.js` 用 `Number(s.price) || 0` 把缺失价格写成 0，
 * 而 `useSignalHistory` 会以 `price <= 0` 判为 no_price 排除该样本 → 历史信号胜率面板
 * 100% 空转且没有任何报错。方向字段同样曾用中文正则去「猜」，现在改为显式白名单。
 *
 * 跑法：pnpm test（= node --test "scripts/*.test.mjs"）
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildSignalEvents } from "../src/utils/history.js";

/** 构造一条最小可用信号 */
function sig(over = {}) {
  return { name: "放量急拉⚠", time: "09:35", price: 12.34, ...over };
}

test("方向：dir 白名单 up/down 与中文别名都映射到 bull/bear", () => {
  const events = buildSignalEvents("600000", "volume", [
    sig({ name: "a", dir: "up" }),
    sig({ name: "b", dir: "down" }),
    sig({ name: "c", dir: "看涨" }),
    sig({ name: "d", dir: "看跌" }),
    sig({ name: "e", dir: "bull" }),
    sig({ name: "f", dir: "BEAR" }),
  ]);
  assert.deepEqual(
    events.map((e) => [e.name, e.dir]),
    [["a", "bull"], ["b", "bear"], ["c", "bull"], ["d", "bear"], ["e", "bull"], ["f", "bear"]],
  );
});

test("方向：没有 dir 时按 type 映射表回退（volume 链路只给 type）", () => {
  const events = buildSignalEvents("600000", "volume", [
    sig({ name: "放量急拉⚠", type: "bull" }),
    sig({ name: "放量急跌⚠", type: "bear" }),
  ]);
  assert.deepEqual(events.map((e) => e.dir), ["bull", "bear"]);
});

test("方向：推断不出必须留空（不得默认成看涨）", () => {
  const events = buildSignalEvents("600000", "trap", [
    sig({ name: "疑似诱多", action: "追高风险极大，反弹均价受阻" }),
    sig({ name: "未知", dir: "", type: "" }),
  ]);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.dir), ["", ""]);
});

test("缺价格/缺名称的信号一律跳过，不写 price=0", () => {
  const events = buildSignalEvents("600519", "trap", [
    sig({ name: "无价格", price: undefined }),
    sig({ name: "价格为零", price: 0 }),
    sig({ name: "价格为负", price: -1 }),
    sig({ name: "价格非数", price: "abc" }),
    sig({ name: "", price: 10 }),
    sig({ name: 123, price: 10 }),
    sig({ name: "正常", price: 10 }),
  ]);
  assert.deepEqual(events.map((e) => e.name), ["正常"]);
  assert.equal(events[0].price, 10);
});

test("细节字段：detail 优先，回退 desc，缺省为空串", () => {
  const events = buildSignalEvents("000001", "ma", [
    sig({ name: "x", detail: "上穿 MA20" }),
    sig({ name: "y", desc: "跌破 MA5" }),
    sig({ name: "z" }),
  ]);
  assert.deepEqual(events.map((e) => e.detail), ["上穿 MA20", "跌破 MA5", ""]);
});

test("非法入参返回空数组", () => {
  assert.deepEqual(buildSignalEvents("", "trap", [sig()]), []);
  assert.deepEqual(buildSignalEvents("600000", "trap", null), []);
  assert.deepEqual(buildSignalEvents("600000", "trap", []), []);
});

test("code/kind/time 原样透传（后端 UNIQUE 依赖 time 锚点）", () => {
  const [e] = buildSignalEvents("000001", "trap", [sig({ time: "14:57", price: 9.87 })]);
  assert.equal(e.code, "000001");
  assert.equal(e.kind, "trap");
  assert.equal(e.time, "14:57");
  assert.equal(e.price, 9.87);
});
