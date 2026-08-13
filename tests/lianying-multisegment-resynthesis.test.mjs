import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import {
  isLianyingCompanionAnchorPackAllowed,
  isLianyingThunderAnchorPackAllowed,
  lianyingAnchorDriftNodeKey,
  lianyingAnchorDriftLongTermScore,
  isLianyingAnchorDriftPackAllowed,
  lianyingAnchorDriftScheduleToCsv,
  lianyingAnchorDriftWindow,
  lianyingMultiSegmentAnchorDiagnosticsToCsv,
  lianyingPrimaryHistoryStructureKey,
  lianyingQualityDiversityCellKey,
  optimizeLianyingAnchorDriftResynthesis,
  optimizeLianyingMultiSegmentResynthesis,
  selectLianyingJointBoundaryNodes,
  selectLianyingQualityDiversityArchive,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import {
  buildLianyingBoundedThunderTemplates,
  buildLianyingFocusedCompanionAnchorTemplate,
  buildLianyingRankedPairThunderTemplates,
  lianyingAnchorCoordinationTemplatesToCsv,
  optimizeLianyingHierarchicalAnchorCoordination,
  optimizeLianyingIterativeFocusedCompanionAnchorCoordination,
  lianyingEarlyStructureKey,
  selectLianyingEarlyStructuralSeedCandidates,
  selectLianyingStructuralSeedCandidates,
} from "../src/policies/lianying-anchor-coordinator.js";
import { lianyingResynthesisStateKey } from "../src/policies/lianying-segment-resynthesis.js";
import {
  replayWhitepaperLianying,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";

test("联合搜索固定每个区段首行开雷且区段内部不重复开雷", () => {
  assert.equal(
    isLianyingThunderAnchorPackAllowed(
      { prefix: ["thunder"], primary: "dragonFang" },
      0,
    ),
    true,
  );
  assert.equal(
    isLianyingThunderAnchorPackAllowed(
      { prefix: [], primary: "dragonFang" },
      0,
    ),
    false,
  );
  assert.equal(
    isLianyingThunderAnchorPackAllowed(
      { prefix: ["thunder"], primary: "dragonFang" },
      1,
    ),
    false,
  );
});

test("雷锚点漂移窗口在最晚行强制开雷并固定首尾锚点", () => {
  const anchors = [2, 20, 36];
  assert.deepEqual(lianyingAnchorDriftWindow(anchors, 0), {
    target: 2,
    earliest: 2,
    latest: 2,
    slack: 0,
    fixed: true,
  });
  assert.deepEqual(lianyingAnchorDriftWindow(anchors, 1), {
    target: 20,
    earliest: 19,
    latest: 21,
    slack: 1,
    fixed: false,
  });
  const thunder = { prefix: ["thunder"], primary: "dragonFang" };
  const noThunder = { prefix: [], primary: "dragonFang" };
  assert.equal(
    isLianyingAnchorDriftPackAllowed(thunder, 19, 1, anchors),
    true,
  );
  assert.equal(
    isLianyingAnchorDriftPackAllowed(noThunder, 19, 1, anchors),
    true,
  );
  assert.equal(
    isLianyingAnchorDriftPackAllowed(noThunder, 21, 1, anchors),
    false,
  );
  assert.equal(
    isLianyingAnchorDriftPackAllowed(thunder, 21, 1, anchors),
    true,
  );
  assert.equal(
    isLianyingAnchorDriftPackAllowed(thunder, 22, 1, anchors),
    false,
  );
});

test("雷坐标谱系长期评分累加锚点后的新增实际伤害", () => {
  assert.equal(
    lianyingAnchorDriftLongTermScore({
      state: { totalDamage: 150 },
      lineageBaseDamage: 100,
      lineageProjectedFinal: 1000,
    }),
    1050,
  );
  assert.equal(
    lianyingAnchorDriftLongTermScore({ state: { totalDamage: 150 } }),
    150,
  );
});

test("质量多样性单元区分资源、充能队列与关键冷却", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const base = createInitialState(runtime.config, {
    rage: 3,
    dragonRideStacks: 7,
    executePhase: true,
  });
  const differentRage = structuredClone(base);
  differentRage.rage = 4;
  const differentRecharge = structuredClone(base);
  differentRecharge.chargeTicks.ride.rechargeQueue = [32000];
  assert.notEqual(
    lianyingQualityDiversityCellKey(base),
    lianyingQualityDiversityCellKey(differentRage),
  );
  assert.notEqual(
    lianyingQualityDiversityCellKey(base),
    lianyingQualityDiversityCellKey(differentRecharge),
  );
});

test("质量多样性档案固定总配额且每个单元只保留最高分", () => {
  const nodes = [
    { id: "a-best", cell: "a", score: 100 },
    { id: "a-lower", cell: "a", score: 90 },
    { id: "b", cell: "b", score: 99 },
    { id: "c", cell: "c", score: 98 },
    { id: "d", cell: "d", score: 97 },
  ];
  const options = {
    quota: 3,
    candidateMultiplier: 2,
    seed: 42,
    keyNode: (node) => node.cell,
    scoreNode: (node) => node.score,
  };
  const first = selectLianyingQualityDiversityArchive(nodes, options);
  const second = selectLianyingQualityDiversityArchive(nodes, options);
  assert.equal(first.length, 3);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((node) => node.cell)).size, 3);
  assert.equal(first.some((node) => node.id === "a-lower"), false);
});

