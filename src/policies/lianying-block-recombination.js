import {
  cloneLianyingPack,
  identifyLianyingThunderSegments,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import {
  optimizeLianyingDashOverlay,
  optimizeLianyingNeighborhoodAxis,
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function clonePacks(packs) {
  return packs.map(cloneLianyingPack);
}

function thunderRows(packs) {
  return identifyLianyingThunderSegments(packs).anchors.map((row) => row + 1);
}

function selectCandidates(candidates, limit) {
  const sorted = [...candidates].sort((left, right) =>
    right.coreDamage - left.coreDamage ||
    right.primaryDifferenceRows.length - left.primaryDifferenceRows.length);
  const selected = [];
  const selectedKeys = new Set();
  const add = (candidate) => {
    if (!candidate || selected.length >= limit) return;
    const key = JSON.stringify(candidate.packs);
    if (selectedKeys.has(key)) return;
    selected.push(candidate);
    selectedKeys.add(key);
  };
  const blockBest = new Map();
  for (const candidate of sorted) {
    if (!blockBest.has(candidate.blockNumber)) {
      blockBest.set(candidate.blockNumber, candidate);
    }
  }
  for (const candidate of blockBest.values()) add(candidate);
  for (const candidate of sorted) add(candidate);
  return selected;
}

export function selectLianyingTwoSegmentBlockCandidates(
  runtime,
  incumbentPacks,
  donors,
  {
    durationSeconds = 180,
    minimumPrimaryDifferences = 2,
    maximumCoreDamageLossRatio = 0.01,
    candidateLimit = 4,
  } = {},
) {
  const incumbent = stripLianyingDashPacks(incumbentPacks);
  const anchors = identifyLianyingThunderSegments(incumbent).anchors;
  const incumbentRows = anchors.map((row) => row + 1);
  const baseline = replayWhitepaperLianying(runtime, incumbent, {
    durationSeconds,
  }).state.totalDamage;
  const candidates = new Map();
  const diagnostics = {
    attemptedBlocks: 0,
    changedBlocks: 0,
    legalBlocks: 0,
    structurallyEligibleBlocks: 0,
  };
  for (const [donorIndex, donorEntry] of (donors ?? []).entries()) {
    const donorPacks = Array.isArray(donorEntry) ? donorEntry : donorEntry.packs;
    if (!Array.isArray(donorPacks)) continue;
    const donor = stripLianyingDashPacks(donorPacks);
    if (JSON.stringify(thunderRows(donor)) !== JSON.stringify(incumbentRows)) continue;
    for (let blockIndex = 0; blockIndex < anchors.length - 1; blockIndex += 1) {
      diagnostics.attemptedBlocks += 1;
      const startIndex = anchors[blockIndex];
      const endIndex = blockIndex + 2 < anchors.length
        ? anchors[blockIndex + 2]
        : incumbent.length;
      if (
        JSON.stringify(incumbent.slice(startIndex, endIndex)) ===
        JSON.stringify(donor.slice(startIndex, endIndex))
      ) continue;
      diagnostics.changedBlocks += 1;
      const primaryDifferenceRows = [];
      for (let index = startIndex; index < endIndex; index += 1) {
        if (actionId(incumbent[index]?.primary) !== actionId(donor[index]?.primary)) {
          primaryDifferenceRows.push(index + 1);
        }
      }
      if (primaryDifferenceRows.length < minimumPrimaryDifferences) continue;
      const packs = [
        ...clonePacks(incumbent.slice(0, startIndex)),
        ...clonePacks(donor.slice(startIndex, endIndex)),
        ...clonePacks(incumbent.slice(endIndex)),
      ];
      let coreDamage;
      try {
        coreDamage = replayWhitepaperLianying(runtime, packs, {
          durationSeconds,
        }).state.totalDamage;
      } catch {
        continue;
      }
      diagnostics.legalBlocks += 1;
      const coreDamageLoss = baseline - coreDamage;
      const coreDamageLossRatio = coreDamageLoss / baseline;
      if (coreDamageLossRatio > maximumCoreDamageLossRatio) continue;
      diagnostics.structurallyEligibleBlocks += 1;
      const candidate = {
        sourceId: donorEntry?.sourceId ?? `donor-${donorIndex + 1}`,
        sourceCandidateIndex: donorEntry?.sourceCandidateIndex ?? donorIndex,
        blockNumber: blockIndex + 1,
        startRow: startIndex + 1,
        endRow: endIndex,
        primaryDifferenceRows,
        coreDamage,
        coreDamageLoss,
        coreDamageLossRatio,
        packs,
      };
      const key = JSON.stringify(packs);
      const current = candidates.get(key);
      if (!current || candidate.coreDamage > current.coreDamage) {
        candidates.set(key, candidate);
      }
    }
  }
  const selected = selectCandidates(
    candidates.values(),
    Math.max(0, Math.floor(Number(candidateLimit))),
  );
  return {
    baselineDamage: baseline,
    thunderRows: incumbentRows,
    diagnostics,
    uniqueCandidates: candidates.size,
    selected,
  };
}

export function optimizeLianyingTwoSegmentBlockRecombination(
  runtime,
  incumbentPacks,
  donors,
  {
    durationSeconds = 180,
    candidateLimit = 4,
    neighborhood = {},
    coarseDashStates = 8,
    finalDashCandidateCount = 2,
    fullDashStates = 128,
    onProgress = null,
    ...selectionOptions
  } = {},
) {
  const incumbentReplay = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const selected = selectLianyingTwoSegmentBlockCandidates(
    runtime,
    incumbentPacks,
    donors,
    { durationSeconds, candidateLimit, ...selectionOptions },
  );
  const optimizedBlocks = [];
  const incumbentCoreKey = JSON.stringify(stripLianyingDashPacks(incumbentPacks));
  for (const [index, candidate] of selected.selected.entries()) {
    if (typeof onProgress === "function") {
      onProgress({
        stage: "block-neighborhood",
        candidate: index + 1,
        candidateCount: selected.selected.length,
        blockNumber: candidate.blockNumber,
        coreDamageLoss: candidate.coreDamageLoss,
      });
    }
    const optimized = optimizeLianyingNeighborhoodAxis(
      runtime,
      candidate.packs,
      {
        durationSeconds,
        maxPasses: 3,
        maxSwapDistance: 8,
        maxRotationLength: 8,
        localLookaheadRows: [16, 32, 64],
        shortlistPerHorizon: 64,
        shortlistPerKind: 12,
        shortlistPerResourceSignal: 4,
        fullEvaluationLimit: 256,
        requiredThunderRows: selected.thunderRows,
        mutableRowRanges: [{
          startRow: candidate.startRow,
          endRow: candidate.endRow,
        }],
        ...neighborhood,
      },
    );
    optimizedBlocks.push({
      ...candidate,
      packs: optimized.packs,
      optimizedCoreDamage: optimized.state.totalDamage,
      neighborhoodGain: optimized.damageGain,
      convergedToIncumbent:
        JSON.stringify(optimized.packs) === incumbentCoreKey,
      improvements: optimized.improvements,
    });
  }
  const coarse = [];
  for (const candidate of optimizedBlocks) {
    const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
      durationSeconds,
      maxStatesPerRow: coarseDashStates,
    });
    coarse.push({ ...candidate, packs: dash.packs, totalDamage: dash.state.totalDamage });
  }
  const finalists = coarse
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
  const accepted = Boolean(best && best.totalDamage > incumbentReplay.state.totalDamage);
  return {
    packs: accepted ? best.packs : clonePacks(incumbentPacks),
    state: accepted ? best.state : incumbentReplay.state,
    accepted,
    baselineDamage: incumbentReplay.state.totalDamage,
    damageGain: accepted ? best.totalDamage - incumbentReplay.state.totalDamage : 0,
    bestAlternative: best,
    selection: selected,
    optimizedBlocks,
    coarseCandidates: coarse.map((candidate) => ({
      sourceId: candidate.sourceId,
      blockNumber: candidate.blockNumber,
      startRow: candidate.startRow,
      endRow: candidate.endRow,
      primaryDifferenceRows: candidate.primaryDifferenceRows,
      coreDamageLoss: candidate.coreDamageLoss,
      neighborhoodGain: candidate.neighborhoodGain,
      optimizedCoreDamage: candidate.optimizedCoreDamage,
      convergedToIncumbent: candidate.convergedToIncumbent,
      totalDamage: candidate.totalDamage,
      improvements: candidate.improvements,
    })),
  };
}
