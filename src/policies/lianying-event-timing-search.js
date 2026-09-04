import { frameToTicks, gcdLockTicks, millisecondsToTicks } from
  "../engine/clock.js";
import { executeActionPack } from "../engine/simulator.js";
import { createInitialState } from "../engine/state.js";
import {
  cloneLianyingPack,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import { replayWhitepaperLianying } from "./whitepaper-lianying.js";

const MOVABLE_ACTIONS = new Set([
  "thunder",
  "orange",
  "charge",
  "dismount",
]);

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function primaryTiming(pack, config) {
  const primary = typeof pack?.primary === "string"
    ? { id: pack.primary }
    : pack?.primary;
  if (!primary || primary.id === "wait") return null;
  return {
    lockFrames: Number(primary.lockFrames ?? config.gcdFrames),
    latencyMs: Number(primary.latencyMs ?? config.latencyMs ?? 0),
  };
}

function eventTicks(state) {
  const entries = [
    ["autoAttack", state.autoAttackNextTick],
    ["bleedTick", state.bleedNextTick],
    ["orangeReady", state.cooldownReadyTick?.orange],
    ["chargeReady", state.cooldownReadyTick?.charge],
    ["thunderRecharge", state.chargeTicks?.thunder?.rechargeQueue?.[0]],
    ["thunderExpire", state.buffTicks?.thunderUntil],
    ["orangeExpire", state.buffTicks?.orangeUntil],
    ["rideExpire", state.buffTicks?.rideUntil],
    ["bleedExpire", state.buffTicks?.bleedUntil],
    ["breakArmyExpire", state.buffTicks?.breakArmyUntil],
  ];
  return entries.filter(([, tick]) => Number.isSafeInteger(tick) && tick > 0);
}

export function lianyingEventBreakpointLeads(state, pack, config) {
  const timing = primaryTiming(pack, config);
  if (!timing) return [];
  const decisionTick = Math.max(state.tick, state.gcdReadyTick);
  const nextDecisionTick = decisionTick + gcdLockTicks(
    timing.lockFrames,
    timing.latencyMs,
  );
  const frameTicks = frameToTicks(1);
  const maximumLead = Math.floor(
    (nextDecisionTick - decisionTick) / frameTicks,
  );
  const candidates = new Map();
  for (const [eventKind, eventTick] of eventTicks(state)) {
    for (const deltaFrames of [-1, 0, 1]) {
      const targetTick = eventTick + frameToTicks(deltaFrames);
      const rawLead = (nextDecisionTick - targetTick) / frameTicks;
      for (const leadFrames of [Math.floor(rawLead), Math.ceil(rawLead)]) {
        if (
          !Number.isInteger(leadFrames) ||
          leadFrames < 1 ||
          leadFrames > maximumLead
        ) continue;
        const activationTick = nextDecisionTick - frameToTicks(leadFrames);
        const current = candidates.get(leadFrames) ?? {
          leadFrames,
          activationTick,
          eventKinds: [],
        };
        current.eventKinds.push(`${eventKind}${deltaFrames >= 0 ? "+" : ""}${deltaFrames}`);
        candidates.set(leadFrames, current);
      }
    }
  }
  return [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      eventKinds: [...new Set(candidate.eventKinds)].sort(),
    }))
    .sort((left, right) => right.leadFrames - left.leadFrames);
}

function buildPrefixStates(runtime, packs, durationSeconds) {
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  let state = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  const states = [state];
  for (const pack of packs) {
    state = executeActionPack(
      state,
      pack,
      runtime.config,
      runtime.oracle,
      { endTick },
    );
    states.push(state);
  }
  return states;
}

function actionOccurrences(pack) {
  return [
    ...(pack?.prefix ?? []).flatMap((action, index) =>
      MOVABLE_ACTIONS.has(actionId(action))
        ? [{ location: "prefix", index, id: actionId(action), action }]
        : []),
    ...(pack?.tail ?? []).flatMap((action, index) =>
      MOVABLE_ACTIONS.has(actionId(action))
        ? [{ location: "tail", index, id: actionId(action), action }]
        : []),
  ];
}

function moveOccurrence(pack, occurrence, target) {
  const next = cloneLianyingPack(pack);
  delete next.label;
  next.prefix = [...(next.prefix ?? [])];
  next.tail = [...(next.tail ?? [])];
  const [removed] = next[occurrence.location].splice(occurrence.index, 1);
  const action = {
    ...(typeof removed === "string" ? { id: removed } : removed),
  };
  delete action.leadFrames;
  if (target.location === "prefix") {
    next.prefix.push(action);
  } else {
    next.tail.push({ ...action, leadFrames: target.leadFrames });
  }
  return next;
}

