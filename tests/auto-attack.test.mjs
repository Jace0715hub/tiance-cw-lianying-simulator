import test from "node:test";
import assert from "node:assert/strict";
import { createZeroDamageOracle } from "../src/engine/damage-oracle.js";
import { executeActionPack, runRotation } from "../src/engine/simulator.js";
import { createInitialState } from "../src/engine/state.js";
import { createTimedConfig } from "../src/mechanics/timing.js";

const oracle = createZeroDamageOracle();

function autoAttacks(state) {
  return state.timeline.filter(
    (event) => event.type === "damage" && event.component === "autoAttack",
  );
}

test("进入战斗立即产生第一击，之后按加速后宽GCD循环", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const result = executeActionPack(
    createInitialState(config),
    { primary: { id: "wait", frames: 50 } },
    config,
    oracle,
  );

  assert.equal(config.autoAttackIntervalFrames, 24);
  assert.deepEqual(autoAttacks(result).map((event) => event.frame), [0, 24, 48]);
  assert.equal(result.autoAttackNextFrame, 72);
});

test("任驰骋完成、上马与下马均不重置自动攻击节奏", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const result = runRotation(
    createInitialState(config),
    [
      { primary: "ride" },
      { prefix: ["dismount"], primary: { id: "wait", frames: 30 } },
    ],
    config,
    oracle,
  );

  assert.deepEqual(autoAttacks(result).map((event) => event.frame), [0, 24, 48]);
  assert.equal(result.autoAttackNextFrame, 72);
});

test("自动攻击按命中时刻快照激雷与驰骋", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const result = executeActionPack(
    createInitialState(config, {
      buffs: {
        thunderFrom: 10,
        thunderUntil: 40,
        rideFrom: 20,
        rideUntil: 40,
      },
    }),
    { primary: { id: "wait", frames: 50 } },
    config,
    oracle,
  );
  const hits = autoAttacks(result);

  assert.deepEqual(
    hits.map((event) => [event.frame, event.thunder, event.ride, event.mounted]),
    [
      [0, false, false, false],
      [24, true, true, false],
      [48, false, false, false],
    ],
  );
  const snapshots = [];
  const snapshotOracle = {
    id: "snapshot",
    evaluateComponent(component, snapshot) {
      if (component === "autoAttack") snapshots.push(snapshot);
      return 0;
    },
  };
  executeActionPack(
    createInitialState(config, {
      buffs: {
        thunderFrom: 10,
        thunderUntil: 40,
        rideFrom: 20,
        rideUntil: 40,
      },
    }),
    { primary: { id: "wait", frames: 50 } },
    config,
    snapshotOracle,
  );
  assert.deepEqual(
    snapshots.map((snapshot) => [snapshot.frame, snapshot.thunder, snapshot.ride]),
    [
      [0, false, false],
      [24, true, true],
      [48, false, false],
    ],
  );
});
