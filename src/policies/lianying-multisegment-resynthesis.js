import { executeActionPack } from "../engine/simulator.js";
import { millisecondsToTicks, ticksToMilliseconds } from "../engine/clock.js";
import {
  createInitialState,
  isBuffActiveAtTick,
  isMountedAtTick,
} from "../engine/state.js";
import {
  cloneLianyingPack,
  identifyLianyingThunderSegments,
  lianyingDecisionTick,
  lianyingPackHasAction,
  lianyingResynthesisStateKey,
  lianyingStateValueFeatures,
  selectLianyingResynthesisBeam,
  selectLianyingValueShadowCandidates,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import {
  legalMechanicalLianyingPacks,
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";

function remainingTicks(readyTick, tick) {
  return Math.max(0, Number(readyTick ?? 0) - tick);
}

function clonePacks(packs) {
  return packs.map(cloneLianyingPack);
}

function buildWarmStates(runtime, packs, endTick) {
  let state = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  const states = [state];
  for (const pack of packs) {
    if (lianyingDecisionTick(state) < endTick) {
      state = executeActionPack(
        state,
        pack,
        runtime.config,
        runtime.oracle,
        { endTick },
      );
    }
    states.push(state);
  }
  return states;
}

export function isLianyingThunderAnchorPackAllowed(pack, offset) {
  const hasThunder = lianyingPackHasAction(pack, "thunder");
  return offset === 0 ? hasThunder : !hasThunder;
}

function evaluateLianyingNextSegmentProbe(
  runtime,
  state,
  sourcePacks,
  { endTick, beamWidth = 2 } = {},
) {
  let nodes = [{ state, lineageId: "probe" }];
  let explored = 0;
  let legal = 0;
  for (let offset = 0; offset < sourcePacks.length; offset += 1) {
    const candidates = new Map();
    for (const node of nodes) {
      for (const pack of legalMechanicalLianyingPacks(
        node.state,
        runtime.config,
      )) {
        if (!isLianyingThunderAnchorPackAllowed(pack, offset)) continue;
        explored += 1;
        try {
          const nextState = executeActionPack(
            node.state,
            pack,
            runtime.config,
            runtime.oracle,
            { endTick },
          );
          legal += 1;
          const key = lianyingResynthesisStateKey(nextState);
          const current = candidates.get(key);
          if (!current || nextState.totalDamage > current.state.totalDamage) {
            candidates.set(key, { state: nextState, lineageId: "probe" });
          }
        } catch {
          // 探针与正式搜索使用同一完整状态机过滤非法动作。
        }
      }
    }
    nodes = selectLianyingResynthesisBeam(
      candidates.values(),
      Math.max(1, Math.floor(Number(beamWidth))),
      null,
      null,
    );
    if (nodes.length === 0) break;
  }
  return {
    legal: nodes.length > 0,
    bestBoundaryDamage: nodes.length > 0
      ? Math.max(...nodes.map((node) => node.state.totalDamage))
      : null,
    outcomeCount: nodes.length,
    explored,
    legalTransitions: legal,
  };
}

export function lianyingAnchorDriftWindow(
  anchors,
  anchorIndex,
  {
    slackRows = 1,
    fixFirstAnchor = true,
    fixLastAnchor = true,
  } = {},
) {
  if (anchorIndex < 0 || anchorIndex >= anchors.length) return null;
  const fixed =
    (fixFirstAnchor && anchorIndex === 0) ||
    (fixLastAnchor && anchorIndex === anchors.length - 1);
  const slack = fixed ? 0 : Math.max(0, Number(slackRows));
  const target = Number(anchors[anchorIndex]);
  return {
    target,
    earliest: target - slack,
    latest: target + slack,
    slack,
    fixed,
  };
}

export function isLianyingAnchorDriftPackAllowed(
  pack,
  rowIndex,
  thunderCount,
  anchors,
  options = {},
) {
  const hasThunder = lianyingPackHasAction(pack, "thunder");
  if (thunderCount >= anchors.length) return !hasThunder;
  const window = lianyingAnchorDriftWindow(
    anchors,
    thunderCount,
    options,
  );
  if (rowIndex < window.earliest) return !hasThunder;
  if (rowIndex > window.latest) return false;
  if (rowIndex === window.latest) return hasThunder;
  return true;
}

function boundaryCategoryKey(state) {
  const tick = lianyingDecisionTick(state);
  return JSON.stringify([
    isMountedAtTick(state, tick),
    state.executeDestroyToggle,
    state.bleedQuality,
    isBuffActiveAtTick(state, "thunder", tick),
    isBuffActiveAtTick(state, "orange", tick),
    isBuffActiveAtTick(state, "ride", tick),
    isBuffActiveAtTick(state, "breakArmy", tick),
    isBuffActiveAtTick(state, "poLouLan", tick),
  ]);
}

function boundaryDiversityKey(state) {
  const tick = lianyingDecisionTick(state);
  const readyBucket = (readyTick) =>
    Math.floor(remainingTicks(readyTick, tick) / 20000);
  const queueBucket = (name) =>
    (state.chargeTicks[name].rechargeQueue ?? []).map(readyBucket);
  return JSON.stringify([
    boundaryCategoryKey(state),
    state.rage,
    Math.floor(state.dragonRideStacks / 2),
    state.bleedStacks,
    state.chargeTicks.thunder.ready,
    queueBucket("thunder"),
    state.chargeTicks.ride.ready,
    queueBucket("ride"),
    readyBucket(state.cooldownReadyTick.destroy),
    readyBucket(state.cooldownReadyTick.dragonRoar),
    readyBucket(state.cooldownReadyTick.charge),
    readyBucket(state.cooldownReadyTick.orange),
  ]);
}

function boundaryParetoVector(state) {
  const tick = lianyingDecisionTick(state);
  const cooldownValue = (name) =>
    -remainingTicks(state.cooldownReadyTick[name], tick);
  const buffValue = (name) =>
    remainingTicks(state.buffTicks[`${name}Until`], tick);
  const nextChargeValue = (name) => {
    const next = state.chargeTicks[name].rechargeQueue?.[0];
    return next === undefined ? 0 : -remainingTicks(next, tick);
  };
  return [
    state.totalDamage,
    state.rage,
    state.dragonRideStacks,
    state.bleedStacks,
    state.chargeTicks.thunder.ready,
    nextChargeValue("thunder"),
    state.chargeTicks.ride.ready,
    nextChargeValue("ride"),
    cooldownValue("destroy"),
    cooldownValue("dragonRoar"),
    cooldownValue("charge"),
    cooldownValue("orange"),
    buffValue("ride"),
    buffValue("orange"),
    buffValue("breakArmy"),
    buffValue("poLouLan"),
  ];
}

function dominates(left, right) {
  const leftVector = boundaryParetoVector(left.state);
  const rightVector = boundaryParetoVector(right.state);
  let strictlyBetter = false;
  for (let index = 0; index < leftVector.length; index += 1) {
    if (leftVector[index] < rightVector[index]) return false;
    if (leftVector[index] > rightVector[index]) strictlyBetter = true;
  }
  return strictlyBetter;
}

function paretoFrontier(nodes) {
  const categories = new Map();
  for (const node of nodes) {
    const key = boundaryCategoryKey(node.state);
    if (!categories.has(key)) categories.set(key, []);
    categories.get(key).push(node);
  }
  const frontier = [];
  for (const categoryNodes of categories.values()) {
    for (const candidate of categoryNodes) {
      if (categoryNodes.some(
        (other) => other !== candidate && dominates(other, candidate),
      )) continue;
      frontier.push(candidate);
    }
  }
  return frontier;
}

export function selectLianyingJointBoundaryNodes(
  nodes,
  beamWidth,
  pinnedKey = null,
  { scoreNode = null } = {},
) {
  const sorted = [...nodes].sort(
    (left, right) => right.state.totalDamage - left.state.totalDamage,
  );
  const scored = typeof scoreNode === "function"
    ? [...sorted].sort((left, right) => scoreNode(right) - scoreNode(left))
    : [];
  const frontier = paretoFrontier(sorted).sort(
    (left, right) => right.state.totalDamage - left.state.totalDamage,
  );
  const selected = [];
  const selectedNodes = new Set();
  const add = (node) => {
    if (!node || selected.length >= beamWidth || selectedNodes.has(node)) return;
    selected.push(node);
    selectedNodes.add(node);
  };
  const damageQuota = Math.max(
    1,
    Math.floor(beamWidth / (scored.length > 0 ? 4 : 3)),
  );
  const scoreQuota = scored.length > 0
    ? Math.max(damageQuota, Math.floor(beamWidth / 2))
    : damageQuota;
  const frontierQuota = Math.max(
    scoreQuota,
    Math.floor((beamWidth * 3) / 4),
  );
  for (const node of sorted.slice(0, damageQuota)) add(node);
  for (const node of scored) {
    add(node);
    if (selected.length >= scoreQuota) break;
  }
  for (const node of frontier) {
    add(node);
    if (selected.length >= frontierQuota) break;
  }
  const diversity = new Set();
  for (const node of sorted) {
    const key = boundaryDiversityKey(node.state);
    if (diversity.has(key)) continue;
    diversity.add(key);
    add(node);
    if (selected.length >= beamWidth) break;
  }
  for (const node of sorted) add(node);
  if (
    pinnedKey &&
    !selected.some((node) => lianyingResynthesisStateKey(node.state) === pinnedKey)
  ) {
    const pinned = sorted.find(
      (node) => lianyingResynthesisStateKey(node.state) === pinnedKey,
    );
    if (pinned) selected[selected.length - 1] = pinned;
  }
  return {
    nodes: selected,
    paretoCount: frontier.length,
    diversityBuckets: new Set(sorted.map((node) =>
      boundaryDiversityKey(node.state))).size,
  };
}

function selectJointRowBeam(
  nodes,
  beamWidth,
  pinnedKey,
  boundaryTarget,
) {
  const all = [...nodes];
  const lineageBest = new Map();
  for (const node of all) {
    const current = lineageBest.get(node.lineageId);
    if (!current || node.state.totalDamage > current.state.totalDamage) {
      lineageBest.set(node.lineageId, node);
    }
  }
  const lineageNodes = [...lineageBest.values()].sort(
    (left, right) => right.state.totalDamage - left.state.totalDamage,
  );
  const lineageQuota = Math.min(
    lineageNodes.length,
    Math.max(1, Math.floor(beamWidth / 2)),
  );
  const selected = lineageNodes.slice(0, lineageQuota);
  const selectedNodes = new Set(selected);
  const base = selectLianyingResynthesisBeam(
    all,
    beamWidth,
    pinnedKey,
    boundaryTarget,
  );
  for (const node of base) {
    if (selected.length >= beamWidth) break;
    if (selectedNodes.has(node)) continue;
    selected.push(node);
    selectedNodes.add(node);
  }
  if (
    pinnedKey &&
    !selected.some((node) => lianyingResynthesisStateKey(node.state) === pinnedKey)
  ) {
    const pinned = all.find(
      (node) => lianyingResynthesisStateKey(node.state) === pinnedKey,
    );
    if (pinned) selected[selected.length - 1] = pinned;
  }
  return selected;
}

function selectAnchorDriftRowBeam(
  nodes,
  beamWidth,
  pinnedKey,
  boundaryTarget,
) {
  const all = [...nodes];
  const countBest = new Map();
  const scheduleBest = new Map();
  for (const node of all) {
    const current = countBest.get(node.thunderCount);
    if (
      !current ||
      lianyingAnchorDriftLongTermScore(node) >
        lianyingAnchorDriftLongTermScore(current)
    ) {
      countBest.set(node.thunderCount, node);
    }
    const scheduleKey = JSON.stringify(node.anchorRows);
    const currentSchedule = scheduleBest.get(scheduleKey);
    if (
      !currentSchedule ||
      lianyingAnchorDriftLongTermScore(node) >
        lianyingAnchorDriftLongTermScore(currentSchedule)
    ) {
      scheduleBest.set(scheduleKey, node);
    }
  }
  const selected = [...countBest.values()].sort(
    (left, right) =>
      lianyingAnchorDriftLongTermScore(right) -
      lianyingAnchorDriftLongTermScore(left),
  );
  const selectedNodes = new Set(selected);
  const scheduleNodes = [...scheduleBest.values()].sort(
    (left, right) =>
      lianyingAnchorDriftLongTermScore(right) -
      lianyingAnchorDriftLongTermScore(left),
  );
  const scheduleQuota = Math.min(
    scheduleNodes.length,
    Math.max(1, Math.ceil(beamWidth / 2)),
  );
  let selectedSchedules = new Set(
    selected.map((node) => JSON.stringify(node.anchorRows)),
  );
  for (const node of scheduleNodes) {
    if (selected.length >= beamWidth) break;
    const scheduleKey = JSON.stringify(node.anchorRows);
    if (selectedSchedules.has(scheduleKey)) continue;
    selected.push(node);
    selectedNodes.add(node);
    selectedSchedules.add(scheduleKey);
    if (selectedSchedules.size >= scheduleQuota) break;
  }
  const base = selectJointRowBeam(
    all,
    beamWidth,
    pinnedKey,
    boundaryTarget,
  );
  for (const node of base) {
    if (selected.length >= beamWidth) break;
    if (selectedNodes.has(node)) continue;
    selected.push(node);
    selectedNodes.add(node);
  }
  return selected.slice(0, beamWidth);
}

export function lianyingAnchorDriftLongTermScore(node) {
  const projected = Number(node?.lineageProjectedFinal);
  const baseDamage = Number(node?.lineageBaseDamage);
  const currentDamage = Number(node?.state?.totalDamage ?? 0);
  if (Number.isFinite(projected) && Number.isFinite(baseDamage)) {
    return projected + currentDamage - baseDamage;
  }
  return currentDamage;
}

function selectAnchorDriftBoundaryNodes(
  nodes,
  beamWidth,
  pinnedKey,
  pinnedScheduleKey,
  { scoreNode = null } = {},
) {
  const all = [...nodes];
  const score = typeof scoreNode === "function"
    ? scoreNode
    : (node) => node.state.totalDamage;
  const scheduleBest = new Map();
  for (const node of all) {
    const key = JSON.stringify(node.anchorRows);
    const current = scheduleBest.get(key);
    if (!current || score(node) > score(current)) scheduleBest.set(key, node);
  }
  const scheduleNodes = [...scheduleBest.values()].sort(
    (left, right) => score(right) - score(left),
  );
  const selected = [];
  const selectedNodes = new Set();
  const selectedScheduleKeys = new Set();
  const add = (node) => {
    if (!node || selected.length >= beamWidth || selectedNodes.has(node)) return;
    selected.push(node);
    selectedNodes.add(node);
    selectedScheduleKeys.add(JSON.stringify(node.anchorRows));
  };
  const pinned = all.find((node) =>
    JSON.stringify(node.anchorRows) === pinnedScheduleKey &&
    lianyingResynthesisStateKey(node.state) === pinnedKey);
  add(pinned);
  const scheduleQuota = Math.min(
    scheduleNodes.length,
    Math.max(1, Math.ceil(beamWidth / 2)),
  );
  for (const node of scheduleNodes) {
    add(node);
    if (selectedScheduleKeys.size >= scheduleQuota) break;
  }
  const base = selectLianyingJointBoundaryNodes(
    all,
    beamWidth,
    pinnedKey,
    { scoreNode },
  );
  for (const node of base.nodes) add(node);
  for (const node of scheduleNodes) add(node);
  return {
    nodes: selected,
    paretoCount: base.paretoCount,
    diversityBuckets: base.diversityBuckets,
    scheduleBuckets: scheduleBest.size,
  };
}

function stateRemainingSnapshot(state) {
  const tick = lianyingDecisionTick(state);
  const cooldowns = Object.fromEntries(
    ["destroy", "dragonRoar", "charge", "orange"].map((name) => [
      name,
      ticksToMilliseconds(remainingTicks(state.cooldownReadyTick[name], tick)),
    ]),
  );
  const buffs = Object.fromEntries(
    ["thunder", "orange", "ride", "breakArmy", "poLouLan"].map((name) => [
      name,
      ticksToMilliseconds(
        remainingTicks(state.buffTicks[`${name}Until`], tick),
      ),
    ]),
  );
  const charges = Object.fromEntries(
    ["thunder", "ride"].map((name) => {
      const pool = state.chargeTicks[name];
      return [name, {
        ready: pool.ready,
        nextRechargeMs: pool.rechargeQueue?.[0] === undefined
          ? 0
          : ticksToMilliseconds(
            remainingTicks(pool.rechargeQueue[0], tick),
          ),
      }];
    }),
  );
  return {
    rage: state.rage,
    dragonRideStacks: state.dragonRideStacks,
    mounted: isMountedAtTick(state, tick),
    bleedStacks: state.bleedStacks,
    bleedQuality: state.bleedQuality,
    cooldowns,
    buffs,
    charges,
  };
}

function snapshotDelta(state, reference) {
  const current = stateRemainingSnapshot(state);
  const target = stateRemainingSnapshot(reference);
  return {
    rage: current.rage - target.rage,
    dragonRideStacks:
      current.dragonRideStacks - target.dragonRideStacks,
    mountedChanged: current.mounted !== target.mounted,
    bleedStacks: current.bleedStacks - target.bleedStacks,
    bleedQuality: current.bleedQuality - target.bleedQuality,
    cooldownRemainingMs: Object.fromEntries(
      Object.keys(current.cooldowns).map((name) => [
        name,
        current.cooldowns[name] - target.cooldowns[name],
      ]),
    ),
    buffRemainingMs: Object.fromEntries(
      Object.keys(current.buffs).map((name) => [
        name,
        current.buffs[name] - target.buffs[name],
      ]),
    ),
    charges: Object.fromEntries(
      Object.keys(current.charges).map((name) => [
        name,
        {
          ready: current.charges[name].ready - target.charges[name].ready,
          nextRechargeMs:
            current.charges[name].nextRechargeMs -
            target.charges[name].nextRechargeMs,
        },
      ]),
    ),
  };
}

export function evaluateLianyingReferenceSuffixValue(
  runtime,
  state,
  suffixPacks,
  warmStates,
  boundaryIndex,
  coreFinalDamage,
  {
    endTick = Number.POSITIVE_INFINITY,
    averageRowDamage = 0,
    repairPenaltyRows = 1,
  } = {},
) {
  let replayState = state;
  let completedRows = 0;
  let failure = null;
  for (let index = 0; index < suffixPacks.length; index += 1) {
    if (lianyingDecisionTick(replayState) >= endTick) {
      completedRows = suffixPacks.length;
      break;
    }
    try {
      replayState = executeActionPack(
        replayState,
        suffixPacks[index],
        runtime.config,
        runtime.oracle,
        { endTick },
      );
      completedRows += 1;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  const comparableWarmState = warmStates[
    Math.min(boundaryIndex + completedRows, warmStates.length - 1)
  ];
  const projectedFinalDamage =
    replayState.totalDamage +
    (coreFinalDamage - comparableWarmState.totalDamage);
  const repairPenalty = failure
    ? Number(averageRowDamage) * Number(repairPenaltyRows)
    : 0;
  return {
    projectedFinalDamage,
    score: projectedFinalDamage - repairPenalty,
    completedRows,
    totalRows: suffixPacks.length,
    completionRatio: suffixPacks.length === 0
      ? 1
      : completedRows / suffixPacks.length,
    suffixLegal: failure === null,
    failure,
    repairPenalty,
  };
}

function buildBoundaryDiagnostics(nodes, warmState, coreFinalDamage, limit = 3) {
  return [...nodes]
    .sort((left, right) =>
      Number(right.suffixValue?.score ?? right.state.totalDamage) -
      Number(left.suffixValue?.score ?? left.state.totalDamage))
    .slice(0, limit)
    .map((node, index) => ({
      rank: index + 1,
      currentDamageGain: node.state.totalDamage - warmState.totalDamage,
      projectedFinalDamage: node.suffixValue?.projectedFinalDamage ?? null,
      projectedFinalGain:
        Number(node.suffixValue?.projectedFinalDamage ?? coreFinalDamage) -
        coreFinalDamage,
      suffixScore: node.suffixValue?.score ?? null,
      suffixLegal: node.suffixValue?.suffixLegal ?? null,
      suffixCompletedRows: node.suffixValue?.completedRows ?? null,
      suffixTotalRows: node.suffixValue?.totalRows ?? null,
      suffixFailure: node.suffixValue?.failure ?? null,
      stateDelta: snapshotDelta(node.state, warmState),
    }));
}

function selectCoreCandidates(candidates, limit) {
  const sorted = [...candidates].sort(
    (left, right) => right.coreDamage - left.coreDamage,
  );
  const incumbent = sorted.find((candidate) => candidate.isIncumbent);
  const selected = sorted
    .filter((candidate) => !candidate.isIncumbent)
    .slice(0, Math.max(0, limit - 1));
  if (incumbent) selected.push(incumbent);
  return selected.sort((left, right) => right.coreDamage - left.coreDamage);
}

function selectAnchorDriftCoreCandidates(candidates, limit) {
  const all = [...candidates];
  const scheduleBest = new Map();
  for (const candidate of all) {
    const key = JSON.stringify(candidate.anchorRows);
    const current = scheduleBest.get(key);
    if (!current || candidate.coreDamage > current.coreDamage) {
      scheduleBest.set(key, candidate);
    }
  }
  const representatives = [...scheduleBest.values()].sort(
    (left, right) => right.coreDamage - left.coreDamage,
  );
  const incumbent = all.find((candidate) => candidate.isIncumbent);
  const selected = [];
  const selectedCandidates = new Set();
  const add = (candidate) => {
    if (
      !candidate ||
      selected.length >= limit ||
      selectedCandidates.has(candidate)
    ) return;
    selected.push(candidate);
    selectedCandidates.add(candidate);
  };
  add(incumbent);
  const scheduleQuota = Math.min(
    representatives.length,
    Math.max(1, Math.ceil(limit / 2)),
  );
  for (const candidate of representatives) {
    add(candidate);
    if (selected.length >= scheduleQuota) break;
  }
  for (const candidate of all.sort(
    (left, right) => right.coreDamage - left.coreDamage,
  )) add(candidate);
  return selected.sort((left, right) => right.coreDamage - left.coreDamage);
}

function selectFinalDashCandidates(candidates, limit) {
  const sorted = [...candidates].sort(
    (left, right) => right.totalDamage - left.totalDamage,
  );
  const incumbent = sorted.find((candidate) => candidate.isIncumbent);
  const selected = sorted
    .filter((candidate) => !candidate.isIncumbent)
    .slice(0, Math.max(0, limit - 1));
  if (incumbent) selected.push(incumbent);
  return selected.sort((left, right) => right.totalDamage - left.totalDamage);
}

export function optimizeLianyingMultiSegmentResynthesis(
  runtime,
  packs,
  {
    durationSeconds = 180,
    rowBeamWidth = 48,
    boundaryBeamWidth = 24,
    coreFinalistCount = 24,
    coarseCandidateLimit = 6,
    coarseDashStates = 16,
    finalDashCandidateCount = 2,
    fullDashStates = 256,
    useSuffixValue = true,
    suffixRepairPenaltyRows = 1,
    boundaryDiagnosticCount = 3,
    valueShadowPolicy = null,
    collectValueTrainingData = false,
    valueProbeMaximumBaselineRank = 32,
    valueProbeRowStride = 4,
    valueProbeNextSegmentBeamWidth = 2,
    onProgress = null,
  } = {},
) {
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  const incumbentPacks = clonePacks(packs);
  const incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const corePacks = stripLianyingDashPacks(incumbentPacks);
  const coreBaseline = replayWhitepaperLianying(runtime, corePacks, {
    durationSeconds,
  });
  const identified = identifyLianyingThunderSegments(corePacks);
  if (identified.ranges.length === 0) {
    return {
      packs: incumbentPacks,
      state: incumbent.state,
      baselineDamage: incumbent.state.totalDamage,
      damageGain: 0,
      anchors: [],
      segments: [],
      coreCandidates: 1,
      accepted: false,
    };
  }

  const firstAnchor = identified.ranges[0].startIndex;
  const prefixPacks = clonePacks(corePacks.slice(0, firstAnchor));
  const warmStates = buildWarmStates(runtime, corePacks, endTick);
  let warmState = warmStates[firstAnchor];
  let warmGeneratedPacks = [];
  let nodes = [{
    state: warmState,
    packs: [],
    valueShadow: false,
    boundaryProbeIds: [],
  }];
  let explored = 0;
  let legal = 0;
  let peakRowStates = 1;
  let valueShadowRows = 0;
  let valueShadowSelections = 0;
  let valueShadowBoundarySelections = 0;
  const valueTrainingRows = [];
  const boundaryValueProbes = new Map();
  let nextValueProbeId = 0;
  let rowProbeAttempts = 0;
  let rowProbeLegal = 0;
  let boundaryProbeAttempts = 0;
  let boundaryProbeReferenceLegal = 0;
  let boundaryNextSegmentProbeAttempts = 0;
  let boundaryNextSegmentProbeLegal = 0;
  let boundaryNextSegmentProbeExplored = 0;
  let boundaryNextSegmentProbeLegalTransitions = 0;
  const makeValueRow = (
    node,
    {
      traceId,
      segment,
      globalRow,
      baselineRank,
      bestFinalDamage,
      referenceDamage,
      metadata = {},
    },
  ) => {
    const bestRemainingDamage = Number(bestFinalDamage) -
      Number(node.state.totalDamage);
    const referenceRemainingDamage = coreBaseline.state.totalDamage -
      Number(referenceDamage);
    return {
      traceId,
      segmentId: segment.id,
      durationSeconds: Number(durationSeconds),
      layer: globalRow + 1,
      globalRow: globalRow + 1,
      baselineRank,
      totalDamage: Number(node.state.totalDamage),
      bestFinalDamage: Number(bestFinalDamage),
      bestRemainingDamage,
      referenceRemainingDamage,
      remainingDamageResidual: bestRemainingDamage - referenceRemainingDamage,
      descendantOutcomeCount: 1,
      ...metadata,
      ...lianyingStateValueFeatures(node.state, endTick),
    };
  };
  const segmentReports = [];

  for (let segmentIndex = 0; segmentIndex < identified.ranges.length; segmentIndex += 1) {
    const segment = identified.ranges[segmentIndex];
    const source = corePacks.slice(segment.startIndex, segment.endIndex);
    nodes = nodes.map((node, index) => ({
      ...node,
      lineageId: `${segmentIndex + 1}:${index + 1}`,
    }));
    const warmIncomingKey = lianyingResynthesisStateKey(warmState);
    const warmIncomingNode = nodes.find(
      (node) => lianyingResynthesisStateKey(node.state) === warmIncomingKey,
    );
    const warmLineageId = warmIncomingNode?.lineageId ??
      `${segmentIndex + 1}:warm`;
    const warmBoundaryProbeIds = warmIncomingNode?.boundaryProbeIds ?? [];
    const incomingStates = nodes.length;
    if (typeof onProgress === "function") {
      onProgress({
        stage: "segment-start",
        segment: segmentIndex + 1,
        segmentCount: identified.ranges.length,
        segmentId: segment.id,
        incomingStates,
        rowCount: source.length,
      });
    }

    for (let offset = 0; offset < source.length; offset += 1) {
      const candidates = new Map();
      const baselineCandidates = new Map();
      const addCandidate = (map, key, candidate) => {
        const current = map.get(key);
        if (!current || candidate.state.totalDamage > current.state.totalDamage) {
          map.set(key, candidate);
        }
      };
      for (const node of nodes) {
        for (const pack of legalMechanicalLianyingPacks(
          node.state,
          runtime.config,
        )) {
          if (!isLianyingThunderAnchorPackAllowed(pack, offset)) continue;
          explored += 1;
          try {
            const state = executeActionPack(
              node.state,
              pack,
              runtime.config,
              runtime.oracle,
              { endTick },
            );
            legal += 1;
            const candidate = {
              state,
              packs: [...node.packs, cloneLianyingPack(pack)],
              lineageId: node.lineageId,
              valueShadow: node.valueShadow === true,
              boundaryProbeIds: node.boundaryProbeIds ?? [],
            };
            const key = lianyingResynthesisStateKey(state);
            addCandidate(candidates, key, candidate);
            if (node.valueShadow !== true) {
              addCandidate(baselineCandidates, key, {
                ...candidate,
                valueShadow: false,
              });
            }
          } catch {
            // 战意、冷却、充能、马上状态等非法动作由完整状态机淘汰。
          }
        }
      }

      const warmPack = source[offset];
      if (!isLianyingThunderAnchorPackAllowed(warmPack, offset)) {
        throw new Error(`${segment.id}的热启动轴不满足固定雷锚点约束`);
      }
      warmState = executeActionPack(
        warmState,
        warmPack,
        runtime.config,
        runtime.oracle,
        { endTick },
      );
      warmGeneratedPacks = [
        ...warmGeneratedPacks,
        cloneLianyingPack(warmPack),
      ];
      const warmKey = lianyingResynthesisStateKey(warmState);
      const warmCandidate = {
        state: warmState,
        packs: warmGeneratedPacks,
        lineageId: warmLineageId,
        valueShadow: false,
        boundaryProbeIds: warmBoundaryProbeIds,
      };
      addCandidate(candidates, warmKey, warmCandidate);
      addCandidate(baselineCandidates, warmKey, warmCandidate);
      const baselineNodes = selectJointRowBeam(
        baselineCandidates.values(),
        rowBeamWidth,
        warmKey,
        warmState,
      );
      const shadowNodes = selectLianyingValueShadowCandidates(
        candidates.values(),
        baselineNodes,
        endTick,
        valueShadowPolicy,
      ).map((node) => ({ ...node, valueShadow: true }));
      if (shadowNodes.length > 0) valueShadowRows += 1;
      valueShadowSelections += shadowNodes.length;
      nodes = [...baselineNodes, ...shadowNodes];
      const globalRow = segment.startIndex + offset;
      const stride = Math.max(1, Math.floor(Number(valueProbeRowStride)));
      if (
        collectValueTrainingData &&
        (globalRow - firstAnchor) % stride === 0
      ) {
        const baselineKeys = new Set(baselineNodes.map((node) =>
          lianyingResynthesisStateKey(node.state)));
        const shadowKeys = new Set(shadowNodes.map((node) =>
          lianyingResynthesisStateKey(node.state)));
        const ranked = [...candidates.values()]
          .sort((left, right) =>
            right.state.totalDamage - left.state.totalDamage)
          .slice(0, Math.max(
            1,
            Math.floor(Number(valueProbeMaximumBaselineRank)),
          ));
        for (const [rankIndex, candidate] of ranked.entries()) {
          rowProbeAttempts += 1;
          const suffixValue = evaluateLianyingReferenceSuffixValue(
            runtime,
            candidate.state,
            corePacks.slice(globalRow + 1),
            warmStates,
            globalRow + 1,
            coreBaseline.state.totalDamage,
            { endTick, averageRowDamage: 0, repairPenaltyRows: 0 },
          );
          if (!suffixValue.suffixLegal) continue;
          rowProbeLegal += 1;
          const key = lianyingResynthesisStateKey(candidate.state);
          valueTrainingRows.push(makeValueRow(candidate, {
            traceId: "multi-row-reference",
            segment,
            globalRow,
            baselineRank: rankIndex + 1,
            bestFinalDamage: suffixValue.projectedFinalDamage,
            referenceDamage: warmStates[globalRow + 1].totalDamage,
            metadata: {
              labelKind: "reference-suffix",
              selectionStage: "row",
              selectedByBaselineBeam: Number(baselineKeys.has(key)),
              selectedByValueShadow: Number(shadowKeys.has(key)),
              lineageId: candidate.lineageId,
            },
          }));
        }
      }
      peakRowStates = Math.max(peakRowStates, nodes.length);
      if (nodes.length === 0) {
        throw new Error(`${segment.id}第${offset + 1}行没有合法联合搜索状态`);
      }
    }

    const survivingIncomingLineages = new Set(
      nodes.map((node) => node.lineageId),
    ).size;
    const suffixPacks = corePacks.slice(segment.endIndex);
    const averageRowDamage =
      coreBaseline.state.totalDamage / Math.max(1, corePacks.length);
    if (useSuffixValue) {
      nodes = nodes.map((node) => ({
        ...node,
        suffixValue: evaluateLianyingReferenceSuffixValue(
          runtime,
          node.state,
          suffixPacks,
          warmStates,
          segment.endIndex,
          coreBaseline.state.totalDamage,
          {
            endTick,
            averageRowDamage,
            repairPenaltyRows: suffixRepairPenaltyRows,
          },
        ),
      }));
    }
    const boundaryProbeEntries = [];
    if (collectValueTrainingData) {
      const ranked = [...nodes].sort((left, right) =>
        right.state.totalDamage - left.state.totalDamage);
      const rankByNode = new Map(ranked.map((node, index) => [node, index + 1]));
      nodes = nodes.map((node) => {
        boundaryProbeAttempts += 1;
        const probeId = nextValueProbeId;
        nextValueProbeId += 1;
        const record = {
          probeId,
          node,
          segment,
          globalRow: segment.endIndex - 1,
          baselineRank: rankByNode.get(node),
          referenceDamage: warmState.totalDamage,
          referenceFinalDamage: node.suffixValue?.suffixLegal
            ? node.suffixValue.projectedFinalDamage
            : null,
          nextSegmentBestBoundaryDamage: Number.NEGATIVE_INFINITY,
          nextSegmentReferenceDamage: null,
          nextSegmentOutcomeCount: 0,
          actualBestFinalDamage: Number.NEGATIVE_INFINITY,
          actualOutcomeCount: 0,
        };
        boundaryValueProbes.set(probeId, record);
        boundaryProbeEntries.push(record);
        return {
          ...node,
          boundaryProbeIds: [...(node.boundaryProbeIds ?? []), probeId],
        };
      });
    }
    const warmKey = lianyingResynthesisStateKey(warmState);
    const baselineBoundary = selectLianyingJointBoundaryNodes(
      nodes.filter((node) => node.valueShadow !== true),
      boundaryBeamWidth,
      warmKey,
      {
        scoreNode: useSuffixValue
          ? (node) => node.suffixValue.score
          : null,
      },
    );
    const boundaryShadowNodes = selectLianyingValueShadowCandidates(
      nodes,
      baselineBoundary.nodes,
      endTick,
      valueShadowPolicy,
    ).map((node) => ({ ...node, valueShadow: true }));
    valueShadowBoundarySelections += boundaryShadowNodes.length;
    nodes = [...baselineBoundary.nodes, ...boundaryShadowNodes];
    if (collectValueTrainingData) {
      const baselineKeys = new Set(baselineBoundary.nodes.map((node) =>
        lianyingResynthesisStateKey(node.state)));
      const shadowKeys = new Set(boundaryShadowNodes.map((node) =>
        lianyingResynthesisStateKey(node.state)));
      for (const record of boundaryProbeEntries) {
        const key = lianyingResynthesisStateKey(record.node.state);
        record.selectedByBaselineBeam = Number(baselineKeys.has(key));
        record.selectedByValueShadow = Number(shadowKeys.has(key));
        if (!Number.isFinite(record.referenceFinalDamage)) continue;
        boundaryProbeReferenceLegal += 1;
        valueTrainingRows.push(makeValueRow(record.node, {
          traceId: "multi-boundary-reference",
          segment: record.segment,
          globalRow: record.globalRow,
          baselineRank: record.baselineRank,
          bestFinalDamage: record.referenceFinalDamage,
          referenceDamage: record.referenceDamage,
          metadata: {
            labelKind: "reference-suffix",
            selectionStage: "boundary",
            selectedByBaselineBeam: Number(baselineKeys.has(key)),
            selectedByValueShadow: Number(shadowKeys.has(key)),
            lineageId: record.node.lineageId,
          },
        }));
      }
      const nextSegment = identified.ranges[segmentIndex + 1];
      if (nextSegment) {
        const nextSource = corePacks.slice(
          nextSegment.startIndex,
          nextSegment.endIndex,
        );
        for (const record of boundaryProbeEntries) {
          boundaryNextSegmentProbeAttempts += 1;
          const probe = evaluateLianyingNextSegmentProbe(
            runtime,
            record.node.state,
            nextSource,
            {
              endTick,
              beamWidth: valueProbeNextSegmentBeamWidth,
            },
          );
          boundaryNextSegmentProbeExplored += probe.explored;
          boundaryNextSegmentProbeLegalTransitions += probe.legalTransitions;
          if (!probe.legal) continue;
          boundaryNextSegmentProbeLegal += 1;
          record.nextSegmentBestBoundaryDamage = probe.bestBoundaryDamage;
          record.nextSegmentOutcomeCount = probe.outcomeCount;
          record.nextSegmentProbeExplored = probe.explored;
          record.nextSegmentProbeLegalTransitions = probe.legalTransitions;
          record.nextSegmentReferenceDamage =
            warmStates[nextSegment.endIndex].totalDamage;
        }
      }
    }
    const diagnostics = buildBoundaryDiagnostics(
      nodes,
      warmState,
      coreBaseline.state.totalDamage,
      boundaryDiagnosticCount,
    );
    const report = {
      ...segment,
      incomingStates,
      survivingIncomingLineages,
      outgoingStates: nodes.length,
      baselineOutgoingStates: baselineBoundary.nodes.length,
      valueShadowOutgoingStates: boundaryShadowNodes.length,
      paretoStates: baselineBoundary.paretoCount,
      diversityBuckets: baselineBoundary.diversityBuckets,
      bestDamageGainAtBoundary:
        Math.max(...nodes.map((node) => node.state.totalDamage)) -
        warmState.totalDamage,
      suffixValueEnabled: useSuffixValue,
      referenceSuffixLegalCandidates: nodes.filter(
        (node) => node.suffixValue?.suffixLegal,
      ).length,
      bestProjectedFinalGain: Math.max(...nodes.map((node) =>
        Number(node.suffixValue?.projectedFinalDamage ?? node.state.totalDamage))) -
        coreBaseline.state.totalDamage,
      bestSuffixScoreGain: Math.max(...nodes.map((node) =>
        Number(node.suffixValue?.score ?? node.state.totalDamage))) -
        coreBaseline.state.totalDamage,
      candidateDiagnostics: diagnostics,
    };
    segmentReports.push(report);
    if (typeof onProgress === "function") {
      const { candidateDiagnostics: _diagnostics, ...progressReport } = report;
      onProgress({
        stage: "segment-complete",
        segment: segmentIndex + 1,
        segmentCount: identified.ranges.length,
        ...progressReport,
      });
    }
  }

  const coreCandidatesByPath = new Map();
  const addCoreCandidate = (candidate) => {
    const key = JSON.stringify(candidate.packs);
    const current = coreCandidatesByPath.get(key);
    if (!current || candidate.coreDamage > current.coreDamage) {
      coreCandidatesByPath.set(key, candidate);
    }
  };
  addCoreCandidate({
    packs: corePacks,
    coreDamage: coreBaseline.state.totalDamage,
    isIncumbent: true,
    valueShadow: false,
  });
  const baselineCoreFinalists = nodes
    .filter((node) => node.valueShadow !== true)
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, coreFinalistCount);
  const valueShadowCoreFinalists = nodes
    .filter((node) => node.valueShadow === true)
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, Math.max(0, Math.floor(Number(valueShadowPolicy?.valueQuota ?? 0))));
  for (const node of [...baselineCoreFinalists, ...valueShadowCoreFinalists]) {
    const candidatePacks = [...prefixPacks, ...clonePacks(node.packs)];
    try {
      const replay = replayWhitepaperLianying(runtime, candidatePacks, {
        durationSeconds,
      });
      if (collectValueTrainingData) {
        for (const probeId of node.boundaryProbeIds ?? []) {
          const probe = boundaryValueProbes.get(probeId);
          if (!probe) continue;
          probe.actualBestFinalDamage = Math.max(
            probe.actualBestFinalDamage,
            replay.state.totalDamage,
          );
          probe.actualOutcomeCount += 1;
        }
      }
      addCoreCandidate({
        packs: candidatePacks,
        coreDamage: replay.state.totalDamage,
        isIncumbent: JSON.stringify(candidatePacks) === JSON.stringify(corePacks),
        valueShadow: node.valueShadow === true,
      });
    } catch {
      // 联合候选仍以完整180秒重放作为最终合法性门槛。
    }
  }

  const selectedCore = selectCoreCandidates(
    coreCandidatesByPath.values(),
    coarseCandidateLimit,
  );
  if (collectValueTrainingData) {
    for (const probe of boundaryValueProbes.values()) {
      if (Number.isFinite(probe.nextSegmentBestBoundaryDamage)) {
        const projectedFinalDamage = probe.nextSegmentBestBoundaryDamage +
          (coreBaseline.state.totalDamage -
            Number(probe.nextSegmentReferenceDamage));
        valueTrainingRows.push(makeValueRow(probe.node, {
          traceId: "multi-boundary-next-segment",
          segment: probe.segment,
          globalRow: probe.globalRow,
          baselineRank: probe.baselineRank,
          bestFinalDamage: projectedFinalDamage,
          referenceDamage: probe.referenceDamage,
          metadata: {
            labelKind: "actual-next-segment",
            selectionStage: "boundary",
            selectedByBaselineBeam: probe.selectedByBaselineBeam,
            selectedByValueShadow: probe.selectedByValueShadow,
            lineageId: probe.node.lineageId,
            descendantOutcomeCount: probe.nextSegmentOutcomeCount,
            probeBeamWidth: Number(valueProbeNextSegmentBeamWidth),
            probeExplored: probe.nextSegmentProbeExplored,
            probeLegalTransitions: probe.nextSegmentProbeLegalTransitions,
          },
        }));
      }
      if (!Number.isFinite(probe.actualBestFinalDamage)) continue;
      valueTrainingRows.push(makeValueRow(probe.node, {
        traceId: "multi-boundary-actual",
        segment: probe.segment,
        globalRow: probe.globalRow,
        baselineRank: probe.baselineRank,
        bestFinalDamage: probe.actualBestFinalDamage,
        referenceDamage: probe.referenceDamage,
        metadata: {
          labelKind: "actual-full-descendant",
          selectionStage: "boundary",
          selectedByBaselineBeam: probe.selectedByBaselineBeam,
          selectedByValueShadow: probe.selectedByValueShadow,
          lineageId: probe.node.lineageId,
          descendantOutcomeCount: probe.actualOutcomeCount,
        },
      }));
    }
  }
  const valueShadowCoreCandidates = [...coreCandidatesByPath.values()].filter(
    (candidate) => candidate.valueShadow === true);
  const coarseCandidates = selectedCore.map((candidate, index) => {
    if (typeof onProgress === "function") {
      onProgress({
        stage: "dash-coarse",
        candidate: index + 1,
        candidateCount: selectedCore.length,
        isIncumbent: candidate.isIncumbent,
      });
    }
    if (candidate.isIncumbent) {
      return {
        ...candidate,
        packs: incumbentPacks,
        totalDamage: incumbent.state.totalDamage,
        dashCount: incumbent.state.timeline.filter(
          (event) => event.type === "offGcd" && event.action === "dash",
        ).length,
      };
    }
    const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
      durationSeconds,
      maxStatesPerRow: coarseDashStates,
    });
    return {
      ...candidate,
      packs: dash.packs,
      totalDamage: dash.state.totalDamage,
      dashCount: dash.dashCount,
    };
  });

  const selectedFinal = selectFinalDashCandidates(
    coarseCandidates,
    finalDashCandidateCount,
  );
  const finalCandidates = selectedFinal.map((candidate, index) => {
    if (typeof onProgress === "function") {
      onProgress({
        stage: "dash-final",
        candidate: index + 1,
        candidateCount: selectedFinal.length,
        isIncumbent: candidate.isIncumbent,
      });
    }
    if (candidate.isIncumbent) {
      return { ...candidate, state: incumbent.state };
    }
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
  }).sort((left, right) => right.totalDamage - left.totalDamage);

  const best = finalCandidates[0];
  const accepted = Boolean(best && best.totalDamage > incumbent.state.totalDamage);
  return {
    packs: accepted ? best.packs : incumbentPacks,
    state: accepted ? best.state : incumbent.state,
    baselineDamage: incumbent.state.totalDamage,
    damageGain: accepted ? best.totalDamage - incumbent.state.totalDamage : 0,
    accepted,
    anchors: identified.anchors.map((index) => index + 1),
    segments: segmentReports,
    explored,
    legal,
    peakRowStates,
    finalBoundaryStates: nodes.length,
    coreCandidates: coreCandidatesByPath.size,
    valueShadowCoreCandidates: valueShadowCoreCandidates.length,
    bestValueShadowCoreDamage: valueShadowCoreCandidates.length > 0
      ? Math.max(...valueShadowCoreCandidates.map(
        (candidate) => candidate.coreDamage))
      : null,
    bestValueShadowCoreDamageGain: valueShadowCoreCandidates.length > 0
      ? Math.max(...valueShadowCoreCandidates.map(
        (candidate) => candidate.coreDamage)) - coreBaseline.state.totalDamage
      : null,
    baselineCoreFinalists: baselineCoreFinalists.length,
    valueShadowCoreFinalists: valueShadowCoreFinalists.length,
    valueShadowRows,
    valueShadowSelections,
    valueShadowBoundarySelections,
    valueTraining: collectValueTrainingData
      ? {
          rows: valueTrainingRows,
          summary: {
            rowCount: valueTrainingRows.length,
            rowProbeAttempts,
            rowProbeLegal,
            boundaryProbeAttempts,
            boundaryProbeReferenceLegal,
            boundaryNextSegmentProbeAttempts,
            boundaryNextSegmentProbeLegal,
            boundaryNextSegmentProbeExplored,
            boundaryNextSegmentProbeLegalTransitions,
            boundaryActualRows: valueTrainingRows.filter(
              (row) => String(row.labelKind).startsWith("actual-")).length,
            boundaryNextSegmentRows: valueTrainingRows.filter(
              (row) => row.labelKind === "actual-next-segment").length,
            boundaryFullDescendantRows: valueTrainingRows.filter(
              (row) => row.labelKind === "actual-full-descendant").length,
          },
        }
      : null,
    coarseCandidates: coarseCandidates.map((candidate) => ({
      isIncumbent: candidate.isIncumbent,
      valueShadow: candidate.valueShadow === true,
      coreDamage: candidate.coreDamage,
      totalDamage: candidate.totalDamage,
      dashCount: candidate.dashCount,
    })),
    options: {
      durationSeconds,
      rowBeamWidth,
      boundaryBeamWidth,
      coreFinalistCount,
      coarseCandidateLimit,
      coarseDashStates,
      finalDashCandidateCount,
      fullDashStates,
      useSuffixValue,
      suffixRepairPenaltyRows,
      boundaryDiagnosticCount,
      valueShadowPolicy: valueShadowPolicy
        ? {
            enabled: valueShadowPolicy.enabled === true,
            baselineQuota: Number(valueShadowPolicy.baselineQuota ?? 5),
            valueQuota: Number(valueShadowPolicy.valueQuota ?? 1),
            valueWeight: Number(valueShadowPolicy.valueWeight ?? 1),
            maximumBaselineRank: Number(valueShadowPolicy.maximumBaselineRank),
            modelKind: valueShadowPolicy.model?.kind ?? null,
            modelTrainingRows: valueShadowPolicy.model?.trainingRows ?? null,
          }
        : null,
      collectValueTrainingData,
      valueProbeMaximumBaselineRank,
      valueProbeRowStride,
      valueProbeNextSegmentBeamWidth,
    },
  };
}