test("雷坐标谱系作为锚点搜索去重键的一部分", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const state = createInitialState(runtime.config, {
    rage: 5,
    executePhase: true,
  });

  assert.notEqual(
    lianyingAnchorDriftNodeKey(2, [3, 20], state),
    lianyingAnchorDriftNodeKey(2, [3, 21], state),
  );
  assert.equal(
    lianyingAnchorDriftNodeKey(2, [3, 20], state),
    lianyingAnchorDriftNodeKey(2, [3, 20], structuredClone(state)),
  );
  assert.notEqual(
    lianyingAnchorDriftNodeKey(2, [3, 20], state, { orange: [3, 47] }),
    lianyingAnchorDriftNodeKey(2, [3, 20], state, { orange: [3, 48] }),
  );
});

test("锚点候选压缩同时保留高伤状态和钉住的热启动状态", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const base = createInitialState(runtime.config, { rage: 5, executePhase: true });
  const high = structuredClone(base);
  high.totalDamage = 100;
  const middle = structuredClone(base);
  middle.rage = 4;
  middle.totalDamage = 90;
  const pinned = structuredClone(base);
  pinned.rage = 0;
  pinned.totalDamage = 1;
  const selected = selectLianyingJointBoundaryNodes(
    [high, middle, pinned].map((state) => ({ state, packs: [] })),
    2,
    lianyingResynthesisStateKey(pinned),
  ).nodes;

  assert.equal(selected.length, 2);
  assert.ok(selected.some((node) => node.state.totalDamage === 100));
  assert.ok(selected.some((node) => node.state.rage === 0));
});

test("后缀价值评分能为低即时伤害候选保留独立名额", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const base = createInitialState(runtime.config, { rage: 5, executePhase: true });
  const highDamage = structuredClone(base);
  highDamage.totalDamage = 100;
  const highSuffixValue = structuredClone(base);
  highSuffixValue.rage = 4;
  highSuffixValue.totalDamage = 10;
  const selected = selectLianyingJointBoundaryNodes(
    [
      { state: highDamage, packs: [], suffixScore: 100 },
      { state: highSuffixValue, packs: [], suffixScore: 1000 },
    ],
    2,
    null,
    { scoreNode: (node) => node.suffixScore },
  ).nodes;

  assert.ok(selected.some((node) => node.state.totalDamage === 100));
  assert.ok(selected.some((node) => node.suffixScore === 1000));
});

test("双雷样例能连续拼接区段并以完整含突伤害不降级", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const baseline = replayWhitepaperLianying(runtime, seed.packs, {
    durationSeconds: 30,
  });
  const optimized = optimizeLianyingMultiSegmentResynthesis(
    runtime,
    seed.packs,
    {
      durationSeconds: 30,
      rowBeamWidth: 4,
      boundaryBeamWidth: 2,
      coreFinalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 2,
      fullDashStates: 4,
    },
  );
  const replay = replayWhitepaperLianying(runtime, optimized.packs, {
    durationSeconds: 30,
  });

  assert.equal(optimized.segments.length, 2);
  assert.ok(optimized.segments.every((segment) => segment.outgoingStates > 0));
  assert.ok(optimized.segments.every(
    (segment) => segment.survivingIncomingLineages > 0,
  ));
  assert.ok(optimized.segments.every((segment) => segment.suffixValueEnabled));
  assert.ok(optimized.segments.every(
    (segment) => segment.candidateDiagnostics.length > 0,
  ));
  const diagnosticsCsv = lianyingMultiSegmentAnchorDiagnosticsToCsv(optimized);
  assert.match(diagnosticsCsv, /预计最终伤害差/);
  assert.match(diagnosticsCsv, /thunder-1-to-2/);
  assert.ok(optimized.state.totalDamage >= baseline.state.totalDamage);
  assert.equal(replay.state.totalDamage, optimized.state.totalDamage);
});

