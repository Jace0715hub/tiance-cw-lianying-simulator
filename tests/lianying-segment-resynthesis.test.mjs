import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  classifyLianyingSuffixFailure,
  identifyLianyingThunderSegments,
  lianyingAdaptiveSuffixEndIndex,
  lianyingBoundaryStateDistance,
  lianyingCorePackDistance,
  lianyingCoreStructureKey,
  lianyingSegmentNodeKey,
  lianyingSuffixFailureRepairAxes,
  optimizeLianyingSegmentResynthesis,
  selectLianyingDiverseAxisCandidates,
  selectLianyingLayeredSuffixFailures,
  selectLianyingValueShadowCandidates,
} from "../src/policies/lianying-segment-resynthesis.js";
import {
  replayWhitepaperLianying,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";

test("按雷锚点识别两个任雷之间及最后雷后的整段", () => {
  const packs = Array.from({ length: 12 }, () => ({ primary: "cloudStrike" }));
  packs[1] = { prefix: ["thunder"], primary: "dragonFang" };
  packs[5] = { prefix: ["thunder"], primary: "dragonFang" };
  packs[9] = { prefix: ["thunder"], primary: "dragonFang" };
  const identified = identifyLianyingThunderSegments(packs);

  assert.deepEqual(identified.anchors, [1, 5, 9]);
  assert.deepEqual(
    identified.ranges.map((segment) => [segment.startIndex, segment.endIndex]),
    [[1, 5], [5, 9], [9, 12]],
  );
});

test("区段去重键在雷漂移时保留不同坐标谱系", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const state = replayWhitepaperLianying(runtime, [], {
    durationSeconds: 1,
  }).state;
  const lineageKey = (node) => JSON.stringify(
    node.packs.map((pack) => pack.primary),
  );

  assert.notEqual(
    lianyingSegmentNodeKey(
      state,
      [{ primary: "dragonFang" }],
      lineageKey,
    ),
    lianyingSegmentNodeKey(
      state,
      [{ primary: "dragonRoar" }],
      lineageKey,
    ),
  );
  assert.equal(
    lianyingSegmentNodeKey(state, [{ primary: "dragonFang" }]),
    lianyingSegmentNodeKey(state, [{ primary: "dragonRoar" }]),
  );
});

test("核心结构键可以忽略雷突橙武相位但保留主要技能差异", () => {
  const baseline = [{
    prefix: [],
    primary: "dragonFang",
    tail: ["thunder", "orange"],
  }];
  const phaseOnly = [{
    prefix: ["thunder", "orange"],
    primary: "dragonFang",
    tail: ["dash"],
  }];
  const differentPrimary = [{
    prefix: ["thunder"],
    primary: "destroy",
    tail: [],
  }];
  const options = { ignoredActionIds: ["thunder", "dash", "orange"] };
  assert.equal(
    lianyingCoreStructureKey(baseline, options),
    lianyingCoreStructureKey(phaseOnly, options),
  );
  assert.notEqual(
    lianyingCoreStructureKey(baseline, options),
    lianyingCoreStructureKey(differentPrimary, options),
  );
});

test("边界状态距离对同一状态为零并识别资源与冷却差异", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const base = replayWhitepaperLianying(runtime, [], {
    durationSeconds: 1,
  }).state;
  const changed = structuredClone(base);
  changed.rage -= 1;
  changed.cooldownReadyTick.destroy += 1000;

  assert.equal(lianyingBoundaryStateDistance(base, base), 0);
  assert.ok(lianyingBoundaryStateDistance(changed, base) > 0);
});

test("后缀失败按资源、冷却、充能和马上状态分类", () => {
  assert.equal(classifyLianyingSuffixFailure("龙牙需要1点战意，当前只有0点"), "rage");
  assert.equal(classifyLianyingSuffixFailure("撼如雷充能不足"), "sequential-charge");
  assert.equal(classifyLianyingSuffixFailure("灭尚有34.08帧冷却"), "cooldown");
  assert.equal(classifyLianyingSuffixFailure("断魂刺只能在马上施展"), "mounted-state");
});

