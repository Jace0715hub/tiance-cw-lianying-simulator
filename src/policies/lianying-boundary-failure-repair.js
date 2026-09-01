import { millisecondsToTicks } from "../engine/clock.js";
import { executeActionPack } from "../engine/simulator.js";
import { createInitialState } from "../engine/state.js";
import {
  cloneLianyingPack,
  lianyingCoreStructureKey,
  lianyingDecisionTick,
  lianyingSuffixFailureRepairAxes,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";

function clonePacks(packs) {
  return packs.map(cloneLianyingPack);
}

function inspectLianyingAxis(runtime, packs, durationSeconds) {
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  let state = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  for (let index = 0; index < packs.length; index += 1) {
    if (lianyingDecisionTick(state) >= endTick) break;
    try {
      state = executeActionPack(
        state,
        packs[index],
        runtime.config,
        runtime.oracle,
        { endTick },
      );
    } catch (error) {
      return {
        legal: false,
        state,
        failureIndex: index,
        failureRow: index + 1,
        failure: error instanceof Error ? error.message : String(error),
        failureState: {
          rage: state.rage,
          dragonRideStacks: state.dragonRideStacks,
          mounted: state.mounted,
          tick: lianyingDecisionTick(state),
        },
      };
    }
  }
  return {
    legal: true,
    state,
    failureIndex: null,
    failureRow: null,
    failure: null,
    failureState: null,
  };
}

function repairKey(packs) {
  return JSON.stringify(packs);
}

function coreBehaviorKey(state) {
  return JSON.stringify((state.timeline ?? [])
    .filter((event) =>
      (event.type === "cast" || event.type === "offGcd") &&
      event.action !== "dash" &&
      !(event.type === "offGcd" && event.action === "dismount" &&
        event.mounted === false))
    .map((event) => [event.type, event.action, event.tick]));
}

/**
 * 将多区段搜索留下的高伤边界前缀接回正式轴，并只针对首次失败生成一次
 * 定向修改。所有候选最终都必须完整复演，再由突覆盖搜索公平补回突。
 */
export function searchLianyingBoundaryFailureRepairs(
  runtime,
  incumbentPacks,
  boundaryPaths,
  {
    durationSeconds = 180,
    pathLimit = 12,
    repairLimitPerPath = 16,
    repairLookBehindRows = 4,
    repairLookAheadRows = 8,
    dashFinalistCount = 6,
    dashStates = 256,
    excludeIncumbentCore = true,
  } = {},
) {
  const incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const corePacks = stripLianyingDashPacks(incumbentPacks);
  const incumbentCoreStructureKey = lianyingCoreStructureKey(corePacks);
  const incumbentBehaviorKey = coreBehaviorKey(incumbent.state);
  const selectedPaths = [...(boundaryPaths ?? [])]
    .sort((left, right) =>
      Number(right.totalDamage) - Number(left.totalDamage))
    .slice(0, Math.max(0, Math.floor(Number(pathLimit))));
  const attempts = [];
  const legalCoreCandidates = [];
  const seenRepairs = new Set();
  const seenLegalCoreStructures = new Set();
  const seenLegalBehaviors = new Set();

  for (const path of selectedPaths) {
    const depth = Math.floor(Number(path.depth));
    if (
      !Number.isInteger(depth) ||
      depth < 0 ||
      depth > corePacks.length ||
      path.prefixPacks?.length !== depth
    ) continue;
    const splicedPacks = [
      ...clonePacks(path.prefixPacks),
      ...clonePacks(corePacks.slice(depth)),
    ];
    const initialAttempt = inspectLianyingAxis(
      runtime,
      splicedPacks,
      durationSeconds,
    );
    const attemptReport = {
      segmentNumber: path.segmentNumber,
      segmentId: path.segmentId,
      boundaryRank: path.rank,
      depth,
      boundaryDamage: path.totalDamage,
      boundaryDamageGain: path.currentDamageGain,
      initialLegal: initialAttempt.legal,
      initialFailureRow: initialAttempt.failureRow,
      initialFailure: initialAttempt.failure,
      generatedRepairs: 0,
      legalRepairs: 0,
      repairKinds: {},
    };
    const repairAxes = initialAttempt.legal
      ? [{ kind: "unrepaired", description: "参考后缀直接合法", packs: splicedPacks }]
      : lianyingSuffixFailureRepairAxes(splicedPacks, initialAttempt, {
          lookBehindRows: repairLookBehindRows,
          lookAheadRows: repairLookAheadRows,
          limit: repairLimitPerPath,
        });
    attemptReport.generatedRepairs = repairAxes.length;
    for (const repair of repairAxes) {
      const key = repairKey(repair.packs);
      if (seenRepairs.has(key)) continue;
      seenRepairs.add(key);
      attemptReport.repairKinds[repair.kind] =
        Number(attemptReport.repairKinds[repair.kind] ?? 0) + 1;
      const repairedAttempt = inspectLianyingAxis(
        runtime,
        repair.packs,
        durationSeconds,
      );
      if (!repairedAttempt.legal) continue;
      const coreStructureKey = lianyingCoreStructureKey(repair.packs);
      const behaviorKey = coreBehaviorKey(repairedAttempt.state);
      if (
        (excludeIncumbentCore &&
          (coreStructureKey === incumbentCoreStructureKey ||
            behaviorKey === incumbentBehaviorKey)) ||
        seenLegalCoreStructures.has(coreStructureKey) ||
        seenLegalBehaviors.has(behaviorKey)
      ) continue;
      seenLegalCoreStructures.add(coreStructureKey);
      seenLegalBehaviors.add(behaviorKey);
      attemptReport.legalRepairs += 1;
      const replay = replayWhitepaperLianying(runtime, repair.packs, {
        durationSeconds,
      });
      legalCoreCandidates.push({
        segmentNumber: path.segmentNumber,
        segmentId: path.segmentId,
        boundaryRank: path.rank,
        depth,
        kind: repair.kind,
        description: repair.description,
        failureRow: initialAttempt.failureRow,
        failure: initialAttempt.failure,
        coreDamage: replay.state.totalDamage,
        packs: repair.packs,
      });
    }
    attempts.push(attemptReport);
  }

  const dashFinalists = legalCoreCandidates
    .sort((left, right) => right.coreDamage - left.coreDamage)
    .slice(0, Math.max(0, Math.floor(Number(dashFinalistCount))))
    .map((candidate) => {
      const overlay = optimizeLianyingDashOverlay(runtime, candidate.packs, {
        durationSeconds,
        maxStatesPerRow: dashStates,
      });
      return {
        ...candidate,
        packs: overlay.packs,
        state: overlay.state,
        totalDamage: overlay.state.totalDamage,
        dashCount: overlay.dashCount,
      };
    })
    .sort((left, right) => right.totalDamage - left.totalDamage);
  const best = dashFinalists[0] ?? null;
  const accepted = Boolean(
    best && best.totalDamage > incumbent.state.totalDamage,
  );
  return {
    packs: accepted ? best.packs : clonePacks(incumbentPacks),
    state: accepted ? best.state : incumbent.state,
    baselineDamage: incumbent.state.totalDamage,
    bestDamage: best?.totalDamage ?? null,
    damageGain: accepted ? best.totalDamage - incumbent.state.totalDamage : 0,
    accepted,
    selectedPaths: selectedPaths.length,
    attempts,
    generatedRepairs: attempts.reduce(
      (sum, attempt) => sum + attempt.generatedRepairs,
      0,
    ),
    legalRepairs: legalCoreCandidates.length,
    dashFinalists,
    options: {
      durationSeconds,
      pathLimit,
      repairLimitPerPath,
      repairLookBehindRows,
      repairLookAheadRows,
      dashFinalistCount,
      dashStates,
      excludeIncumbentCore,
    },
  };
}
