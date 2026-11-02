/**
 * utils/limit.js 单测 —— 锁住「涨跌停幅度按板块，ST 与所属板块一致」的规则。
 *
 * 为什么值得锁：2026-07-06 起主板 ST 的涨跌幅由 ±5% 改为与板块一致的 ±10%，
 * 项目里曾按旧规则给 ST 加过 name 参数分支（已回退）。这条用例保证以后
 * 任何人「顺手把 ST 改回 ±5%」都会立刻变红，而不是等到用户看到错的涨停价。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { getLimitPct, getLimitThreshold } from "../src/utils/limit.js";

test("主板（含 ST/*ST）— 一律 ±10%", () => {
  assert.equal(getLimitPct("600519"), 10); // 沪主板
  assert.equal(getLimitPct("000001"), 10); // 深主板
  // ST 与普通股口径相同：函数根本不接收名称，ST 不会被区分对待
  assert.equal(getLimitPct("600519"), 10);
  assert.equal(getLimitPct("000004"), 10); // 曾为 ST 的深主板代码
});

test("创业板 / 科创板 ±20%", () => {
  assert.equal(getLimitPct("300750"), 20);
  assert.equal(getLimitPct("301001"), 20);
  assert.equal(getLimitPct("688981"), 20);
  assert.equal(getLimitPct("689009"), 20);
});

test("北交所 ±30%", () => {
  for (const code of ["430047", "830799", "831010", "870508", "871981", "920002"]) {
    assert.equal(getLimitPct(code), 30, `${code} 应判北交所`);
  }
});

test("港股无涨跌停（返回 0）", () => {
  assert.equal(getLimitPct("00700"), 0);
  assert.equal(getLimitPct("09988"), 0);
});

test("空代码回退主板口径，避免参考线消失", () => {
  assert.equal(getLimitPct(""), 10);
  assert.equal(getLimitPct(null), 10);
  assert.equal(getLimitPct(undefined), 10);
});

test("涨停阈值 = 幅度 - 0.5%，港股为 0", () => {
  assert.equal(getLimitThreshold("600519"), 9.5);
  assert.equal(getLimitThreshold("300750"), 19.5);
  assert.equal(getLimitThreshold("430047"), 29.5);
  assert.equal(getLimitThreshold("00700"), 0);
});

test("名称参数即便被误传也不会改变结果（ST 不做特判）", () => {
  // 旧实现 getLimitPct(code, name) 会对 "ST中珠" 返回 5；现在多余参数被忽略
  assert.equal(getLimitPct("600568", "ST中珠"), 10);
  assert.equal(getLimitPct("600568", "*ST海核"), 10);
  assert.equal(getLimitThreshold("600568", "S*ST天香"), 9.5);
});