test("分层失败链保留高伤、最早和最晚代表并扩展至最晚链", () => {
  const candidate = (failureIndex, failure, boundaryDamage, thunderRows) => ({
    attempt: {
      failureIndex,
      failureRow: failureIndex + 1,
      failure,
      thunderRows,
      drifted: thunderRows[1] !== 20,
    },
    boundaryDamage,
    packs: [{ primary: "dragonFang" }],
  });
  const selected = selectLianyingLayeredSuffixFailures([
    candidate(30, "龙牙需要1点战意，当前只有0点", 100, [3, 19, 38]),
    candidate(31, "龙牙需要1点战意，当前只有0点", 90, [3, 19, 38]),
    candidate(44, "灭尚有4帧冷却", 130, [3, 20, 38]),
    candidate(58, "断魂刺只能在马上施展", 80, [3, 21, 38]),
  ], { limit: 3, failureRowBucketSize: 8 });

  assert.equal(selected.length, 3);
  assert.deepEqual(
    [...selected.map((entry) => entry.attempt.failureIndex)].sort((a, b) => a - b),
    [30, 44, 58],
  );
  assert.deepEqual(
    new Set(selected.map((entry) => entry.failureCategory)),
    new Set(["rage", "cooldown", "mounted-state"]),
  );
  assert.equal(lianyingAdaptiveSuffixEndIndex({
    currentEndIndex: 24,
    initialEndIndex: 24,
    failureIndices: selected.map((entry) => entry.attempt.failureIndex),
    packCount: 80,
    lookaheadRows: 2,
    maximumAddedRows: 40,
    failureSelection: "latest",
  }), 61);
});

test("后缀失败修复会按资源、冷却和骑乘状态生成定向热启动轴", () => {
  const ragePacks = [
    { primary: "dragonFang" },
    { primary: "dragonFang" },
    { primary: "destroy" },
    { prefix: ["charge"], primary: "dragonFang" },
  ];
  const rageRepairs = lianyingSuffixFailureRepairAxes(ragePacks, {
    failureIndex: 1,
    failure: "龙牙需要1点战意，当前只有0点",
    failureState: { mounted: true },
  }, { limit: 16 });
  const rageKinds = new Set(rageRepairs.map((repair) => repair.kind));
  assert.ok(rageKinds.has("rage-primary-swap"));
  assert.ok(rageKinds.has("rage-charge-move"));
  assert.ok(rageKinds.has("rage-prior-refill"));
  const swapped = rageRepairs.find((repair) => repair.kind === "rage-primary-swap");
  assert.equal(swapped.packs[1].primary, "destroy");
  assert.equal(swapped.packs[2].primary, "dragonFang");

  const cooldownRepairs = lianyingSuffixFailureRepairAxes([
    { primary: "destroy" },
    { primary: "dragonFang" },
  ], {
    failureIndex: 0,
    failure: "灭尚有34.08帧冷却",
  });
  assert.equal(cooldownRepairs[0].kind, "cooldown-primary-delay");
  assert.equal(cooldownRepairs[0].packs[0].primary, "dragonFang");

  const rideRepairs = lianyingSuffixFailureRepairAxes([
    { primary: "ride" },
  ], {
    failureIndex: 0,
    failure: "马上不能施展任驰骋，需要先下马",
  });
  assert.equal(rideRepairs[0].kind, "mounted-add-dismount");
  assert.equal(rideRepairs[0].packs[0].prefix[0].id, "dismount");

  const chargeRepairs = lianyingSuffixFailureRepairAxes([
    { prefix: ["charge"], primary: "dragonFang" },
    { primary: "ride" },
  ], {
    failureIndex: 0,
    failure: "断魂刺只能在马上施展",
  });
  assert.equal(chargeRepairs[0].kind, "mounted-charge-after-ride");
  assert.equal(chargeRepairs[0].packs[1].tail[0].id, "charge");
});

test("近优候选按区段和结构距离分层保留并过滤低质量轴", () => {
  const reference = [
    { primary: "dragonFang" },
    { primary: "destroy" },
    { primary: "dragonRoar" },
  ];
  const segmentA = structuredClone(reference);
  segmentA[1] = { primary: "cloudStrike" };
  const segmentB = structuredClone(reference);
  segmentB[2] = { primary: "dragonFang" };
  const lowQuality = structuredClone(reference);
  lowQuality[0] = { primary: "cloudStrike" };
  const selected = selectLianyingDiverseAxisCandidates([
    { segmentId: "incumbent", packs: reference, coreDamage: 100, behaviorKey: "ref" },
    { segmentId: "pseudo", packs: lowQuality, coreDamage: 100, behaviorKey: "ref" },
    { segmentId: "segment-a", packs: segmentA, coreDamage: 99.8, behaviorKey: "a" },
    { segmentId: "segment-b", packs: segmentB, coreDamage: 99.7, behaviorKey: "b" },
    { segmentId: "low", packs: lowQuality, coreDamage: 98, behaviorKey: "low" },
  ], {
    referencePacks: reference,
    limit: 3,
    maximumLossRatio: 0.005,
  });
  assert.equal(selected.length, 3);
  assert.equal(selected[0].isReference, true);
  assert.deepEqual(
    new Set(selected.map((candidate) => candidate.segmentId)),
    new Set(["incumbent", "segment-a", "segment-b"]),
  );
  assert.equal(lianyingCorePackDistance(reference, segmentA), 1);
  assert.ok(selected.every((candidate) => candidate.coreDamageLossRatio <= 0.005));
});

