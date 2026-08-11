import { executeActionPack } from "../engine/simulator.js";
import { millisecondsToTicks } from "../engine/clock.js";
import {
  createInitialState,
  isBuffActiveAtTick,
  isMountedAtTick,
} from "../engine/state.js";
import {
  legalMechanicalLianyingPacks,
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";

function actionId(action) {
  return typeof action === "string" ? action : action.id;
}

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

function stripDash(pack) {
  const next = clonePack(pack);
  next.prefix = next.prefix.filter((action) => actionId(action) !== "dash");
  next.tail = next.tail.filter((action) => actionId(action) !== "dash");
  return next;
}

function stripDashPacks(packs) {
  return packs.map(stripDash);
}

function packHasAction(pack, id) {
  return [...(pack.prefix ?? []), ...(pack.tail ?? [])].some(
    (action) => actionId(action) === id,
  );
}

function thunderRows(packs) {
  return packs
    .map((pack, index) => (packHasAction(pack, "thunder") ? index + 1 : null))
    .filter(Boolean);
}

function decisionTick(state) {
  return Math.max(state.tick, state.gcdReadyTick);
}

function currentThunderContext(state, tick) {
  if (!isBuffActiveAtTick(state, "thunder", tick)) return null;
  const start = [...state.timeline]
    .reverse()
    .find(
      (event) =>
        event.type === "offGcd" &&
        event.action === "thunder" &&
        event.tick <= tick,
    );
  if (!start) return null;
  const events = state.timeline.filter((event) => event.sequence > start.sequence);
  return [
    Number(start.dragonRideStacksAtStart ?? state.dragonRideStacks),
    events.filter(
      (event) => event.type === "cast" && event.action === "dragonFang",
    ).length,
    events.some(
      (event) => event.type === "cast" && event.action === "dragonRoar",
    ),
    events.some(
      (event) => event.type === "offGcd" && event.action === "charge",
    ),
  ];
}

function segmentStateKey(state) {
  const tick = decisionTick(state);
  return JSON.stringify([
    state.tick,
    state.gcdReadyTick,
    state.rage,
    state.bleedStacks,
    state.bleedQuality,
    state.bleedNextTick,
    state.autoAttackNextTick,
    state.dragonRideStacks,
    state.mounted,
    state.mountedFromTick,
    state.executeDestroyToggle,
    state.cooldownReadyTick,
    state.buffTicks,
    state.chargeTicks,
    currentThunderContext(state, tick),
  ]);
}

function segmentDiversityKey(state) {
  const tick = decisionTick(state);
  return JSON.stringify([
    state.rage,
    Math.floor(state.dragonRideStacks / 3),
    isMountedAtTick(state, tick),
    isBuffActiveAtTick(state, "thunder", tick),
    isBuffActiveAtTick(state, "orange", tick),
    isBuffActiveAtTick(state, "ride", tick),
    state.chargeTicks.thunder.ready,
    state.chargeTicks.ride.ready,
    Number(state.cooldownReadyTick.destroy ?? 0) <= tick,
    Number(state.cooldownReadyTick.dragonRoar ?? 0) <= tick,
    Number(state.cooldownReadyTick.charge ?? 0) <= tick,
    state.executeDestroyToggle,
  ]);
}

function remainingTicks(readyTick, tick) {
  return Math.max(0, Number(readyTick ?? 0) - tick);
}

function queueRemainingTicks(pool, tick) {
  return (pool?.rechargeQueue ?? []).map((readyTick) =>
    remainingTicks(readyTick, tick));
}

// 区段内部的最高即时伤害状态经常已经透支了下一段需要的冷却、充能或战意。
// 这个距离只用于保留一部分能重新接回原轴的“桥接状态”，不参与最终伤害判定。
export function lianyingBoundaryStateDistance(state, target) {
  const tick = decisionTick(state);
  const targetTick = decisionTick(target);
  let distance = Math.abs(tick - targetTick) / 1000;
  distance += Math.abs(state.rage - target.rage) * 20;
  distance += Math.abs(state.dragonRideStacks - target.dragonRideStacks) * 16;
  distance += Math.abs(state.bleedStacks - target.bleedStacks) * 12;
  distance += Math.abs(state.bleedQuality - target.bleedQuality) * 20;
  distance += state.executeDestroyToggle === target.executeDestroyToggle ? 0 : 30;
  distance += isMountedAtTick(state, tick) === isMountedAtTick(target, targetTick)
    ? 0
    : 80;

  for (const name of ["destroy", "dragonRoar", "charge", "orange"]) {
    distance += Math.abs(
      remainingTicks(state.cooldownReadyTick[name], tick) -
        remainingTicks(target.cooldownReadyTick[name], targetTick),
    ) / 1000;
  }
  for (const name of ["thunder", "orange", "ride", "breakArmy", "poLouLan"]) {
    distance += Math.abs(
      remainingTicks(state.buffTicks[`${name}Until`], tick) -
        remainingTicks(target.buffTicks[`${name}Until`], targetTick),
    ) / 1000;
  }
  for (const name of ["thunder", "ride"]) {
    const pool = state.chargeTicks[name];
    const targetPool = target.chargeTicks[name];
    distance += Math.abs(pool.ready - targetPool.ready) * 50;
    const queue = queueRemainingTicks(pool, tick);
    const targetQueue = queueRemainingTicks(targetPool, targetTick);
    distance += Math.abs(queue.length - targetQueue.length) * 50;
    for (let index = 0; index < Math.max(queue.length, targetQueue.length); index += 1) {
      distance += Math.abs(
        Number(queue[index] ?? 0) - Number(targetQueue[index] ?? 0),
      ) / 1000;
    }
  }
  distance += Math.abs(
    remainingTicks(state.bleedNextTick, tick) -
      remainingTicks(target.bleedNextTick, targetTick),
  ) / 1000;
  const context = currentThunderContext(state, tick);
  const targetContext = currentThunderContext(target, targetTick);
  distance += JSON.stringify(context) === JSON.stringify(targetContext) ? 0 : 50;
  return distance;
}

function selectSegmentBeam(
  nodes,
  beamWidth,
  pinnedKey,
  boundaryTarget,
  lineageKey = null,
) {
  const sorted = [...nodes].sort(
    (left, right) => right.state.totalDamage - left.state.totalDamage,
  );
  const selected = [];
  const selectedNodes = new Set();
  const add = (node) => {
    if (!node || selectedNodes.has(node) || selected.length >= beamWidth) return;
    selected.push(node);
    selectedNodes.add(node);
  };
  const damageQuota = Math.max(1, Math.floor(beamWidth / 3));
  const diversityQuota = Math.max(damageQuota, Math.floor((beamWidth * 2) / 3));
  for (const node of sorted.slice(0, damageQuota)) add(node);

  if (typeof lineageKey === "function") {
    const lineages = new Set();
    for (const node of sorted) {
      const lineage = lineageKey(node);
      if (lineages.has(lineage)) continue;
      lineages.add(lineage);
      add(node);
      if (selected.length >= Math.max(damageQuota, Math.floor(beamWidth / 2))) {
        break;
      }
    }
    if (boundaryTarget) {
      const boundaryLineages = new Set();
      const closestByBoundary = [...sorted].sort((left, right) => {
        const difference =
          lianyingBoundaryStateDistance(left.state, boundaryTarget) -
          lianyingBoundaryStateDistance(right.state, boundaryTarget);
        return difference || right.state.totalDamage - left.state.totalDamage;
      });
      for (const node of closestByBoundary) {
        const lineage = lineageKey(node);
        if (boundaryLineages.has(lineage)) continue;
        boundaryLineages.add(lineage);
        add(node);
      }
    }
  }

  const buckets = new Set();
  for (const node of sorted) {
    const bucket = segmentDiversityKey(node.state);
    if (buckets.has(bucket)) continue;
    buckets.add(bucket);
    add(node);
    if (selected.length >= diversityQuota) break;
  }
  if (boundaryTarget) {
    const distances = new Map(
      sorted.map((node) => [
        node,
        lianyingBoundaryStateDistance(node.state, boundaryTarget),
      ]),
    );
    const closest = [...sorted].sort((left, right) => {
      const difference =
        distances.get(left) - distances.get(right);
      return difference || right.state.totalDamage - left.state.totalDamage;
    });
    for (const node of closest) {
      add(node);
      if (selected.length >= beamWidth) break;
    }
  }
  for (const node of sorted) {
    if (selected.length >= beamWidth) break;
    add(node);
  }
  const pinnedKeys = (Array.isArray(pinnedKey) ? pinnedKey : [pinnedKey])
    .filter(Boolean);
  for (const key of pinnedKeys) {
    if (selected.some((node) => segmentStateKey(node.state) === key)) continue;
    const pinned = sorted.find((node) => segmentStateKey(node.state) === key);
    if (!pinned) continue;
    if (selected.length < beamWidth) {
      selected.push(pinned);
      selectedNodes.add(pinned);
      continue;
    }
    const lineageCounts = typeof lineageKey === "function"
      ? selected.reduce((counts, node) => {
        const lineage = lineageKey(node);
        counts.set(lineage, Number(counts.get(lineage) ?? 0) + 1);
        return counts;
      }, new Map())
      : null;
    const replacementIndex = selected.findLastIndex((node) => {
      if (pinnedKeys.includes(segmentStateKey(node.state))) return false;
      if (!lineageCounts) return true;
      return Number(lineageCounts.get(lineageKey(node)) ?? 0) > 1;
    });
    if (replacementIndex >= 0) {
      selectedNodes.delete(selected[replacementIndex]);
      selected[replacementIndex] = pinned;
      selectedNodes.add(pinned);
    }
  }
  return selected;
}

function selectSegmentFinalists(
  nodes,
  finalistCount,
  warmState,
  lineageKey = null,
) {
  const sorted = [...nodes].sort(
    (left, right) => right.state.totalDamage - left.state.totalDamage,
  );
  const selected = [];
  const selectedNodes = new Set();
  const add = (node) => {
    if (!node || selectedNodes.has(node) || selected.length >= finalistCount) return;
    selected.push(node);
    selectedNodes.add(node);
  };
  const damageQuota = Math.max(1, Math.floor(finalistCount / 3));
  for (const node of sorted.slice(0, damageQuota)) add(node);

  if (typeof lineageKey === "function") {
    const lineages = new Set();
    for (const node of sorted) {
      const lineage = lineageKey(node);
      if (lineages.has(lineage)) continue;
      lineages.add(lineage);
      add(node);
    }
    const closestLineages = new Set();
    const closestByBoundary = [...sorted].sort((left, right) => {
      const difference =
        lianyingBoundaryStateDistance(left.state, warmState) -
        lianyingBoundaryStateDistance(right.state, warmState);
      return difference || right.state.totalDamage - left.state.totalDamage;
    });
    for (const node of closestByBoundary) {
      const lineage = lineageKey(node);
      if (closestLineages.has(lineage)) continue;
      closestLineages.add(lineage);
      add(node);
    }
  }

  // 束搜索中保留下来的边界近邻必须真正进入后缀合法性验证；如果最后仍只取
  // 段内伤害最高状态，边界连续性配额就会在最后一层失效。
  const boundaryQuota = Math.max(damageQuota, Math.floor((finalistCount * 2) / 3));
  const closest = [...sorted].sort((left, right) => {
    const difference =
      lianyingBoundaryStateDistance(left.state, warmState) -
      lianyingBoundaryStateDistance(right.state, warmState);
    return difference || right.state.totalDamage - left.state.totalDamage;
  });
  for (const node of closest) {
    add(node);
    if (selected.length >= boundaryQuota) break;
  }

  const diversity = new Set();
  for (const node of sorted) {
    const key = segmentDiversityKey(node.state);
    if (diversity.has(key)) continue;
    diversity.add(key);
    add(node);
    if (selected.length >= finalistCount) break;
  }
  for (const node of sorted) add(node);

  const warmKey = segmentStateKey(warmState);
  if (!selected.some((node) => segmentStateKey(node.state) === warmKey)) {
    const warm = sorted.find((node) => segmentStateKey(node.state) === warmKey);
    if (warm) selected.push(warm);
  }
  return selected;
}

// 多区段联合搜索复用同一套动作克隆、状态去重和行内束选择，避免两种
// 重合成器对“同一机制状态”的定义发生漂移。
export {
  clonePack as cloneLianyingPack,
  decisionTick as lianyingDecisionTick,
  packHasAction as lianyingPackHasAction,
  segmentDiversityKey as lianyingResynthesisDiversityKey,
  segmentStateKey as lianyingResynthesisStateKey,
  selectSegmentBeam as selectLianyingResynthesisBeam,
  stripDashPacks as stripLianyingDashPacks,
};

export function identifyLianyingThunderSegments(
  packs,
  { minimumRows = 3, includeOpener = false, includeTail = true } = {},
) {
  const anchors = packs
    .map((pack, index) => (packHasAction(pack, "thunder") ? index : -1))
    .filter((index) => index >= 0);
  const ranges = [];
  if (includeOpener && anchors[0] >= minimumRows) {
    ranges.push({
      id: "opener",
      kind: "opener",
      startIndex: 0,
      endIndex: anchors[0],
      rowCount: anchors[0],
    });
  }
  for (let index = 0; index + 1 < anchors.length; index += 1) {
    const startIndex = anchors[index];
    const endIndex = anchors[index + 1];
    if (endIndex - startIndex < minimumRows) continue;
    ranges.push({
      id: `thunder-${index + 1}-to-${index + 2}`,
      kind: "between-thunders",
      startIndex,
      endIndex,
      rowCount: endIndex - startIndex,
      startThunderNumber: index + 1,
      endThunderNumber: index + 2,
    });
  }
  if (includeTail && anchors.length > 0) {
    const startIndex = anchors.at(-1);
    if (packs.length - startIndex >= minimumRows) {
      ranges.push({
        id: `thunder-${anchors.length}-to-end`,
        kind: "tail",
        startIndex,
        endIndex: packs.length,
        rowCount: packs.length - startIndex,
        startThunderNumber: anchors.length,
      });
    }
  }
  return { anchors, ranges };
}

function buildPrefixStates(runtime, packs, endTick) {
  let state = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  const states = [state];
  for (const pack of packs) {
    if (decisionTick(state) < endTick) {
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

function replaySuffixFromState(
  runtime,
  initialState,
  packs,
  startIndex,
  endTick,
) {
  let state = initialState;
  for (let index = startIndex; index < packs.length; index += 1) {
    if (decisionTick(state) >= endTick) break;
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
        failureReason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { legal: true, state, failureIndex: null, failureReason: null };
}

export function lianyingAdaptiveSuffixEndIndex({
  currentEndIndex,
  initialEndIndex,
  failureIndices,
  packCount,
  lookaheadRows = 4,
  maximumAddedRows = 16,
}) {
  const failures = failureIndices
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= currentEndIndex);
  if (failures.length === 0) return null;
  const firstFailureIndex = Math.min(...failures);
  const hardLimit = Math.min(
    Number(packCount),
    Number(initialEndIndex) + Math.max(0, Number(maximumAddedRows)),
  );
  const nextEndIndex = Math.min(
    hardLimit,
    firstFailureIndex + 1 + Math.max(0, Number(lookaheadRows)),
  );
  return nextEndIndex > currentEndIndex ? nextEndIndex : null;
}

export function synthesizeLianyingSegment(
  runtime,
  basePacks,
  prefixState,
  segment,
  {
    durationSeconds = 180,
    beamWidth = 32,
    finalistCount = 8,
    preserveThunderPositions = false,
    thunderPositionWindows = [],
    additionalWarmSegments = [],
    onLayer = null,
  } = {},
) {
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  const sourceSegment = basePacks.slice(segment.startIndex, segment.endIndex);
  let nodes = [{ state: prefixState, packs: [] }];
  const warmSources = [
    sourceSegment,
    ...additionalWarmSegments.filter(
      (candidate) => candidate.length === sourceSegment.length,
    ),
  ];
  let warmNodes = warmSources.map(() => ({
    state: prefixState,
    packs: [],
    active: true,
  }));
  let explored = 0;
  let legal = 0;
  let peakStates = 1;

  const thunderAllowed = (partialPacks, pack, offset) => {
    const globalIndex = segment.startIndex + offset;
    const hasThunder = packHasAction(pack, "thunder");
    const window = thunderPositionWindows.find(
      (candidate) =>
        globalIndex >= candidate.earliestIndex &&
        globalIndex <= candidate.latestIndex,
    );
    if (window) {
      const alreadyPlaced = partialPacks.some((partialPack, partialOffset) => {
        const partialIndex = segment.startIndex + partialOffset;
        return partialIndex >= window.earliestIndex &&
          partialIndex <= window.latestIndex &&
          packHasAction(partialPack, "thunder");
      });
      if (hasThunder && alreadyPlaced) return false;
      if (globalIndex === window.latestIndex && !alreadyPlaced && !hasThunder) {
        return false;
      }
      return true;
    }
    if (!preserveThunderPositions) return true;
    return hasThunder === packHasAction(sourceSegment[offset], "thunder");
  };
  const thunderLineageKey = thunderPositionWindows.length > 0
    ? (node) => JSON.stringify(thunderPositionWindows.map((window) => {
      const offset = node.packs.findIndex((pack, packOffset) => {
        const globalIndex = segment.startIndex + packOffset;
        return globalIndex >= window.earliestIndex &&
          globalIndex <= window.latestIndex &&
          packHasAction(pack, "thunder");
      });
      return offset < 0 ? "pending" : segment.startIndex + offset + 1;
    }))
    : null;

  for (let offset = 0; offset < sourceSegment.length; offset += 1) {
    const deduplicated = new Map();
    for (const node of nodes) {
      for (const pack of legalMechanicalLianyingPacks(
        node.state,
        runtime.config,
      )) {
        if (!thunderAllowed(node.packs, pack, offset)) continue;
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
            packs: [...node.packs, clonePack(pack)],
          };
          const key = segmentStateKey(state);
          const current = deduplicated.get(key);
          if (!current || state.totalDamage > current.state.totalDamage) {
            deduplicated.set(key, candidate);
          }
        } catch {
          // 完整状态机负责淘汰战意、冷却、充能和马上状态非法候选。
        }
      }
    }

    warmNodes = warmNodes.map((warmNode, warmIndex) => {
      if (!warmNode.active) return warmNode;
      const warmPack = warmSources[warmIndex][offset];
      if (!thunderAllowed(warmNode.packs, warmPack, offset)) {
        return { ...warmNode, active: false };
      }
      try {
        const state = executeActionPack(
          warmNode.state,
          warmPack,
          runtime.config,
          runtime.oracle,
          { endTick },
        );
        const packs = [...warmNode.packs, clonePack(warmPack)];
        const key = segmentStateKey(state);
        const existing = deduplicated.get(key);
        if (!existing || state.totalDamage > existing.state.totalDamage) {
          deduplicated.set(key, { state, packs });
        }
        return { state, packs, active: true };
      } catch {
        return { ...warmNode, active: false };
      }
    });
    const baseWarm = warmNodes[0];
    if (!baseWarm.active) {
      throw new Error(`区段${segment.id}的基础热启动在第${offset + 1}层失效`);
    }
    nodes = selectSegmentBeam(
      deduplicated.values(),
      beamWidth,
      warmNodes
        .filter((warmNode) => warmNode.active)
        .map((warmNode) => segmentStateKey(warmNode.state)),
      baseWarm.state,
      thunderLineageKey,
    );
    peakStates = Math.max(peakStates, nodes.length);
    if (typeof onLayer === "function") {
      onLayer({
        segmentId: segment.id,
        layer: offset + 1,
        rowCount: sourceSegment.length,
        uniqueStates: deduplicated.size,
        beamSize: nodes.length,
      });
    }
  }

  const baseWarm = warmNodes[0];
  const terminalThunderLineages = thunderLineageKey
    ? [...new Set(nodes.map((node) => thunderLineageKey(node)))]
      .map((value) => JSON.parse(value))
    : [];
  const finalists = selectSegmentFinalists(
    nodes,
    finalistCount,
    baseWarm.state,
    thunderLineageKey,
  );
  for (const warmNode of warmNodes.filter((candidate) => candidate.active)) {
    if (!finalists.some(
      (node) => segmentStateKey(node.state) === segmentStateKey(warmNode.state),
    )) {
      finalists.push({ state: warmNode.state, packs: warmNode.packs });
    }
  }
  return {
    segment,
    finalists,
    explored,
    legal,
    peakStates,
    beamWidth,
    finalistCount,
    warmStartCount: warmNodes.filter((candidate) => candidate.active).length,
    terminalThunderLineages,
  };
}

function spliceSegment(basePacks, segment, replacement) {
  return [
    ...basePacks.slice(0, segment.startIndex).map(clonePack),
    ...replacement.map(clonePack),
    ...basePacks.slice(segment.endIndex).map(clonePack),
  ];
}

function selectCoarseCandidates(candidates, limit) {
  const sorted = [...candidates].sort(
    (left, right) => right.coreDamage - left.coreDamage,
  );
  const selected = [];
  const seen = new Set();
  for (const candidate of sorted) {
    if (seen.has(candidate.segmentId)) continue;
    selected.push(candidate);
    seen.add(candidate.segmentId);
    if (selected.length >= limit) return selected;
  }
  for (const candidate of sorted) {
    if (selected.length >= limit) break;
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
  }
  return selected;
}

export function optimizeLianyingSegmentResynthesis(
  runtime,
  packs,
  {
    durationSeconds = 180,
    maxPasses = 1,
    beamWidth = 32,
    finalistCount = 8,
    coarseCandidateLimit = 8,
    coarseDashStates = 32,
    finalDashCandidateCount = 2,
    fullDashStates = 256,
    boundaryPaddingRows = 6,
    segmentIndices = null,
    segmentRanges = null,
    preserveThunderPositions = false,
    thunderPositionWindows = [],
    additionalWarmAxes = [],
    excludedCorePackKeys = [],
    adaptiveSuffixRepair = false,
    adaptiveSuffixMaxExpansions = 2,
    adaptiveSuffixLookaheadRows = 4,
    adaptiveSuffixMaximumAddedRows = 16,
    adaptiveSuffixPreferDriftedLineages = true,
    adaptiveSuffixWarmFailureLimit = 4,
    onProgress = null,
  } = {},
) {
  const excludedCorePackKeySet = new Set(excludedCorePackKeys);
  let incumbentPacks = packs.map(clonePack);
  let incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const baselineDamage = incumbent.state.totalDamage;
  const passes = [];

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const corePacks = stripDashPacks(incumbentPacks);
    const coreBaseline = replayWhitepaperLianying(runtime, corePacks, {
      durationSeconds,
    });
    const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
    const prefixStates = buildPrefixStates(runtime, corePacks, endTick);
    const identified = identifyLianyingThunderSegments(corePacks);
    const availableSegments = Array.isArray(segmentRanges)
      ? segmentRanges
      : identified.ranges;
    const rawSelectedSegments = segmentIndices
      ? availableSegments.filter((_, index) => segmentIndices.includes(index))
      : availableSegments;
    const selectedSegments = rawSelectedSegments.map((segment) => {
      if (segment.kind === "tail" || boundaryPaddingRows <= 0) return segment;
      const endIndex = Math.min(
        corePacks.length,
        segment.endIndex + boundaryPaddingRows,
      );
      return {
        ...segment,
        anchorEndIndex: segment.endIndex,
        endIndex,
        rowCount: endIndex - segment.startIndex,
        boundaryPaddingRowsApplied: endIndex - segment.endIndex,
      };
    });
    const coreCandidates = [{
      segmentId: "incumbent",
      segment: null,
      packs: corePacks,
      coreDamage: coreBaseline.state.totalDamage,
      coreDamageGain: 0,
    }];
    const segmentReports = [];

    for (const segment of selectedSegments) {
      if (typeof onProgress === "function") {
        onProgress({ stage: "segment-start", pass: pass + 1, segment });
      }
      let suffixLegal = 0;
      let excludedCoreCandidates = 0;
      const suffixLegalThunderSchedules = [];
      const suffixAttempts = [];
      const suffixFailureReasons = {};
      const adaptiveAttempts = [];
      const initialEndIndex = segment.endIndex;
      const sourceThunderSchedule = thunderRows(corePacks);
      let adaptiveWarmAxes = additionalWarmAxes;
      let currentSegment = segment;
      let explored = 0;
      let legal = 0;
      let peakStates = 0;
      let finalists = 0;
      let warmStartCount = 0;
      const terminalThunderLineages = new Map();
      const maximumAdaptiveExpansions = adaptiveSuffixRepair
        ? Math.max(0, Math.floor(Number(adaptiveSuffixMaxExpansions)))
        : 0;

      for (
        let adaptiveAttempt = 0;
        adaptiveAttempt <= maximumAdaptiveExpansions;
        adaptiveAttempt += 1
      ) {
        const synthesis = synthesizeLianyingSegment(
          runtime,
          corePacks,
          prefixStates[currentSegment.startIndex],
          currentSegment,
          {
            durationSeconds,
            beamWidth,
            finalistCount,
            preserveThunderPositions,
            thunderPositionWindows,
            additionalWarmSegments: adaptiveWarmAxes.map((axis) =>
              stripDashPacks(axis).slice(
                currentSegment.startIndex,
                currentSegment.endIndex,
              )),
          },
        );
        explored += synthesis.explored;
        legal += synthesis.legal;
        peakStates = Math.max(peakStates, synthesis.peakStates);
        finalists = synthesis.finalists.length;
        warmStartCount = synthesis.warmStartCount;
        for (const lineage of synthesis.terminalThunderLineages) {
          terminalThunderLineages.set(JSON.stringify(lineage), lineage);
        }

        const iterationAttempts = [];
        const failedAttempts = [];
        const failedWarmAxes = [];
        for (const finalist of synthesis.finalists) {
          const candidatePacks = spliceSegment(
            corePacks,
            currentSegment,
            finalist.packs,
          );
          const schedule = thunderRows(candidatePacks);
          const drifted = thunderPositionWindows.some((window) =>
            schedule[Number(window.anchorNumber) - 1] !== Number(window.sourceIndex) + 1);
          const suffix = replaySuffixFromState(
            runtime,
            finalist.state,
            candidatePacks,
            currentSegment.endIndex,
            endTick,
          );
          if (suffix.legal) {
            const replay = replayWhitepaperLianying(runtime, candidatePacks, {
              durationSeconds,
            });
            suffixLegal += 1;
            suffixLegalThunderSchedules.push(schedule);
            if (excludedCorePackKeySet.has(JSON.stringify(candidatePacks))) {
              excludedCoreCandidates += 1;
              const attempt = {
                adaptiveAttempt,
                segmentEndRow: currentSegment.endIndex,
                thunderRows: schedule,
                drifted,
                legal: true,
                excluded: true,
              };
              iterationAttempts.push(attempt);
              suffixAttempts.push(attempt);
              continue;
            }
            const attempt = {
              adaptiveAttempt,
              segmentEndRow: currentSegment.endIndex,
              thunderRows: schedule,
              drifted,
              legal: true,
              excluded: false,
            };
            iterationAttempts.push(attempt);
            suffixAttempts.push(attempt);
            coreCandidates.push({
              segmentId: segment.id,
              segment: currentSegment,
              packs: candidatePacks,
              coreDamage: replay.state.totalDamage,
              coreDamageGain:
                replay.state.totalDamage - coreBaseline.state.totalDamage,
              thunderRows: schedule,
              adaptiveAttempt,
            });
            continue;
          }

          const reason = suffix.failureReason;
          suffixFailureReasons[reason] = Number(suffixFailureReasons[reason] ?? 0) + 1;
          const attempt = {
            adaptiveAttempt,
            segmentEndRow: currentSegment.endIndex,
            thunderRows: schedule,
            drifted,
            legal: false,
            excluded: false,
            failureIndex: suffix.failureIndex,
            failureRow: suffix.failureIndex + 1,
            failure: reason,
            failureState: {
              rage: suffix.state.rage,
              dragonRideStacks: suffix.state.dragonRideStacks,
              mounted: suffix.state.mounted,
              tick: decisionTick(suffix.state),
            },
          };
          iterationAttempts.push(attempt);
          suffixAttempts.push(attempt);
          failedAttempts.push(attempt);
          failedWarmAxes.push({
            attempt,
            packs: candidatePacks,
            boundaryDamage: finalist.state.totalDamage,
          });
        }

        const preferredFailures = adaptiveSuffixPreferDriftedLineages
          ? failedAttempts.filter((attempt) => attempt.drifted)
          : failedAttempts;
        const repairFailures = preferredFailures.length > 0
          ? preferredFailures
          : failedAttempts;
        const nextEndIndex = adaptiveSuffixRepair &&
          adaptiveAttempt < maximumAdaptiveExpansions
          ? lianyingAdaptiveSuffixEndIndex({
            currentEndIndex: currentSegment.endIndex,
            initialEndIndex,
            failureIndices: repairFailures.map((attempt) => attempt.failureIndex),
            packCount: corePacks.length,
            lookaheadRows: adaptiveSuffixLookaheadRows,
            maximumAddedRows: adaptiveSuffixMaximumAddedRows,
          })
          : null;
        adaptiveAttempts.push({
          attempt: adaptiveAttempt,
          startRow: currentSegment.startIndex + 1,
          endRow: currentSegment.endIndex,
          rowCount: currentSegment.endIndex - currentSegment.startIndex,
          explored: synthesis.explored,
          legal: synthesis.legal,
          finalists: synthesis.finalists.length,
          suffixLegal: iterationAttempts.filter((attempt) => attempt.legal).length,
          suffixFailures: failedAttempts.length,
          driftedSuffixFailures: failedAttempts.filter((attempt) => attempt.drifted).length,
          firstFailureRow: repairFailures.length > 0
            ? Math.min(...repairFailures.map((attempt) => attempt.failureRow))
            : null,
          nextEndRow: nextEndIndex,
        });
        if (nextEndIndex === null) break;
        const repairFailureSet = new Set(repairFailures);
        const selectedFailureWarmAxes = failedWarmAxes
          .filter((candidate) => repairFailureSet.has(candidate.attempt))
          .sort((left, right) => right.boundaryDamage - left.boundaryDamage)
          .slice(0, Math.max(1, Number(adaptiveSuffixWarmFailureLimit)))
          .map((candidate) => candidate.packs);
        adaptiveWarmAxes = [
          ...additionalWarmAxes,
          ...selectedFailureWarmAxes,
        ];
        if (typeof onProgress === "function") {
          onProgress({
            stage: "adaptive-suffix-expand",
            pass: pass + 1,
            segmentId: segment.id,
            attempt: adaptiveAttempt + 1,
            previousEndRow: currentSegment.endIndex,
            nextEndRow: nextEndIndex,
            firstFailureRow: adaptiveAttempts.at(-1).firstFailureRow,
            failureWarmStartCount: selectedFailureWarmAxes.length,
          });
        }
        currentSegment = {
          ...currentSegment,
          endIndex: nextEndIndex,
          rowCount: nextEndIndex - currentSegment.startIndex,
          adaptiveSuffixRowsApplied: nextEndIndex - initialEndIndex,
          adaptiveFailureRow: adaptiveAttempts.at(-1).firstFailureRow,
        };
      }
      const report = {
        ...currentSegment,
        initialEndIndex,
        explored,
        legal,
        peakStates,
        finalists,
        warmStartCount,
        terminalThunderLineages: [...terminalThunderLineages.values()],
        suffixLegal,
        suffixLegalThunderSchedules: [...new Map(
          suffixLegalThunderSchedules.map((rows) => [JSON.stringify(rows), rows]),
        ).values()],
        suffixAttempts,
        excludedCoreCandidates,
        suffixFailureReasons,
        adaptiveSuffixRepair,
        adaptiveSuffixExpansions: adaptiveAttempts.length - 1,
        adaptiveAttempts,
        sourceThunderSchedule,
      };
      segmentReports.push(report);
      if (typeof onProgress === "function") {
        onProgress({ stage: "segment-complete", pass: pass + 1, ...report });
      }
    }

    const selectedCoarseCandidates = selectCoarseCandidates(
      coreCandidates,
      coarseCandidateLimit,
    );
    const coarseCandidates = selectedCoarseCandidates.map((candidate, index) => {
      if (typeof onProgress === "function") {
        onProgress({
          stage: "dash-coarse",
          pass: pass + 1,
          candidate: index + 1,
          candidateCount: selectedCoarseCandidates.length,
          segmentId: candidate.segmentId,
        });
      }
      if (candidate.segmentId === "incumbent") {
        return {
          ...candidate,
          packs: incumbentPacks,
          totalDamage: incumbent.state.totalDamage,
          dashCount: incumbent.state.timeline.filter(
            (event) => event.type === "offGcd" && event.action === "dash",
          ).length,
          coarseBaseline: true,
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
        coarseBaseline: false,
      };
    });
    const selectedFinalCandidates = [...coarseCandidates]
      .sort((left, right) => right.totalDamage - left.totalDamage)
      .slice(0, finalDashCandidateCount);
    const finalCandidates = selectedFinalCandidates
      .map((candidate, index) => {
        if (typeof onProgress === "function") {
          onProgress({
            stage: "dash-final",
            pass: pass + 1,
            candidate: index + 1,
            candidateCount: selectedFinalCandidates.length,
            segmentId: candidate.segmentId,
          });
        }
        if (candidate.segmentId === "incumbent") {
          return { ...candidate, state: incumbent.state };
        }
        const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
          durationSeconds,
          maxStatesPerRow: fullDashStates,
        });
        return {
          ...candidate,
          packs: dash.packs,
          state: dash.state,
          totalDamage: dash.state.totalDamage,
          dashCount: dash.dashCount,
        };
      })
      .sort((left, right) => right.totalDamage - left.totalDamage);
    const best = finalCandidates[0];
    const passReport = {
      pass: pass + 1,
      anchors: identified.anchors.map((index) => index + 1),
      segments: segmentReports,
      coreCandidates: coreCandidates.length,
      coarseCandidates: coarseCandidates.map((candidate) => ({
        segmentId: candidate.segmentId,
        coreDamageGain: candidate.coreDamageGain,
        totalDamage: candidate.totalDamage,
        dashCount: candidate.dashCount,
        thunderRows: candidate.thunderRows ?? thunderRows(candidate.packs),
      })),
      bestSegmentId: best?.segmentId ?? null,
      damageGain: best ? best.totalDamage - incumbent.state.totalDamage : 0,
    };
    passes.push(passReport);
    if (!best || best.totalDamage <= incumbent.state.totalDamage) break;
    incumbentPacks = best.packs;
    incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
      durationSeconds,
    });
  }

  return {
    packs: incumbentPacks,
    state: incumbent.state,
    baselineDamage,
    damageGain: incumbent.state.totalDamage - baselineDamage,
    passes,
    options: {
      durationSeconds,
      maxPasses,
      beamWidth,
      finalistCount,
      coarseCandidateLimit,
      coarseDashStates,
      finalDashCandidateCount,
      fullDashStates,
      boundaryPaddingRows,
      segmentIndices,
      segmentRanges,
      preserveThunderPositions,
      thunderPositionWindows,
      additionalWarmAxisCount: additionalWarmAxes.length,
      excludedCorePackKeys: [...excludedCorePackKeySet],
      adaptiveSuffixRepair,
      adaptiveSuffixMaxExpansions,
      adaptiveSuffixLookaheadRows,
      adaptiveSuffixMaximumAddedRows,
      adaptiveSuffixPreferDriftedLineages,
      adaptiveSuffixWarmFailureLimit,
    },
  };
}