test("联合区段价值影子谱系只追加候选且保留基础束", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const options = {
    durationSeconds: 30,
    rowBeamWidth: 4,
    boundaryBeamWidth: 2,
    coreFinalistCount: 2,
    coarseCandidateLimit: 2,
    coarseDashStates: 4,
    finalDashCandidateCount: 2,
    fullDashStates: 4,
  };
  const control = optimizeLianyingMultiSegmentResynthesis(
    runtime,
    seed.packs,
    options,
  );
  const shadow = optimizeLianyingMultiSegmentResynthesis(
    runtime,
    seed.packs,
    {
      ...options,
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

  assert.ok(shadow.valueShadowRows > 0);
  assert.ok(shadow.valueShadowSelections >= shadow.valueShadowRows);
  assert.ok(shadow.peakRowStates <= options.rowBeamWidth + 1);
  assert.ok(shadow.explored >= control.explored);
  assert.ok(shadow.segments.every((segment) =>
    segment.baselineOutgoingStates <= options.boundaryBeamWidth &&
    segment.valueShadowOutgoingStates <= 1));
  assert.equal(shadow.options.valueShadowPolicy.enabled, true);
  assert.equal(control.options.valueShadowPolicy, null);
});

test("联合区段价值探针同时记录参考后缀和真实跨区段后代", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const optimized = optimizeLianyingMultiSegmentResynthesis(
    runtime,
    seed.packs,
    {
      durationSeconds: 30,
      rowBeamWidth: 4,
      boundaryBeamWidth: 2,
      coreFinalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 2,
      fullDashStates: 4,
      collectValueTrainingData: true,
      valueProbeMaximumBaselineRank: 8,
      valueProbeRowStride: 2,
      valueProbeNextSegmentBeamWidth: 2,
    },
  );

  const training = optimized.valueTraining;
  assert.ok(training);
  assert.ok(training.summary.rowProbeAttempts >= training.summary.rowProbeLegal);
  assert.ok(training.summary.rowProbeLegal > 0);
  assert.ok(training.summary.boundaryProbeAttempts > 0);
  assert.ok(training.summary.boundaryProbeReferenceLegal > 0);
  assert.ok(training.summary.boundaryActualRows > 0);
  assert.ok(training.summary.boundaryNextSegmentProbeAttempts > 0);
  assert.ok(training.summary.boundaryNextSegmentProbeLegal > 0);
  assert.ok(training.summary.boundaryNextSegmentProbeExplored > 0);
  assert.ok(training.rows.some((row) => row.traceId === "multi-row-reference"));
  assert.ok(training.rows.some(
    (row) => row.traceId === "multi-boundary-reference"));
  const nextSegmentRows = training.rows.filter(
    (row) => row.traceId === "multi-boundary-next-segment");
  assert.ok(nextSegmentRows.length > 0);
  const actualRows = training.rows.filter(
    (row) => row.traceId === "multi-boundary-actual");
  assert.ok(actualRows.length > 0);
  assert.ok(training.rows.every((row) =>
    Number.isFinite(row.bestFinalDamage) &&
    Number.isFinite(row.remainingDamageResidual)));
  assert.ok([...nextSegmentRows, ...actualRows].every((row) =>
    String(row.labelKind).startsWith("actual-") &&
    row.descendantOutcomeCount >= 1));
  assert.equal(optimized.options.collectValueTrainingData, true);
  assert.equal(optimized.options.valueProbeMaximumBaselineRank, 8);
  assert.equal(optimized.options.valueProbeRowStride, 2);
  assert.equal(optimized.options.valueProbeNextSegmentBeamWidth, 2);
});

