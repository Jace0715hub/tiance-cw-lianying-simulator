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
import { predictLianyingRidgeValue } from "./lianying-value-model.js";

function remainingTicks(readyTick, tick) {
  return Math.max(0, Number(readyTick ?? 0) - tick);
}

export function isLianyingPrimaryActionPackAllowed(
  pack,
  rowIndex,
  constraints = [],
) {
  const row = Number(rowIndex) + 1;
  const primaryId = actionId(pack?.primary);
  return (constraints ?? []).every((constraint) => {
    if (Number(constraint.row) !== row) return true;
    const allowed = constraint.allowedActionIds;
    if (Array.isArray(allowed) && !allowed.includes(primaryId)) return false;
    const forbidden = constraint.forbiddenActionIds;
    return !Array.isArray(forbidden) || !forbidden.includes(primaryId);
  });
}

function lianyingPrimaryWindowSignature(packs, constraint) {
  const tracked = Array.isArray(constraint.trackedActionIds)
    ? new Set(constraint.trackedActionIds)
    : null;
  const ids = (packs ?? [])
    .slice(Number(constraint.startRow) - 1, Number(constraint.endRow))
    .map((pack) => actionId(pack?.primary))
    .filter((id) => tracked === null || tracked.has(id));
  if (constraint.signatureMode !== "counts") return JSON.stringify(ids);
  const counts = new Map();
  for (const id of ids) counts.set(id, Number(counts.get(id) ?? 0) + 1);
  return JSON.stringify([...counts.entries()].sort(([left], [right]) =>
    String(left).localeCompare(String(right))));
}

export function isLianyingPrimaryWindowPathAllowed(
  packs,
  currentRow,
  referencePacks,
  constraints = [],
) {
  return (constraints ?? []).every((constraint) => {
    if (Number(currentRow) < Number(constraint.endRow)) return true;
    return lianyingPrimaryWindowSignature(packs, constraint) !==
      lianyingPrimaryWindowSignature(referencePacks, constraint);
  });
}

function lianyingPrimaryCountSignature(packs, constraint, currentRow) {
  const endRow = Math.min(Number(constraint.endRow), Number(currentRow));
  const counts = Object.fromEntries(
    Object.keys(constraint.counts ?? {}).map((id) => [id, 0]),
  );
  for (const pack of (packs ?? []).slice(
    Number(constraint.startRow) - 1,
    endRow,
  )) {
    const id = actionId(pack?.primary);
    if (Object.hasOwn(counts, id)) counts[id] += 1;
  }
  return counts;
}

export function isLianyingPrimaryCountPathAllowed(
  packs,
  currentRow,
  constraints = [],
) {
  return (constraints ?? []).every((constraint) => {
    if (Number(currentRow) < Number(constraint.startRow)) return true;
    const actual = lianyingPrimaryCountSignature(
      packs,
      constraint,
      currentRow,
    );
    for (const [id, target] of Object.entries(constraint.counts ?? {})) {
      if (actual[id] > Number(target)) return false;
      if (
        Number(currentRow) >= Number(constraint.endRow) &&
        actual[id] !== Number(target)
      ) return false;
    }
    return true;
  });
}

function lianyingActionCountSignature(packs, constraint, currentRow) {
  const endRow = Math.min(Number(constraint.endRow), Number(currentRow));
  const counts = Object.fromEntries(
    Object.keys(constraint.counts ?? {}).map((id) => [id, 0]),
  );
  for (const pack of (packs ?? []).slice(
    Number(constraint.startRow) - 1,
    endRow,
  )) {
    for (const action of [
      ...(pack?.prefix ?? []),
      pack?.primary,
      ...(pack?.tail ?? []),
    ]) {
      const id = actionId(action);
      if (Object.hasOwn(counts, id)) counts[id] += 1;
    }
  }
  return counts;
}

export function isLianyingActionCountPathAllowed(
  packs,
  currentRow,
  constraints = [],
) {
  return (constraints ?? []).every((constraint) => {
    if (Number(currentRow) < Number(constraint.startRow)) return true;
    const actual = lianyingActionCountSignature(
      packs,
      constraint,
      currentRow,
    );
    for (const [id, target] of Object.entries(constraint.counts ?? {})) {
      if (actual[id] > Number(target)) return false;
      if (
        Number(currentRow) >= Number(constraint.endRow) &&
        actual[id] !== Number(target)
      ) return false;
    }
    return true;
  });
}

function stableStringHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function lianyingQualityDiversityCellKey(
  state,
  { bucketTicks = 16000 } = {},
) {
  const tick = lianyingDecisionTick(state);
  const size = Math.max(1, Math.floor(Number(bucketTicks)));
  const bucket = (readyTick) =>
    Math.floor(remainingTicks(readyTick, tick) / size);
  const chargeCell = (name) => [
    state.chargeTicks[name].ready,
    ...(state.chargeTicks[name].rechargeQueue ?? []).map(bucket),
  ];
  const buffCell = (name) => bucket(state.buffTicks[`${name}Until`]);
  return JSON.stringify([
    state.rage,
    state.dragonRideStacks,
    isMountedAtTick(state, tick),
    state.executeDestroyToggle,
    state.bleedStacks,
    state.bleedQuality,
    chargeCell("thunder"),
    chargeCell("ride"),
    bucket(state.cooldownReadyTick.destroy),
    bucket(state.cooldownReadyTick.dragonRoar),
    bucket(state.cooldownReadyTick.charge),
    bucket(state.cooldownReadyTick.orange),
    buffCell("thunder"),
    buffCell("ride"),
    buffCell("orange"),
    buffCell("poLouLan"),
  ]);
}

export function selectLianyingQualityDiversityArchive(
  nodes,
  {
    quota = 0,
    candidateMultiplier = 8,
    seed = 0,
    keyNode = (node) => lianyingQualityDiversityCellKey(node.state),
    scoreNode = (node) => node.state.totalDamage,
  } = {},
) {
  const maximum = Math.max(0, Math.floor(Number(quota)));
  if (maximum === 0) return [];
  const cellBest = new Map();
  for (const node of nodes ?? []) {
    const key = keyNode(node);
    const current = cellBest.get(key);
    if (!current || scoreNode(node) > scoreNode(current.node)) {
      cellBest.set(key, { key, node });
    }
  }
  const pool = [...cellBest.values()]
    .sort((left, right) => scoreNode(right.node) - scoreNode(left.node))
    .slice(0, Math.max(maximum, maximum * Math.max(
      1,
      Math.floor(Number(candidateMultiplier)),
    )));
  return pool
    .sort((left, right) =>
      stableStringHash(`${seed}|${left.key}`) -
        stableStringHash(`${seed}|${right.key}`) ||
      scoreNode(right.node) - scoreNode(left.node))
    .slice(0, maximum)
    .map((entry) => entry.node);
}

function qualityDiversityLineageKey(node) {
  return node?.qualityDiversityLineageId ?? null;
}

function selectBestLianyingNodesByKey(nodes, keyNode, scoreNode) {
  if (typeof keyNode !== "function") return [];
  const best = new Map();
  for (const node of nodes ?? []) {
    const key = keyNode(node);
    if (key === null || key === undefined) continue;
    const current = best.get(key);
    if (!current || scoreNode(node) > scoreNode(current)) best.set(key, node);
  }
  return [...best.values()].sort(
    (left, right) => scoreNode(right) - scoreNode(left),
  );
}

export function refreshLianyingQualityDiversityLineages(
  nodes,
  {
    anchorIndex,
    quota = 0,
    tenureSegments = 1,
    candidateMultiplier = 8,
    seed = 0,
    keyNode = (node) => lianyingQualityDiversityCellKey(node.state),
    scoreNode = (node) => node.state.totalDamage,
  },
) {
  const maximum = Math.max(0, Math.floor(Number(quota)));
  const currentAnchor = Math.max(0, Math.floor(Number(anchorIndex)));
  const tenure = Math.max(1, Math.floor(Number(tenureSegments)));
  const refreshed = [...(nodes ?? [])].map((node) => {
    if (
      node.qualityDiversityLineageId == null ||
      Number(node.qualityDiversityLineageExpiresAtAnchor) > currentAnchor
    ) return node;
    const next = { ...node };
    delete next.qualityDiversityLineageId;
    delete next.qualityDiversityLineageExpiresAtAnchor;
    return next;
  });
  const activeIds = new Set(
    refreshed.map(qualityDiversityLineageKey).filter(Boolean),
  );
  const additions = selectLianyingQualityDiversityArchive(
    refreshed.filter((node) => qualityDiversityLineageKey(node) === null),
    {
      quota: Math.max(0, maximum - activeIds.size),
      candidateMultiplier,
      seed: Number(seed) + currentAnchor,
      keyNode,
      scoreNode,
    },
  );
  const additionIds = new Map(additions.map((node, index) => [
    node,
    `qd:${seed}:${currentAnchor}:${stableStringHash(keyNode(node))}:${index}`,
  ]));
  const assigned = refreshed.map((node) => additionIds.has(node)
    ? {
        ...node,
        qualityDiversityLineageId: additionIds.get(node),
        qualityDiversityLineageExpiresAtAnchor: currentAnchor + tenure,
      }
    : node);
  return {
    nodes: assigned,
    activeLineages: new Set(
      assigned.map(qualityDiversityLineageKey).filter(Boolean),
    ).size,
    retainedLineages: activeIds.size,
    newLineages: additions.length,
  };
}

