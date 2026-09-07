import { identifyLianyingThunderSegments } from
  "./lianying-segment-resynthesis.js";
import { replayWhitepaperLianying } from "./whitepaper-lianying.js";

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function cloneAction(action) {
  return action && typeof action === "object" ? { ...action } : action;
}

function clonePack(pack) {
  return {
    ...pack,
    prefix: (pack?.prefix ?? []).map(cloneAction),
    primary: cloneAction(pack?.primary),
    tail: (pack?.tail ?? []).map(cloneAction),
  };
}

function primaryId(pack) {
  return actionId(pack?.primary);
}

function hasAction(pack, id) {
  return [
    ...(pack?.prefix ?? []),
    ...(pack?.tail ?? []),
  ].some((action) => actionId(action) === id);
}

function freeDismountReason(pack) {
  for (const location of ["prefix", "tail"]) {
    const action = (pack?.[location] ?? []).find((entry) =>
      actionId(entry) === "dismount" &&
      (typeof entry !== "object" || entry.reason !== "refresh-ride"));
    if (action) {
      return typeof action === "object"
        ? action.reason ?? "free-search"
        : "free-search";
    }
  }
  return null;
}

function stripFreeDismountBundle(pack) {
  const next = clonePack(pack);
  const reason = freeDismountReason(pack);
  if (reason === null) return null;
  const hasDash = hasAction(pack, "dash");
  for (const location of ["prefix", "tail"]) {
    next[location] = next[location].filter((action) => {
      const id = actionId(action);
      if (id === "dash" && hasDash) return false;
      if (id !== "dismount") return true;
      return typeof action === "object" && action.reason === "refresh-ride";
    });
  }
  return { pack: next, reason, hasDash };
}

function dismountAction(reason, location) {
  return location === "tail"
    ? { id: "dismount", reason, leadFrames: 1 }
    : { id: "dismount", reason };
}

function dashAction(location) {
  return location === "tail" ? { id: "dash", leadFrames: 1 } : "dash";
}

function addBundle(pack, { reason, hasDash }, placement) {
  const next = clonePack(pack);
  if (placement === "prefix") {
    next.prefix.push(dismountAction(reason, "prefix"));
    if (hasDash) next.prefix.push(dashAction("prefix"));
  } else if (placement === "split") {
    next.prefix.push(dismountAction(reason, "prefix"));
    if (hasDash) next.tail.push(dashAction("tail"));
  } else if (placement === "tail") {
    next.tail.push(dismountAction(reason, "tail"));
    if (hasDash) next.tail.push(dashAction("tail"));
  } else {
    throw new Error(`未知下马突包时点：${placement}`);
  }
  return next;
}

function mutationKey(mutation) {
  return JSON.stringify([...mutation.changes.entries()].map(([index, pack]) => [
    index,
    pack,
  ]));
}

function segmentIndexForRow(ranges, rowIndex) {
  return ranges.findIndex((range) =>
    rowIndex >= range.startIndex && rowIndex < range.endIndex);
}

