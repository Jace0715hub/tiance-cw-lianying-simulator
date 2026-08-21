import { millisecondsToTicks } from "../engine/clock.js";
import { executeActionPack } from "../engine/simulator.js";
import { createInitialState } from "../engine/state.js";
import {
  evaluateLianyingReferenceSuffixValue,
} from "./lianying-multisegment-resynthesis.js";
import {
  cloneLianyingPack,
  lianyingDecisionTick,
  lianyingResynthesisStateKey,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import {
  legalMechanicalLianyingPacks,
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function packActionIds(pack) {
  return [
    ...(pack?.prefix ?? []),
    pack?.primary,
    ...(pack?.tail ?? []),
  ].map(actionId).filter(Boolean);
}

export function isLianyingFixedAnchorPackAllowed(
  pack,
  referencePack,
  fixedActionIds = ["thunder", "ride", "orange", "dismount"],
) {
  const actual = packActionIds(pack);
  const reference = packActionIds(referencePack);
  return fixedActionIds.every((id) =>
    actual.filter((candidate) => candidate === id).length ===
      reference.filter((candidate) => candidate === id).length);
}

function buildReferenceStates(runtime, packs, endTick) {
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

function compareNodes(left, right) {
  return Number(right.score) - Number(left.score) ||
    Number(right.state.totalDamage) - Number(left.state.totalDamage) ||
    Number(right.depth) - Number(left.depth) ||
    Number(left.serial) - Number(right.serial);
}

class MaxPriorityQueue {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value) {
    const items = this.items;
    items.push(value);
    let index = items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareNodes(items[parent], items[index]) <= 0) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }

  pop() {
    if (this.items.length === 0) return null;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length === 0) return first;
    this.items[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (
        left < this.items.length &&
        compareNodes(this.items[best], this.items[left]) > 0
      ) best = left;
      if (
        right < this.items.length &&
        compareNodes(this.items[best], this.items[right]) > 0
      ) best = right;
      if (best === index) break;
      [this.items[index], this.items[best]] =
        [this.items[best], this.items[index]];
      index = best;
    }
    return first;
  }

  trim(maximum) {
    if (this.items.length <= maximum) return [];
    const ranked = this.items.sort(compareNodes);
    const retained = ranked.slice(0, maximum);
    const removed = ranked.slice(maximum);
    this.items = [];
    for (const node of retained) this.push(node);
    return removed;
  }

  hasNodeKey(key) {
    return this.items.some((node) => nodeKey(node) === key);
  }
}

function nodeKey(node) {
  return `${node.depth}:${lianyingResynthesisStateKey(node.state)}`;
}

function candidatePathKey(packs) {
  return JSON.stringify(packs);
}

function selectPinnedBeam(nodes, width, pinnedKey) {
  const maximum = Math.max(1, Math.floor(Number(width)));
  const ranked = [...nodes].sort(compareNodes);
  const selected = ranked.slice(0, maximum);
  if (selected.some((node) => nodeKey(node) === pinnedKey)) return selected;
  const pinned = ranked.find((node) => nodeKey(node) === pinnedKey);
  if (!pinned) return selected;
  selected[selected.length - 1] = pinned;
  return selected.sort(compareNodes);
}

function normalizeWindow(packs, startRow, endRow) {
  const startIndex = Math.max(0, Math.floor(Number(startRow)) - 1);
  const endIndex = Math.min(packs.length, Math.floor(Number(endRow)));
  if (endIndex <= startIndex) throw new Error("最佳优先搜索窗口不能为空");
  return { startIndex, endIndex, rowCount: endIndex - startIndex };
}

