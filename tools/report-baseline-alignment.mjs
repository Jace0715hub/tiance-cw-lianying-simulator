import fs from "node:fs";
import { loadGearTemplate, createGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import { replayProfileRows } from "../src/policies/profile-replay.js";
import { buildBaselineAlignment } from "../src/reports/baseline-alignment.js";
import { applyExpectedEquipmentDamage } from "../src/effects/expected-equipment.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("../data/excel-v1.3-profile-reference.json", import.meta.url), "utf8"),
);
const template = loadGearTemplate();
const cases = [
  ["连营", "lianying", "lianying"],
  ["牧云大橙武", "muyunOrange", "muyun"],
];

for (const [label, profileId, rotation] of cases) {
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
  console.log(`\n=== ${label}：总伤害对齐 ===`);
  console.table(report.rows);
  console.table(report.unsupported);
  console.log(JSON.stringify({
    excelTotalDamage: report.excelTotalDamage,
    simulatedDamage: report.simulatedDamage,
    comparableExcelDamage: report.comparableExcelDamage,
    unsupportedDamage: report.unsupportedDamage,
    damageDelta: report.damageDelta,
    damageDeltaPercent: report.damageDeltaPercent,
  }, null, 2));
}
