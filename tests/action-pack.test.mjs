import test from "node:test";
import assert from "node:assert/strict";
import { createConfig } from "../src/config/defaults.js";
import { createZeroDamageOracle } from "../src/engine/damage-oracle.js";
import { executeActionPack, runRotation } from "../src/engine/simulator.js";
import { createInitialState } from "../src/engine/state.js";
import { orangeBurstOnFoot } from "../src/policies/scenarios.js";

const config = createConfig({ gcdFrames: 20 });
const oracle = createZeroDamageOracle();

test("GCD末端非GCD技能在下一技能前1帧生效", () => {
  const initial = createInitialState(config, { rage: 4 });
  const prepared = executeActionPack(
    initial,
    {
      primary: "cloudStrike",
      tail: [
        { id: "thunder", leadFrames: 1 },
        { id: "orange", leadFrames: 1 },
      ],
    },
    config,
    oracle,
  );
  const thunder = prepared.timeline.find(
    (event) => event.type === "offGcd" && event.action === "thunder",
  );
  const orange = prepared.timeline.find(
    (event) => event.type === "offGcd" && event.action === "orange",
  );

  assert.equal(prepared.frame, 20);
  assert.equal(thunder.frame, 19);
  assert.equal(orange.frame, 19);

  const result = executeActionPack(
    prepared,
    { primary: "dragonFang" },
    config,
    oracle,
  );
  const cast = result.timeline.findLast(
    (event) => event.type === "cast" && event.action === "dragonFang",
  );
  assert.equal(cast.frame, 20);
  assert.equal(cast.thunder, true);
  assert.equal(cast.orange, true);
});

test("20帧GCD下，GCD末端开启的96帧橙武覆盖5发龙牙", () => {
  const result = runRotation(
    createInitialState(config, { rage: 0 }),
    orangeBurstOnFoot(),
    config,
    oracle,
  );
  const casts = result.timeline.filter(
    (event) => event.type === "cast" && event.action === "dragonFang",
  );

  assert.equal(casts.length, 5);
  assert.equal(casts.every((event) => event.orange), true);
  assert.equal(casts.every((event) => event.thunder), true);
  assert.equal(result.dragonRideStacks, 5);
});

test("顺序充能的第二层从第一层恢复后开始计时", () => {
  const first = executeActionPack(
    createInitialState(config),
    { prefix: ["thunder"], primary: "cloudStrike" },
    config,
    oracle,
  );
  const second = executeActionPack(
    first,
    { prefix: ["thunder"], primary: "cloudStrike" },
    config,
    oracle,
  );

  assert.deepEqual(second.charges.thunder.rechargeQueue, [480, 960]);
});

test("任驰骋连续消耗两层后同样按顺序恢复", () => {
  const first = executeActionPack(
    createInitialState(config),
    { primary: "ride" },
    config,
    oracle,
  );
  const second = executeActionPack(
    first,
    { prefix: ["dismount"], primary: "ride" },
    config,
    oracle,
  );

  assert.deepEqual(second.charges.ride.rechargeQueue, [544, 1088]);
});

test("战斗截止点可以截断最后一个GCD并忽略截止后的末端动作", () => {
  const result = executeActionPack(
    createInitialState(config),
    {
      primary: "cloudStrike",
      tail: [{ id: "orange", leadFrames: 1 }],
    },
    config,
    oracle,
    { endTick: 10000 },
  );

  assert.equal(result.frame, 10);
  assert.equal(result.gcdReadyFrame, 20);
  assert.equal(result.timeline.some((event) => event.action === "orange"), false);
});