export function generateLianyingEventTimingMutations(
  runtime,
  packs,
  { durationSeconds = 180 } = {},
) {
  const corePacks = stripLianyingDashPacks(packs);
  const prefixStates = buildPrefixStates(runtime, corePacks, durationSeconds);
  const mutations = new Map();
  for (let rowIndex = 0; rowIndex < corePacks.length; rowIndex += 1) {
    const pack = corePacks[rowIndex];
    const leads = lianyingEventBreakpointLeads(
      prefixStates[rowIndex],
      pack,
      runtime.config,
    );
    if (leads.length === 0) continue;
    for (const occurrence of actionOccurrences(pack)) {
      const targets = [
        { location: "prefix", leadFrames: null, eventKinds: ["gcdStart"] },
        ...leads.map((lead) => ({ location: "tail", ...lead })),
      ];
      for (const target of targets) {
        const currentLead = occurrence.location === "tail"
          ? Number(
              typeof occurrence.action === "string"
                ? 1
                : occurrence.action.leadFrames ?? 1,
            )
          : null;
        if (
          occurrence.location === target.location &&
          (target.location === "prefix" || currentLead === target.leadFrames)
        ) continue;
        const candidatePacks = corePacks.map(cloneLianyingPack);
        candidatePacks[rowIndex] = moveOccurrence(pack, occurrence, target);
        const key = JSON.stringify(candidatePacks);
        if (mutations.has(key)) continue;
        mutations.set(key, {
          rowNumber: rowIndex + 1,
          action: occurrence.id,
          sourceLocation: occurrence.location,
          sourceLeadFrames: currentLead,
          targetLocation: target.location,
          targetLeadFrames: target.leadFrames,
          eventKinds: target.eventKinds,
          packs: candidatePacks,
        });
      }
    }
  }
  return [...mutations.values()];
}

function eventCount(state, type) {
  return (state.timeline ?? []).filter((event) => event.type === type).length;
}

export function searchLianyingEventTimingBreakpoints(
  runtime,
  packs,
  { durationSeconds = 180, preserveEventCounts = true } = {},
) {
  const corePacks = stripLianyingDashPacks(packs);
  const baseline = replayWhitepaperLianying(runtime, corePacks, {
    durationSeconds,
  });
  const baselineCastCount = eventCount(baseline.state, "cast");
  const baselineOffGcdCount = eventCount(baseline.state, "offGcd");
  const mutations = generateLianyingEventTimingMutations(runtime, corePacks, {
    durationSeconds,
  });
  const candidates = [];
  let legal = 0;
  let preservedEventCounts = 0;
  for (const mutation of mutations) {
    try {
      const replay = replayWhitepaperLianying(runtime, mutation.packs, {
        durationSeconds,
      });
      legal += 1;
      const castCount = eventCount(replay.state, "cast");
      const offGcdCount = eventCount(replay.state, "offGcd");
      const preservesCounts =
        castCount === baselineCastCount && offGcdCount === baselineOffGcdCount;
      if (preservesCounts) preservedEventCounts += 1;
      if (preserveEventCounts && !preservesCounts) continue;
      candidates.push({
        ...mutation,
        state: replay.state,
        castCount,
        offGcdCount,
        damageGain: replay.state.totalDamage - baseline.state.totalDamage,
      });
    } catch {
      // 同一状态机淘汰冷却、充能、资源、骑乘或时点非法候选。
    }
  }
  candidates.sort((left, right) =>
    right.state.totalDamage - left.state.totalDamage ||
    left.rowNumber - right.rowNumber ||
    String(left.action).localeCompare(String(right.action)) ||
    Number(left.targetLeadFrames ?? 0) - Number(right.targetLeadFrames ?? 0),
  );
  return {
    baseline,
    baselineCastCount,
    baselineOffGcdCount,
    explored: mutations.length,
    legal,
    preservedEventCounts,
    candidates,
    best: candidates[0] ?? null,
  };
}

export function searchLianyingCompoundEventTimings(
  runtime,
  baselinePacks,
  singleCandidates,
  {
    durationSeconds = 180,
    seedLimit = 12,
    minimumSingleGain = 1e-6,
  } = {},
) {
  const seeds = (singleCandidates ?? [])
    .filter((candidate) => candidate.damageGain > minimumSingleGain)
    .slice(0, Math.max(0, Math.floor(Number(seedLimit))));
  return searchLianyingEventTimingSeedPairs(runtime, baselinePacks, seeds, {
    durationSeconds,
  });
}

function timingOrder(candidate) {
  if (candidate.targetLocation === "prefix") return 1_000_000;
  return Number(candidate.targetLeadFrames ?? 0);
}

