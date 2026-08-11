import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  buildLianyingCrossoverJointSegment,
  lianyingCrossoverBridgeSegmentIndices,
  optimizeLianyingCrossoverBridge,
  optimizeLianyingCrossoverJointBridge,
} from "../src/policies/lianying-crossover-bridge.js";
import {
  replayWhitepaperLianying,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import {
  lianyingAdaptiveSuffixEndIndex,
  stripLianyingDashPacks,
} from "../src/policies/lianying-segment-resynthesis.js";

test("后缀首次失败行按前瞻行数扩展且不超过总上限", () => {
  assert.equal(lianyingAdaptiveSuffixEndIndex({
    currentEndIndex: 45,
    initialEndIndex: 45,
    failureIndices: [50, 45, 60],
    packCount: 148,
    lookaheadRows: 4,
    maximumAddedRows: 12,
  }), 50);
  assert.equal(lianyingAdaptiveSuffixEndIndex({
    currentEndIndex: 55,
    initialEndIndex: 45,
    failureIndices: [60],
    packCount: 148,
    lookaheadRows: 4,
    maximumAddedRows: 12,
  }), 57);
  assert.equal(lianyingAdaptiveSuffixEndIndex({
    currentEndIndex: 57,
    initialEndIndex: 45,
    failureIndices: [57],
    packCount: 148,
    lookaheadRows: 4,
    maximumAddedRows: 12,
  }), null);
  assert.equal(lianyingAdaptiveSuffixEndIndex({
    currentEndIndex: 45,
    initialEndIndex: 45,
    failureIndices: [44],
    packCount: 148,
  }), null);
});

test("交叉桥接只搜索交叉雷前后的两个相邻区段并保留全局最优", () => {
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
  const result = optimizeLianyingCrossoverBridge(
    runtime,
    seed.packs,
    alternative,
    {
      durationSeconds: 50,
      crossoverAnchorNumber: 2,
      maxPasses: 1,
      beamWidth: 4,
      finalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      boundaryPaddingRows: 2,
    },
  );
  const replay = replayWhitepaperLianying(runtime, result.packs, {
    durationSeconds: 50,
  });

  assert.deepEqual(lianyingCrossoverBridgeSegmentIndices(2, 4), [0, 1]);
  assert.deepEqual(result.segmentIndices, [0, 1]);
  assert.ok(result.state.totalDamage >= result.baselineDamage);
  assert.equal(replay.state.totalDamage, result.state.totalDamage);
  assert.ok(Number.isFinite(result.bridgeDamageGain));
  assert.notEqual(
    JSON.stringify(stripLianyingDashPacks(result.candidatePacks)),
    JSON.stringify(stripLianyingDashPacks(seed.packs)),
  );
});

test("联合桥接合并交叉雷前后区段并锁定原雷锚点", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 50,
    mode: "fixed",
    beamWidth: 4,
  });
  const segment = buildLianyingCrossoverJointSegment(seed.packs, 2);
  const result = optimizeLianyingCrossoverJointBridge(
    runtime,
    seed.packs,
    seed.packs,
    {
      durationSeconds: 50,
      crossoverAnchorNumber: 2,
      beamWidth: 4,
      finalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      boundaryPaddingRows: 2,
    },
  );
  const replay = replayWhitepaperLianying(runtime, result.packs, {
    durationSeconds: 50,
  });

  assert.match(segment.id, /joint-thunder-1-to-3/);
  assert.ok(segment.rowCount > 0);
  assert.equal(result.preserveThunderPositions, true);
  assert.equal(replay.state.totalDamage, result.state.totalDamage);
  assert.ok(result.state.totalDamage >= result.baselineDamage);
});