export function searchLianyingBoundedLocalBlock(
  runtime,
  packs,
  {
    durationSeconds = 180,
    startRow = 107,
    endRow = 128,
    strategy = "best-first",
    beamWidth = 24,
    expansionBudget = Number.POSITIVE_INFINITY,
    queueLimit = 4096,
    candidateLimit = 32,
    wallClockMs = Number.POSITIVE_INFINITY,
    fixedActionIds = ["thunder", "ride", "orange", "dismount"],
    suffixRepairPenaltyRows = 1,
  } = {},
) {
  if (!["beam", "best-first"].includes(strategy)) {
    throw new Error("局部块搜索策略应为 beam 或 best-first");
  }
  const corePacks = stripLianyingDashPacks(packs);
  const { startIndex, endIndex, rowCount } = normalizeWindow(
    corePacks,
    startRow,
    endRow,
  );
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  const referenceStates = buildReferenceStates(runtime, corePacks, endTick);
  const coreBaseline = replayWhitepaperLianying(runtime, corePacks, {
    durationSeconds,
  });
  const averageRowDamage = coreBaseline.state.totalDamage /
    Math.max(1, corePacks.length);
  const referenceWindow = corePacks.slice(startIndex, endIndex);
  const prefixPacks = corePacks.slice(0, startIndex);
  const suffixPacks = corePacks.slice(endIndex);
  const maximumExpansions = Number.isFinite(Number(expansionBudget))
    ? Math.max(1, Math.floor(Number(expansionBudget)))
    : Number.POSITIVE_INFINITY;
  const maximumQueue = Math.max(1, Math.floor(Number(queueLimit)));
  const maximumCandidates = Math.max(1, Math.floor(Number(candidateLimit)));
  const maximumWallClockMs = Number.isFinite(Number(wallClockMs))
    ? Math.max(1, Math.floor(Number(wallClockMs)))
    : Number.POSITIVE_INFINITY;
  const startedAt = Date.now();
  let serial = 0;
  let expandedNodes = 0;
  let exploredTransitions = 0;
  let legalTransitions = 0;
  let staleNodes = 0;
  let trimmedNodes = 0;
  let peakFrontier = 1;
  let stoppedByWallClock = false;
  const completeByPath = new Map();

  const suffixValueFor = (state, depth) =>
    evaluateLianyingReferenceSuffixValue(
      runtime,
      state,
      corePacks.slice(startIndex + depth),
      referenceStates,
      startIndex + depth,
      coreBaseline.state.totalDamage,
      {
        endTick,
        averageRowDamage,
        repairPenaltyRows: suffixRepairPenaltyRows,
      },
    );
  const makeNode = (state, windowPacks, depth) => {
    const suffixValue = suffixValueFor(state, depth);
    return {
      state,
      packs: windowPacks,
      depth,
      suffixValue,
      score: suffixValue.score,
      serial: serial++,
    };
  };
  const root = makeNode(referenceStates[startIndex], [], 0);

  const recordComplete = (node) => {
    if (!node.suffixValue.suffixLegal) return;
    const fullPacks = [
      ...prefixPacks,
      ...node.packs,
      ...suffixPacks,
    ].map(cloneLianyingPack);
    const key = candidatePathKey(fullPacks);
    const current = completeByPath.get(key);
    if (!current || node.suffixValue.projectedFinalDamage > current.coreDamage) {
      completeByPath.set(key, {
        packs: fullPacks,
        coreDamage: node.suffixValue.projectedFinalDamage,
        windowPacks: node.packs.map(cloneLianyingPack),
        finalStateKey: lianyingResynthesisStateKey(node.state),
      });
    }
  };
  const expandNode = (node, addCandidate) => {
    const referencePack = referenceWindow[node.depth];
    for (const pack of legalMechanicalLianyingPacks(
      node.state,
      runtime.config,
    )) {
      if (!isLianyingFixedAnchorPackAllowed(
        pack,
        referencePack,
        fixedActionIds,
      )) continue;
      exploredTransitions += 1;
      try {
        const state = executeActionPack(
          node.state,
          pack,
          runtime.config,
          runtime.oracle,
          { endTick },
        );
        legalTransitions += 1;
        const child = makeNode(
          state,
          [...node.packs, cloneLianyingPack(pack)],
          node.depth + 1,
        );
        if (child.depth === rowCount) recordComplete(child);
        else addCandidate(child);
      } catch {
        // 状态机统一淘汰战意、冷却、充能和骑乘状态非法动作。
      }
    }
  };

  if (strategy === "beam") {
    let nodes = [root];
    for (let depth = 0; depth < rowCount; depth += 1) {
      if (Date.now() - startedAt >= maximumWallClockMs) {
        stoppedByWallClock = true;
        break;
      }
      const pinnedState = referenceStates[startIndex + depth];
      const pinnedKey = `${depth}:${lianyingResynthesisStateKey(pinnedState)}`;
      const selected = selectPinnedBeam(nodes, beamWidth, pinnedKey);
      const nextByState = new Map();
      const addCandidate = (candidate) => {
        const key = nodeKey(candidate);
        const current = nextByState.get(key);
        if (!current || compareNodes(candidate, current) < 0) {
          nextByState.set(key, candidate);
        }
      };
      for (const node of selected) {
        if (expandedNodes >= maximumExpansions) break;
        if (Date.now() - startedAt >= maximumWallClockMs) {
          stoppedByWallClock = true;
          break;
        }
        expandedNodes += 1;
        expandNode(node, addCandidate);
      }
      if (depth + 1 < rowCount) {
        const warmNode = makeNode(
          referenceStates[startIndex + depth + 1],
          referenceWindow.slice(0, depth + 1).map(cloneLianyingPack),
          depth + 1,
        );
        addCandidate(warmNode);
        nodes = selectPinnedBeam(
          nextByState.values(),
          beamWidth,
          nodeKey(warmNode),
        );
        peakFrontier = Math.max(peakFrontier, nodes.length);
      }
      if (expandedNodes >= maximumExpansions) break;
    }
  } else {
    const queue = new MaxPriorityQueue();
    const bestDamageByState = new Map([[nodeKey(root), root.state.totalDamage]]);
    queue.push(root);
    while (queue.size > 0 && expandedNodes < maximumExpansions) {
      if (Date.now() - startedAt >= maximumWallClockMs) {
        stoppedByWallClock = true;
        break;
      }
      const node = queue.pop();
      const key = nodeKey(node);
      if (node.state.totalDamage < bestDamageByState.get(key)) {
        staleNodes += 1;
        continue;
      }
      expandedNodes += 1;
      expandNode(node, (candidate) => {
        const candidateKey = nodeKey(candidate);
        const currentDamage = bestDamageByState.get(candidateKey);
        if (
          currentDamage !== undefined &&
          currentDamage >= candidate.state.totalDamage
        ) return;
        bestDamageByState.set(candidateKey, candidate.state.totalDamage);
        queue.push(candidate);
      });
      if (queue.size > maximumQueue + Math.ceil(maximumQueue / 10)) {
        const removed = queue.trim(maximumQueue);
        trimmedNodes += removed.length;
        for (const removedNode of removed) {
          const removedKey = nodeKey(removedNode);
          if (
            !queue.hasNodeKey(removedKey) &&
            bestDamageByState.get(removedKey) ===
              removedNode.state.totalDamage
          ) bestDamageByState.delete(removedKey);
        }
      }
      peakFrontier = Math.max(peakFrontier, queue.size);
    }
  }

  const incumbentPathKey = candidatePathKey(corePacks);
  const incumbentCandidate = {
    packs: corePacks.map(cloneLianyingPack),
    coreDamage: coreBaseline.state.totalDamage,
    windowPacks: referenceWindow.map(cloneLianyingPack),
    finalStateKey: lianyingResynthesisStateKey(referenceStates[endIndex]),
    isIncumbent: true,
  };
  completeByPath.set(incumbentPathKey, incumbentCandidate);
  const candidates = [...completeByPath.entries()]
    .map(([key, candidate]) => ({
      ...candidate,
      isIncumbent: key === incumbentPathKey,
    }))
    .sort((left, right) => right.coreDamage - left.coreDamage)
    .slice(0, maximumCandidates);
  const best = candidates[0] ?? incumbentCandidate;
  return {
    strategy,
    startRow: startIndex + 1,
    endRow: endIndex,
    rowCount,
    expandedNodes,
    exploredTransitions,
    legalTransitions,
    staleNodes,
    trimmedNodes,
    peakFrontier,
    stoppedByWallClock,
    completeCandidateCount: completeByPath.size,
    candidates,
    packs: best.packs,
    state: replayWhitepaperLianying(runtime, best.packs, {
      durationSeconds,
    }).state,
    baselineDamage: coreBaseline.state.totalDamage,
    damageGain: best.coreDamage - coreBaseline.state.totalDamage,
    accepted: best.coreDamage > coreBaseline.state.totalDamage,
    options: {
      durationSeconds,
      beamWidth,
      expansionBudget: maximumExpansions,
      queueLimit: maximumQueue,
      candidateLimit: maximumCandidates,
      wallClockMs: maximumWallClockMs,
      fixedActionIds: [...fixedActionIds],
      suffixRepairPenaltyRows,
    },
  };
}