function clonePacks(packs) {
  return packs.map(cloneLianyingPack);
}

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

const LIANYING_COMPANION_LINEAGE_TYPES = ["ride", "orange", "dismount"];

function companionPackHasAction(pack, type) {
  return type === "ride"
    ? actionId(pack.primary) === "ride"
    : lianyingPackHasAction(pack, type);
}

function selectCompanionLineageRows(packs, types) {
  return Object.fromEntries(types.map((type) => [
    type,
    packs.flatMap((pack, index) =>
      companionPackHasAction(pack, type) ? [index + 1] : []),
  ]));
}

function appendCompanionLineageRows(rows, pack, rowNumber, types) {
  let next = rows;
  for (const type of types) {
    if (!companionPackHasAction(pack, type)) continue;
    if (next === rows) next = structuredClone(rows);
    next[type] = [...(next[type] ?? []), rowNumber];
  }
  return next;
}

export function lianyingAnchorDriftScheduleKey(
  anchorRows,
  companionLineageRows = {},
) {
  return JSON.stringify({ anchorRows, companionLineageRows });
}

function anchorDriftNodeScheduleKey(node) {
  return lianyingAnchorDriftScheduleKey(
    node.anchorRows,
    node.companionLineageRows,
  );
}

export function lianyingCompanionAnchorRows(packs) {
  const rowsFor = (predicate) => packs.flatMap((pack, index) =>
    predicate(pack) ? [index + 1] : []);
  return {
    rideRows: rowsFor((pack) => actionId(pack.primary) === "ride"),
    orangeRows: rowsFor((pack) => lianyingPackHasAction(pack, "orange")),
    dismountRows: rowsFor((pack) => lianyingPackHasAction(pack, "dismount")),
  };
}

export function isLianyingCompanionAnchorPackAllowed(
  pack,
  rowIndex,
  template = null,
  priorPacks = [],
) {
  if (!template) return true;
  const rowNumber = Number(rowIndex) + 1;
  const expected = (rows) => new Set((rows ?? []).map(Number)).has(rowNumber);
  const windowAllows = (windows, id) => {
    if (!Array.isArray(windows)) return true;
    const priorCount = priorPacks.filter((prior) =>
      id === "ride"
        ? actionId(prior.primary) === "ride"
        : lianyingPackHasAction(prior, id)).length;
    const hasAction = id === "ride"
      ? actionId(pack.primary) === "ride"
      : lianyingPackHasAction(pack, id);
    if (priorCount >= windows.length) return !hasAction;
    const window = windows[priorCount];
    const earliest = Number(window.earliestRow);
    const latest = Number(window.latestRow);
    if (rowNumber < earliest) return !hasAction;
    if (rowNumber > latest) return false;
    if (rowNumber === latest) return hasAction;
    return true;
  };
  if (!windowAllows(template.rideWindows, "ride")) return false;
  if (!windowAllows(template.orangeWindows, "orange")) return false;
  if (!windowAllows(template.dismountWindows, "dismount")) return false;
  if (
    Array.isArray(template.rideRows) &&
    (actionId(pack.primary) === "ride") !== expected(template.rideRows)
  ) return false;
  if (
    Array.isArray(template.orangeRows) &&
    lianyingPackHasAction(pack, "orange") !== expected(template.orangeRows)
  ) return false;
  if (
    Array.isArray(template.dismountRows) &&
    lianyingPackHasAction(pack, "dismount") !== expected(template.dismountRows)
  ) return false;
  return true;
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

function evaluateLianyingSegmentHorizonProbe(
  runtime,
  state,
  sourceSegments,
  { endTick, beamWidth = 2 } = {},
) {
  let nodes = [{ state, lineageId: "probe" }];
  let explored = 0;
  let legal = 0;
  let completedSegments = 0;
  for (const sourcePacks of sourceSegments) {
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
    if (nodes.length === 0) break;
    completedSegments += 1;
  }
  return {
    legal: nodes.length > 0 && completedSegments === sourceSegments.length,
    bestBoundaryDamage: nodes.length > 0
      ? Math.max(...nodes.map((node) => node.state.totalDamage))
      : null,
    outcomeCount: nodes.length,
    completedSegments,
    explored,
    legalTransitions: legal,
  };
}

export function lianyingAnchorDriftWindow(
  anchors,
  anchorIndex,
  options = {},
) {
  if (anchorIndex < 0 || anchorIndex >= anchors.length) return null;
  const {
    slackRows = 1,
    fixFirstAnchor = true,
    fixLastAnchor = true,
    allowedAnchorSchedules = [],
  } = options;
  const explicitRows = allowedAnchorSchedules
    .map((schedule) => Number(schedule?.[anchorIndex]))
    .filter(Number.isInteger);
  if (explicitRows.length > 0) {
    const target = Number(anchors[anchorIndex]);
    const earliest = Math.min(...explicitRows);
    const latest = Math.max(...explicitRows);
    return {
      target,
      earliest,
      latest,
      slack: Math.max(target - earliest, latest - target),
      fixed: earliest === latest,
    };
  }
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
  selectedAnchorRows = [],
) {
  const hasThunder = lianyingPackHasAction(pack, "thunder");
  if (thunderCount >= anchors.length) return !hasThunder;
  const explicitSchedules = options.allowedAnchorSchedules ?? [];
  if (explicitSchedules.length > 0) {
    const matchingSchedules = explicitSchedules.filter((schedule) =>
      selectedAnchorRows.every(
        (row, index) => Number(schedule[index]) === Number(row),
      ));
    if (matchingSchedules.length === 0) return false;
    const allowedRows = new Set(matchingSchedules.map(
      (schedule) => Number(schedule[thunderCount]),
    ));
    if (hasThunder) return allowedRows.has(Number(rowIndex));
    return [...allowedRows].some((row) => row > rowIndex);
  }
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

function lianyingValuePolicyAppliesAt(policy, stage) {
  return policy?.enabled === true && (
    !Array.isArray(policy.applicationStages) ||
    policy.applicationStages.includes(stage)
  );
}

function selectPropagatedValueShadowCandidates(
  nodes,
  baselineNodes,
  quota,
  shadowKind = "value",
) {
  const baselineKeys = new Set(baselineNodes.map((node) =>
    lianyingResynthesisStateKey(node.state)));
  return [...nodes]
    .filter((node) => node.valueShadowKind === shadowKind || (
      shadowKind === "value" &&
      node.valueShadow === true &&
      node.valueShadowKind == null
    ))
    .filter((node) => !baselineKeys.has(
      lianyingResynthesisStateKey(node.state)))
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, Math.max(0, Math.floor(Number(quota))));
}

function selectDamageShadowCandidates(nodes, excludedNodes, quota) {
  const excludedKeys = new Set(excludedNodes.map((node) =>
    lianyingResynthesisStateKey(node.state)));
  return [...nodes]
    .filter((node) => !excludedKeys.has(
      lianyingResynthesisStateKey(node.state)))
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, Math.max(0, Math.floor(Number(quota))));
}

function shadowQuota(policy, kind) {
  return Math.max(0, Math.floor(Number(kind === "damage"
    ? policy?.damageShadowQuota ?? 0
    : policy?.valueQuota ?? 0)));
}

