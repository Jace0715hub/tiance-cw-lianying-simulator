import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { applyExpectedEquipmentDamage } from
  "../src/effects/expected-equipment.js";
import { replayWhitepaperLianying } from
  "../src/policies/whitepaper-lianying.js";
import { buildLianyingCurrentBestVerification } from
  "../src/reports/lianying-current-best-verification.js";

const artifact = JSON.parse(fs.readFileSync(new URL(
  "../output/lianying-free-fixed-180s-event-breakpoint.json",
  import.meta.url,
)));

test("current 180s axis passes independent replay and accounting verification", () => {
  const runtime = loadDefaultGearRuntime({
    rotation: "lianying",
    executePhase: true,
    latencyMs: 30,
  });
  const replay = replayWhitepaperLianying(runtime, artifact.actionPacks, {
    durationSeconds: 180,
  });
  const finalState = applyExpectedEquipmentDamage(
    replay.state,
    runtime.expectedEquipmentEffects,
    runtime.panel,
    runtime.oracle,
    { durationSeconds: 180 },
  );
  const report = buildLianyingCurrentBestVerification({
    artifact,
    replayState: replay.state,
    finalState,
    runtime,
  });
  assert.equal(report.result.allHardChecksPassed, true);
  assert.equal(report.orangeWindows.length, 4);
  assert.deepEqual(report.orangeWindows.map((window) => window.dragonFangs), [5, 5, 5, 5]);
  assert.equal(report.periodic.bleed.count, 110);
  assert.equal(report.periodic.bleed.continuousUpperBound, 110);
  assert.equal(report.periodic.bleed.gaps.length, 1);
  assert.equal(report.periodic.bleed.gaps[0].dragonFangsWhileInactive, 0);
  assert.equal(report.rideThunder.thunderBeforeRideCompletionCount, 0);
  assert.equal(report.thunderResource.startsBelowFive, 2);
  assert.equal(report.thunderResource.neutralizedByOrangeBeforeNextCast, 1);
  assert.equal(report.thunderResource.actionableStartsBelowFive, 1);
  assert.equal(report.thunderResource.rows[0].orangeBeforeNextCast, true);
});