export function lianyingDismountTransferMutations(
  packs,
  {
    maxDistance = 4,
    sourceRows = null,
    targetRows = null,
  } = {},
) {
  const distance = Math.max(1, Math.floor(Number(maxDistance)));
  const allowedSources = Array.isArray(sourceRows)
    ? new Set(sourceRows.map(Number))
    : null;
  const allowedTargets = Array.isArray(targetRows)
    ? new Set(targetRows.map(Number))
    : null;
  const ranges = identifyLianyingThunderSegments(packs).ranges;
  const mutations = [];
  const seen = new Set();

  for (let sourceIndex = 0; sourceIndex < packs.length; sourceIndex += 1) {
    if (allowedSources && !allowedSources.has(sourceIndex + 1)) continue;
    const stripped = stripFreeDismountBundle(packs[sourceIndex]);
    if (!stripped) continue;
    const sourceSegment = segmentIndexForRow(ranges, sourceIndex);
    if (sourceSegment < 0) continue;
    const left = Math.max(
      ranges[sourceSegment].startIndex,
      sourceIndex - distance,
    );
    const right = Math.min(
      ranges[sourceSegment].endIndex - 1,
      sourceIndex + distance,
    );
    for (let targetIndex = left; targetIndex <= right; targetIndex += 1) {
      if (allowedTargets && !allowedTargets.has(targetIndex + 1)) continue;
      if (primaryId(packs[targetIndex]) !== "dragonFang") continue;
      const targetBase = targetIndex === sourceIndex
        ? stripped.pack
        : packs[targetIndex];
      if (
        targetIndex !== sourceIndex &&
        (hasAction(targetBase, "dismount") || hasAction(targetBase, "dash"))
      ) continue;
      const placements = stripped.hasDash
        ? ["prefix", "split", "tail"]
        : ["prefix", "tail"];
      for (const placement of placements) {
        const movedTarget = addBundle(targetBase, stripped, placement);
        if (
          targetIndex === sourceIndex &&
          JSON.stringify(movedTarget) === JSON.stringify(packs[sourceIndex])
        ) continue;
        const changes = new Map();
        changes.set(sourceIndex, stripped.pack);
        changes.set(targetIndex, movedTarget);
        const mutation = {
          kind: "dismountTransfer",
          sourceIndex,
          targetIndex,
          sourceSegment,
          placement,
          hasDash: stripped.hasDash,
          changes,
          description:
            `第${sourceSegment + 1}雷下马${stripped.hasDash ? "+突" : ""}` +
            ` ${sourceIndex + 1}→${targetIndex + 1}行(${placement})`,
        };
        const key = mutationKey(mutation);
        if (seen.has(key)) continue;
        seen.add(key);
        mutations.push(mutation);
      }
    }
  }
  return mutations;
}

export function applyLianyingDismountTransferMutations(packs, mutations) {
  const next = packs.map(clonePack);
  const occupied = new Set();
  for (const mutation of mutations) {
    for (const [index, pack] of mutation.changes) {
      if (occupied.has(index)) {
        throw new Error("下马双窗口变化不能修改同一动作行");
      }
      occupied.add(index);
      next[index] = clonePack(pack);
    }
  }
  return next;
}

function replayCandidate(runtime, packs, durationSeconds) {
  try {
    return replayWhitepaperLianying(runtime, packs, { durationSeconds });
  } catch {
    return null;
  }
}

function mutationRows(mutation) {
  return new Set(mutation.changes.keys());
}

function mutationsConflict(left, right) {
  const leftRows = mutationRows(left);
  return [...right.changes.keys()].some((row) => leftRows.has(row));
}

function evaluateSingleMutations(runtime, packs, mutations, {
  durationSeconds,
  baselineDamage,
}) {
  return mutations.map((mutation) => {
    const candidatePacks = applyLianyingDismountTransferMutations(
      packs,
      [mutation],
    );
    const replay = replayCandidate(runtime, candidatePacks, durationSeconds);
    return {
      mutation,
      packs: candidatePacks,
      replay,
      damageGain: replay ? replay.state.totalDamage - baselineDamage : null,
    };
  });
}

function candidateSummary(candidate, baselineDamage) {
  return {
    description: candidate.description,
    sourceRows: candidate.mutations.map((mutation) => mutation.sourceIndex + 1),
    targetRows: candidate.mutations.map((mutation) => mutation.targetIndex + 1),
    sourceSegments: candidate.mutations.map(
      (mutation) => mutation.sourceSegment + 1,
    ),
    placements: candidate.mutations.map((mutation) => mutation.placement),
    rotationDamage: candidate.replay.state.totalDamage,
    damageGain: candidate.replay.state.totalDamage - baselineDamage,
    synergyDamage: candidate.synergyDamage ?? null,
    actionPacks: candidate.packs,
  };
}

