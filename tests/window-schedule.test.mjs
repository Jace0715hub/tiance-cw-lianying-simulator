import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWindowCastSchedule,
  compareWindowCoverage,
} from "../src/mechanics/window-schedule.js";

test("默认43002加速在30/60/90ms下均可覆盖五发龙牙", () => {
  const results = compareWindowCoverage({
    hasteValues: [43002],
    latencyValues: [30, 60, 90],
  });

  assert.deepEqual(results.map((result) => result.count), [5, 5, 5]);
  assert.deepEqual(results.map((result) => result.intervalMs), [1217.5, 1247.5, 1277.5]);
  assert.equal(results.every((result) => result.firstCastAtMs === 62.5), true);
});

test("窗口采用半开区间，恰好在结束时刻施展不计入", () => {
  const result = buildWindowCastSchedule({
    haste: 0,
    latencyMs: 0,
    windowSeconds: 6,
    activationLeadFrames: 0,
  });

  assert.deepEqual(
    result.casts.map((cast) => cast.castAtMs),
    [0, 1500, 3000, 4500],
  );
  assert.equal(result.count, 4);
});

test("激活提前量和首发额外延迟分别计入覆盖时间", () => {
  const base = buildWindowCastSchedule({
    haste: 31326,
    latencyMs: 30,
    activationLeadFrames: 1,
  });
  const delayed = buildWindowCastSchedule({
    haste: 31326,
    latencyMs: 30,
    activationLeadFrames: 1,
    firstCastDelayMs: 900,
  });

  assert.equal(base.firstCastAtMs, 62.5);
  assert.equal(delayed.firstCastAtMs, 962.5);
  assert.equal(base.count, 5);
  assert.equal(delayed.count, 4);
});