function selectAnchorDriftRowBeam(
  nodes,
  beamWidth,
  pinnedKey,
  boundaryTarget,
  minimumScheduleQuota = 0,
  {
    structureKeyNode = null,
    minimumStructureQuota = 0,
    qualityDiversityKeyNode = null,
    minimumQualityDiversityQuota = 0,
    qualityDiversityCandidateMultiplier = 8,
    qualityDiversitySeed = 0,
    qualityDiversityLineageKeyNode = null,
    minimumQualityDiversityLineageQuota = 0,
  } = {},
) {
  const all = [...nodes];
  const structureKey = typeof structureKeyNode === "function"
    ? structureKeyNode
    : null;
  const pinnedEntries = (Array.isArray(pinnedKey) ? pinnedKey : [pinnedKey])
    .filter(Boolean)
    .map((entry) => typeof entry === "string"
      ? { stateKey: entry, scheduleKey: null }
      : entry);
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
    const scheduleKey = anchorDriftNodeScheduleKey(node);
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
  const structureBest = new Map();
  if (structureKey) {
    for (const node of all) {
      const key = structureKey(node);
      const current = structureBest.get(key);
      if (
        !current ||
        lianyingAnchorDriftLongTermScore(node) >
          lianyingAnchorDriftLongTermScore(current)
      ) structureBest.set(key, node);
    }
  }
  const structureNodes = [...structureBest.values()].sort(
    (left, right) =>
      lianyingAnchorDriftLongTermScore(right) -
      lianyingAnchorDriftLongTermScore(left),
  );
  const structureQuota = Math.min(
    structureNodes.length,
    Math.max(0, Math.floor(Number(minimumStructureQuota ?? 0))),
  );
  const scheduleQuota = Math.min(
    scheduleNodes.length,
    Math.max(
      1,
      Math.ceil(beamWidth / 2),
      Math.floor(Number(minimumScheduleQuota ?? 0)) - structureQuota,
    ),
  );
  let selectedSchedules = new Set(
    selected.map(anchorDriftNodeScheduleKey),
  );
  for (const node of scheduleNodes) {
    if (selected.length >= beamWidth) break;
    const scheduleKey = anchorDriftNodeScheduleKey(node);
    if (selectedSchedules.has(scheduleKey)) continue;
    selected.push(node);
    selectedNodes.add(node);
    selectedSchedules.add(scheduleKey);
    if (selectedSchedules.size >= scheduleQuota) break;
  }
  if (structureKey) {
    const selectedStructureKeys = new Set(selected.map(structureKey));
    if (selectedStructureKeys.size < structureQuota) {
      for (const node of structureNodes) {
        if (selected.length >= beamWidth) break;
        const key = structureKey(node);
        if (selectedStructureKeys.has(key)) continue;
        selected.push(node);
        selectedNodes.add(node);
        selectedStructureKeys.add(key);
        if (selectedStructureKeys.size >= structureQuota) break;
      }
    }
  }
  const lineageNodes = selectBestLianyingNodesByKey(
    all,
    qualityDiversityLineageKeyNode,
    lianyingAnchorDriftLongTermScore,
  );
  const lineageQuota = Math.min(
    lineageNodes.length,
    Math.max(0, Math.floor(Number(minimumQualityDiversityLineageQuota))),
  );
  const selectedLineageKeys = new Set(selected
    .map((node) => qualityDiversityLineageKeyNode?.(node))
    .filter((key) => key !== null && key !== undefined));
  for (const node of lineageNodes) {
    if (selected.length >= beamWidth || selectedLineageKeys.size >= lineageQuota) {
      break;
    }
    const key = qualityDiversityLineageKeyNode(node);
    if (selectedLineageKeys.has(key)) continue;
    selected.push(node);
    selectedNodes.add(node);
    selectedLineageKeys.add(key);
  }
  for (const node of selectLianyingQualityDiversityArchive(all, {
    quota: Math.max(
      0,
      Number(minimumQualityDiversityQuota) - selectedLineageKeys.size,
    ),
    candidateMultiplier: qualityDiversityCandidateMultiplier,
    seed: qualityDiversitySeed,
    keyNode: qualityDiversityKeyNode ?? undefined,
    scoreNode: lianyingAnchorDriftLongTermScore,
  })) {
    if (selected.length >= beamWidth) break;
    if (selectedNodes.has(node)) continue;
    selected.push(node);
    selectedNodes.add(node);
  }
  const base = selectJointRowBeam(
    all,
    beamWidth,
    pinnedEntries[0]?.stateKey ?? null,
    boundaryTarget,
  );
  for (const node of base) {
    if (selected.length >= beamWidth) break;
    if (selectedNodes.has(node)) continue;
    selected.push(node);
    selectedNodes.add(node);
  }
  const matchesPinned = (node, entry) =>
    lianyingResynthesisStateKey(node.state) === entry.stateKey &&
    (entry.scheduleKey === null ||
      anchorDriftNodeScheduleKey(node) === entry.scheduleKey);
  for (const entry of pinnedEntries) {
    if (selected.some((node) => matchesPinned(node, entry))) continue;
    const pinned = all.find((node) => matchesPinned(node, entry));
    if (!pinned) continue;
    if (selected.length < beamWidth) {
      selected.push(pinned);
      selectedNodes.add(pinned);
      continue;
    }
    const scheduleCounts = selected.reduce((counts, node) => {
      const schedule = anchorDriftNodeScheduleKey(node);
      counts.set(schedule, Number(counts.get(schedule) ?? 0) + 1);
      return counts;
    }, new Map());
    const replacementIndex = selected.findLastIndex((node) =>
      !pinnedEntries.some((candidate) => matchesPinned(node, candidate)) &&
      Number(scheduleCounts.get(anchorDriftNodeScheduleKey(node)) ?? 0) > 1);
    if (replacementIndex >= 0) {
      selectedNodes.delete(selected[replacementIndex]);
      selected[replacementIndex] = pinned;
      selectedNodes.add(pinned);
    }
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

export function lianyingAnchorDriftNodeKey(
  thunderCount,
  anchorRows,
  state,
  companionLineageRows = {},
) {
  return `${thunderCount}|${lianyingAnchorDriftScheduleKey(
    anchorRows,
    companionLineageRows,
  )}|${
    lianyingResynthesisStateKey(state)
  }`;
}

function selectAnchorDriftBoundaryNodes(
  nodes,
  beamWidth,
  pinnedKey,
  pinnedScheduleKey,
  {
    scoreNode = null,
    minimumScheduleQuota = 0,
    structureKeyNode = null,
    minimumStructureQuota = 0,
    qualityDiversityKeyNode = null,
    minimumQualityDiversityQuota = 0,
    qualityDiversityCandidateMultiplier = 8,
    qualityDiversitySeed = 0,
    qualityDiversityLineageKeyNode = null,
    minimumQualityDiversityLineageQuota = 0,
    additionalPinned = [],
  } = {},
) {
  const all = [...nodes];
  const score = typeof scoreNode === "function"
    ? scoreNode
    : (node) => node.state.totalDamage;
  const structureKey = typeof structureKeyNode === "function"
    ? structureKeyNode
    : null;
  const scheduleBest = new Map();
  for (const node of all) {
    const key = anchorDriftNodeScheduleKey(node);
    const current = scheduleBest.get(key);
    if (!current || score(node) > score(current)) scheduleBest.set(key, node);
  }
  const scheduleNodes = [...scheduleBest.values()].sort(
    (left, right) => score(right) - score(left),
  );
  const structureBest = new Map();
  if (structureKey) {
    for (const node of all) {
      const key = structureKey(node);
      const current = structureBest.get(key);
      if (!current || score(node) > score(current)) structureBest.set(key, node);
    }
  }
  const structureNodes = [...structureBest.values()].sort(
    (left, right) => score(right) - score(left),
  );
  const structureQuota = Math.min(
    structureNodes.length,
    Math.max(0, Math.floor(Number(minimumStructureQuota ?? 0))),
  );
  const selected = [];
  const selectedNodes = new Set();
  const selectedScheduleKeys = new Set();
  const add = (node) => {
    if (!node || selected.length >= beamWidth || selectedNodes.has(node)) return;
    selected.push(node);
    selectedNodes.add(node);
    selectedScheduleKeys.add(anchorDriftNodeScheduleKey(node));
  };
  const pinned = all.find((node) =>
    anchorDriftNodeScheduleKey(node) === pinnedScheduleKey &&
    lianyingResynthesisStateKey(node.state) === pinnedKey);
  add(pinned);
  for (const entry of additionalPinned) {
    add(all.find((node) =>
      anchorDriftNodeScheduleKey(node) === entry.scheduleKey &&
      lianyingResynthesisStateKey(node.state) === entry.stateKey));
  }
  const scheduleQuota = Math.min(
    scheduleNodes.length,
    Math.max(
      1,
      Math.ceil(beamWidth / 2),
      Math.floor(Number(minimumScheduleQuota ?? 0)) - structureQuota,
    ),
  );
  for (const node of scheduleNodes) {
    add(node);
    if (selectedScheduleKeys.size >= scheduleQuota) break;
  }
  if (structureKey) {
    const selectedStructureKeys = new Set(selected.map(structureKey));
    if (selectedStructureKeys.size < structureQuota) {
      for (const node of structureNodes) {
        if (selected.length >= beamWidth) break;
        const key = structureKey(node);
        if (selectedStructureKeys.has(key)) continue;
        add(node);
        selectedStructureKeys.add(key);
        if (selectedStructureKeys.size >= structureQuota) break;
      }
    }
  }
  const lineageNodes = selectBestLianyingNodesByKey(
    all,
    qualityDiversityLineageKeyNode,
    score,
  );
  const lineageQuota = Math.min(
    lineageNodes.length,
    Math.max(0, Math.floor(Number(minimumQualityDiversityLineageQuota))),
  );
  const selectedLineageKeys = new Set(selected
    .map((node) => qualityDiversityLineageKeyNode?.(node))
    .filter((key) => key !== null && key !== undefined));
  for (const node of lineageNodes) {
    if (selected.length >= beamWidth || selectedLineageKeys.size >= lineageQuota) {
      break;
    }
    const key = qualityDiversityLineageKeyNode(node);
    if (selectedLineageKeys.has(key)) continue;
    add(node);
    selectedLineageKeys.add(key);
  }
  for (const node of selectLianyingQualityDiversityArchive(all, {
    quota: Math.max(
      0,
      Number(minimumQualityDiversityQuota) - selectedLineageKeys.size,
    ),
    candidateMultiplier: qualityDiversityCandidateMultiplier,
    seed: qualityDiversitySeed,
    keyNode: qualityDiversityKeyNode ?? undefined,
    scoreNode: score,
  })) add(node);
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
    structureBuckets: structureBest.size,
    selectedStructureBuckets: structureKey
      ? new Set(selected.map(structureKey)).size
      : 0,
    qualityDiversityBuckets: qualityDiversityKeyNode
      ? new Set(all.map(qualityDiversityKeyNode)).size
      : 0,
    selectedQualityDiversityBuckets: qualityDiversityKeyNode
      ? new Set(selected.map(qualityDiversityKeyNode)).size
      : 0,
    qualityDiversityLineageBuckets: qualityDiversityLineageKeyNode
      ? new Set(all.map(qualityDiversityLineageKeyNode).filter(Boolean)).size
      : 0,
    selectedQualityDiversityLineages: qualityDiversityLineageKeyNode
      ? new Set(selected.map(qualityDiversityLineageKeyNode).filter(Boolean)).size
      : 0,
  };
}

export function lianyingPrimaryHistoryStructureKey(
  packs,
  referencePacks,
  {
    startRow = 1,
    endRow = 79,
    rowBucketSize = 8,
    maximumDifferences = 2,
    companionActionIds = [],
    maximumCompanionDifferences = 2,
  } = {},
) {
  const startIndex = Math.max(0, Math.floor(Number(startRow)) - 1);
  const endIndex = Math.min(
    packs.length,
    referencePacks.length,
    Math.max(startIndex, Math.floor(Number(endRow))),
  );
  const bucketSize = Math.max(1, Math.floor(Number(rowBucketSize)));
  const differenceLimit = Math.max(
    1,
    Math.floor(Number(maximumDifferences)),
  );
  const trackedCompanionActions = new Set(companionActionIds);
  const companionDifferenceLimit = Math.max(
    1,
    Math.floor(Number(maximumCompanionDifferences)),
  );
  const differences = [];
  const countDelta = new Map();
  const companionDifferences = [];
  const companionCountDelta = new Map();
  const rowCompanionActions = (pack) => [
    ...(pack?.prefix ?? []),
    ...(pack?.tail ?? []),
  ].map(actionId).filter((id) => trackedCompanionActions.has(id)).sort();
  for (let index = startIndex; index < endIndex; index += 1) {
    const candidateId = actionId(packs[index]?.primary);
    const referenceId = actionId(referencePacks[index]?.primary);
    if (candidateId !== referenceId) {
      if (differences.length < differenceLimit) {
        differences.push([
          Math.floor((index - startIndex) / bucketSize),
          referenceId,
          candidateId,
        ]);
      }
      countDelta.set(
        referenceId,
        Number(countDelta.get(referenceId) ?? 0) - 1,
      );
      countDelta.set(
        candidateId,
        Number(countDelta.get(candidateId) ?? 0) + 1,
      );
    }
    if (trackedCompanionActions.size === 0) continue;
    const candidateCompanions = rowCompanionActions(packs[index]);
    const referenceCompanions = rowCompanionActions(referencePacks[index]);
    if (JSON.stringify(candidateCompanions) ===
      JSON.stringify(referenceCompanions)) continue;
    if (companionDifferences.length < companionDifferenceLimit) {
      companionDifferences.push([
        Math.floor((index - startIndex) / bucketSize),
        referenceCompanions,
        candidateCompanions,
      ]);
    }
    for (const id of referenceCompanions) {
      companionCountDelta.set(
        id,
        Number(companionCountDelta.get(id) ?? 0) - 1,
      );
    }
    for (const id of candidateCompanions) {
      companionCountDelta.set(
        id,
        Number(companionCountDelta.get(id) ?? 0) + 1,
      );
    }
  }
  const deltas = [...countDelta.entries()]
    .filter(([, count]) => count !== 0)
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  const companionDeltas = [...companionCountDelta.entries()]
    .filter(([, count]) => count !== 0)
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  return JSON.stringify([
    differences,
    deltas,
    companionDifferences,
    companionDeltas,
  ]);
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
    valueProbeSegmentHorizon = 1,
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
    valueShadowKind: null,
    boundaryProbeIds: [],
  }];
  let explored = 0;
  let legal = 0;
  let peakRowStates = 1;
  let valueShadowRows = 0;
  let valueShadowSelections = 0;
  let valueShadowRowIntroductions = 0;
  let valueShadowRowPropagations = 0;
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
              valueShadowKind: node.valueShadowKind ?? null,
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
        valueShadowKind: null,
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
      const introduceRowShadows = lianyingValuePolicyAppliesAt(
        valueShadowPolicy,
        "row",
      );
      const damageShadowNodes = (introduceRowShadows
        ? selectDamageShadowCandidates(
            candidates.values(),
            baselineNodes,
            shadowQuota(valueShadowPolicy, "damage"),
          )
        : selectPropagatedValueShadowCandidates(
            candidates.values(),
            baselineNodes,
            shadowQuota(valueShadowPolicy, "damage"),
            "damage",
          )
      ).map((node) => ({
        ...node,
        valueShadow: true,
        valueShadowKind: "damage",
      }));
      const valueShadowNodes = (introduceRowShadows
        ? selectLianyingValueShadowCandidates(
            candidates.values(),
            [...baselineNodes, ...damageShadowNodes],
            endTick,
            valueShadowPolicy,
          )
        : selectPropagatedValueShadowCandidates(
            candidates.values(),
            [...baselineNodes, ...damageShadowNodes],
            shadowQuota(valueShadowPolicy, "value"),
            "value",
          )
      ).map((node) => ({
        ...node,
        valueShadow: true,
        valueShadowKind: "value",
      }));
      const shadowNodes = [...damageShadowNodes, ...valueShadowNodes];
      if (shadowNodes.length > 0) valueShadowRows += 1;
      valueShadowSelections += shadowNodes.length;
      if (introduceRowShadows) {
        valueShadowRowIntroductions += shadowNodes.length;
      } else {
        valueShadowRowPropagations += shadowNodes.length;
      }
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
          probeSegmentCount: 0,
          probeEndIndex: null,
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
    const boundaryDamageShadowNodes = (lianyingValuePolicyAppliesAt(
      valueShadowPolicy,
      "boundary",
    )
      ? selectDamageShadowCandidates(
          nodes,
          baselineBoundary.nodes,
          shadowQuota(valueShadowPolicy, "damage"),
        )
      : []
    ).map((node) => ({
      ...node,
      valueShadow: true,
      valueShadowKind: "damage",
    }));
    const boundaryValueShadowNodes = (lianyingValuePolicyAppliesAt(
      valueShadowPolicy,
      "boundary",
    )
      ? selectLianyingValueShadowCandidates(
          nodes,
          [...baselineBoundary.nodes, ...boundaryDamageShadowNodes],
          endTick,
          valueShadowPolicy,
        )
      : []
    ).map((node) => ({
      ...node,
      valueShadow: true,
      valueShadowKind: "value",
    }));
    const boundaryShadowNodes = [
      ...boundaryDamageShadowNodes,
      ...boundaryValueShadowNodes,
    ];
    const boundaryDamageRanking = [...nodes].sort(
      (left, right) => right.state.totalDamage - left.state.totalDamage);
    const boundaryRankByKey = new Map(boundaryDamageRanking.map(
      (node, index) => [lianyingResynthesisStateKey(node.state), index + 1]));
    const valueShadowDiagnostics = boundaryShadowNodes.map((node) => {
      const features = lianyingStateValueFeatures(node.state, endTick);
      const predictedValue = predictLianyingRidgeValue(
        valueShadowPolicy.model,
        features,
      );
      return {
        shadowKind: node.valueShadowKind ?? "value",
        lineageId: node.lineageId,
        stateKey: lianyingResynthesisStateKey(node.state),
        baselineRank: boundaryRankByKey.get(
          lianyingResynthesisStateKey(node.state)) ?? null,
        totalDamage: node.state.totalDamage,
        predictedValue,
        valueScore: node.state.totalDamage +
          Number(valueShadowPolicy.valueWeight ?? 1) * predictedValue,
        rage: features.rage,
        dragonRideStacks: features.dragonRideStacks,
        mounted: features.mounted,
        thunderRemainingSeconds: features.thunderRemainingSeconds,
        rideRemainingSeconds: features.rideRemainingSeconds,
        orangeRemainingSeconds: features.orangeRemainingSeconds,
      };
    });
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
      const probeSegments = identified.ranges.slice(
        segmentIndex + 1,
        segmentIndex + 1 + Math.max(
          1,
          Math.floor(Number(valueProbeSegmentHorizon)),
        ),
      );
      if (probeSegments.length > 0) {
        const probeSources = probeSegments.map((entry) => corePacks.slice(
          entry.startIndex,
          entry.endIndex,
        ));
        const probeEndIndex = probeSegments.at(-1).endIndex;
        for (const record of boundaryProbeEntries) {
          boundaryNextSegmentProbeAttempts += 1;
          const probe = evaluateLianyingSegmentHorizonProbe(
            runtime,
            record.node.state,
            probeSources,
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
            warmStates[probeEndIndex].totalDamage;
          record.probeSegmentCount = probe.completedSegments;
          record.probeEndIndex = probeEndIndex;
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
      damageShadowOutgoingStates: boundaryDamageShadowNodes.length,
      modelValueShadowOutgoingStates: boundaryValueShadowNodes.length,
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
      valueShadowDiagnostics,
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
    valueShadowKind: null,
  });
  const baselineCoreFinalists = nodes
    .filter((node) => node.valueShadow !== true)
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, coreFinalistCount);
  const damageShadowCoreFinalists = nodes
    .filter((node) => node.valueShadowKind === "damage")
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, shadowQuota(valueShadowPolicy, "damage"));
  const valueShadowCoreFinalists = nodes
    .filter((node) => node.valueShadowKind === "value" || (
      node.valueShadow === true && node.valueShadowKind == null))
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, shadowQuota(valueShadowPolicy, "value"));
  for (const node of [
    ...baselineCoreFinalists,
    ...damageShadowCoreFinalists,
    ...valueShadowCoreFinalists,
  ]) {
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
        valueShadowKind: node.valueShadowKind ?? null,
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
        const isSingleSegmentProbe = probe.probeSegmentCount === 1;
        valueTrainingRows.push(makeValueRow(probe.node, {
          traceId: isSingleSegmentProbe
            ? "multi-boundary-next-segment"
            : "multi-boundary-segment-horizon",
          segment: probe.segment,
          globalRow: probe.globalRow,
          baselineRank: probe.baselineRank,
          bestFinalDamage: projectedFinalDamage,
          referenceDamage: probe.referenceDamage,
          metadata: {
            labelKind: isSingleSegmentProbe
              ? "actual-next-segment"
              : "actual-segment-horizon",
            selectionStage: "boundary",
            selectedByBaselineBeam: probe.selectedByBaselineBeam,
            selectedByValueShadow: probe.selectedByValueShadow,
            lineageId: probe.node.lineageId,
            descendantOutcomeCount: probe.nextSegmentOutcomeCount,
            probeBeamWidth: Number(valueProbeNextSegmentBeamWidth),
            probeSegmentHorizon: Number(valueProbeSegmentHorizon),
            probeSegmentCount: probe.probeSegmentCount,
            probeEndRow: Number(probe.probeEndIndex),
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
  const damageShadowCoreCandidates = valueShadowCoreCandidates.filter(
    (candidate) => candidate.valueShadowKind === "damage");
  const modelValueShadowCoreCandidates = valueShadowCoreCandidates.filter(
    (candidate) => candidate.valueShadowKind === "value" ||
      candidate.valueShadowKind == null);
  const bestCoreDamage = (candidates) => candidates.length > 0
    ? Math.max(...candidates.map((candidate) => candidate.coreDamage))
    : null;
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
    damageShadowCoreCandidates: damageShadowCoreCandidates.length,
    bestDamageShadowCoreDamage: bestCoreDamage(damageShadowCoreCandidates),
    bestDamageShadowCoreDamageGain: damageShadowCoreCandidates.length > 0
      ? bestCoreDamage(damageShadowCoreCandidates) -
        coreBaseline.state.totalDamage
      : null,
    modelValueShadowCoreCandidates: modelValueShadowCoreCandidates.length,
    bestModelValueShadowCoreDamage: bestCoreDamage(
      modelValueShadowCoreCandidates),
    bestModelValueShadowCoreDamageGain:
      modelValueShadowCoreCandidates.length > 0
        ? bestCoreDamage(modelValueShadowCoreCandidates) -
          coreBaseline.state.totalDamage
        : null,
    baselineCoreFinalists: baselineCoreFinalists.length,
    valueShadowCoreFinalists: valueShadowCoreFinalists.length,
    damageShadowCoreFinalists: damageShadowCoreFinalists.length,
    valueShadowRows,
    valueShadowSelections,
    valueShadowRowIntroductions,
    valueShadowRowPropagations,
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
            boundarySegmentHorizonRows: valueTrainingRows.filter(
              (row) => row.labelKind === "actual-segment-horizon").length,
            boundaryFullDescendantRows: valueTrainingRows.filter(
              (row) => row.labelKind === "actual-full-descendant").length,
          },
        }
      : null,
    coarseCandidates: coarseCandidates.map((candidate) => ({
      isIncumbent: candidate.isIncumbent,
      valueShadow: candidate.valueShadow === true,
      valueShadowKind: candidate.valueShadowKind ?? null,
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
            damageShadowQuota: Number(
              valueShadowPolicy.damageShadowQuota ?? 0),
            valueWeight: Number(valueShadowPolicy.valueWeight ?? 1),
            maximumBaselineRank: Number(valueShadowPolicy.maximumBaselineRank),
            modelKind: valueShadowPolicy.model?.kind ?? null,
            modelTrainingRows: valueShadowPolicy.model?.trainingRows ?? null,
            applicationStages: Array.isArray(valueShadowPolicy.applicationStages)
              ? [...valueShadowPolicy.applicationStages]
              : null,
          }
        : null,
      collectValueTrainingData,
      valueProbeMaximumBaselineRank,
      valueProbeRowStride,
      valueProbeNextSegmentBeamWidth,
      valueProbeSegmentHorizon,
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
    allowedAnchorSchedules = null,
    companionAnchorTemplate = null,
    preserveCompanionLineageTypes = [],
    additionalWarmAxes = [],
    includeScheduleCandidatePacks = false,
    includeCoreCandidatePacks = false,
    coreCandidatePackLimit = 0,
    primaryStructureDiversity = null,
    qualityDiversityRestart = null,
    primaryActionConstraints = [],
    primaryWindowConstraints = [],
    primaryCountConstraints = [],
    actionCountConstraints = [],
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

  const normalizedAllowedAnchorSchedules = Array.isArray(allowedAnchorSchedules)
    ? [...new Map(allowedAnchorSchedules.map((schedule) => {
        const normalized = schedule.map(Number);
        if (
          normalized.length !== anchors.length ||
          normalized.some((row) => !Number.isInteger(row))
        ) {
          throw new Error("显式雷锚点模板必须与原锚点等长且全部为整数行索引");
        }
        return [JSON.stringify(normalized), normalized];
      })).values()]
    : [];
  if (
    normalizedAllowedAnchorSchedules.length > 0 &&
    !normalizedAllowedAnchorSchedules.some(
      (schedule) => JSON.stringify(schedule) === JSON.stringify(anchors),
    )
  ) {
    throw new Error("显式雷锚点模板必须包含原轴锚点，以保证不降级回退");
  }

  const driftOptions = {
    slackRows: anchorSlackRows,
    fixFirstAnchor,
    fixLastAnchor,
    allowedAnchorSchedules: normalizedAllowedAnchorSchedules,
  };
  const firstAnchor = anchors[0];
  const prefixPacks = clonePacks(corePacks.slice(0, firstAnchor));
  const normalizedPrimaryActionConstraints = (primaryActionConstraints ?? [])
    .map((constraint) => ({
      row: Math.floor(Number(constraint.row)),
      allowedActionIds: Array.isArray(constraint.allowedActionIds)
        ? [...new Set(constraint.allowedActionIds.map(String))]
        : null,
      forbiddenActionIds: Array.isArray(constraint.forbiddenActionIds)
        ? [...new Set(constraint.forbiddenActionIds.map(String))]
        : null,
    }));
  for (const constraint of normalizedPrimaryActionConstraints) {
    if (
      !Number.isInteger(constraint.row) ||
      constraint.row < 1 ||
      constraint.row > corePacks.length
    ) {
      throw new Error("反事实主技能约束行必须位于技能轴范围内");
    }
    if (
      constraint.allowedActionIds === null &&
      constraint.forbiddenActionIds === null
    ) {
      throw new Error("反事实主技能约束必须声明允许或禁止的技能");
    }
    if (
      constraint.row <= firstAnchor &&
      !isLianyingPrimaryActionPackAllowed(
        corePacks[constraint.row - 1],
        constraint.row - 1,
        normalizedPrimaryActionConstraints,
      )
    ) {
      throw new Error(`第${constraint.row}行位于固定前缀，无法施加反事实主技能约束`);
    }
  }
  const normalizedPrimaryWindowConstraints = (primaryWindowConstraints ?? [])
    .map((constraint) => ({
      startRow: Math.floor(Number(constraint.startRow)),
      endRow: Math.floor(Number(constraint.endRow)),
      signatureMode: constraint.signatureMode === "counts"
        ? "counts"
        : "sequence",
      trackedActionIds: Array.isArray(constraint.trackedActionIds)
        ? [...new Set(constraint.trackedActionIds.map(String))]
        : null,
    }));
  for (const constraint of normalizedPrimaryWindowConstraints) {
    if (
      !Number.isInteger(constraint.startRow) ||
      !Number.isInteger(constraint.endRow) ||
      constraint.startRow < 1 ||
      constraint.startRow > constraint.endRow ||
      constraint.endRow > corePacks.length
    ) {
      throw new Error("反事实主技能窗口必须位于技能轴范围内且起点不晚于终点");
    }
    if (
      Array.isArray(constraint.trackedActionIds) &&
      constraint.trackedActionIds.length === 0
    ) {
      throw new Error("反事实主技能窗口的跟踪技能清单不能为空");
    }
    if (constraint.endRow <= firstAnchor) {
      throw new Error(
        `第${constraint.startRow}至${constraint.endRow}行位于固定前缀，无法施加反事实主技能窗口`,
      );
    }
  }
  const normalizedPrimaryCountConstraints = (primaryCountConstraints ?? [])
    .map((constraint) => ({
      startRow: Math.floor(Number(constraint.startRow)),
      endRow: Math.floor(Number(constraint.endRow)),
      counts: Object.fromEntries(Object.entries(constraint.counts ?? {})
        .map(([id, count]) => [String(id), Math.floor(Number(count))])),
    }));
  for (const constraint of normalizedPrimaryCountConstraints) {
    if (
      !Number.isInteger(constraint.startRow) ||
      !Number.isInteger(constraint.endRow) ||
      constraint.startRow < 1 ||
      constraint.startRow > constraint.endRow ||
      constraint.endRow > corePacks.length
    ) {
      throw new Error("主技能计数骨架必须位于技能轴范围内且起点不晚于终点");
    }
    if (
      Object.keys(constraint.counts).length === 0 ||
      Object.values(constraint.counts).some(
        (count) => !Number.isInteger(count) || count < 0,
      )
    ) {
      throw new Error("主技能计数骨架必须包含非负整数目标");
    }
    if (
      constraint.endRow <= firstAnchor &&
      !isLianyingPrimaryCountPathAllowed(
        corePacks,
        constraint.endRow,
        [constraint],
      )
    ) {
      throw new Error(
        `第${constraint.startRow}至${constraint.endRow}行位于固定前缀，无法施加主技能计数骨架`,
      );
    }
  }
  const normalizedActionCountConstraints = (actionCountConstraints ?? [])
    .map((constraint) => ({
      startRow: Math.floor(Number(constraint.startRow)),
      endRow: Math.floor(Number(constraint.endRow)),
      counts: Object.fromEntries(Object.entries(constraint.counts ?? {})
        .map(([id, count]) => [String(id), Math.floor(Number(count))])),
    }));
  for (const constraint of normalizedActionCountConstraints) {
    if (
      !Number.isInteger(constraint.startRow) ||
      !Number.isInteger(constraint.endRow) ||
      constraint.startRow < 1 ||
      constraint.startRow > constraint.endRow ||
      constraint.endRow > corePacks.length
    ) {
      throw new Error("动作包计数骨架必须位于技能轴范围内且起点不晚于终点");
    }
    if (
      Object.keys(constraint.counts).length === 0 ||
      Object.values(constraint.counts).some(
        (count) => !Number.isInteger(count) || count < 0,
      )
    ) {
      throw new Error("动作包计数骨架必须包含非负整数目标");
    }
    if (
      constraint.endRow <= firstAnchor &&
      !isLianyingActionCountPathAllowed(
        corePacks,
        constraint.endRow,
        [constraint],
      )
    ) {
      throw new Error(
        `第${constraint.startRow}至${constraint.endRow}行位于固定前缀，无法施加动作包计数骨架`,
      );
    }
  }
  const normalizedPrimaryStructureDiversity = primaryStructureDiversity
    ? {
        startRow: Math.max(
          1,
          Math.floor(Number(primaryStructureDiversity.startRow ?? 1)),
        ),
        endRow: Math.max(
          1,
          Math.floor(Number(primaryStructureDiversity.endRow ?? 79)),
        ),
        rowBucketSize: Math.max(
          1,
          Math.floor(Number(primaryStructureDiversity.rowBucketSize ?? 8)),
        ),
        maximumDifferences: Math.max(
          1,
          Math.floor(Number(primaryStructureDiversity.maximumDifferences ?? 2)),
        ),
        companionActionIds: [...new Set(
          primaryStructureDiversity.companionActionIds ?? [],
        )],
        maximumCompanionDifferences: Math.max(
          1,
          Math.floor(Number(
            primaryStructureDiversity.maximumCompanionDifferences ?? 2,
          )),
        ),
        rowQuota: Math.max(
          0,
          Math.floor(Number(primaryStructureDiversity.rowQuota ?? 0)),
        ),
        boundaryQuota: Math.max(
          0,
          Math.floor(Number(primaryStructureDiversity.boundaryQuota ?? 0)),
        ),
      }
    : null;
  const primaryStructureKeyNode = normalizedPrimaryStructureDiversity
    ? (node) => lianyingPrimaryHistoryStructureKey(
        [...prefixPacks, ...node.packs],
        corePacks,
        normalizedPrimaryStructureDiversity,
      )
    : null;
  const normalizedQualityDiversityRestart = qualityDiversityRestart
    ? {
        bucketTicks: Math.max(
          1,
          Math.floor(Number(qualityDiversityRestart.bucketTicks ?? 16000)),
        ),
        candidateMultiplier: Math.max(
          1,
          Math.floor(Number(
            qualityDiversityRestart.candidateMultiplier ?? 8,
          )),
        ),
        rowQuota: Math.max(
          0,
          Math.floor(Number(qualityDiversityRestart.rowQuota ?? 0)),
        ),
        boundaryQuota: Math.max(
          0,
          Math.floor(Number(qualityDiversityRestart.boundaryQuota ?? 0)),
        ),
        lineageQuota: Math.max(
          0,
          Math.floor(Number(qualityDiversityRestart.lineageQuota ?? 0)),
        ),
        lineageTenureSegments: Math.max(
          1,
          Math.floor(Number(
            qualityDiversityRestart.lineageTenureSegments ?? 1,
          )),
        ),
        seed: Math.floor(Number(qualityDiversityRestart.seed ?? 0)),
      }
    : null;
  const qualityDiversityKeyNode = normalizedQualityDiversityRestart
    ? (node) => lianyingQualityDiversityCellKey(node.state, {
        bucketTicks: normalizedQualityDiversityRestart.bucketTicks,
      })
    : null;
  const companionLineageTypes = [...new Set(
    (preserveCompanionLineageTypes ?? []).filter((type) =>
      LIANYING_COMPANION_LINEAGE_TYPES.includes(type)),
  )];
  const initialCompanionLineageRows = selectCompanionLineageRows(
    prefixPacks,
    companionLineageTypes,
  );
  for (let rowIndex = 0; rowIndex < prefixPacks.length; rowIndex += 1) {
    if (!isLianyingCompanionAnchorPackAllowed(
      prefixPacks[rowIndex],
      rowIndex,
      companionAnchorTemplate,
      prefixPacks.slice(0, rowIndex),
    )) {
      throw new Error(`第${rowIndex + 1}行固定前缀不满足伴随锚点模板`);
    }
  }
  const additionalWarmSources = (additionalWarmAxes ?? []).map(
    (axis, index) => {
      const source = stripLianyingDashPacks(axis);
      if (source.length !== corePacks.length) {
        throw new Error(`附加热启动${index + 1}与原轴行数不同`);
      }
      if (
        JSON.stringify(source.slice(0, firstAnchor)) !==
        JSON.stringify(prefixPacks)
      ) {
        throw new Error(`附加热启动${index + 1}在首雷前与固定前缀不同`);
      }
      const states = buildWarmStates(runtime, source, endTick);
      return {
        source,
        state: states[firstAnchor],
        packs: [],
        thunderCount: 0,
        anchorRows: [],
        companionLineageRows: structuredClone(initialCompanionLineageRows),
        lineageId: `additional-warm-${index + 1}`,
        active: true,
      };
    },
  );
  const warmStates = buildWarmStates(runtime, corePacks, endTick);
  let warmState = warmStates[firstAnchor];
  let warmGeneratedPacks = [];
  let warmThunderCount = 0;
  let warmCompanionLineageRows = structuredClone(initialCompanionLineageRows);
  let warmLineageId = "warm";
  let warmLineageBaseDamage = null;
  let warmLineageProjectedFinal = null;
  let warmConstraintActive = true;
  let nodes = [{
    state: warmState,
    packs: [],
    thunderCount: 0,
    anchorRows: [],
    companionLineageRows: structuredClone(initialCompanionLineageRows),
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
        if (!isLianyingPrimaryActionPackAllowed(
          pack,
          rowIndex,
          normalizedPrimaryActionConstraints,
        )) continue;
        const candidatePath = [
          ...prefixPacks,
          ...node.packs,
          cloneLianyingPack(pack),
        ];
        if (!isLianyingPrimaryWindowPathAllowed(
          candidatePath,
          rowIndex + 1,
          corePacks,
          normalizedPrimaryWindowConstraints,
        )) continue;
        if (!isLianyingPrimaryCountPathAllowed(
          candidatePath,
          rowIndex + 1,
          normalizedPrimaryCountConstraints,
        )) continue;
        if (!isLianyingActionCountPathAllowed(
          candidatePath,
          rowIndex + 1,
          normalizedActionCountConstraints,
        )) continue;
        if (!isLianyingAnchorDriftPackAllowed(
          pack,
          rowIndex,
          node.thunderCount,
          anchors,
          driftOptions,
          node.anchorRows,
        )) continue;
        if (!isLianyingCompanionAnchorPackAllowed(
          pack,
          rowIndex,
          companionAnchorTemplate,
          [...prefixPacks, ...node.packs],
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
          const anchorRows = hasThunder
            ? [...node.anchorRows, rowIndex]
            : node.anchorRows;
          const companionLineageRows = appendCompanionLineageRows(
            node.companionLineageRows,
            pack,
            rowIndex + 1,
            companionLineageTypes,
          );
          const candidate = {
            state,
            packs: [...node.packs, cloneLianyingPack(pack)],
            thunderCount,
            anchorRows,
            companionLineageRows,
            lineageId: node.lineageId,
            lineageBaseDamage: node.lineageBaseDamage,
            lineageProjectedFinal: node.lineageProjectedFinal,
            qualityDiversityLineageId:
              node.qualityDiversityLineageId,
            qualityDiversityLineageExpiresAtAnchor:
              node.qualityDiversityLineageExpiresAtAnchor,
          };
          const key = lianyingAnchorDriftNodeKey(
            thunderCount,
            anchorRows,
            state,
            companionLineageRows,
          );
          const current = candidates.get(key);
          if (!current || state.totalDamage > current.state.totalDamage) {
            candidates.set(key, candidate);
          }
        } catch {
          // 完整状态机淘汰资源、冷却、充能和马上状态非法动作。
        }
      }
    }

    for (const warmNode of additionalWarmSources) {
      if (!warmNode.active) continue;
      const warmPack = warmNode.source[rowIndex];
      if (
        !isLianyingPrimaryActionPackAllowed(
          warmPack,
          rowIndex,
          normalizedPrimaryActionConstraints,
        ) ||
        !isLianyingPrimaryWindowPathAllowed(
          warmNode.source.slice(0, rowIndex + 1),
          rowIndex + 1,
          corePacks,
          normalizedPrimaryWindowConstraints,
        ) ||
        !isLianyingPrimaryCountPathAllowed(
          warmNode.source.slice(0, rowIndex + 1),
          rowIndex + 1,
          normalizedPrimaryCountConstraints,
        ) ||
        !isLianyingActionCountPathAllowed(
          warmNode.source.slice(0, rowIndex + 1),
          rowIndex + 1,
          normalizedActionCountConstraints,
        ) ||
        !isLianyingAnchorDriftPackAllowed(
          warmPack,
          rowIndex,
          warmNode.thunderCount,
          anchors,
          driftOptions,
          warmNode.anchorRows,
        ) ||
        !isLianyingCompanionAnchorPackAllowed(
          warmPack,
          rowIndex,
          companionAnchorTemplate,
          [...prefixPacks, ...warmNode.packs],
        )
      ) {
        warmNode.active = false;
        continue;
      }
      try {
        warmNode.state = executeActionPack(
          warmNode.state,
          warmPack,
          runtime.config,
          runtime.oracle,
          { endTick },
        );
        warmNode.packs = [...warmNode.packs, cloneLianyingPack(warmPack)];
        const hasThunder = lianyingPackHasAction(warmPack, "thunder");
        warmNode.thunderCount += Number(hasThunder);
        if (hasThunder) warmNode.anchorRows = [...warmNode.anchorRows, rowIndex];
        warmNode.companionLineageRows = appendCompanionLineageRows(
          warmNode.companionLineageRows,
          warmPack,
          rowIndex + 1,
          companionLineageTypes,
        );
        const key = lianyingAnchorDriftNodeKey(
          warmNode.thunderCount,
          warmNode.anchorRows,
          warmNode.state,
          warmNode.companionLineageRows,
        );
        const current = candidates.get(key);
        if (!current || warmNode.state.totalDamage > current.state.totalDamage) {
          candidates.set(key, {
            state: warmNode.state,
            packs: warmNode.packs,
            thunderCount: warmNode.thunderCount,
            anchorRows: warmNode.anchorRows,
            companionLineageRows: warmNode.companionLineageRows,
            lineageId: warmNode.lineageId,
          });
        }
      } catch {
        warmNode.active = false;
      }
    }

    const warmPack = corePacks[rowIndex];
    if (!isLianyingAnchorDriftPackAllowed(
      warmPack,
      rowIndex,
      warmThunderCount,
      anchors,
      driftOptions,
      anchors.slice(0, warmThunderCount),
    )) {
      throw new Error(`第${rowIndex + 1}行热启动轴不满足雷锚点漂移约束`);
    }
    if (!isLianyingCompanionAnchorPackAllowed(
      warmPack,
      rowIndex,
      companionAnchorTemplate,
      [...prefixPacks, ...warmGeneratedPacks],
    )) {
      throw new Error(`第${rowIndex + 1}行热启动轴不满足伴随锚点模板`);
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
    warmConstraintActive = warmConstraintActive &&
      isLianyingPrimaryActionPackAllowed(
        warmPack,
        rowIndex,
        normalizedPrimaryActionConstraints,
      ) &&
      isLianyingPrimaryWindowPathAllowed(
        [...prefixPacks, ...warmGeneratedPacks],
        rowIndex + 1,
        corePacks,
        normalizedPrimaryWindowConstraints,
      ) &&
      isLianyingPrimaryCountPathAllowed(
        [...prefixPacks, ...warmGeneratedPacks],
        rowIndex + 1,
        normalizedPrimaryCountConstraints,
      ) &&
      isLianyingActionCountPathAllowed(
        [...prefixPacks, ...warmGeneratedPacks],
        rowIndex + 1,
        normalizedActionCountConstraints,
      );
    const warmHasThunder = lianyingPackHasAction(warmPack, "thunder");
    warmThunderCount += Number(warmHasThunder);
    const warmAnchorRows = anchors.slice(0, warmThunderCount);
    warmCompanionLineageRows = appendCompanionLineageRows(
      warmCompanionLineageRows,
      warmPack,
      rowIndex + 1,
      companionLineageTypes,
    );
    const warmKey = lianyingResynthesisStateKey(warmState);
    const warmCompositeKey = lianyingAnchorDriftNodeKey(
      warmThunderCount,
      warmAnchorRows,
      warmState,
      warmCompanionLineageRows,
    );
    const currentWarm = candidates.get(warmCompositeKey);
    if (
      warmConstraintActive &&
      (!currentWarm || warmState.totalDamage > currentWarm.state.totalDamage)
    ) {
      candidates.set(warmCompositeKey, {
        state: warmState,
        packs: warmGeneratedPacks,
        thunderCount: warmThunderCount,
        anchorRows: warmAnchorRows,
        companionLineageRows: warmCompanionLineageRows,
        lineageId: warmLineageId,
        lineageBaseDamage: warmLineageBaseDamage,
        lineageProjectedFinal: warmLineageProjectedFinal,
      });
    }
    nodes = selectAnchorDriftRowBeam(
      candidates.values(),
      rowBeamWidth,
      [
        ...(warmConstraintActive
          ? [{
              stateKey: warmKey,
              scheduleKey: lianyingAnchorDriftScheduleKey(
                warmAnchorRows,
                warmCompanionLineageRows,
              ),
            }]
          : []),
        ...additionalWarmSources
          .filter((candidate) => candidate.active)
          .map((candidate) => ({
            stateKey: lianyingResynthesisStateKey(candidate.state),
            scheduleKey: anchorDriftNodeScheduleKey(candidate),
          })),
      ],
      warmState,
      companionLineageTypes.length > 0 ? rowBeamWidth : 0,
      {
        structureKeyNode: primaryStructureKeyNode,
        minimumStructureQuota:
          normalizedPrimaryStructureDiversity?.rowQuota ?? 0,
        qualityDiversityKeyNode,
        minimumQualityDiversityQuota:
          normalizedQualityDiversityRestart?.rowQuota ?? 0,
        qualityDiversityCandidateMultiplier:
          normalizedQualityDiversityRestart?.candidateMultiplier ?? 8,
        qualityDiversitySeed:
          (normalizedQualityDiversityRestart?.seed ?? 0) + rowIndex + 1,
        qualityDiversityLineageKeyNode: qualityDiversityLineageKey,
        minimumQualityDiversityLineageQuota:
          normalizedQualityDiversityRestart?.lineageQuota ?? 0,
      },
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
    const pinnedScheduleKey = lianyingAnchorDriftScheduleKey(
      anchors.slice(0, anchorIndex + 1),
      warmCompanionLineageRows,
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
        minimumScheduleQuota: companionLineageTypes.length > 0
          ? boundaryBeamWidth
          : normalizedAllowedAnchorSchedules.length,
        structureKeyNode: primaryStructureKeyNode,
        minimumStructureQuota:
          normalizedPrimaryStructureDiversity?.boundaryQuota ?? 0,
        qualityDiversityKeyNode,
        minimumQualityDiversityQuota:
          normalizedQualityDiversityRestart?.boundaryQuota ?? 0,
        qualityDiversityCandidateMultiplier:
          normalizedQualityDiversityRestart?.candidateMultiplier ?? 8,
        qualityDiversitySeed:
          (normalizedQualityDiversityRestart?.seed ?? 0) + 10000 + anchorIndex,
        qualityDiversityLineageKeyNode: qualityDiversityLineageKey,
        minimumQualityDiversityLineageQuota:
          normalizedQualityDiversityRestart?.lineageQuota ?? 0,
        additionalPinned: additionalWarmSources
          .filter((candidate) =>
            candidate.active && candidate.thunderCount >= anchorIndex + 1)
          .map((candidate) => ({
            stateKey: lianyingResynthesisStateKey(candidate.state),
            scheduleKey: anchorDriftNodeScheduleKey(candidate),
          })),
      },
    );
    const lineageRefresh = normalizedQualityDiversityRestart?.lineageQuota > 0
      ? refreshLianyingQualityDiversityLineages(boundary.nodes, {
          anchorIndex,
          quota: normalizedQualityDiversityRestart.lineageQuota,
          tenureSegments:
            normalizedQualityDiversityRestart.lineageTenureSegments,
          candidateMultiplier:
            normalizedQualityDiversityRestart.candidateMultiplier,
          seed: normalizedQualityDiversityRestart.seed + 10000,
          keyNode: qualityDiversityKeyNode,
          scoreNode: useSuffixValue
            ? (node) => node.suffixValue.score
            : lianyingAnchorDriftLongTermScore,
        })
      : {
          nodes: boundary.nodes,
          activeLineages: 0,
          retainedLineages: 0,
          newLineages: 0,
        };
    nodes = lineageRefresh.nodes;
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
      availablePrimaryStructures: boundary.structureBuckets,
      survivingPrimaryStructures: boundary.selectedStructureBuckets,
      availableQualityDiversityCells: boundary.qualityDiversityBuckets,
      survivingQualityDiversityCells:
        boundary.selectedQualityDiversityBuckets,
      availableQualityDiversityLineages:
        boundary.qualityDiversityLineageBuckets,
      survivingQualityDiversityLineages:
        boundary.selectedQualityDiversityLineages,
      activeQualityDiversityLineages: lineageRefresh.activeLineages,
      retainedQualityDiversityLineages: lineageRefresh.retainedLineages,
      newQualityDiversityLineages: lineageRefresh.newLineages,
      actualRowHistogram,
      survivingAnchorSchedules: [...new Set(nodes.map(
        (node) => JSON.stringify(node.anchorRows.map((row) => row + 1)),
      ))].map((schedule) => JSON.parse(schedule)),
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
    lianyingAnchorDriftScheduleKey(anchors, warmCompanionLineageRows),
    {
      minimumScheduleQuota: companionLineageTypes.length > 0
        ? boundaryBeamWidth
        : normalizedAllowedAnchorSchedules.length,
      structureKeyNode: primaryStructureKeyNode,
      minimumStructureQuota:
        normalizedPrimaryStructureDiversity?.boundaryQuota ?? 0,
      qualityDiversityKeyNode,
      minimumQualityDiversityQuota:
        normalizedQualityDiversityRestart?.boundaryQuota ?? 0,
      qualityDiversityCandidateMultiplier:
        normalizedQualityDiversityRestart?.candidateMultiplier ?? 8,
      qualityDiversitySeed:
        (normalizedQualityDiversityRestart?.seed ?? 0) + 20000,
      qualityDiversityLineageKeyNode: qualityDiversityLineageKey,
      minimumQualityDiversityLineageQuota:
        normalizedQualityDiversityRestart?.lineageQuota ?? 0,
      additionalPinned: additionalWarmSources
        .filter((candidate) =>
          candidate.active && candidate.thunderCount === anchors.length)
        .map((candidate) => ({
          stateKey: lianyingResynthesisStateKey(candidate.state),
          scheduleKey: anchorDriftNodeScheduleKey(candidate),
        })),
    },
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
  const coreBestBySchedule = new Map();
  for (const candidate of coreCandidatesByPath.values()) {
    const key = JSON.stringify(candidate.anchorRows);
    const current = coreBestBySchedule.get(key);
    if (!current || candidate.coreDamage > current.coreDamage) {
      coreBestBySchedule.set(key, candidate);
    }
  }
  const coreScheduleDiagnostics = [...coreBestBySchedule.values()].map(
    (candidate) => ({
      anchorRows: candidate.anchorRows.map((row) => row + 1),
      bestCoreDamage: candidate.coreDamage,
      bestCoreDamageGain:
        candidate.coreDamage - coreBaseline.state.totalDamage,
      bestCoreCompanionAnchors: lianyingCompanionAnchorRows(candidate.packs),
    }),
  ).sort(
    (left, right) => right.bestCoreDamage - left.bestCoreDamage,
  );
  const coreBestByCompanionLineage = new Map();
  for (const candidate of coreCandidatesByPath.values()) {
    const companionAnchors = lianyingCompanionAnchorRows(candidate.packs);
    const lineage = Object.fromEntries(companionLineageTypes.map((type) => [
      `${type}Rows`,
      companionAnchors[`${type}Rows`],
    ]));
    const key = JSON.stringify(lineage);
    const current = coreBestByCompanionLineage.get(key);
    if (!current || candidate.coreDamage > current.coreDamage) {
      coreBestByCompanionLineage.set(key, {
        ...candidate,
        companionAnchors,
      });
    }
  }
  const coreCompanionLineageDiagnostics = companionLineageTypes.length > 0
    ? [...coreBestByCompanionLineage.values()].map((candidate) => ({
        anchorRows: candidate.anchorRows.map((row) => row + 1),
        companionAnchors: candidate.companionAnchors,
        bestCoreDamage: candidate.coreDamage,
        bestCoreDamageGain:
          candidate.coreDamage - coreBaseline.state.totalDamage,
      })).sort((left, right) =>
        right.bestCoreDamage - left.bestCoreDamage)
    : [];
  const coreScheduleCandidates = includeScheduleCandidatePacks
    ? [...coreBestBySchedule.values()].map((candidate) => ({
        anchorRows: candidate.anchorRows.map((row) => row + 1),
        bestCoreDamage: candidate.coreDamage,
        packs: clonePacks(candidate.packs),
      }))
    : [];
  const normalizedCoreCandidatePackLimit = Math.max(
    0,
    Math.floor(Number(coreCandidatePackLimit)),
  );
  const coreCandidatePacks = includeCoreCandidatePacks
    ? [...coreCandidatesByPath.values()]
        .sort((left, right) => right.coreDamage - left.coreDamage)
        .slice(
          0,
          normalizedCoreCandidatePackLimit > 0
            ? normalizedCoreCandidatePackLimit
            : undefined,
        )
        .map((candidate) => ({
          anchorRows: candidate.anchorRows.map((row) => row + 1),
          coreDamage: candidate.coreDamage,
          isIncumbent: candidate.isIncumbent,
          companionAnchors: lianyingCompanionAnchorRows(candidate.packs),
          packs: clonePacks(candidate.packs),
        }))
    : [];
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
  const additionalWarmDiagnostics = additionalWarmSources.map(
    (candidate, index) => {
      const sourceKey = JSON.stringify(candidate.source);
      const finalStateKey = lianyingResynthesisStateKey(candidate.state);
      return {
        warmAxis: index + 1,
        active: candidate.active,
        anchorRows: candidate.anchorRows.map((row) => row + 1),
        finalStateDamage: candidate.state.totalDamage,
        survivedFinalBoundary: nodes.some((node) =>
          anchorDriftNodeScheduleKey(node) ===
            anchorDriftNodeScheduleKey(candidate) &&
          lianyingResynthesisStateKey(node.state) === finalStateKey),
        reachedCoreReplay: coreCandidatesByPath.has(sourceKey),
        coreDamage: coreCandidatesByPath.get(sourceKey)?.coreDamage ?? null,
      };
    },
  );
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
    finalCompanionLineages: new Set(
      nodes.map((node) => JSON.stringify(node.companionLineageRows ?? {})),
    ).size,
    finalScheduleRows: [...new Set(nodes.map(
      (node) => JSON.stringify(node.anchorRows.map((row) => row + 1)),
    ))].map((schedule) => JSON.parse(schedule)),
    coreCandidates: coreCandidatesByPath.size,
    coreScheduleDiagnostics,
    coreCompanionLineageDiagnostics,
    coreScheduleCandidates,
    coreCandidatePacks,
    additionalWarmDiagnostics,
    coarseCandidates: coarseCandidates.map((candidate) => ({
      isIncumbent: candidate.isIncumbent,
      anchorRows: candidate.anchorRows.map((row) => row + 1),
      coreDamage: candidate.coreDamage,
      totalDamage: candidate.totalDamage,
      dashCount: candidate.dashCount,
      companionAnchors: lianyingCompanionAnchorRows(candidate.packs),
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
      allowedAnchorScheduleCount: normalizedAllowedAnchorSchedules.length,
      allowedAnchorSchedules: normalizedAllowedAnchorSchedules.map(
        (schedule) => schedule.map((row) => row + 1),
      ),
      companionAnchorTemplate,
      preserveCompanionLineageTypes: companionLineageTypes,
      additionalWarmAxisCount: additionalWarmSources.length,
      includeScheduleCandidatePacks,
      includeCoreCandidatePacks,
      coreCandidatePackLimit: normalizedCoreCandidatePackLimit,
      primaryStructureDiversity: normalizedPrimaryStructureDiversity,
      qualityDiversityRestart: normalizedQualityDiversityRestart,
      primaryActionConstraints: normalizedPrimaryActionConstraints,
      primaryWindowConstraints: normalizedPrimaryWindowConstraints,
      primaryCountConstraints: normalizedPrimaryCountConstraints,
      actionCountConstraints: normalizedActionCountConstraints,
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
