import {
  identifyLianyingThunderSegments,
  lianyingCoreStructureKey,
  optimizeLianyingSegmentResynthesis,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";

function clonePack(pack) {
  return {
    prefix: (pack.prefix ?? []).map((action) =>
      typeof action === "string" ? action : { ...action }),
    primary:
      typeof pack.primary === "string" ? pack.primary : { ...pack.primary },
    tail: (pack.tail ?? []).map((action) =>
      typeof action === "string" ? action : { ...action }),
  };
}

function bridgeSegmentIndices(anchorNumber, rangeCount) {
  const crossingIndex = Number(anchorNumber) - 1;
  return [crossingIndex - 1, crossingIndex]
    .filter((index, position, values) =>
      index >= 0 && index < rangeCount && values.indexOf(index) === position);
}

// 交叉点两侧的远端前缀/后缀保持不变，只让整段重合成器搜索相邻雷区段。
// 局部候选首先与交叉轴比较，最终是否采用则始终以全局最优轴为准。
export function optimizeLianyingCrossoverBridge(
  runtime,
  incumbentPacks,
  crossoverPacks,
  {
    durationSeconds = 180,
    crossoverAnchorNumber,
    segmentIndices = null,
    maxPasses = 2,
    beamWidth = 32,
    finalistCount = 8,
    coarseCandidateLimit = 8,
    coarseDashStates = 16,
    finalDashCandidateCount = 2,
    fullDashStates = 256,
    boundaryPaddingRows = 6,
    preserveNovelStructure = true,
    preserveNovelStructureIgnoredActionIds = [],
    valueShadowPolicy = null,
    onProgress = null,
  } = {},
) {
  if (!Number.isInteger(Number(crossoverAnchorNumber))) {
    throw new Error("桥接搜索需要明确的雷交叉点编号");
  }
  const incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const crossover = replayWhitepaperLianying(runtime, crossoverPacks, {
    durationSeconds,
  });
  const identified = identifyLianyingThunderSegments(crossoverPacks);
  const selectedSegmentIndices = segmentIndices ?? bridgeSegmentIndices(
    crossoverAnchorNumber,
    identified.ranges.length,
  );
  if (selectedSegmentIndices.length === 0) {
    throw new Error("交叉点前后没有可搜索的雷区段");
  }
  const optimized = optimizeLianyingSegmentResynthesis(
    runtime,
    crossoverPacks,
    {
      durationSeconds,
      maxPasses,
      beamWidth,
      finalistCount,
      coarseCandidateLimit,
      coarseDashStates,
      finalDashCandidateCount,
      fullDashStates,
      boundaryPaddingRows,
      segmentIndices: selectedSegmentIndices,
      excludedCorePackKeys: preserveNovelStructure
        ? [JSON.stringify(stripLianyingDashPacks(incumbentPacks))]
        : [],
      excludedCoreStructureKeys: preserveNovelStructure &&
        preserveNovelStructureIgnoredActionIds.length > 0
        ? [lianyingCoreStructureKey(stripLianyingDashPacks(incumbentPacks), {
            ignoredActionIds: preserveNovelStructureIgnoredActionIds,
          })]
        : [],
      coreStructureIgnoredActionIds: preserveNovelStructureIgnoredActionIds,
      valueShadowPolicy,
      onProgress,
    },
  );
  const accepted = optimized.state.totalDamage > incumbent.state.totalDamage;
  return {
    packs: accepted ? optimized.packs : incumbentPacks.map(clonePack),
    state: accepted ? optimized.state : incumbent.state,
    accepted,
    baselineDamage: incumbent.state.totalDamage,
    crossoverDamage: crossover.state.totalDamage,
    bridgedDamage: optimized.state.totalDamage,
    crossoverGap: crossover.state.totalDamage - incumbent.state.totalDamage,
    bridgeDamageGain: optimized.state.totalDamage - crossover.state.totalDamage,
    globalDamageGain: optimized.state.totalDamage - incumbent.state.totalDamage,
    candidatePacks: optimized.packs,
    candidateState: optimized.state,
    crossoverAnchorNumber: Number(crossoverAnchorNumber),
    anchors: identified.anchors.map((index) => index + 1),
    segmentIndices: selectedSegmentIndices,
    segmentIds: selectedSegmentIndices.map((index) => identified.ranges[index]?.id),
    preserveNovelStructure,
    preserveNovelStructureIgnoredActionIds,
    resynthesis: optimized,
  };
}

export function buildLianyingCrossoverJointSegment(packs, anchorNumber) {
  const identified = identifyLianyingThunderSegments(packs);
  const indices = bridgeSegmentIndices(anchorNumber, identified.ranges.length);
  if (indices.length !== 2) {
    throw new Error("联合桥接要求交叉雷前后各存在一个完整区段");
  }
  const before = identified.ranges[indices[0]];
  const after = identified.ranges[indices[1]];
  return {
    id: `joint-thunder-${Number(anchorNumber) - 1}-to-${Number(anchorNumber) + 1}`,
    kind: "joint-crossover-bridge",
    startIndex: before.startIndex,
    endIndex: after.endIndex,
    rowCount: after.endIndex - before.startIndex,
    startThunderNumber: before.startThunderNumber,
    crossoverThunderNumber: Number(anchorNumber),
    endThunderNumber: after.endThunderNumber,
    sourceSegmentIds: [before.id, after.id],
  };
}

export function buildLianyingCrossScheduleBridgePlan(
  incumbentAnchors,
  alternateAnchors,
  { thunderDriftRows = 0, actionCount = null } = {},
) {
  const incumbent = incumbentAnchors.map(Number);
  const alternate = alternateAnchors.map(Number);
  if (
    incumbent.length !== alternate.length ||
    incumbent.length < 3 ||
    incumbent.some((row) => !Number.isInteger(row)) ||
    alternate.some((row) => !Number.isInteger(row))
  ) {
    throw new Error("跨坐标桥接要求两条雷表等长且至少包含3次雷");
  }
  const differing = incumbent.flatMap((row, index) =>
    row === alternate[index] ? [] : [index]);
  if (differing.length === 0) {
    throw new Error("跨坐标桥接要求两条雷表至少有一处不同");
  }
  const firstDifference = differing[0];
  const lastDifference = differing.at(-1);
  let previousCommon = firstDifference - 1;
  while (
    previousCommon >= 0 &&
    incumbent[previousCommon] !== alternate[previousCommon]
  ) previousCommon -= 1;
  let nextCommon = lastDifference + 1;
  while (
    nextCommon < incumbent.length &&
    incumbent[nextCommon] !== alternate[nextCommon]
  ) nextCommon += 1;
  if (previousCommon < 0) {
    throw new Error("跨坐标桥接需要在差异雷前有一个相同雷作为左边界");
  }
  const terminalBoundary = nextCommon >= incumbent.length;
  const terminalActionCount = Number(actionCount);
  if (
    terminalBoundary &&
    (!Number.isInteger(terminalActionCount) ||
      terminalActionCount <= alternate[lastDifference])
  ) {
    throw new Error("末雷跨坐标桥接需要有效的动作总数作为右边界");
  }
  const drift = Math.max(0, Math.floor(Number(thunderDriftRows)));
  const thunderPositionWindows = differing.map((anchorIndex) => {
    const lowerBound = Math.max(
      alternate[previousCommon] + 1,
      Math.min(incumbent[anchorIndex], alternate[anchorIndex]) - drift,
    );
    const upperBoundary = terminalBoundary
      ? terminalActionCount - 1
      : alternate[nextCommon] - 1;
    const upperBound = Math.min(
      upperBoundary,
      Math.max(incumbent[anchorIndex], alternate[anchorIndex]) + drift,
    );
    return {
      anchorNumber: anchorIndex + 1,
      sourceIndex: alternate[anchorIndex],
      earliestIndex: lowerBound,
      latestIndex: upperBound,
    };
  });
  for (let index = 1; index < thunderPositionWindows.length; index += 1) {
    if (
      thunderPositionWindows[index - 1].latestIndex >=
      thunderPositionWindows[index].earliestIndex
    ) {
      throw new Error("跨坐标桥接的雷窗口重叠，请缩小额外漂移范围");
    }
  }
  return {
    firstDifferingAnchorNumber: firstDifference + 1,
    lastDifferingAnchorNumber: lastDifference + 1,
    previousCommonAnchorNumber: previousCommon + 1,
    nextCommonAnchorNumber: terminalBoundary ? null : nextCommon + 1,
    differingAnchorNumbers: differing.map((index) => index + 1),
    incumbentAnchors: incumbent.map((row) => row + 1),
    alternateAnchors: alternate.map((row) => row + 1),
    segment: {
      id: terminalBoundary
        ? `cross-schedule-thunder-${previousCommon + 1}-to-end`
        : `cross-schedule-thunder-${previousCommon + 1}-to-${nextCommon + 1}`,
      kind: terminalBoundary
        ? "cross-schedule-terminal-bridge"
        : "cross-schedule-bridge",
      startIndex: alternate[previousCommon],
      endIndex: terminalBoundary
        ? terminalActionCount
        : alternate[nextCommon] + 1,
      rowCount: (terminalBoundary
        ? terminalActionCount
        : alternate[nextCommon] + 1) - alternate[previousCommon],
      startThunderNumber: previousCommon + 1,
      ...(terminalBoundary ? {} : { endThunderNumber: nextCommon + 1 }),
    },
    thunderPositionWindows,
    thunderDriftRows: drift,
    terminalBoundary,
  };
}

export function optimizeLianyingCrossScheduleBridge(
  runtime,
  incumbentPacks,
  alternatePacks,
  {
    durationSeconds = 180,
    maxPasses = 1,
    beamWidth = 32,
    finalistCount = 8,
    coarseCandidateLimit = 8,
    coarseDashStates = 16,
    finalDashCandidateCount = 2,
    fullDashStates = 128,
    boundaryPaddingRows = 6,
    thunderDriftRows = 0,
    preserveNovelStructure = true,
    additionalWarmAxes = [],
    adaptiveSuffixRepair = false,
    adaptiveSuffixMaxExpansions = 1,
    adaptiveSuffixLookaheadRows = 4,
    adaptiveSuffixMaximumAddedRows = 12,
    adaptiveSuffixFailureChainLimit = 2,
    adaptiveSuffixDirectedRepairLimit = 4,
    onProgress = null,
  } = {},
) {
  const incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const alternate = replayWhitepaperLianying(runtime, alternatePacks, {
    durationSeconds,
  });
  const incumbentCore = stripLianyingDashPacks(incumbentPacks);
  const alternateCore = stripLianyingDashPacks(alternatePacks);
  const incumbentAnchors = identifyLianyingThunderSegments(incumbentCore).anchors;
  const alternateAnchors = identifyLianyingThunderSegments(alternateCore).anchors;
  const plan = buildLianyingCrossScheduleBridgePlan(
    incumbentAnchors,
    alternateAnchors,
    { thunderDriftRows, actionCount: alternateCore.length },
  );
  const optimized = optimizeLianyingSegmentResynthesis(
    runtime,
    incumbentPacks,
    {
      durationSeconds,
      maxPasses,
      beamWidth,
      finalistCount,
      coarseCandidateLimit,
      coarseDashStates,
      finalDashCandidateCount,
      fullDashStates,
      boundaryPaddingRows,
      segmentRanges: [plan.segment],
      preserveThunderPositions: true,
      thunderPositionWindows: plan.thunderPositionWindows,
      additionalWarmAxes: [alternatePacks, ...additionalWarmAxes],
      adaptiveSuffixRepair,
      adaptiveSuffixMaxExpansions,
      adaptiveSuffixLookaheadRows,
      adaptiveSuffixMaximumAddedRows,
      adaptiveSuffixPreferDriftedLineages: true,
      adaptiveSuffixFailureChainLimit,
      adaptiveSuffixDirectedRepairLimit,
      excludedCorePackKeys: preserveNovelStructure
        ? [JSON.stringify(incumbentCore)]
        : [],
      collectDiverseCandidates: true,
      diverseCandidateLimit: Math.max(8, coarseCandidateLimit * 2),
      diverseCandidateMaximumLossRatio: 0.05,
      onProgress,
    },
  );
  const incumbentAnchorKey = JSON.stringify(
    incumbentAnchors.map((row) => row + 1),
  );
  const structuralCoreBySchedule = new Map();
  for (const candidate of optimized.diverseCandidates) {
    const anchorRows = identifyLianyingThunderSegments(candidate.packs).anchors.map(
      (row) => row + 1);
    const key = JSON.stringify(anchorRows);
    if (key === incumbentAnchorKey) continue;
    const current = structuralCoreBySchedule.get(key);
    if (!current || candidate.coreDamage > current.coreDamage) {
      structuralCoreBySchedule.set(key, { ...candidate, anchorRows });
    }
  }
  const structuralCoarse = [...structuralCoreBySchedule.values()].map(
    (candidate) => {
      const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
        durationSeconds,
        maxStatesPerRow: coarseDashStates,
      });
      return {
        ...candidate,
        packs: dash.packs,
        state: dash.state,
        totalDamage: dash.state.totalDamage,
        dashCount: dash.dashCount,
      };
    },
  ).sort((left, right) => right.totalDamage - left.totalDamage);
  const structuralFinalists = structuralCoarse
    .slice(0, Math.max(1, finalDashCandidateCount))
    .map((candidate) => {
      const dash = optimizeLianyingDashOverlay(
        runtime,
        stripLianyingDashPacks(candidate.packs),
        { durationSeconds, maxStatesPerRow: fullDashStates },
      );
      return {
        ...candidate,
        packs: dash.packs,
        state: dash.state,
        totalDamage: dash.state.totalDamage,
        dashCount: dash.dashCount,
      };
    })
    .sort((left, right) => right.totalDamage - left.totalDamage);
  const alternateStructuralCandidate = {
    packs: alternatePacks.map(clonePack),
    state: alternate.state,
    totalDamage: alternate.state.totalDamage,
    anchorRows: alternateAnchors.map((row) => row + 1),
    dashCount: alternate.state.timeline.filter(
      (event) => event.type === "offGcd" && event.action === "dash",
    ).length,
    coreDamageLoss: null,
    structuralDistanceFromReference: null,
  };
  const structuralCandidateBySchedule = new Map();
  for (const candidate of [alternateStructuralCandidate, ...structuralFinalists]) {
    const key = JSON.stringify(candidate.anchorRows);
    const current = structuralCandidateBySchedule.get(key);
    if (!current || candidate.totalDamage > current.totalDamage) {
      structuralCandidateBySchedule.set(key, candidate);
    }
  }
  const retainedStructuralCandidates = [...structuralCandidateBySchedule.values()]
    .sort((left, right) => right.totalDamage - left.totalDamage);
  const bestStructuralAlternative = retainedStructuralCandidates[0];
  const accepted = optimized.state.totalDamage > incumbent.state.totalDamage;
  return {
    packs: accepted ? optimized.packs : incumbentPacks.map(clonePack),
    state: accepted ? optimized.state : incumbent.state,
    accepted,
    baselineDamage: incumbent.state.totalDamage,
    alternateDamage: alternate.state.totalDamage,
    bridgedDamage: optimized.state.totalDamage,
    bridgeDamageGain: optimized.state.totalDamage - alternate.state.totalDamage,
    globalDamageGain: optimized.state.totalDamage - incumbent.state.totalDamage,
    candidatePacks: bestStructuralAlternative.packs,
    candidateState: bestStructuralAlternative.state,
    structuralBridgedDamage: bestStructuralAlternative.totalDamage,
    structuralBridgeDamageGain:
      bestStructuralAlternative.totalDamage - alternate.state.totalDamage,
    structuralGlobalDamageGain:
      bestStructuralAlternative.totalDamage - incumbent.state.totalDamage,
    structuralAnchorRows: bestStructuralAlternative.anchorRows,
    structuralFinalists: retainedStructuralCandidates.map((candidate) => ({
      anchorRows: candidate.anchorRows,
      totalDamage: candidate.totalDamage,
      dashCount: candidate.dashCount,
      coreDamageLoss: candidate.coreDamageLoss,
      structuralDistanceFromReference:
        candidate.structuralDistanceFromReference,
    })),
    adaptiveSuffixRepair,
    plan,
    preserveNovelStructure,
    resynthesis: optimized,
  };
}