export function searchLianyingDismountPairNeighborhood(
  runtime,
  packs,
  {
    durationSeconds = 180,
    maxDistance = 4,
    maxPairCandidates = 5000,
    finalistCount = 8,
    sourceRows = null,
    targetRows = null,
    damageTolerance = 1e-6,
  } = {},
) {
  const baseline = replayWhitepaperLianying(runtime, packs, {
    durationSeconds,
  });
  const baselineDamage = baseline.state.totalDamage;
  const mutations = lianyingDismountTransferMutations(packs, {
    maxDistance,
    sourceRows,
    targetRows,
  });
  const singles = evaluateSingleMutations(runtime, packs, mutations, {
    durationSeconds,
    baselineDamage,
  });
  const eligibleSingles = singles.filter((candidate) =>
    candidate.replay && candidate.damageGain <= damageTolerance);
  const pairSpecs = [];
  for (let leftIndex = 0; leftIndex < eligibleSingles.length; leftIndex += 1) {
    const left = eligibleSingles[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < eligibleSingles.length;
      rightIndex += 1
    ) {
      const right = eligibleSingles[rightIndex];
      if (left.mutation.sourceSegment === right.mutation.sourceSegment) continue;
      if (mutationsConflict(left.mutation, right.mutation)) continue;
      pairSpecs.push({
        left,
        right,
        estimatedDamageGain: left.damageGain + right.damageGain,
      });
    }
  }
  pairSpecs.sort((left, right) =>
    right.estimatedDamageGain - left.estimatedDamageGain);
  const selectedPairSpecs = pairSpecs.slice(
    0,
    Math.max(0, Math.floor(Number(maxPairCandidates))),
  );
  const candidates = [];
  const seenPacks = new Set();
  for (const spec of selectedPairSpecs) {
    const mutations = [spec.left.mutation, spec.right.mutation];
    const candidatePacks = applyLianyingDismountTransferMutations(
      packs,
      mutations,
    );
    const key = JSON.stringify(candidatePacks);
    if (seenPacks.has(key)) continue;
    seenPacks.add(key);
    const replay = replayCandidate(runtime, candidatePacks, durationSeconds);
    if (!replay) continue;
    candidates.push({
      mutations,
      packs: candidatePacks,
      replay,
      description: mutations.map((mutation) => mutation.description).join("；"),
      synergyDamage:
        replay.state.totalDamage - baselineDamage -
        spec.left.damageGain - spec.right.damageGain,
    });
  }
  candidates.sort((left, right) =>
    right.replay.state.totalDamage - left.replay.state.totalDamage);
  const bestPair = candidates[0] ?? null;
  const accepted = Boolean(
    bestPair && bestPair.replay.state.totalDamage > baselineDamage + damageTolerance,
  );
  const topSingles = singles
    .filter((candidate) => candidate.replay)
    .sort((left, right) => right.damageGain - left.damageGain)
    .slice(0, Math.max(1, Math.floor(Number(finalistCount))))
    .map((candidate) => ({
      description: candidate.mutation.description,
      sourceRow: candidate.mutation.sourceIndex + 1,
      targetRow: candidate.mutation.targetIndex + 1,
      sourceSegment: candidate.mutation.sourceSegment + 1,
      placement: candidate.mutation.placement,
      rotationDamage: candidate.replay.state.totalDamage,
      damageGain: candidate.damageGain,
    }));
  const finalists = candidates
    .slice(0, Math.max(1, Math.floor(Number(finalistCount))))
    .map((candidate) => candidateSummary(candidate, baselineDamage));
  return {
    packs: accepted ? bestPair.packs : packs.map(clonePack),
    state: accepted ? bestPair.replay.state : baseline.state,
    accepted,
    baselineDamage,
    bestPairDamage: bestPair?.replay.state.totalDamage ?? null,
    damageGain: accepted
      ? bestPair.replay.state.totalDamage - baselineDamage
      : 0,
    generatedSingleCandidates: mutations.length,
    legalSingleCandidates: singles.filter((candidate) => candidate.replay).length,
    eligibleSingleCandidates: eligibleSingles.length,
    generatedPairCandidates: pairSpecs.length,
    evaluatedPairCandidates: selectedPairSpecs.length,
    legalPairCandidates: candidates.length,
    topSingles,
    finalists,
    bestExperimentActionPacks: bestPair?.packs ?? null,
  };
}