test("价值影子候选只追加独立名额且不移除原束节点", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const base = replayWhitepaperLianying(runtime, [], {
    durationSeconds: 1,
  }).state;
  const makeNode = (totalDamage, rage) => ({
    state: { ...structuredClone(base), totalDamage, rage },
  });
  const nodes = [makeNode(100, 0), makeNode(99, 0), makeNode(98, 5)];
  const baseline = nodes.slice(0, 2);
  const policy = {
    enabled: true,
    valueQuota: 1,
    valueWeight: 1,
    maximumBaselineRank: 3,
    model: {
      targetMean: 0,
      featureColumns: ["rage"],
      featureMeans: [0],
      featureScales: [1],
      coefficients: [100],
    },
  };
  const shadow = selectLianyingValueShadowCandidates(
    nodes,
    baseline,
    1000,
    policy,
  );
  assert.deepEqual(shadow, [nodes[2]]);
  assert.equal(selectLianyingValueShadowCandidates(
    nodes,
    baseline,
    1000,
    { ...policy, enabled: false },
  ).length, 0);
  assert.deepEqual([...baseline, ...shadow].slice(0, baseline.length), baseline);
});

test("小规模整段重合成保留合法热启动且不降低总伤害", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 12,
    mode: "fixed",
    beamWidth: 4,
  });
  const baseline = replayWhitepaperLianying(runtime, seed.packs, {
    durationSeconds: 12,
  });
  const optimized = optimizeLianyingSegmentResynthesis(runtime, seed.packs, {
    durationSeconds: 12,
    maxPasses: 1,
    beamWidth: 4,
    finalistCount: 2,
    coarseCandidateLimit: 1,
    coarseDashStates: 4,
    finalDashCandidateCount: 1,
    fullDashStates: 4,
    segmentIndices: [0],
    collectValueTrainingData: true,
    collectPruningValueData: true,
    pruningValueBaselineRankLimit: 4,
    collectDiverseCandidates: true,
    diverseCandidateLimit: 3,
  });
  const replay = replayWhitepaperLianying(runtime, optimized.packs, {
    durationSeconds: 12,
  });

  assert.ok(optimized.state.totalDamage >= baseline.state.totalDamage);
  assert.equal(replay.state.totalDamage, optimized.state.totalDamage);
  assert.ok(optimized.passes[0].segments.length <= 1);
  assert.ok(optimized.valueTraining.summary.traceCount >= 1);
  assert.ok(optimized.valueTraining.summary.outcomeCount >= 1);
  assert.ok(optimized.valueTraining.rows.length >= 2);
  assert.ok(optimized.valueTraining.rows.some((row) => row.parentNodeId === null));
  assert.ok(optimized.diverseCandidates.length >= 1);
  assert.ok(optimized.passes[0].segments.every((segment) =>
    segment.valueShadowSelections === 0 &&
    segment.valueShadowFinalists === 0));
  assert.ok(optimized.pruningValue.summary.probeCount >=
    optimized.pruningValue.summary.legalProbeCount);
  assert.equal(
    optimized.pruningValue.summary.legalProbeCount,
    optimized.pruningValue.rows.length,
  );
  assert.ok(optimized.pruningValue.rows.every((row) =>
    row.baselineRank <= 4 &&
    (row.selectedByBeam === 0 || row.selectedByBeam === 1)));
  assert.equal(optimized.diverseCandidates[0].isReference, true);
  for (const row of optimized.valueTraining.rows) {
    assert.equal(
      row.remainingDamageResidual,
      row.bestRemainingDamage - row.referenceRemainingDamage,
    );
    assert.ok(row.remainingSeconds >= 0);
    assert.ok(row.descendantOutcomeCount >= 1);
  }
});
