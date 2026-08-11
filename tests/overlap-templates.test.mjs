import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import { runRotation } from "../src/engine/simulator.js";
import {
  orangeBurstOnFoot,
  orangeThunderOverlapOnFoot,
  partialOrangeThunderOverlapOnFoot,
  staggeredOrangeAfterThunderOnFoot,
} from "../src/policies/scenarios.js";
import { summarizeOrangeWindow } from "../src/reports/orange-window.js";

const runtime = loadDefaultGearRuntime();

function windowFor(actions) {
  const state = runRotation(
    createInitialState(runtime.config, { rage: 0 }),
    actions,
    runtime.config,
    runtime.oracle,
  );
  return summarizeOrangeWindow(state, runtime.config);
}

test("同时、部分重叠和错开模板分别覆盖5、3、0发激雷龙牙", () => {
  const simultaneous = windowFor(orangeBurstOnFoot());
  const partial = windowFor(partialOrangeThunderOverlapOnFoot());
  const staggered = windowFor(staggeredOrangeAfterThunderOnFoot());

  assert.deepEqual(
    [simultaneous, partial, staggered].map((window) => window.dragonFangs),
    [5, 5, 5],
  );
  assert.deepEqual(
    [simultaneous, partial, staggered].map((window) => window.underThunder),
    [5, 3, 0],
  );
  assert.ok(simultaneous.totalDamage > partial.totalDamage);
  assert.ok(partial.totalDamage > staggered.totalDamage);
});

test("重叠模板拒绝越界或不能整帧表示的时间", () => {
  assert.throws(() => orangeThunderOverlapOnFoot(-1), /0到6秒/);
  assert.throws(() => orangeThunderOverlapOnFoot(7), /0到6秒/);
  assert.throws(() => orangeThunderOverlapOnFoot(0.01), /游戏帧/);
});
