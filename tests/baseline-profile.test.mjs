import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createZeroDamageOracle } from "../src/engine/damage-oracle.js";
import { createInitialState } from "../src/engine/state.js";
import { createTimedConfig } from "../src/mechanics/timing.js";
import { replayProfileRows } from "../src/policies/profile-replay.js";
import { summarize } from "../src/reports/summary.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const oracle = createZeroDamageOracle();

function replay(profileId, rotation) {
  const config = createTimedConfig(
    {
      haste: fixture.timing.haste,
      latencyMs: fixture.timing.latencyMs,
    },
    { rotation },
  );
  const result = replayProfileRows(
    createInitialState(config, { rage: 5 }),
    fixture.profiles[profileId].rows,
    config,
    oracle,
    { combatEndSeconds: fixture.durationSeconds },
  );
  return { ...result, summary: summarize(result.state, config, oracle) };
}

test("180秒连营基准轴通过技能合法性、充能和逐行战意核对", () => {
  const { state, trace, summary } = replay("lianying", "lianying");

  assert.equal(fixture.validationOnly, true);
  assert.equal(fixture.timing.segment, 5);
  assert.equal(trace.length, 148);
  assert.equal(state.timeMs, 180000);
  assert.deepEqual(summary.actionCounts, {
    ride: 6,
    thunder: 7,
    dragonRoar: 13,
    dragonFang: 95,
    charge: 7,
    dismount: 6,
    destroy: 20,
    cloudStrike: 14,
  });
});

test("180秒牧云大橙武基准轴以3豆龙牙规则完成确定性重放", () => {
  const { state, trace, summary } = replay("muyunOrange", "muyun");

  assert.equal(trace.length, 148);
  assert.equal(state.timeMs, 180000);
  assert.equal(summary.actionCounts.orange, 3);
  assert.equal(summary.actionCounts.dragonFang, 66);
  assert.equal(summary.actionCounts.dragonRoar, 22);
  assert.equal(summary.actionCounts.cloudStrike, 33);
  assert.equal(summary.actionCounts.destroy, 21);
});
