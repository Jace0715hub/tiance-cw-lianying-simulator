import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateFrameTiming,
  enumerateTimingBands,
} from "../src/mechanics/timing.js";

test("加速先换算为16帧游戏时间，再单独记录延迟", () => {
  const timing = calculateFrameTiming({ haste: 31326, latencyMs: 30 });

  assert.equal(timing.acceleratedFrames, 152);
  assert.equal(timing.gcdFrames, 20);
  assert.equal(timing.rideCastFrames, 10);
  assert.equal(timing.wideGcdFrames, 24);
  assert.equal(timing.dotIntervalFrames, 27);
  assert.equal(timing.effectiveGcdSeconds, 1.28);
  assert.equal(timing.segment, 4);
});

test("同一游戏帧档可能因延迟落入不同Excel加速段", () => {
  const low = calculateFrameTiming({ haste: 31326, latencyMs: 30 });
  const high = calculateFrameTiming({ haste: 31326, latencyMs: 90 });

  assert.equal(low.gcdFrames, 20);
  assert.equal(high.gcdFrames, 20);
  assert.equal(low.segment, 4);
  assert.equal(high.segment, 3);
});

test("可枚举连续加速范围内的帧档边界", () => {
  const bands = enumerateTimingBands({
    latencyMs: 30,
    minHaste: 30000,
    maxHaste: 32000,
  });

  assert.equal(bands[0].minHaste, 30000);
  assert.equal(bands.at(-1).maxHaste, 32000);
  assert.equal(
    bands.every((band, index) => index === 0 || band.minHaste === bands[index - 1].maxHaste + 1),
    true,
  );
});

test("延迟不改变游戏内帧档，只改变可执行间隔", () => {
  const low = calculateFrameTiming({ haste: 31326, latencyMs: 30 });
  const high = calculateFrameTiming({ haste: 31326, latencyMs: 90 });

  assert.equal(low.gcdFrames, high.gcdFrames);
  assert.equal(low.rideCastFrames, high.rideCastFrames);
  assert.ok(
    Math.abs(high.effectiveGcdSeconds - low.effectiveGcdSeconds - 0.06) < 1e-12,
  );
});
