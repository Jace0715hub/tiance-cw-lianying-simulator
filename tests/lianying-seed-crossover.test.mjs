import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  lianyingSeedCrossoverToCsv,
  optimizeLianyingSeedCrossovers,
} from "../src/policies/lianying-seed-crossover.js";
import {
  replayWhitepaperLianying,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";

test("共同雷锚点的双种子可以生成并审计合法交叉轴", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 50,
    mode: "fixed",
    beamWidth: 4,
  });
  const alternative = structuredClone(seed.packs);
  for (const index of [10, 22]) {
    [alternative[index], alternative[index + 1]] = [
      alternative[index + 1],
      alternative[index],
    ];
  }
  replayWhitepaperLianying(runtime, alternative, { durationSeconds: 50 });
  const result = optimizeLianyingSeedCrossovers(
    runtime,
    [
      { id: "primary", packs: seed.packs },
      { id: "alternative", packs: alternative },
    ],
    {
      durationSeconds: 50,
      maxSeeds: 2,
      coreCandidateLimit: 4,
      coarseDashStates: 4,
      finalDashCandidateCount: 2,
      fullDashStates: 4,
    },
  );

  assert.equal(result.searchedSeedCount, 2);
  assert.ok(result.totalCrossovers > 0);
  assert.ok(result.legalCrossovers > 0);
  assert.ok(result.novelCrossovers > 0);
  assert.ok(result.state.totalDamage >= result.baselineDamage);
  assert.ok(result.bestAlternative);
  const alternativeReplay = replayWhitepaperLianying(
    runtime,
    result.bestAlternative.packs,
    { durationSeconds: 50 },
  );
  assert.equal(alternativeReplay.state.totalDamage, result.bestAlternative.totalDamage);
  const csv = lianyingSeedCrossoverToCsv(result);
  assert.match(csv, /边界状态距离/);
  assert.match(csv, /首次失败原因/);
});