test("联合桥接允许中间雷前后漂移一行并钉住双热启动", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 50,
    mode: "fixed",
    beamWidth: 4,
  });
  const originalAnchors = seed.packs
    .map((pack, index) =>
      [...(pack.prefix ?? []), ...(pack.tail ?? [])]
        .some((action) => (typeof action === "string" ? action : action.id) === "thunder")
        ? index + 1
        : null)
    .filter(Boolean);
  const result = optimizeLianyingCrossoverJointBridge(
    runtime,
    seed.packs,
    seed.packs,
    {
      durationSeconds: 50,
      crossoverAnchorNumber: 2,
      beamWidth: 6,
      finalistCount: 3,
      coarseCandidateLimit: 3,
      coarseDashStates: 4,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      boundaryPaddingRows: 2,
      middleThunderDriftRows: 1,
      useIncumbentWarmStart: true,
      adaptiveSuffixRepair: true,
      adaptiveSuffixMaxExpansions: 1,
      adaptiveSuffixLookaheadRows: 2,
      adaptiveSuffixMaximumAddedRows: 4,
      adaptiveSuffixFailureChainLimit: 3,
      adaptiveSuffixFailureRowBucketSize: 4,
      adaptiveSuffixDirectedRepairLimit: 4,
      adaptiveSuffixDirectedRepairLookBehindRows: 2,
      adaptiveSuffixDirectedRepairLookAheadRows: 3,
      valueShadowPolicy: {
        enabled: true,
        baselineQuota: 1,
        valueQuota: 1,
        valueWeight: 0,
        maximumBaselineRank: 12,
        model: {
          kind: "ridge-residual",
          trainingRows: 1,
          targetMean: 0,
          featureColumns: [],
          featureMeans: [],
          featureScales: [],
          coefficients: [],
        },
      },
    },
  );
  const report = result.resynthesis.passes[0].segments[0];

  assert.equal(result.thunderPositionWindows[0].earliestIndex + 1, originalAnchors[1] - 1);
  assert.equal(result.thunderPositionWindows[0].latestIndex + 1, originalAnchors[1] + 1);
  assert.equal(report.warmStartCount, 2);
  assert.equal(result.adaptiveSuffixRepair, true);
  assert.equal(result.adaptiveSuffixFailureChainLimit, 3);
  assert.equal(result.adaptiveSuffixFailureRowBucketSize, 4);
  assert.equal(result.adaptiveSuffixDirectedRepairLimit, 4);
  assert.equal(result.adaptiveSuffixDirectedRepairLookBehindRows, 2);
  assert.equal(result.adaptiveSuffixDirectedRepairLookAheadRows, 3);
  assert.equal(result.resynthesis.options.adaptiveSuffixRepair, true);
  assert.equal(result.resynthesis.options.adaptiveSuffixFailureChainLimit, 3);
  assert.equal(result.resynthesis.options.adaptiveSuffixDirectedRepairLimit, 4);
  assert.equal(result.resynthesis.options.valueShadowPolicy.enabled, true);
  assert.ok(report.valueShadowSelections > 0);
  assert.ok(report.peakStates <= 7);
  assert.ok(report.adaptiveAttempts.length >= 1);
  assert.equal(
    report.adaptiveAttempts.length,
    report.adaptiveSuffixExpansions + 1,
  );
  assert.equal(report.adaptiveAttempts.at(-1).nextEndRow, null);
  const terminalRows = new Set(
    report.terminalThunderLineages.map((lineage) => lineage[0]),
  );
  assert.ok(terminalRows.size >= 2);
  for (const row of terminalRows) {
    assert.ok(row >= originalAnchors[1] - 1);
    assert.ok(row <= originalAnchors[1] + 1);
  }
  assert.ok(report.suffixLegalThunderSchedules.length >= 1);
  for (const schedule of report.suffixLegalThunderSchedules) {
    assert.equal(schedule[0], originalAnchors[0]);
    assert.ok(schedule[1] >= originalAnchors[1] - 1);
    assert.ok(schedule[1] <= originalAnchors[1] + 1);
    assert.equal(schedule[2], originalAnchors[2]);
  }
});
