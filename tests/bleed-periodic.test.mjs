import test from "node:test";
import assert from "node:assert/strict";
import { createZeroDamageOracle } from "../src/engine/damage-oracle.js";
import { executeActionPack } from "../src/engine/simulator.js";
import { createInitialState } from "../src/engine/state.js";
import { createTimedConfig } from "../src/mechanics/timing.js";

const oracle = createZeroDamageOracle();

function bleedEvents(state) {
  return state.timeline.filter(
    (event) => event.type === "damage" && event.component === "bleedTick",
  );
}

test("首次施加流血经过一个加速后间隔才产生第一跳", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const applied = executeActionPack(
    createInitialState(config, { rage: 2 }),
    { primary: "destroy" },
    config,
    oracle,
  );

  assert.equal(config.dotIntervalFrames, 27);
  assert.equal(applied.bleedNextFrame, 27);
  assert.equal(bleedEvents(applied).length, 0);

  const advanced = executeActionPack(
    applied,
    { primary: { id: "wait", frames: 7 } },
    config,
    oracle,
  );
  const ticks = bleedEvents(advanced);

  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].frame, 27);
  assert.equal(ticks[0].timeMs, 1687.5);
});

test("刷新流血更新层数和品质但保持原下一跳节奏", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const normal = executeActionPack(
    createInitialState(config, { rage: 0 }),
    { prefix: ["orange"], primary: "dragonRoar" },
    config,
    oracle,
  );
  assert.equal(normal.bleedNextFrame, 27);

  const warheart = executeActionPack(
    normal,
    { primary: "destroy" },
    config,
    oracle,
  );
  const ticks = bleedEvents(warheart);

  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].frame, 27);
  assert.equal(ticks[0].bleedStacks, 2);
  assert.equal(ticks[0].bleedQuality, 2);
  assert.equal(warheart.bleedNextFrame, 54);
});

test("流血到期采用半开区间且不会在到期帧补跳", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const applied = executeActionPack(
    createInitialState(config, { rage: 2 }),
    { primary: "destroy" },
    config,
    oracle,
  );
  const completed = executeActionPack(
    applied,
    { primary: { id: "wait", frames: 230 } },
    config,
    oracle,
  );
  const ticks = bleedEvents(completed);

  assert.deepEqual(
    ticks.map((event) => event.frame),
    [27, 54, 81, 108, 135, 162, 189, 216],
  );
  assert.equal(completed.bleedStacks, 0);
  assert.equal(completed.bleedQuality, 0);
  assert.equal(completed.bleedNextTick, 0);
});

test("刷新延长持续时间后仍沿原节奏产生后续跳伤", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const first = executeActionPack(
    createInitialState(config, { rage: 0 }),
    { prefix: ["orange"], primary: "dragonRoar" },
    config,
    oracle,
  );
  const refreshed = executeActionPack(
    first,
    { primary: "destroy" },
    config,
    oracle,
  );
  const completed = executeActionPack(
    refreshed,
    { primary: { id: "wait", frames: 230 } },
    config,
    oracle,
  );

  assert.deepEqual(
    bleedEvents(completed).map((event) => event.frame),
    [27, 54, 81, 108, 135, 162, 189, 216, 243],
  );
});
