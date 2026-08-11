import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  lianyingCrossoverBridgePortfolioToCsv,
  optimizeLianyingCrossoverBridgePortfolio,
  selectLianyingCrossoverBridgePortfolio,
} from "../src/policies/lianying-crossover-bridge-portfolio.js";
import { optimizeLianyingSeedCrossovers } from "../src/policies/lianying-seed-crossover.js";
import {
  replayWhitepaperLianying,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";

test("桥接组合分层保留高伤候选和不同交叉雷", () => {
  const packs = (id) => [{ primary: id }];
  const candidates = [
    { packs: packs("a"), totalDamage: 100, anchorNumber: 2, prefixSeedId: "x", suffixSeedId: "y" },
    { packs: packs("b"), totalDamage: 99, anchorNumber: 2, prefixSeedId: "x", suffixSeedId: "z" },
    { packs: packs("c"), totalDamage: 98, anchorNumber: 3, prefixSeedId: "x", suffixSeedId: "y" },
    { packs: packs("d"), totalDamage: 97, anchorNumber: 4, prefixSeedId: "z", suffixSeedId: "y" },
  ];
  const selected = selectLianyingCrossoverBridgePortfolio(candidates, 3);

  assert.deepEqual(selected.slice(0, 2).map((candidate) => candidate.totalDamage), [100, 99]);
  assert.ok(selected.some((candidate) => candidate.anchorNumber !== 2));
});

test("小规模多交叉桥接共享全局回退并输出逐候选诊断", () => {
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
  const crossover = optimizeLianyingSeedCrossovers(
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
  const result = optimizeLianyingCrossoverBridgePortfolio(
    runtime,
    crossover.packs,
    crossover.bridgeCandidates,
    {
      durationSeconds: 50,
      candidateLimit: 2,
      initialDashStates: 4,
      bridgeOptions: {
        maxPasses: 1,
        beamWidth: 4,
        finalistCount: 2,
        coarseCandidateLimit: 2,
        coarseDashStates: 4,
        finalDashCandidateCount: 1,
        fullDashStates: 4,
        boundaryPaddingRows: 2,
      },
    },
  );
  const replay = replayWhitepaperLianying(runtime, result.packs, {
    durationSeconds: 50,
  });

  assert.ok(result.runs.length >= 1);
  assert.ok(result.state.totalDamage >= result.baselineDamage);
  assert.equal(replay.state.totalDamage, result.state.totalDamage);
  assert.match(lianyingCrossoverBridgePortfolioToCsv(result), /桥接局部收益/);
});

test("组合桥接可以按分层序号定向运行单条候选", () => {
  const selected = selectLianyingCrossoverBridgePortfolio([
    { packs: [{ primary: "a" }], totalDamage: 3, anchorNumber: 2, prefixSeedId: "a", suffixSeedId: "b" },
    { packs: [{ primary: "b" }], totalDamage: 2, anchorNumber: 3, prefixSeedId: "a", suffixSeedId: "c" },
    { packs: [{ primary: "c" }], totalDamage: 1, anchorNumber: 4, prefixSeedId: "c", suffixSeedId: "a" },
  ], 3, [3]);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].packs[0].primary, "c");
});
