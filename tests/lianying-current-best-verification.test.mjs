import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { applyExpectedEquipmentDamage } from
  "../src/effects/expected-equipment.js";
import {
  optimizeLianyingNeighborhoodAxis,
  replayWhitepaperLianying,
} from
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

test("下马突迁移与主技能替换联合邻域能跨过单步降低的局部谷底", () => {
  const runtime = loadDefaultGearRuntime({
    rotation: "lianying",
    executePhase: true,
    latencyMs: 30,
  });
  const candidate = structuredClone(artifact.actionPacks);
  candidate[120] = { prefix: [], primary: "dragonFang", tail: [] };
  candidate[121] = {
    prefix: [],
    primary: "cloudStrike",
    tail: [
      { id: "dismount", reason: "gcd-tail-free-search", leadFrames: 1 },
      { id: "dash", leadFrames: 1 },
    ],
  };
  const baseline = replayWhitepaperLianying(runtime, candidate, {
    durationSeconds: 180,
  });
  const optimized = optimizeLianyingNeighborhoodAxis(runtime, candidate, {
    durationSeconds: 180,
    maxPasses: 1,
    maxSwapDistance: 2,
    localLookaheadRows: [8, 16, 32],
    shortlistPerHorizon: 1,
    shortlistPerKind: 256,
    fullEvaluationLimit: 512,
    mutationKinds: ["dashPrimaryJoint"],
  });
  assert.equal(optimized.improvements[0].kind, "dashPrimaryJoint");
  // 第120行GCD末端与第121行前置动作在此轴上是同一时点。
  assert.equal(optimized.improvements[0].startRow, 120);
  assert.equal(optimized.improvements[0].endRow, 122);
  assert.ok(Math.abs(
    optimized.state.totalDamage - artifact.summary.rotationDamage,
  ) < 1e-6);
  assert.ok(Math.abs(
    optimized.damageGain -
      (artifact.summary.rotationDamage - baseline.state.totalDamage),
  ) < 1e-6);
});

test("下马突包可在同一行的GCD前后独立调整", () => {
  const runtime = loadDefaultGearRuntime({
    rotation: "lianying",
    executePhase: true,
    latencyMs: 30,
  });
  const candidate = structuredClone(artifact.actionPacks);
  candidate[120] = {
    prefix: [],
    primary: "dragonFang",
    tail: [
      { id: "dismount", reason: "gcd-tail-free-search", leadFrames: 1 },
      { id: "dash", leadFrames: 1 },
    ],
  };
  const optimized = optimizeLianyingNeighborhoodAxis(runtime, candidate, {
    durationSeconds: 180,
    maxPasses: 1,
    localLookaheadRows: [8],
    shortlistPerHorizon: 8,
    shortlistPerKind: 8,
    fullEvaluationLimit: 16,
    mutationKinds: ["dashTimingMove"],
  });
  assert.equal(optimized.improvements[0].kind, "dashTimingMove");
  assert.equal(optimized.improvements[0].startRow, 121);
  assert.ok(Math.abs(
    optimized.state.totalDamage - artifact.summary.rotationDamage,
  ) < 1e-6);
});