export function optimizeLianyingCrossoverJointBridge(
  runtime,
  incumbentPacks,
  crossoverPacks,
  {
    durationSeconds = 180,
    crossoverAnchorNumber,
    maxPasses = 1,
    beamWidth = 24,
    finalistCount = 6,
    coarseCandidateLimit = 6,
    coarseDashStates = 12,
    finalDashCandidateCount = 2,
    fullDashStates = 128,
    boundaryPaddingRows = 4,
    preserveNovelStructure = true,
    preserveNovelStructureIgnoredActionIds = [],
    preserveThunderPositions = true,
    middleThunderDriftRows = 0,
    useIncumbentWarmStart = false,
    additionalWarmAxes = [],
    adaptiveSuffixRepair = false,
    adaptiveSuffixMaxExpansions = 2,
    adaptiveSuffixLookaheadRows = 4,
    adaptiveSuffixMaximumAddedRows = 16,
    adaptiveSuffixPreferDriftedLineages = true,
    adaptiveSuffixWarmFailureLimit = 4,
    adaptiveSuffixFailureChainLimit = 1,
    adaptiveSuffixFailureRowBucketSize = 8,
    adaptiveSuffixDirectedRepairLimit = 0,
    adaptiveSuffixDirectedRepairLookBehindRows = 4,
    adaptiveSuffixDirectedRepairLookAheadRows = 6,
    valueShadowPolicy = null,
    onProgress = null,
  } = {},
) {
  if (!Number.isInteger(Number(crossoverAnchorNumber))) {
    throw new Error("联合桥接搜索需要明确的雷交叉点编号");
  }
  const incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const crossover = replayWhitepaperLianying(runtime, crossoverPacks, {
    durationSeconds,
  });
  const crossoverCore = stripLianyingDashPacks(crossoverPacks);
  const identified = identifyLianyingThunderSegments(crossoverCore);
  const jointSegment = buildLianyingCrossoverJointSegment(
    crossoverCore,
    crossoverAnchorNumber,
  );
  const middleAnchorIndex = identified.anchors[Number(crossoverAnchorNumber) - 1];
  const previousAnchorIndex = identified.anchors[Number(crossoverAnchorNumber) - 2];
  const nextAnchorIndex = identified.anchors[Number(crossoverAnchorNumber)];
  const driftRows = Math.max(0, Number(middleThunderDriftRows));
  const thunderPositionWindows = driftRows > 0 ? [{
    anchorNumber: Number(crossoverAnchorNumber),
    sourceIndex: middleAnchorIndex,
    earliestIndex: Math.max(previousAnchorIndex + 1, middleAnchorIndex - driftRows),
    latestIndex: Math.min(nextAnchorIndex - 1, middleAnchorIndex + driftRows),
  }] : [];
  const warmAxes = [
    ...(useIncumbentWarmStart ? [incumbentPacks] : []),
    ...additionalWarmAxes,
  ];
  const optimized = optimizeLianyingSegmentResynthesis(
    runtime,
    crossoverPacks,
    {
      durationSeconds,
      maxPasses,
      beamWidth,
      finalistCount,
      coarseCandidateLimit,
      coarseDashStates,
      finalDashCandidateCount,
      fullDashStates,
      boundaryPaddingRows,
      segmentRanges: [jointSegment],
      preserveThunderPositions,
      thunderPositionWindows,
      additionalWarmAxes: warmAxes,
      adaptiveSuffixRepair,
      adaptiveSuffixMaxExpansions,
      adaptiveSuffixLookaheadRows,
      adaptiveSuffixMaximumAddedRows,
      adaptiveSuffixPreferDriftedLineages,
      adaptiveSuffixWarmFailureLimit,
      adaptiveSuffixFailureChainLimit,
      adaptiveSuffixFailureRowBucketSize,
      adaptiveSuffixDirectedRepairLimit,
      adaptiveSuffixDirectedRepairLookBehindRows,
      adaptiveSuffixDirectedRepairLookAheadRows,
      excludedCorePackKeys: preserveNovelStructure
        ? [JSON.stringify(stripLianyingDashPacks(incumbentPacks))]
        : [],
      excludedCoreStructureKeys: preserveNovelStructure &&
        preserveNovelStructureIgnoredActionIds.length > 0
        ? [lianyingCoreStructureKey(stripLianyingDashPacks(incumbentPacks), {
            ignoredActionIds: preserveNovelStructureIgnoredActionIds,
          })]
        : [],
      coreStructureIgnoredActionIds: preserveNovelStructureIgnoredActionIds,
      valueShadowPolicy,
      onProgress,
    },
  );
  const accepted = optimized.state.totalDamage > incumbent.state.totalDamage;
  return {
    packs: accepted ? optimized.packs : incumbentPacks.map(clonePack),
    state: accepted ? optimized.state : incumbent.state,
    accepted,
    baselineDamage: incumbent.state.totalDamage,
    crossoverDamage: crossover.state.totalDamage,
    bridgedDamage: optimized.state.totalDamage,
    crossoverGap: crossover.state.totalDamage - incumbent.state.totalDamage,
    bridgeDamageGain: optimized.state.totalDamage - crossover.state.totalDamage,
    globalDamageGain: optimized.state.totalDamage - incumbent.state.totalDamage,
    candidatePacks: optimized.packs,
    candidateState: optimized.state,
    crossoverAnchorNumber: Number(crossoverAnchorNumber),
    anchors: identified.anchors.map((index) => index + 1),
    segmentIds: [jointSegment.id],
    jointSegment,
    preserveNovelStructure,
    preserveNovelStructureIgnoredActionIds,
    preserveThunderPositions,
    middleThunderDriftRows: driftRows,
    thunderPositionWindows,
    warmStartAxisCount: 1 + warmAxes.length,
    adaptiveSuffixRepair,
    adaptiveSuffixFailureChainLimit,
    adaptiveSuffixFailureRowBucketSize,
    adaptiveSuffixDirectedRepairLimit,
    adaptiveSuffixDirectedRepairLookBehindRows,
    adaptiveSuffixDirectedRepairLookAheadRows,
    resynthesis: optimized,
  };
}

export { bridgeSegmentIndices as lianyingCrossoverBridgeSegmentIndices };