test("两段价值探针跨过第二个雷边界且尾部自动缩短视野", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 60,
    mode: "fixed",
    beamWidth: 4,
  });
  const optimized = optimizeLianyingMultiSegmentResynthesis(
    runtime,
    seed.packs,
    {
      durationSeconds: 60,
      rowBeamWidth: 4,
      boundaryBeamWidth: 2,
      coreFinalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      collectValueTrainingData: true,
      valueProbeMaximumBaselineRank: 4,
      valueProbeRowStride: 4,
      valueProbeNextSegmentBeamWidth: 2,
      valueProbeSegmentHorizon: 2,
    },
  );

  const horizonRows = optimized.valueTraining.rows.filter(
    (row) => row.labelKind === "actual-segment-horizon");
  const tailRows = optimized.valueTraining.rows.filter(
    (row) => row.labelKind === "actual-next-segment");
  assert.ok(horizonRows.length > 0);
  assert.ok(tailRows.length > 0);
  assert.ok(horizonRows.every((row) =>
    row.probeSegmentHorizon === 2 &&
    row.probeSegmentCount === 2 &&
    row.probeEndRow > row.globalRow));
  assert.ok(tailRows.every((row) =>
    row.probeSegmentHorizon === 2 && row.probeSegmentCount === 1));
  assert.equal(
    optimized.valueTraining.summary.boundarySegmentHorizonRows,
    horizonRows.length,
  );
  assert.equal(optimized.options.valueProbeSegmentHorizon, 2);
});

test("边界专用价值策略只在雷边界引入影子并在区段内机械传播", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const optimized = optimizeLianyingMultiSegmentResynthesis(
    runtime,
    seed.packs,
    {
      durationSeconds: 30,
      rowBeamWidth: 4,
      boundaryBeamWidth: 2,
      coreFinalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 2,
      fullDashStates: 4,
      valueShadowPolicy: {
        enabled: true,
        applicationStages: ["boundary"],
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

  assert.equal(optimized.valueShadowRowIntroductions, 0);
  assert.ok(optimized.valueShadowBoundarySelections > 0);
  assert.ok(optimized.valueShadowRowPropagations > 0);
  const diagnostics = optimized.segments.flatMap(
    (segment) => segment.valueShadowDiagnostics);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((entry) =>
    entry.baselineRank >= 1 &&
    Number.isFinite(entry.totalDamage) &&
    Number.isFinite(entry.predictedValue) &&
    Number.isFinite(entry.valueScore)));
  assert.deepEqual(
    optimized.options.valueShadowPolicy.applicationStages,
    ["boundary"],
  );
});

test("双影子策略独立保留纯伤害与模型价值谱系", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const optimized = optimizeLianyingMultiSegmentResynthesis(
    runtime,
    seed.packs,
    {
      durationSeconds: 30,
      rowBeamWidth: 6,
      boundaryBeamWidth: 2,
      coreFinalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      valueShadowPolicy: {
        enabled: true,
        applicationStages: ["boundary"],
        baselineQuota: 2,
        damageShadowQuota: 1,
        valueQuota: 1,
        valueWeight: 1,
        maximumBaselineRank: 12,
        model: {
          kind: "ridge-residual",
          trainingRows: 1,
          targetMean: 0,
          featureColumns: ["rage"],
          featureMeans: [0],
          featureScales: [1],
          coefficients: [1000000],
        },
      },
    },
  );

  const dualBoundaries = optimized.segments.filter((segment) =>
    segment.damageShadowOutgoingStates === 1 &&
    segment.modelValueShadowOutgoingStates === 1);
  assert.ok(dualBoundaries.length > 0);
  assert.ok(dualBoundaries.every((segment) =>
    new Set(segment.valueShadowDiagnostics.map(
      (entry) => entry.shadowKind)).size === 2));
  assert.ok(optimized.valueShadowRowPropagations > 0);
  assert.ok(optimized.finalBoundaryStates <= 4);
  assert.ok(optimized.damageShadowCoreCandidates >= 1);
  assert.ok(optimized.modelValueShadowCoreCandidates >= 1);
  assert.ok(Number.isFinite(optimized.bestDamageShadowCoreDamage));
  assert.ok(Number.isFinite(optimized.bestModelValueShadowCoreDamage));
  assert.equal(optimized.options.valueShadowPolicy.damageShadowQuota, 1);
});

test("三雷样例只漂移中间锚点并完成不降级复演", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 50,
    mode: "fixed",
    beamWidth: 4,
  });
  const baseline = replayWhitepaperLianying(runtime, seed.packs, {
    durationSeconds: 50,
  });
  const optimized = optimizeLianyingAnchorDriftResynthesis(
    runtime,
    seed.packs,
    {
      durationSeconds: 50,
      rowBeamWidth: 6,
      boundaryBeamWidth: 6,
      coreFinalistCount: 3,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 2,
      fullDashStates: 4,
    },
  );
  const replay = replayWhitepaperLianying(runtime, optimized.packs, {
    durationSeconds: 50,
  });

  assert.equal(optimized.selectedAnchors[0], optimized.anchors[0]);
  assert.equal(optimized.selectedAnchors.at(-1), optimized.anchors.at(-1));
  assert.ok(
    Math.abs(optimized.selectedAnchors[1] - optimized.anchors[1]) <= 1,
  );
  assert.ok(optimized.segments[1].outgoingSchedules > 0);
  assert.equal(optimized.options.lineageLongTermScoring, true);
  assert.ok(optimized.finalSchedules > 1);
  assert.ok(
    Object.hasOwn(
      optimized.segments[1].actualRowHistogram,
      String(optimized.segments[1].latestRow),
    ),
  );
  const scheduleCsv = lianyingAnchorDriftScheduleToCsv(optimized);
  assert.match(scheduleCsv, /实际坐标分布/);
  assert.match(scheduleCsv, /压缩前可用坐标组合数/);
  assert.match(scheduleCsv, /雷序号/u);
  assert.ok(optimized.state.totalDamage >= baseline.state.totalDamage);
  assert.equal(replay.state.totalDamage, optimized.state.totalDamage);
});