function representativeSinglesBySegment(singles, limit) {
  const bySegment = new Map();
  for (const single of singles) {
    const segment = single.mutation.sourceSegment;
    if (!bySegment.has(segment)) bySegment.set(segment, []);
    bySegment.get(segment).push(single);
  }
  const representatives = [];
  for (const entries of bySegment.values()) {
    entries.sort((left, right) => {
      if (right.damageGain !== left.damageGain) {
        return right.damageGain - left.damageGain;
      }
      const leftDistance = Math.abs(
        left.mutation.targetIndex - left.mutation.sourceIndex,
      );
      const rightDistance = Math.abs(
        right.mutation.targetIndex - right.mutation.sourceIndex,
      );
      if (rightDistance !== leftDistance) return rightDistance - leftDistance;
      return mutationKey(left.mutation).localeCompare(mutationKey(right.mutation));
    });
    const placementCounts = new Map();
    const selected = [];
    for (const entry of entries) {
      const placement = entry.mutation.placement;
      const count = placementCounts.get(placement) ?? 0;
      if (count >= Math.ceil(limit / 2)) continue;
      selected.push(entry);
      placementCounts.set(placement, count + 1);
      if (selected.length >= limit) break;
    }
    if (selected.length < limit) {
      for (const entry of entries) {
        if (selected.includes(entry)) continue;
        selected.push(entry);
        if (selected.length >= limit) break;
      }
    }
    representatives.push(...selected);
  }
  return representatives;
}

