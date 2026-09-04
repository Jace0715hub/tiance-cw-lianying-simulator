import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import {
  combineLianyingEventTimingMutations,
  compressLianyingEventTimingPlatforms,
  generateLianyingEventTimingMutations,
  lianyingEventBreakpointLeads,
} from "../src/policies/lianying-event-timing-search.js";

test("事件断点映射为GCD内可表达的整数提前帧", () => {
  const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
  const state = createInitialState(runtime.config, {
    rage: 5,
    executePhase: true,
  });
  state.autoAttackNextTick = 8_000;
  const leads = lianyingEventBreakpointLeads(
    state,
    { prefix: ["orange"], primary: "dragonFang" },
    runtime.config,
  );
  assert.ok(leads.length > 0);
  assert.ok(leads.every(({ leadFrames }) =>
    Number.isInteger(leadFrames) && leadFrames >= 1 && leadFrames <= 16));
  assert.ok(leads.some(({ eventKinds }) =>
    eventKinds.some((kind) => kind.startsWith("autoAttack"))));
});

test("事件断点候选固定主要技能和动作所在行且只改变时点", () => {
  const source = JSON.parse(fs.readFileSync(new URL(
    "../output/lianying-free-fixed-180s-pair-anchor-wait.json",
    import.meta.url,
  )));
  const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
  const mutations = generateLianyingEventTimingMutations(
    runtime,
    source.actionPacks,
    { durationSeconds: 180 },
  );
  assert.ok(mutations.length > 0);
  const primaryId = (pack) => typeof pack.primary === "string"
    ? pack.primary
    : pack.primary?.id;
  for (const mutation of mutations.slice(0, 32)) {
    assert.equal(
      primaryId(mutation.packs[mutation.rowNumber - 1]),
      primaryId(source.actionPacks[mutation.rowNumber - 1]),
    );
    assert.ok(["thunder", "orange", "charge", "dismount"].includes(
      mutation.action,
    ));
  }
});

test("无单点收益事件平台按同一伤害平台只保留时点两端", () => {
  const candidate = (rowNumber, action, leadFrames, damageGain) => ({
    rowNumber,
    action,
    sourceLocation: "tail",
    sourceLeadFrames: 1,
    targetLocation: "tail",
    targetLeadFrames: leadFrames,
    damageGain,
  });
  const seeds = compressLianyingEventTimingPlatforms([
    candidate(3, "orange", 2, 0),
    candidate(3, "orange", 4, 0),
    candidate(3, "orange", 7, 0),
    candidate(38, "thunder", 2, -245_653.2),
    candidate(38, "thunder", 5, -245_653.1),
    candidate(59, "thunder", 5, -600_000),
    candidate(80, "thunder", 5, 1),
  ], {
    maximumSingleLoss: 500_000,
    representativesPerPlatform: 2,
  });
  assert.deepEqual(
    seeds.filter((seed) => seed.rowNumber === 3)
      .map((seed) => seed.targetLeadFrames)
      .sort((left, right) => left - right),
    [2, 7],
  );
  assert.equal(seeds.some((seed) => seed.rowNumber === 59), false);
  assert.equal(seeds.some((seed) => seed.rowNumber === 80), false);
});

test("同一行的雷与橙武时点可以合并而不会互相覆盖", () => {
  const baseline = [{
    prefix: [],
    primary: "ride",
    tail: [
      { id: "thunder", leadFrames: 5 },
      { id: "orange", leadFrames: 1 },
    ],
  }];
  const thunder = {
    rowNumber: 1,
    action: "thunder",
    packs: [{
      prefix: [],
      primary: "ride",
      tail: [
        { id: "thunder", leadFrames: 6 },
        { id: "orange", leadFrames: 1 },
      ],
    }],
  };
  const orange = {
    rowNumber: 1,
    action: "orange",
    packs: [{
      prefix: [],
      primary: "ride",
      tail: [
        { id: "thunder", leadFrames: 5 },
        { id: "orange", leadFrames: 4 },
      ],
    }],
  };
  const [combined] = combineLianyingEventTimingMutations(
    baseline,
    [thunder, orange],
  );
  assert.deepEqual(combined.tail, [
    { id: "thunder", leadFrames: 6 },
    { id: "orange", leadFrames: 4 },
  ]);
});