test("层次协调器只提出单个中间雷相邻移动并由低层完整复演", () => {
  const templates = buildLianyingBoundedThunderTemplates(
    [2, 19, 37, 58, 79, 104, 127],
  );
  assert.equal(templates.length, 11);
  assert.deepEqual(templates[0].anchorRows, [2, 19, 37, 58, 79, 104, 127]);
  assert.ok(templates.slice(1).every(
    (template) => template.shiftedAnchors.length === 1));
  assert.ok(templates.every(
    (template) => template.anchorRows[0] === 2 &&
      template.anchorRows.at(-1) === 127));

  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 50,
    mode: "fixed",
    beamWidth: 4,
  });
  const baseline = replayWhitepaperLianying(runtime, seed.packs, {
    durationSeconds: 50,
  });
  const optimized = optimizeLianyingHierarchicalAnchorCoordination(
    runtime,
    seed.packs,
    {
      durationSeconds: 50,
      evaluationMode: "independent",
      rowBeamWidth: 6,
      boundaryBeamWidth: 6,
      coreFinalistCount: 3,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 2,
      fullDashStates: 4,
    },
  );
  const allowed = new Set(optimized.coordination.proposedTemplates.map(
    (template) => JSON.stringify(template.anchorRows),
  ));
  assert.equal(optimized.coordination.proposedTemplateCount, 3);
  assert.ok(allowed.has(JSON.stringify(optimized.selectedAnchors)));
  assert.ok(optimized.coarseCandidates.every(
    (candidate) => allowed.has(JSON.stringify(candidate.anchorRows)),
  ));
  assert.ok(optimized.state.totalDamage >= baseline.state.totalDamage);
  assert.equal(optimized.options.allowedAnchorScheduleCount, 2);
  assert.equal(optimized.coordination.evaluationMode, "independent");
  assert.equal(optimized.coordination.independentEvaluations, 2);
  assert.equal(optimized.coordination.templateDiagnostics.length, 3);
  assert.ok(optimized.coordination.templateDiagnostics.every(
    (template) => template.survivedThroughAnchorCount >= 1));
  assert.ok(optimized.coordination.finalBoundaryTemplateCount >= 1);
  assert.ok(optimized.coordination.templateDiagnostics.some(
    (template) => template.reachedCore));
  assert.ok(optimized.coordination.templateDiagnostics
    .filter((template) => template.reachedCore)
    .every((template) =>
      Array.isArray(template.bestCoreCompanionAnchors?.rideRows) &&
      Array.isArray(template.bestCoreCompanionAnchors?.orangeRows) &&
      Array.isArray(template.bestCoreCompanionAnchors?.dismountRows)));
  const csv = lianyingAnchorCoordinationTemplatesToCsv(optimized);
  assert.match(csv, /incumbent/);
  assert.match(csv, /shift-2:-1/);
  assert.match(csv, /存活至雷序号/);
});

test("双雷协调模板只组合排名靠前且锚点不同的单移动", () => {
  const anchors = [2, 19, 37, 58, 79, 104, 127];
  const diagnostics = [
    ["shift-6:-1", [3, 20, 38, 59, 80, 104, 128], -10],
    ["shift-5:-1", [3, 20, 38, 59, 79, 105, 128], -20],
    ["shift-6:+1", [3, 20, 38, 59, 80, 106, 128], -30],
    ["shift-5:+1", [3, 20, 38, 59, 81, 105, 128], -40],
    ["shift-4:-1", [3, 20, 38, 58, 80, 105, 128], -50],
    ["shift-3:-1", [3, 20, 37, 59, 80, 105, 128], -60],
  ].map(([templateId, anchorRows, bestCoreDamageGain]) => ({
    templateId,
    anchorRows,
    bestCoreDamageGain,
  }));
  const pairs = buildLianyingRankedPairThunderTemplates(
    anchors,
    diagnostics,
  );
  assert.equal(pairs.length, 6);
  assert.ok(pairs.every((template) => template.shiftedAnchors.length === 2));
  assert.ok(pairs.every((template) =>
    new Set(template.shiftedAnchors.map(
      (shift) => shift.anchorNumber)).size === 2));
  assert.ok(pairs.every((template) =>
    template.sourceTemplateIds.every((id) => id !== "shift-3:-1")));
  assert.deepEqual(pairs[0].anchorRows, [2, 19, 37, 58, 78, 103, 127]);
});

