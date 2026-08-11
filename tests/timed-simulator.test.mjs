import test from "node:test";
import assert from "node:assert/strict";
import { createZeroDamageOracle } from "../src/engine/damage-oracle.js";
import { executeActionPack, runRotation } from "../src/engine/simulator.js";
import { createInitialState } from "../src/engine/state.js";
import { createTimedConfig } from "../src/mechanics/timing.js";
import { orangeBurstOnFoot } from "../src/policies/scenarios.js";

const oracle = createZeroDamageOracle();

function orangeAxis(latencyMs) {
  const config = createTimedConfig({ haste: 31326, latencyMs });
  const result = runRotation(
    createInitialState(config, { rage: 0 }),
    orangeBurstOnFoot(),
    config,
    oracle,
  );
  const orange = result.timeline.find(
    (event) => event.type === "offGcd" && event.action === "orange",
  );
  const dragonFangs = result.timeline.filter(
    (event) => event.type === "cast" && event.action === "dragonFang",
  );
  return { config, result, orange, dragonFangs };
}

test("完整状态机在30ms下复现连续窗口的五发施展时刻", () => {
  const { orange, dragonFangs } = orangeAxis(30);
  const relativeTimes = dragonFangs.map((event) => event.timeMs - orange.timeMs);

  assert.deepEqual(relativeTimes, [62.5, 1342.5, 2622.5, 3902.5, 5182.5]);
  assert.equal(dragonFangs.every((event) => event.orange), true);
  assert.equal(dragonFangs.every((event) => event.thunder), true);
});

test("完整状态机在30/60/90ms下均覆盖五发且末发时刻连续变化", () => {
  const axes = [30, 60, 90].map(orangeAxis);

  assert.deepEqual(axes.map(({ dragonFangs }) => dragonFangs.length), [5, 5, 5]);
  assert.deepEqual(
    axes.map(({ orange, dragonFangs }) => dragonFangs.at(-1).timeMs - orange.timeMs),
    [5182.5, 5302.5, 5422.5],
  );
  assert.equal(
    axes.every(({ dragonFangs }) => dragonFangs.every((event) => event.orange)),
    true,
  );
});

test("连续延迟进入GCD，但不改变技能和增益的游戏帧时长", () => {
  const { config, result, orange } = orangeAxis(30);

  assert.equal(config.gcdFrames, 20);
  assert.equal(result.gcdReadyMs, 7680);
  assert.equal(result.buffs.orangeUntil - result.buffs.orangeFrom, 96);
  assert.equal(result.buffTicks.orangeUntil - result.buffTicks.orangeFrom, 96000);
  assert.equal(result.cooldownReady.orange - orange.frame, config.cooldowns.orange);
});

test("顺序充能在分数帧施展时仍从上一层恢复完成后计时", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const actions = [
    { primary: "cloudStrike", tail: [{ id: "thunder", leadFrames: 1 }] },
    { prefix: ["thunder"], primary: "cloudStrike" },
  ];
  const result = runRotation(createInitialState(config), actions, config, oracle);

  assert.deepEqual(result.charges.thunder.rechargeQueue, [499.48, 979.48]);
  assert.deepEqual(
    result.chargeTicks.thunder.rechargeQueue,
    [499480, 979480],
  );
});

test("时间推进会自动刷新已经恢复的顺序充能层", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const consumed = runRotation(
    createInitialState(config),
    [
      { prefix: ["thunder"], primary: "cloudStrike" },
      { prefix: ["thunder"], primary: "cloudStrike" },
    ],
    config,
    oracle,
  );
  const advanced = executeActionPack(
    consumed,
    { primary: { id: "wait", frames: 500 } },
    config,
    oracle,
  );

  assert.equal(advanced.charges.thunder.ready, 1);
  assert.deepEqual(advanced.charges.thunder.rechargeQueue, [960]);
});
