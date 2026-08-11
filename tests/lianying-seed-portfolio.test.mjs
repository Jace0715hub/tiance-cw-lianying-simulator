import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  lianyingPortfolioStructureKey,
  lianyingSeedPortfolioToCsv,
  optimizeLianyingAnchorDriftPortfolio,
} from "../src/policies/lianying-seed-portfolio.js";
import { searchWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";

test("多种子组合忽略仅突位置不同的重复主要结构", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const dashVariant = structuredClone(seed.packs);
  dashVariant[1].prefix = [...(dashVariant[1].prefix ?? []), "dash"];
  assert.equal(
    lianyingPortfolioStructureKey(seed.packs),
    lianyingPortfolioStructureKey(dashVariant),
  );
});

test("短时多种子组合以最高合法种子为统一不降级回退", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const result = optimizeLianyingAnchorDriftPortfolio(
    runtime,
    [
      { id: "primary", packs: seed.packs },
      { id: "duplicate", packs: structuredClone(seed.packs) },
    ],
    {
      durationSeconds: 30,
      maxSeeds: 2,
      optimizerOptions: {
        rowBeamWidth: 4,
        boundaryBeamWidth: 2,
        coreFinalistCount: 2,
        coarseCandidateLimit: 2,
        coarseDashStates: 4,
        finalDashCandidateCount: 2,
        fullDashStates: 4,
      },
    },
  );

  assert.equal(result.inputSeedCount, 2);
  assert.equal(result.uniqueSeedCount, 1);
  assert.equal(result.searchedSeedCount, 1);
  assert.ok(result.state.totalDamage >= result.baselineDamage);
  assert.match(lianyingSeedPortfolioToCsv(result), /相对全局基线差/);
});