test("伴随锚点模板只约束显式指定的动作类型", () => {
  const template = { rideRows: [3], orangeRows: [4] };
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { prefix: [], primary: "ride", tail: [] }, 2, template), true);
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { prefix: [], primary: "dragonFang", tail: [] }, 2, template), false);
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { prefix: [], primary: "dragonFang", tail: ["orange"] }, 3, template), true);
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { prefix: ["dismount"], primary: "dragonFang", tail: [] }, 4, template), true);
  const windows = {
    rideWindows: [{ earliestRow: 2, latestRow: 4 }],
  };
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { prefix: [], primary: "dragonFang", tail: [] }, 2, windows), true);
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { prefix: [], primary: "dragonFang", tail: [] }, 3, windows), false);
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { prefix: [], primary: "ride", tail: [] }, 1, windows), true);
});

test("定向伴随模板固定早段任驰骋并只向后开放末三次窗口", () => {
  const rideRows = [3, 20, 38, 59, 107, 123, 145];
  const packs = Array.from({ length: 148 }, (_, index) => ({
    prefix: [],
    primary: rideRows.includes(index + 1) ? "ride" : "dragonFang",
    tail: [],
  }));
  const template = buildLianyingFocusedCompanionAnchorTemplate(packs, {
    fixedThroughOrdinal: 4,
    beforeRows: 0,
    afterRows: 2,
  });
  assert.deepEqual(template.rideWindows.slice(0, 4).map(
    (window) => [window.earliestRow, window.latestRow]), [
    [3, 3], [20, 20], [38, 38], [59, 59],
  ]);
  assert.deepEqual(template.rideWindows.slice(4).map(
    (window) => [window.earliestRow, window.latestRow]), [
    [107, 109], [123, 125], [145, 147],
  ]);
});

test("不同伴随动作可以使用独立的固定数量和双向窗口", () => {
  const rideRows = [3, 20, 38, 59, 107, 125, 147];
  const dismountRows = [20, 23, 25, 53, 102, 119, 147];
  const packs = Array.from({ length: 150 }, (_, index) => ({
    prefix: dismountRows.includes(index + 1) ? ["dismount"] : [],
    primary: rideRows.includes(index + 1) ? "ride" : "dragonFang",
    tail: [],
  }));
  const template = buildLianyingFocusedCompanionAnchorTemplate(packs, {
    companionTypes: ["ride", "dismount"],
    companionPolicies: {
      ride: { fixedThroughOrdinal: 7, beforeRows: 0, afterRows: 0 },
      dismount: { fixedThroughOrdinal: 4, beforeRows: 2, afterRows: 2 },
    },
  });
  assert.deepEqual(template.rideWindows.map(
    (window) => [window.earliestRow, window.latestRow]),
  rideRows.map((row) => [row, row]));
  assert.deepEqual(template.dismountWindows.slice(0, 4).map(
    (window) => [window.earliestRow, window.latestRow]), [
    [20, 20], [23, 23], [25, 25], [53, 53],
  ]);
  assert.deepEqual(template.dismountWindows.slice(4).map(
    (window) => [window.earliestRow, window.latestRow]), [
    [100, 104], [117, 121], [145, 149],
  ]);
});

test("后两次橙武可以独立开放双向小窗口", () => {
  const orangeRows = [3, 47, 89, 131];
  const packs = Array.from({ length: 148 }, (_, index) => ({
    prefix: [],
    primary: "dragonFang",
    tail: orangeRows.includes(index + 1) ? ["orange"] : [],
  }));
  const template = buildLianyingFocusedCompanionAnchorTemplate(packs, {
    companionTypes: ["orange"],
    companionPolicies: {
      orange: { fixedThroughOrdinal: 2, beforeRows: 2, afterRows: 2 },
    },
  });

  assert.deepEqual(template.orangeWindows.map(
    (window) => [window.earliestRow, window.latestRow]), [
    [3, 3], [47, 47], [87, 91], [129, 133],
  ]);
});

