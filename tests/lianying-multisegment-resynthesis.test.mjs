import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import {
  isLianyingThunderAnchorPackAllowed,
  lianyingAnchorDriftLongTermScore,
  isLianyingAnchorDriftPackAllowed,
  lianyingAnchorDriftScheduleToCsv,
  lianyingAnchorDriftWindow,
  lianyingMultiSegmentAnchorDiagnosticsToCsv,
  optimizeLianyingAnchorDriftResynthesis,
  optimizeLianyingMultiSegmentResynthesis,
  selectLianyingJointBoundaryNodes,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import {
  buildLianyingBoundedThunderTemplates,
  lianyingAnchorCoordinationTemplatesToCsv,
  optimizeLianyingHierarchicalAnchorCoordination,
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
  const csv = lianyingAnchorCoordinationTemplatesToCsv(optimized);
  assert.match(csv, /incumbent/);
  assert.match(csv, /shift-2:-1/);
  assert.match(csv, /存活至雷序号/);
});
