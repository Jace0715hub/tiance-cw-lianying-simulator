import {
  identifyLianyingThunderSegments,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import {
  optimizeLianyingDashOverlay,
  optimizeLianyingNeighborhoodAxis,
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";

export function optimizeLianyingCompoundNeighborhoodBlocks(
  runtime,
  packs,
  {
    durationSeconds = 180,
    blockNumbers = null,
    neighborhood = {},
    coarseDashStates = 8,
    finalDashCandidateCount = 2,
    fullDashStates = 128,
    onProgress = null,
  } = {},
) {
  const incumbent = replayWhitepaperLianying(runtime, packs, {
    durationSeconds,
  });
  const corePacks = stripLianyingDashPacks(packs);
  const coreBaseline = replayWhitepaperLianying(runtime, corePacks, {
    durationSeconds,
  });
  const anchors = identifyLianyingThunderSegments(corePacks).anchors;
  const maximumBlockNumber = Math.max(0, anchors.length - 1);
  const selectedBlockNumbers = Array.isArray(blockNumbers)
    ? [...new Set(blockNumbers.map(Number).filter((number) =>
        Number.isInteger(number) && number >= 1 && number <= maximumBlockNumber))]
    : Array.from({ length: maximumBlockNumber }, (_, index) => index + 1);
  const thunderRows = anchors.map((row) => row + 1);
  const blockResults = [];
  for (const [index, blockNumber] of selectedBlockNumbers.entries()) {
    const startIndex = anchors[blockNumber - 1];
    const endIndex = blockNumber + 1 < anchors.length
      ? anchors[blockNumber + 1]
      : corePacks.length;
    if (typeof onProgress === "function") {
      onProgress({
        stage: "block-start",
        block: index + 1,
        blockCount: selectedBlockNumbers.length,
        blockNumber,
        startRow: startIndex + 1,
        endRow: endIndex,
      });
    }
    const optimized = optimizeLianyingNeighborhoodAxis(runtime, corePacks, {
      durationSeconds,
      maxPasses: 1,
      maxSwapDistance: 8,
      maxRotationLength: 8,
      localLookaheadRows: [16, 32, 64],
      shortlistPerHorizon: 48,
      shortlistPerKind: 8,
      shortlistPerResourceSignal: 4,
      fullEvaluationLimit: 192,
      requiredThunderRows: thunderRows,
      mutableRowRanges: [{ startRow: startIndex + 1, endRow: endIndex }],
      genericCompoundCandidateLimit: 96,
      genericCompoundSourceLimit: 24,
      genericCompoundMaxGapRows: 12,
      ...neighborhood,
      onPass: (event) => {
        if (typeof onProgress === "function") {
          onProgress({ stage: "block-pass", blockNumber, ...event });
        }
      },
    });
    blockResults.push({
      blockNumber,
      startRow: startIndex + 1,
      endRow: endIndex,
      packs: optimized.packs,
      coreDamage: optimized.state.totalDamage,
      coreDamageGain: optimized.state.totalDamage - coreBaseline.state.totalDamage,
      improvements: optimized.improvements,
      candidatesEvaluated: optimized.candidatesEvaluated,
      illegalCandidates: optimized.illegalCandidates,
      fullCandidatesEvaluated: optimized.fullCandidatesEvaluated,
      shortlistedCandidates: optimized.shortlistedCandidates,
      candidateKinds: optimized.candidateKinds,
    });
  }
  const improvedBlocks = blockResults
    .filter((result) => result.coreDamageGain > 0)
    .sort((left, right) => right.coreDamage - left.coreDamage);
  const coarseCandidates = [];
  for (const result of improvedBlocks) {
    const dash = optimizeLianyingDashOverlay(runtime, result.packs, {
      durationSeconds,
      maxStatesPerRow: coarseDashStates,
    });
    coarseCandidates.push({
      ...result,
      packs: dash.packs,
      totalDamage: dash.state.totalDamage,
    });
  }
  const finalists = coarseCandidates
    .sort((left, right) => right.totalDamage - left.totalDamage)
    .slice(0, Math.max(1, Math.floor(Number(finalDashCandidateCount))))
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
      };
    })
    .sort((left, right) => right.totalDamage - left.totalDamage);
  const best = finalists[0] ?? null;
  const accepted = Boolean(best && best.totalDamage > incumbent.state.totalDamage);
  return {
    packs: accepted ? best.packs : packs,
    state: accepted ? best.state : incumbent.state,
    accepted,
    baselineDamage: incumbent.state.totalDamage,
    coreBaselineDamage: coreBaseline.state.totalDamage,
    damageGain: accepted ? best.totalDamage - incumbent.state.totalDamage : 0,
    selectedBlock: accepted ? best.blockNumber : null,
    thunderRows,
    blockResults: blockResults.map((result) => ({
      blockNumber: result.blockNumber,
      startRow: result.startRow,
      endRow: result.endRow,
      coreDamage: result.coreDamage,
      coreDamageGain: result.coreDamageGain,
      improvements: result.improvements,
      candidatesEvaluated: result.candidatesEvaluated,
      illegalCandidates: result.illegalCandidates,
      fullCandidatesEvaluated: result.fullCandidatesEvaluated,
      shortlistedCandidates: result.shortlistedCandidates,
      candidateKinds: result.candidateKinds,
    })),
    coarseCandidates: coarseCandidates.map((candidate) => ({
      blockNumber: candidate.blockNumber,
      coreDamageGain: candidate.coreDamageGain,
      totalDamage: candidate.totalDamage,
      improvements: candidate.improvements,
    })),
  };
}
