import { identifyLianyingThunderSegments } from
  "./lianying-segment-resynthesis.js";
import {
  lianyingDismountTransferMutations,
} from "./lianying-dismount-pair-neighborhood.js";
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

function mutationKey(mutation) {
  return JSON.stringify([...mutation.changes.entries()].map(([index, pack]) => [
    index,
    primaryId(pack),
  ]));
}

function primaryChangePack(pack, primary) {
  const next = clonePack(pack);
  next.primary = primary;
  return next;
}

function addMutation(mutations, seen, mutation) {
  const key = mutationKey(mutation);
  if (seen.has(key)) return;
  seen.add(key);
  mutations.push(mutation);
}

export function lianyingFocusedPrimaryMutations(
  packs,
  {
    segmentNumbers = [2, 3, 5],
    maxSwapDistance = 8,
    maxRotationLength = 8,
  } = {},
) {
  const mutablePrimaries = ["dragonFang", "destroy", "dragonRoar", "cloudStrike"];
  const mutableSet = new Set(mutablePrimaries);
  const selectedSegments = new Set(segmentNumbers.map((value) => Number(value) - 1));
  const ranges = identifyLianyingThunderSegments(packs).ranges;
  const mutations = [];
  const seen = new Set();
  for (let segmentIndex = 0; segmentIndex < ranges.length; segmentIndex += 1) {
    if (!selectedSegments.has(segmentIndex)) continue;
    const range = ranges[segmentIndex];
    const indices = [];
    for (let index = range.startIndex; index < range.endIndex; index += 1) {
      if (mutableSet.has(primaryId(packs[index]))) indices.push(index);
    }
    for (const index of indices) {
      for (const primary of mutablePrimaries) {
        if (primary === primaryId(packs[index])) continue;
        addMutation(mutations, seen, {
          kind: "primaryReplace",
          sourceSegment: segmentIndex,
          changes: new Map([[index, primaryChangePack(packs[index], primary)]]),
          description: `第${segmentIndex + 1}雷${index + 1}行` +
            `${primaryId(packs[index])}→${primary}`,
        });
      }
    }
    for (let leftPosition = 0; leftPosition < indices.length; leftPosition += 1) {
      const leftIndex = indices[leftPosition];
      for (
        let rightPosition = leftPosition + 1;
        rightPosition < indices.length;
        rightPosition += 1
      ) {
        const rightIndex = indices[rightPosition];
        if (rightIndex - leftIndex > maxSwapDistance) break;
        if (primaryId(packs[leftIndex]) === primaryId(packs[rightIndex])) continue;
        addMutation(mutations, seen, {
          kind: "primarySwap",
          sourceSegment: segmentIndex,
          changes: new Map([
            [leftIndex, primaryChangePack(packs[leftIndex], primaryId(packs[rightIndex]))],
            [rightIndex, primaryChangePack(packs[rightIndex], primaryId(packs[leftIndex]))],
          ]),
          description: `第${segmentIndex + 1}雷${leftIndex + 1}↔${rightIndex + 1}行主技能`,
        });
      }
    }
    const maximumLength = Math.max(3, Math.floor(Number(maxRotationLength)));
    for (let start = range.startIndex; start < range.endIndex; start += 1) {
      for (let length = 3; length <= maximumLength; length += 1) {
        const end = start + length;
        if (end > range.endIndex) break;
        const window = packs.slice(start, end);
        if (window.some((pack) => !mutableSet.has(primaryId(pack)))) continue;
        const primaries = window.map(primaryId);
        if (new Set(primaries).size < 2) continue;
        for (const direction of ["left", "right"]) {
          const rotated = direction === "left"
            ? [...primaries.slice(1), primaries[0]]
            : [primaries.at(-1), ...primaries.slice(0, -1)];
          const changes = new Map();
          for (let offset = 0; offset < length; offset += 1) {
            if (rotated[offset] === primaries[offset]) continue;
            changes.set(
              start + offset,
              primaryChangePack(packs[start + offset], rotated[offset]),
            );
          }
          if (changes.size === 0) continue;
          addMutation(mutations, seen, {
            kind: "primaryRotate",
            sourceSegment: segmentIndex,
            changes,
            description: `第${segmentIndex + 1}雷${start + 1}–${end}行` +
              `${direction === "left" ? "左" : "右"}旋主技能`,
          });
        }
      }
    }
  }
  return mutations;
}

function replayCandidate(runtime, packs, durationSeconds) {
  try {
    return replayWhitepaperLianying(runtime, packs, { durationSeconds });
  } catch {
    return null;
  }
}

function applyPrimaryMutation(packs, mutation) {
  const next = packs.map(clonePack);
  for (const [index, pack] of mutation.changes) next[index] = clonePack(pack);
  return next;
}

function applyJointMutation(packs, dismountMutation, primaryMutation) {
  const next = packs.map(clonePack);
  for (const [index, pack] of dismountMutation.changes) {
    next[index] = clonePack(pack);
  }
  for (const [index, pack] of primaryMutation.changes) {
    next[index].primary = cloneAction(pack.primary);
  }
  return next;
}

function selectRepresentatives(candidates, perSegment, perKind = false) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = perKind
      ? `${candidate.mutation.sourceSegment}:${candidate.mutation.kind}`
      : String(candidate.mutation.sourceSegment);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  const selected = [];
  for (const entries of groups.values()) {
    entries.sort((left, right) => right.damageGain - left.damageGain);
    selected.push(...entries.slice(0, perSegment));
  }
  return selected;
}

