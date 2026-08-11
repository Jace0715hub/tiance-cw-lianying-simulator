import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { loadGearTemplate, createGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import { replayProfileRows } from "../src/policies/profile-replay.js";
import { buildBaselineAlignment } from "../src/reports/baseline-alignment.js";
import { applyExpectedEquipmentDamage } from "../src/effects/expected-equipment.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const template = loadGearTemplate();

for (const [label, profileId, rotation] of [
  ["连营", "lianying", "lianying"],
  ["牧云大橙武", "muyunOrange", "muyun"],
]) {
  test(`${label}基准轴总伤害差异低于0.5%`, () => {
    const runtime = createGearRuntime(template, { rotation });
    const replay = replayProfileRows(
      createInitialState(runtime.config, { rage: 5 }),
      fixture.profiles[profileId].rows,
      runtime.config,
      runtime.oracle,
      { combatEndSeconds: fixture.durationSeconds },
    );
    const state = applyExpectedEquipmentDamage(
      replay.state,
      runtime.expectedEquipmentEffects,
      runtime.panel,
      runtime.oracle,
      { durationSeconds: fixture.durationSeconds },
    );
    const report = buildBaselineAlignment(state, fixture.references[profileId]);

    assert.ok(Math.abs(report.damageDeltaPercent) < 0.005);
    assert.equal(report.unsupportedDamage, 0);
    assert.deepEqual(report.unsupported, []);
  });
}