export function optimizeLianyingAnchorDriftResynthesis(
  runtime,
  packs,
  {
    durationSeconds = 180,
    anchorSlackRows = 1,
    fixFirstAnchor = true,
    fixLastAnchor = true,
    rowBeamWidth = 32,
    boundaryBeamWidth = 16,
    coreFinalistCount = 16,
    coarseCandidateLimit = 5,
    coarseDashStates = 12,
    finalDashCandidateCount = 2,
    fullDashStates = 256,
    useSuffixValue = true,
    suffixRepairPenaltyRows = 1,
    boundaryDiagnosticCount = 3,
    onProgress = null,
  } = {},
) {
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  const incumbentPacks = clonePacks(packs);
  const incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const corePacks = stripLianyingDashPacks(incumbentPacks);
  const coreBaseline = replayWhitepaperLianying(runtime, corePacks, {
    durationSeconds,
  });
  const anchors = identifyLianyingThunderSegments(corePacks).anchors;
  if (anchors.length === 0) {
    return {
      packs: incumbentPacks,
      state: incumbent.state,
      baselineDamage: incumbent.state.totalDamage,
      damageGain: 0,
      accepted: false,
      anchors: [],
      selectedAnchors: [],
      segments: [],
      explored: 0,
      legal: 0,
    };
  }

  const driftOptions = {
    slackRows: anchorSlackRows,
    fixFirstAnchor,
    fixLastAnchor,
  };
  const firstAnchor = anchors[0];
  const prefixPacks = clonePacks(corePacks.slice(0, firstAnchor));
  const warmStates = buildWarmStates(runtime, corePacks, endTick);
  let warmState = warmStates[firstAnchor];
  let warmGeneratedPacks = [];
  let warmThunderCount = 0;
  let warmLineageId = "warm";
  let warmLineageBaseDamage = null;
  let warmLineageProjectedFinal = null;
  let nodes = [{
    state: warmState,
    packs: [],
    thunderCount: 0,
    anchorRows: [],
    lineageId: warmLineageId,
  }];
  let explored = 0;
  let legal = 0;
  let peakRowStates = 1;
  const anchorReports = [];
  const boundaryRows = new Map();
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const window = lianyingAnchorDriftWindow(
      anchors,
      anchorIndex,
      driftOptions,
    );
    boundaryRows.set(window.latest, anchorIndex);
  }
  const averageRowDamage =
    coreBaseline.state.totalDamage / Math.max(1, corePacks.length);

  for (let rowIndex = firstAnchor; rowIndex < corePacks.length; rowIndex += 1) {
    const candidates = new Map();
    for (const node of nodes) {
      for (const pack of legalMechanicalLianyingPacks(
        node.state,
        runtime.config,
      )) {
        if (!isLianyingAnchorDriftPackAllowed(
          pack,
          rowIndex,
          node.thunderCount,
          anchors,
          driftOptions,
        )) continue;
        explored += 1;
        try {
          const state = executeActionPack(
            node.state,
            pack,
            runtime.config,
            runtime.oracle,
            { endTick },
          );
          legal += 1;
          const hasThunder = lianyingPackHasAction(pack, "thunder");
          const thunderCount = node.thunderCount + Number(hasThunder);
          const candidate = {
            state,
            packs: [...node.packs, cloneLianyingPack(pack)],
            thunderCount,
            anchorRows: hasThunder
              ? [...node.anchorRows, rowIndex]
              : node.anchorRows,
            lineageId: node.lineageId,
            lineageBaseDamage: node.lineageBaseDamage,
            lineageProjectedFinal: node.lineageProjectedFinal,
          };
          const key = `${thunderCount}|${lianyingResynthesisStateKey(state)}`;
          const current = candidates.get(key);
          if (!current || state.totalDamage > current.state.totalDamage) {
            candidates.set(key, candidate);
          }
        } catch {
          // 完整状态机淘汰资源、冷却、充能和马上状态非法动作。
        }
      }
    }

    const warmPack = corePacks[rowIndex];
    if (!isLianyingAnchorDriftPackAllowed(
      warmPack,
      rowIndex,
      warmThunderCount,
      anchors,
      driftOptions,
    )) {
      throw new Error(`第${rowIndex + 1}行热启动轴不满足雷锚点漂移约束`);
    }
    warmState = executeActionPack(
      warmState,
      warmPack,
      runtime.config,
      runtime.oracle,
      { endTick },
    );
    warmGeneratedPacks = [
      ...warmGeneratedPacks,
      cloneLianyingPack(warmPack),
    ];
    const warmHasThunder = lianyingPackHasAction(warmPack, "thunder");
    warmThunderCount += Number(warmHasThunder);
    const warmAnchorRows = anchors.slice(0, warmThunderCount);
    const warmKey = lianyingResynthesisStateKey(warmState);
    const warmCompositeKey = `${warmThunderCount}|${warmKey}`;
    const currentWarm = candidates.get(warmCompositeKey);
    if (!currentWarm || warmState.totalDamage > currentWarm.state.totalDamage) {
      candidates.set(warmCompositeKey, {
        state: warmState,
        packs: warmGeneratedPacks,
        thunderCount: warmThunderCount,
        anchorRows: warmAnchorRows,
        lineageId: warmLineageId,
        lineageBaseDamage: warmLineageBaseDamage,
        lineageProjectedFinal: warmLineageProjectedFinal,
      });
    }
    nodes = selectAnchorDriftRowBeam(
      candidates.values(),
      rowBeamWidth,
      warmKey,
      warmState,
    );
    peakRowStates = Math.max(peakRowStates, nodes.length);
    if (nodes.length === 0) {
      throw new Error(`雷锚点漂移搜索在第${rowIndex + 1}行没有合法状态`);
    }

    if (!boundaryRows.has(rowIndex)) continue;
    const anchorIndex = boundaryRows.get(rowIndex);
    nodes = nodes.filter((node) => node.thunderCount >= anchorIndex + 1);
    const suffixPacks = corePacks.slice(rowIndex + 1);
    if (useSuffixValue) {
      nodes = nodes.map((node) => ({
        ...node,
        suffixValue: evaluateLianyingReferenceSuffixValue(
          runtime,
          node.state,
          suffixPacks,
          warmStates,
          rowIndex + 1,
          coreBaseline.state.totalDamage,
          {
            endTick,
            averageRowDamage,
            repairPenaltyRows: suffixRepairPenaltyRows,
          },
        ),
      }));
    }
    const schedulesBeforeBoundary = new Set(
      nodes.map((node) => JSON.stringify(node.anchorRows)),
    ).size;
    const pinnedScheduleKey = JSON.stringify(
      anchors.slice(0, anchorIndex + 1),
    );
    const boundary = selectAnchorDriftBoundaryNodes(
      nodes,
      boundaryBeamWidth,
      warmKey,
      pinnedScheduleKey,
      {
        scoreNode: useSuffixValue
          ? (node) => node.suffixValue.score
          : null,
      },
    );
    nodes = boundary.nodes;
    const window = lianyingAnchorDriftWindow(
      anchors,
      anchorIndex,
      driftOptions,
    );
    const actualRowHistogram = {};
    for (const node of nodes) {
      const row = node.anchorRows[anchorIndex];
      const label = String(Number(row) + 1);
      actualRowHistogram[label] = Number(actualRowHistogram[label] ?? 0) + 1;
    }
    const diagnostics = buildBoundaryDiagnostics(
      nodes,
      warmState,
      coreBaseline.state.totalDamage,
      boundaryDiagnosticCount,
    );
    const report = {
      id: `thunder-${anchorIndex + 1}-drift`,
      kind: "anchor-drift",
      anchorNumber: anchorIndex + 1,
      startIndex: window.earliest,
      endIndex: rowIndex,
      targetRow: window.target + 1,
      earliestRow: window.earliest + 1,
      latestRow: window.latest + 1,
      fixed: window.fixed,
      incomingSchedules: schedulesBeforeBoundary,
      outgoingStates: nodes.length,
      outgoingSchedules: new Set(
        nodes.map((node) => JSON.stringify(node.anchorRows)),
      ).size,
      availableSchedules: boundary.scheduleBuckets,
      actualRowHistogram,
      paretoStates: boundary.paretoCount,
      diversityBuckets: boundary.diversityBuckets,
      bestDamageGainAtBoundary:
        Math.max(...nodes.map((node) => node.state.totalDamage)) -
        warmState.totalDamage,
      suffixValueEnabled: useSuffixValue,
      referenceSuffixLegalCandidates: nodes.filter(
        (node) => node.suffixValue?.suffixLegal,
      ).length,
      bestProjectedFinalGain: Math.max(...nodes.map((node) =>
        Number(node.suffixValue?.projectedFinalDamage ?? node.state.totalDamage))) -
        coreBaseline.state.totalDamage,
      bestSuffixScoreGain: Math.max(...nodes.map((node) =>
        Number(node.suffixValue?.score ?? node.state.totalDamage))) -
        coreBaseline.state.totalDamage,
      candidateDiagnostics: diagnostics,
    };
    anchorReports.push(report);
    nodes = nodes.map((node, index) => ({
      ...node,
      lineageId: `anchor-${anchorIndex + 1}:${index + 1}`,
      lineageBaseDamage: node.state.totalDamage,
      lineageProjectedFinal:
        node.suffixValue?.projectedFinalDamage ?? node.state.totalDamage,
    }));
    const warmNode = nodes.find(
      (node) => lianyingResynthesisStateKey(node.state) === warmKey,
    );
    warmLineageId = warmNode?.lineageId ?? `anchor-${anchorIndex + 1}:warm`;
    warmLineageBaseDamage = warmNode?.lineageBaseDamage ?? warmState.totalDamage;
    warmLineageProjectedFinal =
      warmNode?.lineageProjectedFinal ?? coreBaseline.state.totalDamage;
    if (typeof onProgress === "function") {
      const { candidateDiagnostics: _diagnostics, ...progressReport } = report;
      onProgress({
        stage: "anchor-complete",
        anchor: anchorIndex + 1,
        anchorCount: anchors.length,
        ...progressReport,
      });
    }
  }

  nodes = nodes.filter((node) => node.thunderCount === anchors.length);
  const warmFinalKey = lianyingResynthesisStateKey(warmState);
  nodes = selectAnchorDriftBoundaryNodes(
    nodes,
    boundaryBeamWidth,
    warmFinalKey,
    JSON.stringify(anchors),
  ).nodes;
  const coreCandidatesByPath = new Map();
  const addCoreCandidate = (candidate) => {
    const key = JSON.stringify(candidate.packs);
    const current = coreCandidatesByPath.get(key);
    if (!current || candidate.coreDamage > current.coreDamage) {
      coreCandidatesByPath.set(key, candidate);
    }
  };
  addCoreCandidate({
    packs: corePacks,
    coreDamage: coreBaseline.state.totalDamage,
    isIncumbent: true,
    anchorRows: anchors,
  });
  for (const node of [...nodes]
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, coreFinalistCount)) {
    const candidatePacks = [...prefixPacks, ...clonePacks(node.packs)];
    try {
      const replay = replayWhitepaperLianying(runtime, candidatePacks, {
        durationSeconds,
      });
      addCoreCandidate({
        packs: candidatePacks,
        coreDamage: replay.state.totalDamage,
        isIncumbent: JSON.stringify(candidatePacks) === JSON.stringify(corePacks),
        anchorRows: node.anchorRows,
      });
    } catch {
      // 完整180秒重放仍是最终合法性门槛。
    }
  }

  const selectedCore = selectAnchorDriftCoreCandidates(
    coreCandidatesByPath.values(),
    coarseCandidateLimit,
  );
  const coarseCandidates = selectedCore.map((candidate, index) => {
    if (typeof onProgress === "function") {
      onProgress({
        stage: "dash-coarse",
        candidate: index + 1,
        candidateCount: selectedCore.length,
        isIncumbent: candidate.isIncumbent,
        anchorRows: candidate.anchorRows.map((row) => row + 1),
      });
    }
    if (candidate.isIncumbent) {
      return {
        ...candidate,
        packs: incumbentPacks,
        totalDamage: incumbent.state.totalDamage,
        dashCount: incumbent.state.timeline.filter(
          (event) => event.type === "offGcd" && event.action === "dash",
        ).length,
      };
    }
    const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
      durationSeconds,
      maxStatesPerRow: coarseDashStates,
    });
    return {
      ...candidate,
      packs: dash.packs,
      totalDamage: dash.state.totalDamage,
      dashCount: dash.dashCount,
    };
  });
  const selectedFinal = selectFinalDashCandidates(
    coarseCandidates,
    finalDashCandidateCount,
  );
  const finalCandidates = selectedFinal.map((candidate, index) => {
    if (typeof onProgress === "function") {
      onProgress({
        stage: "dash-final",
        candidate: index + 1,
        candidateCount: selectedFinal.length,
        isIncumbent: candidate.isIncumbent,
        anchorRows: candidate.anchorRows.map((row) => row + 1),
      });
    }
    if (candidate.isIncumbent) {
      return { ...candidate, state: incumbent.state };
    }
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
  }).sort((left, right) => right.totalDamage - left.totalDamage);

  const best = finalCandidates[0];
  const accepted = Boolean(best && best.totalDamage > incumbent.state.totalDamage);
  const selectedAnchorRows = accepted ? best.anchorRows : anchors;
  return {
    packs: accepted ? best.packs : incumbentPacks,
    state: accepted ? best.state : incumbent.state,
    baselineDamage: incumbent.state.totalDamage,
    damageGain: accepted ? best.totalDamage - incumbent.state.totalDamage : 0,
    accepted,
    anchors: anchors.map((row) => row + 1),
    selectedAnchors: selectedAnchorRows.map((row) => row + 1),
    segments: anchorReports,
    explored,
    legal,
    peakRowStates,
    finalBoundaryStates: nodes.length,
    finalSchedules: new Set(
      nodes.map((node) => JSON.stringify(node.anchorRows)),
    ).size,
    coreCandidates: coreCandidatesByPath.size,
    coarseCandidates: coarseCandidates.map((candidate) => ({
      isIncumbent: candidate.isIncumbent,
      anchorRows: candidate.anchorRows.map((row) => row + 1),
      coreDamage: candidate.coreDamage,
      totalDamage: candidate.totalDamage,
      dashCount: candidate.dashCount,
    })),
    options: {
      durationSeconds,
      anchorSlackRows,
      fixFirstAnchor,
      fixLastAnchor,
      rowBeamWidth,
      boundaryBeamWidth,
      coreFinalistCount,
      coarseCandidateLimit,
      coarseDashStates,
      finalDashCandidateCount,
      fullDashStates,
      useSuffixValue,
      lineageLongTermScoring: true,
      suffixRepairPenaltyRows,
      boundaryDiagnosticCount,
    },
  };
}