export function searchLianyingDismountPrimaryJointNeighborhood(
  runtime,
  packs,
  {
    durationSeconds = 180,
    segmentNumbers = [2, 3, 5],
    maxDismountDistance = 6,
    maxSwapDistance = 8,
    maxRotationLength = 8,
    mainRepresentativesPerKind = 8,
    dismountRepresentativesPerSegment = 8,
    maxJointCandidates = 5000,
    finalistCount = 8,
    damageTolerance = 1e-6,
  } = {},
) {
  const baseline = replayWhitepaperLianying(runtime, packs, { durationSeconds });
  const baselineDamage = baseline.state.totalDamage;
  const primaryMutations = lianyingFocusedPrimaryMutations(packs, {
    segmentNumbers,
    maxSwapDistance,
    maxRotationLength,
  });
  const primaryCandidates = primaryMutations.map((mutation) => {
    const candidatePacks = applyPrimaryMutation(packs, mutation);
    const replay = replayCandidate(runtime, candidatePacks, durationSeconds);
    return {
      mutation,
      replay,
      damageGain: replay ? replay.state.totalDamage - baselineDamage : null,
    };
  });
  const eligiblePrimary = primaryCandidates.filter((candidate) =>
    candidate.replay && candidate.damageGain <= damageTolerance);
  const primaryRepresentatives = selectRepresentatives(
    eligiblePrimary,
    Math.max(1, Math.floor(Number(mainRepresentativesPerKind))),
    true,
  );

  const selectedSegments = new Set(segmentNumbers.map((value) => Number(value) - 1));
  const dismountMutations = lianyingDismountTransferMutations(packs, {
    maxDistance: maxDismountDistance,
  }).filter((mutation) => selectedSegments.has(mutation.sourceSegment));
  const dismountCandidates = dismountMutations.map((mutation) => {
    const candidatePacks = packs.map(clonePack);
    for (const [index, pack] of mutation.changes) {
      candidatePacks[index] = clonePack(pack);
    }
    const replay = replayCandidate(runtime, candidatePacks, durationSeconds);
    return {
      mutation,
      replay,
      damageGain: replay ? replay.state.totalDamage - baselineDamage : null,
    };
  });
  const eligibleDismount = dismountCandidates.filter((candidate) =>
    candidate.replay && candidate.damageGain <= damageTolerance);
  const dismountRepresentatives = selectRepresentatives(
    eligibleDismount,
    Math.max(1, Math.floor(Number(dismountRepresentativesPerSegment))),
  );

  const specs = [];
  for (const dismount of dismountRepresentatives) {
    for (const primary of primaryRepresentatives) {
      specs.push({
        dismount,
        primary,
        estimatedDamageGain: dismount.damageGain + primary.damageGain,
      });
    }
  }
  specs.sort((left, right) => right.estimatedDamageGain - left.estimatedDamageGain);
  const selectedSpecs = specs.slice(
    0,
    Math.max(0, Math.floor(Number(maxJointCandidates))),
  );
  const jointCandidates = [];
  const seen = new Set();
  for (const spec of selectedSpecs) {
    const candidatePacks = applyJointMutation(
      packs,
      spec.dismount.mutation,
      spec.primary.mutation,
    );
    const key = JSON.stringify(candidatePacks);
    if (seen.has(key)) continue;
    seen.add(key);
    const replay = replayCandidate(runtime, candidatePacks, durationSeconds);
    if (!replay) continue;
    jointCandidates.push({
      packs: candidatePacks,
      replay,
      dismountMutation: spec.dismount.mutation,
      primaryMutation: spec.primary.mutation,
      description:
        `${spec.dismount.mutation.description}；${spec.primary.mutation.description}`,
      damageGain: replay.state.totalDamage - baselineDamage,
      synergyDamage:
        replay.state.totalDamage - baselineDamage -
        spec.dismount.damageGain - spec.primary.damageGain,
    });
  }
  jointCandidates.sort((left, right) => right.damageGain - left.damageGain);
  const best = jointCandidates[0] ?? null;
  const accepted = Boolean(best && best.damageGain > damageTolerance);
  return {
    packs: accepted ? best.packs : packs.map(clonePack),
    state: accepted ? best.replay.state : baseline.state,
    accepted,
    baselineDamage,
    damageGain: accepted ? best.damageGain : 0,
    bestJointDamage: best?.replay.state.totalDamage ?? null,
    generatedPrimaryCandidates: primaryMutations.length,
    legalPrimaryCandidates: primaryCandidates.filter((entry) => entry.replay).length,
    eligiblePrimaryCandidates: eligiblePrimary.length,
    primaryRepresentativeCandidates: primaryRepresentatives.length,
    generatedDismountCandidates: dismountMutations.length,
    legalDismountCandidates: dismountCandidates.filter((entry) => entry.replay).length,
    eligibleDismountCandidates: eligibleDismount.length,
    dismountRepresentativeCandidates: dismountRepresentatives.length,
    generatedJointCandidates: specs.length,
    evaluatedJointCandidates: selectedSpecs.length,
    legalJointCandidates: jointCandidates.length,
    finalists: jointCandidates
      .slice(0, Math.max(1, Math.floor(Number(finalistCount))))
      .map((candidate) => ({
        description: candidate.description,
        rotationDamage: candidate.replay.state.totalDamage,
        damageGain: candidate.damageGain,
        synergyDamage: candidate.synergyDamage,
        dismount: candidate.dismountMutation.description,
        primary: candidate.primaryMutation.description,
        actionPacks: candidate.packs,
      })),
  };
}