export function compressLianyingEventTimingPlatforms(
  singleCandidates,
  {
    maximumSingleLoss = 500_000,
    representativesPerPlatform = 2,
    seedLimit = 32,
  } = {},
) {
  const maximumLoss = Math.max(0, Number(maximumSingleLoss));
  const representativeLimit = Math.min(2, Math.max(
    1,
    Math.floor(Number(representativesPerPlatform)),
  ));
  const groups = new Map();
  for (const candidate of singleCandidates ?? []) {
    if (candidate.damageGain > 1e-6) continue;
    if (candidate.damageGain < -maximumLoss) continue;
    const damagePlateau = Math.round(Number(candidate.damageGain));
    const key = [
      candidate.rowNumber,
      candidate.action,
      candidate.sourceLocation,
      candidate.sourceLeadFrames ?? "start",
      damagePlateau,
    ].join(":");
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const representatives = [];
  for (const group of groups.values()) {
    group.sort((left, right) =>
      timingOrder(right) - timingOrder(left) ||
      String(left.targetLocation).localeCompare(String(right.targetLocation)) ||
      Number(left.targetLeadFrames ?? 0) - Number(right.targetLeadFrames ?? 0));
    const indices = representativeLimit === 1 || group.length === 1
      ? [0]
      : [0, group.length - 1];
    for (const index of indices.slice(0, representativeLimit)) {
      if (!representatives.includes(group[index])) {
        representatives.push(group[index]);
      }
    }
  }
  representatives.sort((left, right) =>
    right.damageGain - left.damageGain ||
    left.rowNumber - right.rowNumber ||
    String(left.action).localeCompare(String(right.action)) ||
    timingOrder(right) - timingOrder(left));
  return representatives.slice(0, Math.max(0, Math.floor(Number(seedLimit))));
}

function searchLianyingEventTimingSeedPairs(
  runtime,
  baselinePacks,
  seeds,
  { durationSeconds = 180 } = {},
) {
  const corePacks = stripLianyingDashPacks(baselinePacks);
  const baseline = replayWhitepaperLianying(runtime, corePacks, {
    durationSeconds,
  });
  const baselineCastCount = eventCount(baseline.state, "cast");
  const baselineOffGcdCount = eventCount(baseline.state, "offGcd");
  const candidates = [];
  let explored = 0;
  let legal = 0;
  for (let leftIndex = 0; leftIndex < seeds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < seeds.length; rightIndex += 1) {
      const left = seeds[leftIndex];
      const right = seeds[rightIndex];
      if (
        left.rowNumber === right.rowNumber &&
        left.action === right.action
      ) continue;
      explored += 1;
      const packs = combineLianyingEventTimingMutations(
        corePacks,
        [left, right],
      );
      try {
        const replay = replayWhitepaperLianying(runtime, packs, {
          durationSeconds,
        });
        legal += 1;
        const castCount = eventCount(replay.state, "cast");
        const offGcdCount = eventCount(replay.state, "offGcd");
        if (
          castCount !== baselineCastCount ||
          offGcdCount !== baselineOffGcdCount
        ) continue;
        candidates.push({
          mutations: [left, right],
          packs,
          state: replay.state,
          damageGain: replay.state.totalDamage - baseline.state.totalDamage,
          synergyGain: replay.state.totalDamage - baseline.state.totalDamage -
            left.damageGain - right.damageGain,
        });
      } catch {
        // 两处单点均合法不保证组合后的冷却、资源和骑乘状态仍合法。
      }
    }
  }
  candidates.sort((left, right) =>
    right.state.totalDamage - left.state.totalDamage);
  return {
    baseline,
    seeds,
    explored,
    legal,
    candidates,
    best: candidates[0] ?? null,
  };
}

export function combineLianyingEventTimingMutations(
  baselinePacks,
  mutations,
) {
  const packs = stripLianyingDashPacks(baselinePacks).map(cloneLianyingPack);
  const seen = new Set();
  for (const mutation of mutations ?? []) {
    const rowIndex = Number(mutation.rowNumber) - 1;
    const key = `${rowIndex}:${mutation.action}`;
    if (seen.has(key)) {
      throw new Error("同一行同一动作不能同时采用两个事件时点");
    }
    seen.add(key);
    const sourcePack = mutation.packs?.[rowIndex];
    if (!sourcePack || !packs[rowIndex]) {
      throw new Error("事件时点变换缺少对应动作包");
    }
    let target = null;
    let targetLocation = null;
    for (const location of ["prefix", "tail"]) {
      const occurrence = (sourcePack[location] ?? []).find(
        (action) => actionId(action) === mutation.action,
      );
      if (occurrence !== undefined) {
        target = structuredClone(occurrence);
        targetLocation = location;
        break;
      }
    }
    if (!targetLocation) throw new Error("事件时点变换未找到目标动作");
    const pack = packs[rowIndex];
    pack.prefix = (pack.prefix ?? []).filter(
      (action) => actionId(action) !== mutation.action,
    );
    pack.tail = (pack.tail ?? []).filter(
      (action) => actionId(action) !== mutation.action,
    );
    pack[targetLocation].push(target);
    delete pack.label;
  }
  return packs;
}

export function searchLianyingNeutralCompoundEventTimings(
  runtime,
  baselinePacks,
  singleCandidates,
  {
    durationSeconds = 180,
    maximumSingleLoss = 500_000,
    representativesPerPlatform = 2,
    seedLimit = 32,
  } = {},
) {
  const seeds = compressLianyingEventTimingPlatforms(singleCandidates, {
    maximumSingleLoss,
    representativesPerPlatform,
    seedLimit,
  });
  return searchLianyingEventTimingSeedPairs(runtime, baselinePacks, seeds, {
    durationSeconds,
  });
}
