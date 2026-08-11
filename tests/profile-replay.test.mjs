import test from "node:test";
import assert from "node:assert/strict";
import { createConfig } from "../src/config/defaults.js";
import { createZeroDamageOracle } from "../src/engine/damage-oracle.js";
import { createInitialState } from "../src/engine/state.js";
import {
  compileProfileLabel,
  replayProfileRows,
} from "../src/policies/profile-replay.js";

const oracle = createZeroDamageOracle();

test("组合技能标签编译为前置非GCD、主要技能和GCD末端橙武", () => {
  assert.deepEqual(compileProfileLabel("雷断魂刺龙牙"), {
    prefix: ["thunder", "charge"],
    primary: "dragonFang",
    tail: [],
    sourceLabel: "雷断魂刺龙牙",
  });
  assert.deepEqual(compileProfileLabel("龙吟-CW"), {
    prefix: [],
    primary: "dragonRoar",
    tail: [{ id: "orange", leadFrames: 1 }],
    sourceLabel: "龙吟-CW",
  });
  assert.throws(() => compileProfileLabel("龙牙未知标记"), /未识别内容/);
});

test("连营技能表可以逐行核对战意并在龙驭耗尽后自动下马", () => {
  const config = createConfig({ rotation: "lianying", gcdFrames: 20 });
  const rows = [
    ["任驰骋", 5, 5],
    ["雷龙吟", 5, 5],
    ["龙牙", 5, 4],
    ["龙牙", 4, 3],
    ["龙牙", 3, 2],
    ["断魂刺龙牙", 5, 4],
    ["龙牙", 4, 3],
    ["龙牙", 3, 2],
    ["灭", 2, 5],
    ["龙牙", 5, 4],
  ].map(([skill, resourceBefore, resourceAfter]) => ({
    skill,
    resourceBefore,
    resourceAfter,
  }));
  const { state, trace } = replayProfileRows(
    createInitialState(config, { rage: 5 }),
    rows,
    config,
    oracle,
  );

  assert.equal(trace.length, rows.length);
  assert.equal(trace[8].autoDismounted, true);
  assert.equal(state.mounted, false);
  assert.equal(state.dragonRideStacks, 1);
});

test("技能表战意与状态机不一致时立即报告具体行", () => {
  const config = createConfig({ rotation: "muyun", gcdFrames: 20 });
  assert.throws(
    () => replayProfileRows(
      createInitialState(config, { rage: 5 }),
      [{ skill: "雷龙牙", resourceBefore: 5, resourceAfter: 4 }],
      config,
      oracle,
    ),
    /第1行.*战意不一致.*施展后 2\/4/,
  );
});

test("龙驭耗尽且本行含断魂刺时先断魂刺再下马施展龙牙", () => {
  const config = createConfig({ rotation: "lianying", gcdFrames: 20 });
  const { state } = replayProfileRows(
    createInitialState(config, {
      rage: 2,
      mounted: true,
      mountedFrom: 0,
      dragonRideStacks: 0,
    }),
    [{ skill: "断魂刺龙牙", resourceBefore: 5, resourceAfter: 2 }],
    config,
    oracle,
  );
  const actions = state.timeline
    .filter((event) => event.action)
    .map((event) => event.action);

  assert.deepEqual(actions.slice(0, 3), ["charge", "dismount", "dragonFang"]);
  assert.equal(state.mounted, false);
  assert.equal(state.dragonRideStacks, 1);
});

test("技能表在马上安排任驰骋时先显式下马", () => {
  const config = createConfig({ rotation: "lianying", gcdFrames: 20 });
  const state = createInitialState(config, {
    mounted: true,
    mountedFrom: 0,
    dragonRideStacks: 3,
  });
  const result = replayProfileRows(
    state,
    [{ skill: "任驰骋" }],
    config,
    oracle,
    { validateResource: false },
  );
  const actions = result.state.timeline
    .filter((event) => event.type === "cast" || event.type === "offGcd")
    .map((event) => event.action);

  assert.deepEqual(actions, ["dismount", "ride"]);
  assert.equal(result.trace[0].autoDismounted, true);
});