test("伴随锚点可以只开放指定序号并为各序号设置非对称窗口", () => {
  const orangeRows = [3, 47, 89, 131];
  const packs = Array.from({ length: 148 }, (_, index) => ({
    prefix: [],
    primary: "dragonFang",
    tail: orangeRows.includes(index + 1) ? ["orange"] : [],
  }));
  const template = buildLianyingFocusedCompanionAnchorTemplate(packs, {
    companionTypes: ["orange"],
    companionPolicies: {
      orange: {
        ordinalWindows: {
          1: { beforeRows: 0, afterRows: 2 },
          2: { beforeRows: 2, afterRows: 2 },
        },
      },
    },
  });

  assert.deepEqual(template.orangeWindows.map(
    (window) => [window.earliestRow, window.latestRow]), [
    [3, 5], [45, 49], [89, 89], [131, 131],
  ]);
});

test("雷锚点模板可以只开放指定的中段雷", () => {
  const anchors = [2, 19, 37, 58, 78, 106, 127];
  const templates = buildLianyingBoundedThunderTemplates(anchors, {
    slackRows: 1,
    movableAnchorNumbers: [2, 3, 4],
    maximumShiftedAnchors: 1,
    maximumTemplates: 16,
  });

  assert.equal(templates.length, 7);
  assert.deepEqual(new Set(templates.slice(1).map(
    (template) => template.shiftedAnchors[0].anchorNumber)),
  new Set([2, 3, 4]));
  assert.ok(templates.every((template) =>
    template.anchorRows[4] === anchors[4] &&
    template.anchorRows[5] === anchors[5]));
});

test("主要技能历史结构按早段分歧位置与技能数量变化分桶", () => {
  const reference = Array.from({ length: 12 }, () => ({
    prefix: [], primary: "dragonFang", tail: [],
  }));
  const same = structuredClone(reference);
  same[2].prefix.push("thunder");
  const earlySwap = structuredClone(reference);
  earlySwap[3].primary = "destroy";
  earlySwap[4].primary = "dragonRoar";
  const lateSwap = structuredClone(reference);
  lateSwap[9].primary = "destroy";
  lateSwap[10].primary = "dragonRoar";
  const options = {
    startRow: 1,
    endRow: 12,
    rowBucketSize: 4,
    maximumDifferences: 2,
  };

  assert.equal(
    lianyingPrimaryHistoryStructureKey(reference, reference, options),
    lianyingPrimaryHistoryStructureKey(same, reference, options),
  );
  assert.notEqual(
    lianyingPrimaryHistoryStructureKey(earlySwap, reference, options),
    lianyingPrimaryHistoryStructureKey(lateSwap, reference, options),
  );

  const earlyDismount = structuredClone(reference);
  earlyDismount[3].prefix.push("dismount");
  const lateDismount = structuredClone(reference);
  lateDismount[9].tail.push({ id: "dismount", leadFrames: 1 });
  assert.equal(
    lianyingPrimaryHistoryStructureKey(earlyDismount, reference, options),
    lianyingPrimaryHistoryStructureKey(lateDismount, reference, options),
  );
  const dismountOptions = {
    ...options,
    companionActionIds: ["dismount"],
    maximumCompanionDifferences: 2,
  };
  assert.notEqual(
    lianyingPrimaryHistoryStructureKey(
      earlyDismount,
      reference,
      dismountOptions,
    ),
    lianyingPrimaryHistoryStructureKey(
      lateDismount,
      reference,
      dismountOptions,
    ),
  );
});

test("早段结构键忽略雷与突位置但保留主要技能和橙武", () => {
  const baseline = [{
    prefix: [],
    primary: "ride",
    tail: [{ id: "thunder", leadFrames: 1 }, "orange"],
  }];
  const phaseOnly = [{
    prefix: ["thunder"],
    primary: "ride",
    tail: ["orange", "dash"],
  }];
  const differentOrange = [{
    prefix: ["thunder"],
    primary: "ride",
    tail: ["dash"],
  }];
  assert.equal(
    lianyingEarlyStructureKey(baseline),
    lianyingEarlyStructureKey(phaseOnly),
  );
  assert.notEqual(
    lianyingEarlyStructureKey(baseline),
    lianyingEarlyStructureKey(differentOrange),
  );
});