function csvCell(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function lianyingMultiSegmentAnchorDiagnosticsToCsv(result) {
  const headers = [
    "区段",
    "边界行",
    "候选排名",
    "当前累计伤害差",
    "预计最终伤害差",
    "参考后缀合法",
    "参考后缀完成行",
    "参考后缀总行",
    "首次失败原因",
    "战意差",
    "龙驭差",
    "马上状态变化",
    "流血层数差",
    "流血品质差",
    "冷却剩余毫秒差",
    "增益剩余毫秒差",
    "充能差",
  ];
  const rows = [headers];
  for (const segment of result.segments ?? []) {
    for (const diagnostic of segment.candidateDiagnostics ?? []) {
      rows.push([
        segment.id,
        segment.endIndex + 1,
        diagnostic.rank,
        diagnostic.currentDamageGain,
        diagnostic.projectedFinalGain,
        diagnostic.suffixLegal,
        diagnostic.suffixCompletedRows,
        diagnostic.suffixTotalRows,
        diagnostic.suffixFailure ?? "",
        diagnostic.stateDelta.rage,
        diagnostic.stateDelta.dragonRideStacks,
        diagnostic.stateDelta.mountedChanged,
        diagnostic.stateDelta.bleedStacks,
        diagnostic.stateDelta.bleedQuality,
        diagnostic.stateDelta.cooldownRemainingMs,
        diagnostic.stateDelta.buffRemainingMs,
        diagnostic.stateDelta.charges,
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function lianyingAnchorDriftScheduleToCsv(result) {
  const rows = [[
    "雷序号",
    "原锚点行",
    "最早行",
    "最晚行",
    "固定锚点",
    "入站坐标组合数",
    "压缩前可用坐标组合数",
    "出站状态数",
    "出站坐标组合数",
    "实际坐标分布",
    "边界最高累计伤害差",
    "最高后缀评分差",
  ]];
  for (const segment of result.segments ?? []) {
    if (segment.kind !== "anchor-drift") continue;
    rows.push([
      segment.anchorNumber,
      segment.targetRow,
      segment.earliestRow,
      segment.latestRow,
      segment.fixed,
      segment.incomingSchedules,
      segment.availableSchedules,
      segment.outgoingStates,
      segment.outgoingSchedules,
      segment.actualRowHistogram,
      segment.bestDamageGainAtBoundary,
      segment.bestSuffixScoreGain,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
