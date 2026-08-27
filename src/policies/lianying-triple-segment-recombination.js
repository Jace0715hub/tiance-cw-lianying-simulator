import {
  identifyLianyingThunderSegments,
  lianyingCoreStructureKey,
  optimizeLianyingSegmentResynthesis,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import { replayWhitepaperLianying } from "./whitepaper-lianying.js";

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

export function alignLianyingDonorWaitPacks(referencePacks, donorPacks) {
  if (referencePacks.length === donorPacks.length) return donorPacks;
  const referenceWaitCount = referencePacks.filter(
    (pack) => actionId(pack?.primary) === "wait",
  ).length;
  const donorWaitCount = donorPacks.filter(
    (pack) => actionId(pack?.primary) === "wait",
  ).length;
  if (
    donorWaitCount !== 0 ||
    referencePacks.length - referenceWaitCount !== donorPacks.length
  ) {
    throw new Error(
      "多段协同重组只能自动对齐正式轴新增、供体未包含的显式等待行",
    );
  }
  let donorIndex = 0;
  const aligned = referencePacks.map((referencePack) => {
    if (actionId(referencePack?.primary) === "wait") return referencePack;
    const donorPack = donorPacks[donorIndex];
    donorIndex += 1;
    return donorPack;
  });
  if (donorIndex !== donorPacks.length) {
    throw new Error("多段协同重组等待行对齐没有完整消费供体动作包");
  }
  return aligned;
}

function structuralPack(pack) {
  return {
    prefix: (pack?.prefix ?? []).filter((action) => actionId(action) !== "dash"),
    primary: pack?.primary,
    tail: (pack?.tail ?? []).filter((action) => actionId(action) !== "dash"),
  };
}

function thunderRows(packs) {
  return identifyLianyingThunderSegments(stripLianyingDashPacks(packs))
    .anchors.map((row) => row + 1);
}

export function lianyingDifferingThunderSegmentIndices(referencePacks, donorPacks) {
  const reference = stripLianyingDashPacks(referencePacks);
  const donor = stripLianyingDashPacks(
    alignLianyingDonorWaitPacks(referencePacks, donorPacks),
  );
  if (reference.length !== donor.length) {
    throw new Error("多段协同重组要求正式轴与对齐后的热启动轴行数相同");
  }
  const referenceThunderRows = thunderRows(reference);
  const donorThunderRows = thunderRows(donor);
  if (referenceThunderRows.length !== donorThunderRows.length) {
    throw new Error("多段协同重组要求正式轴与热启动轴雷次数相同");
  }
  const thunderPositionWindows = referenceThunderRows.flatMap((row, index) => {
    const donorRow = donorThunderRows[index];
    if (row === donorRow) return [];
    return [{
      anchorNumber: index + 1,
      sourceIndex: donorRow - 1,
      earliestIndex: Math.min(row, donorRow) - 1,
      latestIndex: Math.max(row, donorRow) - 1,
    }];
  });
  const ranges = identifyLianyingThunderSegments(reference).ranges;
  const differenceRows = reference.flatMap((pack, index) =>
    JSON.stringify(structuralPack(pack)) ===
      JSON.stringify(structuralPack(donor[index]))
      ? []
      : [index + 1]);
  const segmentIndices = ranges.flatMap((range, index) =>
    differenceRows.some((row) =>
      row - 1 >= range.startIndex && row - 1 < range.endIndex)
      ? [index]
      : []);
  return {
    differenceRows,
    segmentIndices,
    ranges,
    referenceThunderRows,
    donorThunderRows,
    thunderPositionWindows,
  };
}

export function buildLianyingBoundedMultiSegmentSpan(
  referencePacks,
  donorPacks,
  { segmentCount = 3 } = {},
) {
  const count = Math.max(1, Math.floor(Number(segmentCount)));
  const {
    differenceRows,
    segmentIndices,
    ranges,
    referenceThunderRows,
    donorThunderRows,
    thunderPositionWindows,
  } =
    lianyingDifferingThunderSegmentIndices(referencePacks, donorPacks);
  if (differenceRows.length === 0) {
    throw new Error("多段协同重组要求热启动轴具有真实核心差异");
  }
  const firstDifferenceSegment = segmentIndices[0];
  const lastDifferenceSegment = segmentIndices.at(-1);
  const differenceSpan = lastDifferenceSegment - firstDifferenceSegment + 1;
  if (differenceSpan > count) {
    throw new Error("热启动轴差异跨越的雷区段多于本次有界窗口");
  }
  const spare = count - differenceSpan;
  const maximumStart = Math.max(0, ranges.length - count);
  const startSegmentIndex = Math.min(
    maximumStart,
    Math.max(0, firstDifferenceSegment - Math.floor(spare / 2)),
  );
  const endSegmentIndex = Math.min(
    ranges.length - 1,
    startSegmentIndex + count - 1,
  );
  const selected = ranges.slice(startSegmentIndex, endSegmentIndex + 1);
  const first = selected[0];
  const last = selected.at(-1);
  return {
    id: `thunder-${first.startThunderNumber}-span-${selected.length}`,
    kind: "bounded-multi-thunder-segment",
    startIndex: first.startIndex,
    endIndex: last.endIndex,
    rowCount: last.endIndex - first.startIndex,
    startThunderNumber: first.startThunderNumber,
    endThunderNumber: last.endThunderNumber ?? last.startThunderNumber,
    sourceSegmentIds: selected.map((range) => range.id),
    segmentIndices: selected.map((_, index) => startSegmentIndex + index),
    differenceRows,
    differenceSegmentIndices: segmentIndices,
    referenceThunderRows,
    donorThunderRows,
    thunderPositionWindows,
  };
}

export function optimizeLianyingTripleSegmentRecombination(
  runtime,
  incumbentPacks,
  donorPacks,
  {
    durationSeconds = 180,
    segmentCount = 3,
    maxPasses = 1,
    beamWidth = 24,
    finalistCount = 12,
    coarseCandidateLimit = 8,
    coarseDashStates = 8,
    finalDashCandidateCount = 2,
    fullDashStates = 128,
    boundaryPaddingRows = 0,
    collectDiverseCandidates = true,
    diverseCandidateLimit = 16,
    diverseCandidateMaximumLossRatio = 0.01,
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
  const alignedDonorPacks = alignLianyingDonorWaitPacks(
    incumbentPacks,
    donorPacks,
  );
  const incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const donor = replayWhitepaperLianying(runtime, alignedDonorPacks, {
    durationSeconds,
  });
  const span = buildLianyingBoundedMultiSegmentSpan(
    incumbentPacks,
    alignedDonorPacks,
    { segmentCount },
  );
  const incumbentCore = stripLianyingDashPacks(incumbentPacks);
  const ignoredStructureActionIds = ["dash", "dismount", "thunder", "orange"];
  const optimized = optimizeLianyingSegmentResynthesis(runtime, alignedDonorPacks, {
    durationSeconds,
    maxPasses,
    beamWidth,
    finalistCount,
    coarseCandidateLimit,
    coarseDashStates,
    finalDashCandidateCount,
    fullDashStates,
    boundaryPaddingRows,
    segmentRanges: [span],
    preserveThunderPositions: true,
    thunderPositionWindows: span.thunderPositionWindows,
    additionalWarmAxes: [incumbentPacks, ...additionalWarmAxes],
    pinAdditionalWarmAxes: true,
    excludedCorePackKeys: [JSON.stringify(incumbentCore)],
    excludedCoreStructureKeys: [lianyingCoreStructureKey(incumbentCore, {
      ignoredActionIds: ignoredStructureActionIds,
    })],
    coreStructureIgnoredActionIds: ignoredStructureActionIds,
    collectDiverseCandidates,
    diverseCandidateLimit,
    diverseCandidateMaximumLossRatio,
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
    onProgress,
  });
  const candidateDamage = optimized.state.totalDamage;
  const accepted = candidateDamage > incumbent.state.totalDamage;
  return {
    packs: accepted ? optimized.packs : incumbentPacks,
    state: accepted ? optimized.state : incumbent.state,
    accepted,
    baselineDamage: incumbent.state.totalDamage,
    donorDamage: donor.state.totalDamage,
    candidateDamage,
    donorDamageGain: candidateDamage - donor.state.totalDamage,
    globalDamageGain: candidateDamage - incumbent.state.totalDamage,
    candidatePacks: optimized.packs,
    candidateState: optimized.state,
    span,
    resynthesis: optimized,
  };
}