test("早段结构种子排除纯雷相位并保留近优主要技能差异", () => {
  const incumbent = [
    { prefix: [], primary: "destroy", tail: ["thunder"] },
    { prefix: [], primary: "dragonFang", tail: [] },
  ];
  const candidates = [
    { isIncumbent: true, coreDamage: 1000, packs: incumbent },
    {
      coreDamage: 999,
      packs: [
        { prefix: ["thunder"], primary: "destroy", tail: [] },
        incumbent[1],
      ],
    },
    {
      coreDamage: 995,
      packs: [incumbent[1], incumbent[0]],
    },
    {
      coreDamage: 970,
      packs: [
        { prefix: [], primary: "piercingCloud", tail: [] },
        incumbent[1],
      ],
    },
  ];
  const selected = selectLianyingEarlyStructuralSeedCandidates(
    candidates,
    incumbent,
    { limit: 3, maximumCoreDamageLossRatio: 0.01, endRow: 2 },
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0].coreDamage, 995);
  assert.deepEqual(selected[0].earlyDifferingRows, [1, 2]);

  const orangePhase = selectLianyingEarlyStructuralSeedCandidates(
    [
      { isIncumbent: true, coreDamage: 1000, packs: [{
        prefix: [], primary: "destroy", tail: ["orange"],
      }] },
      { coreDamage: 999, packs: [{
        prefix: ["orange"], primary: "destroy", tail: [],
      }] },
    ],
    [{ prefix: [], primary: "destroy", tail: ["orange"] }],
    {
      limit: 1,
      maximumCoreDamageLossRatio: 0.01,
      endRow: 1,
      ignoredActionIds: ["thunder", "dash", "orange"],
    },
  );
  assert.equal(orangePhase.length, 0);

  const mustDifferImmediately = selectLianyingEarlyStructuralSeedCandidates(
    [
      { isIncumbent: true, coreDamage: 1000, packs: incumbent },
      {
        coreDamage: 990,
        packs: [incumbent[0], {
          prefix: [], primary: "destroy", tail: [],
        }],
      },
    ],
    incumbent,
    {
      limit: 3,
      maximumCoreDamageLossRatio: 0.05,
      endRow: 2,
      latestFirstDifferenceRow: 1,
    },
  );
  assert.equal(mustDifferImmediately.length, 0);
});

test("结构种子按移动雷分组保留高伤候选并过滤过度损失", () => {
  const incumbentRows = [3, 20, 38, 59, 79, 107, 128];
  const candidates = [
    [incumbentRows, 1000],
    [[3, 20, 38, 59, 79, 103, 128], 970],
    [[3, 20, 38, 59, 79, 104, 128], 965],
    [[3, 20, 38, 59, 80, 104, 128], 960],
    [[3, 20, 38, 55, 79, 107, 128], 900],
  ].map(([anchorRows, bestCoreDamage]) => ({
    anchorRows,
    bestCoreDamage,
    packs: [{ primary: "dragonFang" }],
  }));
  const selected = selectLianyingStructuralSeedCandidates(
    candidates,
    incumbentRows,
    { limit: 3, maximumCoreDamageLossRatio: 0.05 },
  );
  assert.deepEqual(selected.map((candidate) => candidate.anchorRows), [
    [3, 20, 38, 59, 79, 103, 128],
    [3, 20, 38, 59, 80, 104, 128],
    [3, 20, 38, 59, 79, 104, 128],
  ]);
  assert.deepEqual(selected.map((candidate) => candidate.changedAnchors), [
    [6], [5, 6], [6],
  ]);
  assert.equal(selected.some((candidate) => candidate.bestCoreDamage === 900), false);
});

test("聚焦伴随协调可按上限重新居中并汇总每轮诊断", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const optimized =
    optimizeLianyingIterativeFocusedCompanionAnchorCoordination(
      runtime,
      seed.packs,
      {
        durationSeconds: 30,
        maximumFocusedPasses: 1,
        fixedThroughOrdinal: 1,
        beforeRows: 0,
        afterRows: 1,
        rowBeamWidth: 4,
        boundaryBeamWidth: 4,
        coreFinalistCount: 2,
        coarseCandidateLimit: 2,
        coarseDashStates: 2,
        finalDashCandidateCount: 2,
        fullDashStates: 2,
      },
    );
  assert.equal(optimized.iteration.executedPasses, 1);
  assert.equal(optimized.iteration.maximumPasses, 1);
  assert.equal(optimized.iteration.passes.length, 1);
  assert.equal(
    optimized.coordination.kind,
    "iterative-focused-companion-anchor-coordination",
  );
  assert.ok(optimized.state.totalDamage >= optimized.baselineDamage);
});
