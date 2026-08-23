import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import {
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
