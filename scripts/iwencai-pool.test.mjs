/**
 * 问财选股 → 模拟盘自选池 的候选提取单测（`pickPaperPoolCandidates` 纯函数）。
 *
 * 背景：问财结果列里 `股票代码` 带交易所后缀（301565.SZ），港股是 5 位数字，
 * 而模拟盘只按 A 股规则撮合（涨跌停 / T+1 / 手数）。混进港股或把后缀原样写进池，
 * 会让 `usePaperAccount` 的行情与撮合全部走错分支，所以这里必须与入池口径严格一致。
 *
 * 跑法：pnpm test（= node --test "scripts/*.test.mjs"）
 */
import test from "node:test";
import assert from "node:assert/strict";

import { pickPaperPoolCandidates } from "../src/composables/useIwencaiRobot.js";

test("提取：带后缀的 6 位 A 股代码剥后缀后入池", () => {
  const rows = [
    { 股票代码: "301565.SZ", 股票简称: "中工国际" },
    { 股票代码: "600000.SH", 股票简称: "浦发银行" },
    { 股票代码: "832000.BJ", 股票简称: "北交所票" },
  ];
  assert.deepEqual(pickPaperPoolCandidates(rows), [
    { code: "301565", name: "中工国际", source: "iwencai" },
    { code: "600000", name: "浦发银行", source: "iwencai" },
    { code: "832000", name: "北交所票", source: "iwencai" },
  ]);
});

test("提取：港股 5 位与非代码行一律丢弃", () => {
  const rows = [
    { 股票代码: "00700", 股票简称: "腾讯控股" },
    { 股票代码: "00700.HK", 股票简称: "腾讯控股" },
    { 股票简称: "没有代码的行" },
    { 股票代码: "", 股票简称: "空代码" },
    { 股票代码: "600519", 股票简称: "贵州茅台" },
  ];
  const out = pickPaperPoolCandidates(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].code, "600519");
});

test("提取：重复代码只保留首次出现的那条", () => {
  const rows = [
    { 股票代码: "600519.SH", 股票简称: "贵州茅台" },
    { 股票代码: "600519", 股票简称: "贵州茅台（重复）" },
    { code: "600519", 股票简称: "再一次重复" },
  ];
  const out = pickPaperPoolCandidates(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "贵州茅台");
});

test("提取：缺名称时 name 为空串，不写 undefined", () => {
  const out = pickPaperPoolCandidates([{ 股票代码: "000001" }]);
  assert.deepEqual(out, [{ code: "000001", name: "", source: "iwencai" }]);
});

test("提取：非数组入参不抛错", () => {
  assert.deepEqual(pickPaperPoolCandidates(null), []);
  assert.deepEqual(pickPaperPoolCandidates(undefined), []);
  assert.deepEqual(pickPaperPoolCandidates("600519"), []);
});
