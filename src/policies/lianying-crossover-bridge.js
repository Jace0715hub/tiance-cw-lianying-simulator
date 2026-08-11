import {
  identifyLianyingThunderSegments,
  optimizeLianyingSegmentResynthesis,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import { replayWhitepaperLianying } from "./whitepaper-lianying.js";

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
