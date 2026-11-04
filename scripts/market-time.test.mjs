/**
 * utils/marketTime.js 盘后固定价格交易单测
 *
 * 锁的是 2026-07-06 沪深新规的硬边界：15:05-15:30、沪深全部 A 股、成交价恒为收盘价。
 * 边界写错（例如按用户口语的 15:00 开始）会让模拟盘在交易所还没撮合时就能成交。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AFTER_HOURS,
  getAfterHoursStatus,
  getMarketStatus,
  isTradingHours,
  supportsAfterHours,
} from "../src/utils/marketTime.js";

/** 2026-11-04 是周三；day=7/8 分别是周六、周日 */
function at(h, m, day = 4) {
  return new Date(2026, 10, day, h, m);
}

test("盘后 — 窗口常量为 15:05-15:30（前 5 分钟不撮合）", () => {
  assert.equal(AFTER_HOURS.startAt, "15:05");
  assert.equal(AFTER_HOURS.endAt, "15:30");
  assert.equal(AFTER_HOURS.startMinute, 905);
  assert.equal(AFTER_HOURS.endMinute, 930);
});

test("盘后 — 15:04 不可、15:05 可、15:30 可、15:31 不可", () => {
  const cases = [
    [15, 4, false, /15:05 开始/],
    [15, 5, true, null],
    [15, 29, true, null],
    [15, 30, true, null],
    [15, 31, false, /15:30 结束/],
  ];
  for (const [h, m, expected, reasonRe] of cases) {
    const res = getAfterHoursStatus("600519", at(h, m));
    assert.equal(res.available, expected, `${h}:${String(m).padStart(2, "0")} 判定错误：${res.reason}`);
    if (expected) assert.equal(res.session, "afterHours");
    else {
      assert.equal(res.session, "closed");
      assert.match(res.reason, reasonRe);
    }
  }
  assert.equal(getAfterHoursStatus("600519", at(15, 5)).minutesLeft, 25);
  assert.equal(getAfterHoursStatus("600519", at(15, 30)).minutesLeft, 0);
});

test("盘后 — 不改变 getMarketStatus.state，也不扩大 isTradingHours", () => {
  const s = getMarketStatus("600519", at(15, 10));
  assert.equal(s.state, "post", "盘后仍是 post，避免影响全局降频与状态渲染");
  assert.equal(s.afterHours, true);
  assert.equal(s.afterHoursStartAt, "15:05");
  assert.equal(s.afterHoursEndAt, "15:30");
  assert.equal(isTradingHours("600519", at(15, 10)), false, "盘后不属于连续竞价，轮询口径不变");
  assert.equal(getMarketStatus("600519", at(15, 4)).afterHours, false);
  assert.equal(getMarketStatus("600519", at(10, 0)).afterHours, false);
});

test("盘后 — 沪深全部 A 股适用；北交所、港股、ETF/指数不适用", () => {
  for (const code of ["600519", "000001", "300750", "688981", "601318"]) {
    assert.equal(supportsAfterHours(code), true, `${code} 应适用盘后固定价`);
    assert.equal(getAfterHoursStatus(code, at(15, 10)).available, true, `${code} 盘中盘后应可下单`);
  }
  assert.equal(supportsAfterHours("830799"), false);
  assert.equal(supportsAfterHours("920090"), false);
  const bj = getAfterHoursStatus("830799", at(15, 10));
  assert.equal(bj.available, false);
  assert.match(bj.reason, /北交所/);
  assert.equal(supportsAfterHours("00700"), false);
  const hk = getAfterHoursStatus("00700", at(15, 10));
  assert.equal(hk.available, false);
  assert.match(hk.reason, /港股/);
  assert.equal(supportsAfterHours("sh000001"), false, "指数/带前缀代码不在模拟盘范围");
  assert.equal(supportsAfterHours(""), true, "未指定代码时按沪深 A 股默认");
});

test("盘后 — 非交易日与连续竞价时段均不可盘后下单", () => {
  const weekend = getAfterHoursStatus("600519", at(15, 10, 7)); // 周六
  assert.equal(weekend.available, false);
  assert.match(weekend.reason, /非交易日/);
  const morning = getAfterHoursStatus("600519", at(10, 0));
  assert.equal(morning.available, false);
  assert.equal(getMarketStatus("600519", at(10, 0)).state, "open", "上午仍在连续竞价");
});

test("盘后 — nearWindow 供 UI 加密刷新状态（纯本地、零请求）", () => {
  assert.equal(getAfterHoursStatus("600519", at(14, 59)).nearWindow, false);
  assert.equal(getAfterHoursStatus("600519", at(15, 0)).nearWindow, true);
  assert.equal(getAfterHoursStatus("600519", at(15, 10)).nearWindow, true);
  assert.equal(getAfterHoursStatus("600519", at(15, 35)).nearWindow, true);
  assert.equal(getAfterHoursStatus("600519", at(16, 0)).nearWindow, false);
});
