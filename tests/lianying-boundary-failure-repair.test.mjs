import assert from "node:assert/strict";
import test from "node:test";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { searchLianyingBoundaryFailureRepairs } from
  "../src/policies/lianying-boundary-failure-repair.js";
import { stripLianyingDashPacks } from
  "../src/policies/lianying-segment-resynthesis.js";
import {
  replayWhitepaperLianying,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";

test("边界首错修复器会完整复演直接合法前缀且不降低正式轴", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 12,
    mode: "fixed",
    beamWidth: 2,
  });
  const corePacks = stripLianyingDashPacks(seed.packs);
  const depth = Math.min(3, corePacks.length);
  const result = searchLianyingBoundaryFailureRepairs(
    runtime,
    seed.packs,
    [{
      segmentNumber: 1,
      segmentId: "test-boundary",
      rank: 1,
      depth,
      totalDamage: 1,
      currentDamageGain: 0,
      prefixPacks: corePacks.slice(0, depth),
    }],
    {
      durationSeconds: 12,
      pathLimit: 1,
      repairLimitPerPath: 2,
      dashFinalistCount: 1,
      dashStates: 2,
    },
  );
  const replay = replayWhitepaperLianying(runtime, result.packs, {
    durationSeconds: 12,
  });

  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].initialLegal, true);
  assert.equal(result.generatedRepairs, 1);
  assert.equal(result.legalRepairs, 1);
  assert.ok(result.bestDamage >= result.baselineDamage);
  assert.equal(replay.state.totalDamage, result.state.totalDamage);
});