export function searchLianyingDismountTripleNeighborhood(
  runtime,
  packs,
  {
    durationSeconds = 180,
    maxDistance = 6,
    maxRepresentativesPerSegment = 8,
    maxTripleCandidates = 5000,
    finalistCount = 8,
    sourceRows = null,
    targetRows = null,
    damageTolerance = 1e-6,
  } = {},
) {
  const baseline = replayWhitepaperLianying(runtime, packs, {
    durationSeconds,
  });
  const baselineDamage = baseline.state.totalDamage;
  const mutations = lianyingDismountTransferMutations(packs, {
    maxDistance,
    sourceRows,
    targetRows,
  });
  const singles = evaluateSingleMutations(runtime, packs, mutations, {
    durationSeconds,
    baselineDamage,
  });
  const eligibleSingles = singles.filter((candidate) =>
    candidate.replay && candidate.damageGain <= damageTolerance);
  const representatives = representativeSinglesBySegment(
    eligibleSingles,
    Math.max(1, Math.floor(Number(maxRepresentativesPerSegment))),
  );

  const pairScores = new Map();
  let evaluatedRepresentativePairs = 0;
  let legalRepresentativePairs = 0;
  for (let leftIndex = 0; leftIndex < representatives.length; leftIndex += 1) {
    const left = representatives[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < representatives.length;
      rightIndex += 1
    ) {
      const right = representatives[rightIndex];
      if (left.mutation.sourceSegment === right.mutation.sourceSegment) continue;
      if (mutationsConflict(left.mutation, right.mutation)) continue;
      evaluatedRepresentativePairs += 1;
      const candidatePacks = applyLianyingDismountTransferMutations(
        packs,
        [left.mutation, right.mutation],
      );
      const replay = replayCandidate(runtime, candidatePacks, durationSeconds);
      if (!replay) continue;
      legalRepresentativePairs += 1;
      pairScores.set(`${leftIndex}:${rightIndex}`, {
        damageGain: replay.state.totalDamage - baselineDamage,
        synergyDamage:
          replay.state.totalDamage - baselineDamage -
          left.damageGain - right.damageGain,
      });
    }
  }

  const tripleSpecs = [];
  for (let firstIndex = 0; firstIndex < representatives.length; firstIndex += 1) {
    const first = representatives[firstIndex];
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < representatives.length;
      secondIndex += 1
    ) {
      const second = representatives[secondIndex];
      if (first.mutation.sourceSegment === second.mutation.sourceSegment) continue;
      if (mutationsConflict(first.mutation, second.mutation)) continue;
      const firstSecond = pairScores.get(`${firstIndex}:${secondIndex}`);
      if (!firstSecond) continue;
      for (
        let thirdIndex = secondIndex + 1;
        thirdIndex < representatives.length;
        thirdIndex += 1
      ) {
        const third = representatives[thirdIndex];
        if (
          third.mutation.sourceSegment === first.mutation.sourceSegment ||
          third.mutation.sourceSegment === second.mutation.sourceSegment
        ) continue;
        if (
          mutationsConflict(first.mutation, third.mutation) ||
          mutationsConflict(second.mutation, third.mutation)
        ) continue;
        const firstThird = pairScores.get(`${firstIndex}:${thirdIndex}`);
        const secondThird = pairScores.get(`${secondIndex}:${thirdIndex}`);
        if (!firstThird || !secondThird) continue;
        tripleSpecs.push({
          entries: [first, second, third],
          estimatedDamageGain:
            first.damageGain + second.damageGain + third.damageGain +
            firstSecond.synergyDamage + firstThird.synergyDamage +
            secondThird.synergyDamage,
        });
      }
    }
  }
  tripleSpecs.sort((left, right) =>
    right.estimatedDamageGain - left.estimatedDamageGain);
  const selectedSpecs = tripleSpecs.slice(
    0,
    Math.max(0, Math.floor(Number(maxTripleCandidates))),
  );
  const candidates = [];
  const seenPacks = new Set();
  for (const spec of selectedSpecs) {
    const selectedMutations = spec.entries.map((entry) => entry.mutation);
    const candidatePacks = applyLianyingDismountTransferMutations(
      packs,
      selectedMutations,
    );
    const key = JSON.stringify(candidatePacks);
    if (seenPacks.has(key)) continue;
    seenPacks.add(key);
    const replay = replayCandidate(runtime, candidatePacks, durationSeconds);
    if (!replay) continue;
    candidates.push({
      mutations: selectedMutations,
      packs: candidatePacks,
      replay,
      description: selectedMutations
        .map((mutation) => mutation.description)
        .join("；"),
      estimatedDamageGain: spec.estimatedDamageGain,
      synergyDamage:
        replay.state.totalDamage - baselineDamage -
        spec.entries.reduce((sum, entry) => sum + entry.damageGain, 0),
    });
  }
  candidates.sort((left, right) =>
    right.replay.state.totalDamage - left.replay.state.totalDamage);
  const bestTriple = candidates[0] ?? null;
  const accepted = Boolean(
    bestTriple &&
    bestTriple.replay.state.totalDamage > baselineDamage + damageTolerance,
  );
  return {
    packs: accepted ? bestTriple.packs : packs.map(clonePack),
    state: accepted ? bestTriple.replay.state : baseline.state,
    accepted,
    baselineDamage,
    bestTripleDamage: bestTriple?.replay.state.totalDamage ?? null,
    damageGain: accepted
      ? bestTriple.replay.state.totalDamage - baselineDamage
      : 0,
    generatedSingleCandidates: mutations.length,
    legalSingleCandidates: singles.filter((candidate) => candidate.replay).length,
    eligibleSingleCandidates: eligibleSingles.length,
    representativeSingleCandidates: representatives.length,
    evaluatedRepresentativePairs,
    legalRepresentativePairs,
    generatedTripleCandidates: tripleSpecs.length,
    evaluatedTripleCandidates: selectedSpecs.length,
    legalTripleCandidates: candidates.length,
    finalists: candidates
      .slice(0, Math.max(1, Math.floor(Number(finalistCount))))
      .map((candidate) => ({
        ...candidateSummary(candidate, baselineDamage),
        estimatedDamageGain: candidate.estimatedDamageGain,
      })),
    bestExperimentActionPacks: bestTriple?.packs ?? null,
  };
}
