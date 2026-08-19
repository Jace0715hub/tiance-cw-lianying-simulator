function skeletonSegmentKey(segment) {
  return `${Number(segment.startRow)}-${Number(segment.endRow)}`;
}

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function packHasAction(pack, id) {
  return [
    ...(pack?.prefix ?? []),
    pack?.primary,
    ...(pack?.tail ?? []),
  ].some((action) => actionId(action) === id);
}

export function moveLianyingThunderAnchor(
  packs,
  anchorOrdinal,
  targetRow,
) {
  const next = structuredClone(packs ?? []);
  const thunderRows = next.flatMap((pack, index) =>
    packHasAction(pack, "thunder") ? [index + 1] : []);
  const ordinal = Math.floor(Number(anchorOrdinal));
  const row = Math.floor(Number(targetRow));
  if (ordinal < 1 || ordinal > thunderRows.length) {
    throw new Error("待移动雷序号超出技能轴锚点范围");
  }
  if (row < 1 || row > next.length) {
    throw new Error("目标雷行超出技能轴范围");
  }
  const sourceRow = thunderRows[ordinal - 1];
  const sourcePack = next[sourceRow - 1];
  sourcePack.prefix = (sourcePack.prefix ?? []).filter(
    (action) => actionId(action) !== "thunder",
  );
  sourcePack.tail = (sourcePack.tail ?? []).filter(
    (action) => actionId(action) !== "thunder",
  );
  if (actionId(sourcePack.primary) === "thunder") {
    throw new Error("不支持移动作为主要技能施展的雷");
  }
  const targetPack = next[row - 1];
  if (packHasAction(targetPack, "thunder")) return next;
  if (actionId(targetPack.primary) === "ride") {
    targetPack.tail = [
      ...(targetPack.tail ?? []),
      { id: "thunder", leadFrames: 1 },
    ];
  } else {
    targetPack.prefix = ["thunder", ...(targetPack.prefix ?? [])];
  }
  return next;
}

export function lianyingCountSkeletonSegments(
  packs,
  {
    firstAnchorOrdinal = 3,
    lastAnchorOrdinal = 6,
    trackedActionIds = [
      "dragonFang",
      "destroy",
      "dragonRoar",
      "cloudStrike",
      "charge",
    ],
  } = {},
) {
  const anchors = (packs ?? []).flatMap((pack, index) =>
    packHasAction(pack, "thunder") ? [index] : []);
  const first = Math.max(1, Math.floor(Number(firstAnchorOrdinal)));
  const last = Math.min(
    anchors.length - 1,
    Math.floor(Number(lastAnchorOrdinal)),
  );
  const segments = [];
  for (let ordinal = first; ordinal <= last; ordinal += 1) {
    const startIndex = anchors[ordinal - 1];
    const endIndex = anchors[ordinal] - 1;
    const counts = Object.fromEntries(
      trackedActionIds.map((id) => [id, 0]),
    );
    for (const pack of packs.slice(startIndex, endIndex + 1)) {
      const id = actionId(pack.primary);
      if (Object.hasOwn(counts, id)) counts[id] += 1;
    }
    segments.push({
      ordinal,
      startRow: startIndex + 1,
      endRow: endIndex + 1,
      counts,
    });
  }
  return segments;
}

function countIds(segments) {
  return [...new Set((segments ?? []).flatMap((segment) =>
    Object.keys(segment.counts ?? {})))].sort();
}

function emptyDelta(segments, actionIds) {
  return Object.fromEntries((segments ?? []).map((segment) => [
    skeletonSegmentKey(segment),
    Object.fromEntries(actionIds.map((id) => [id, 0])),
  ]));
}

function deltaSignature(delta, segments, actionIds) {
  return JSON.stringify((segments ?? []).map((segment) => [
    skeletonSegmentKey(segment),
    actionIds.map((id) => Number(delta[skeletonSegmentKey(segment)]?.[id] ?? 0)),
  ]));
}

export function lianyingSegmentSkeletonDelta(
  segments,
  experiment,
) {
  const actionIds = countIds(segments);
  const delta = emptyDelta(segments, actionIds);
  const segmentByKey = new Map((segments ?? []).map((segment) => [
    skeletonSegmentKey(segment),
    segment,
  ]));
  for (const constraint of experiment?.constraints ?? []) {
    const key = skeletonSegmentKey(constraint);
    const segment = segmentByKey.get(key);
    if (!segment) throw new Error(`单骨架约束引用未知区段${key}`);
    for (const id of actionIds) {
      if (!Object.hasOwn(constraint.counts ?? {}, id)) continue;
      delta[key][id] = Number(constraint.counts[id]) -
        Number(segment.counts?.[id] ?? 0);
    }
  }
  return delta;
}

function combineDeltas(left, right, segments, actionIds) {
  return Object.fromEntries(segments.map((segment) => {
    const key = skeletonSegmentKey(segment);
    return [key, Object.fromEntries(actionIds.map((id) => [
      id,
      Number(left[key]?.[id] ?? 0) + Number(right[key]?.[id] ?? 0),
    ]))];
  }));
}

function affectedOrdinals(delta, segments, actionIds) {
  return segments.flatMap((segment) => {
    const key = skeletonSegmentKey(segment);
    return actionIds.some((id) => Number(delta[key]?.[id] ?? 0) !== 0)
      ? [Number(segment.ordinal)]
      : [];
  });
}

function cancellationMagnitude(left, right, segments, actionIds) {
  let cancellation = 0;
  for (const segment of segments) {
    const key = skeletonSegmentKey(segment);
    for (const id of actionIds) {
      const leftValue = Number(left[key]?.[id] ?? 0);
      const rightValue = Number(right[key]?.[id] ?? 0);
      if (leftValue * rightValue < 0) {
        cancellation += Math.min(Math.abs(leftValue), Math.abs(rightValue));
      }
    }
  }
  return cancellation;
}

function constraintsFromDelta(delta, segments, actionIds) {
  const affected = affectedOrdinals(delta, segments, actionIds);
  const first = Math.min(...affected);
  const last = Math.max(...affected);
  return segments.filter((segment) =>
    Number(segment.ordinal) >= first && Number(segment.ordinal) <= last)
    .map((segment) => {
      const key = skeletonSegmentKey(segment);
      return {
        startRow: Number(segment.startRow),
        endRow: Number(segment.endRow),
        counts: Object.fromEntries(actionIds.map((id) => [
          id,
          Number(segment.counts?.[id] ?? 0) + Number(delta[key]?.[id] ?? 0),
        ])),
      };
    });
}

export function buildLianyingDoubleCountSkeletons(
  segments,
  experiments,
  {
    maximumSingleCoreDamageLossRatio = 0.01,
    limit = 24,
  } = {},
) {
  const actionIds = countIds(segments);
  const eligible = (experiments ?? []).filter((experiment) =>
    experiment?.bestPacks &&
    Number.isFinite(Number(experiment.coreDamageLossRatio)) &&
    Number(experiment.coreDamageLossRatio) <= maximumSingleCoreDamageLossRatio)
    .map((experiment) => ({
      experiment,
      delta: lianyingSegmentSkeletonDelta(segments, experiment),
    }));
  const eligibleSignatures = new Set(eligible.map(({ delta }) =>
    deltaSignature(delta, segments, actionIds)));
  const candidates = [];
  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < eligible.length;
      rightIndex += 1
    ) {
      const left = eligible[leftIndex];
      const right = eligible[rightIndex];
      const delta = combineDeltas(
        left.delta,
        right.delta,
        segments,
        actionIds,
      );
      const affected = affectedOrdinals(delta, segments, actionIds);
      if (affected.length === 0) continue;
      const signature = deltaSignature(delta, segments, actionIds);
      if (eligibleSignatures.has(signature)) continue;
      const constraints = constraintsFromDelta(delta, segments, actionIds);
      if (constraints.some((constraint) =>
        Object.values(constraint.counts).some((count) => count < 0))) continue;
      const cancellation = cancellationMagnitude(
        left.delta,
        right.delta,
        segments,
        actionIds,
      );
      candidates.push({
        id: `double--${left.experiment.id}--${right.experiment.id}`,
        kind: "double-segment-count-skeleton",
        sourceExperimentIds: [left.experiment.id, right.experiment.id],
        sourceCoreDamageLossRatios: [
          Number(left.experiment.coreDamageLossRatio),
          Number(right.experiment.coreDamageLossRatio),
        ],
        sourceBestPacks: [left.experiment.bestPacks, right.experiment.bestPacks],
        delta,
        deltaSignature: signature,
        cancellationMagnitude: cancellation,
        affectedSegmentOrdinals: affected,
        startRow: constraints[0].startRow,
        endRow: constraints.at(-1).endRow,
        constraints,
      });
    }
  }
  const ranked = candidates.sort((left, right) =>
    Number(right.cancellationMagnitude > 0) -
      Number(left.cancellationMagnitude > 0) ||
    right.cancellationMagnitude - left.cancellationMagnitude ||
    Math.max(...left.affectedSegmentOrdinals) -
      Math.min(...left.affectedSegmentOrdinals) -
      (Math.max(...right.affectedSegmentOrdinals) -
        Math.min(...right.affectedSegmentOrdinals)) ||
    left.sourceCoreDamageLossRatios.reduce((sum, value) => sum + value, 0) -
      right.sourceCoreDamageLossRatios.reduce((sum, value) => sum + value, 0) ||
    left.id.localeCompare(right.id));
  const deduplicated = new Map();
  for (const candidate of ranked) {
    if (!deduplicated.has(candidate.deltaSignature)) {
      deduplicated.set(candidate.deltaSignature, candidate);
    }
  }
  return {
    eligibleSingleSkeletonCount: eligible.length,
    rawPairCount: candidates.length,
    deduplicatedPairCount: deduplicated.size,
    skeletons: [...deduplicated.values()].slice(
      0,
      Math.max(0, Math.floor(Number(limit))),
    ),
  };
}

export function buildLianyingAnchorCountSkeletons(
  sourceSegments,
  targetSegments,
  experiments,
  {
    maximumSingleCoreDamageLossRatio = 0.01,
    limit = 6,
  } = {},
) {
  const sourceByOrdinal = new Map(sourceSegments.map((segment) => [
    Number(segment.ordinal),
    segment,
  ]));
  const targetByOrdinal = new Map(targetSegments.map((segment) => [
    Number(segment.ordinal),
    segment,
  ]));
  const candidates = [];
  for (const experiment of experiments ?? []) {
    if (
      !experiment?.bestPacks ||
      !Number.isFinite(Number(experiment.coreDamageLossRatio)) ||
      Number(experiment.coreDamageLossRatio) > maximumSingleCoreDamageLossRatio
    ) continue;
    const delta = lianyingSegmentSkeletonDelta(sourceSegments, experiment);
    const affectedOrdinals = sourceSegments.flatMap((segment) => {
      const key = skeletonSegmentKey(segment);
      return Object.values(delta[key] ?? {}).some((value) => value !== 0)
        ? [Number(segment.ordinal)]
        : [];
    });
    if (
      affectedOrdinals.length === 0 ||
      affectedOrdinals.some((ordinal) => !targetByOrdinal.has(ordinal))
    ) continue;
    const first = Math.min(...affectedOrdinals);
    const last = Math.max(...affectedOrdinals);
    const constraints = targetSegments.filter((segment) =>
      Number(segment.ordinal) >= first && Number(segment.ordinal) <= last)
      .map((segment) => {
        const source = sourceByOrdinal.get(Number(segment.ordinal));
        const sourceKey = skeletonSegmentKey(source);
        const counts = Object.fromEntries(Object.keys(segment.counts).map(
          (id) => [
            id,
            Number(segment.counts[id] ?? 0) +
              Number(delta[sourceKey]?.[id] ?? 0),
          ],
        ));
        return {
          startRow: Number(segment.startRow),
          endRow: Number(segment.endRow),
          counts,
        };
      });
    if (constraints.some((constraint) =>
      Object.values(constraint.counts).some((count) => count < 0))) continue;
    candidates.push({
      id: `anchor-count--${experiment.id}`,
      kind: "anchor-segment-count-skeleton",
      sourceExperimentId: experiment.id,
      sourceCoreDamageLossRatio: Number(experiment.coreDamageLossRatio),
      sourceBestPacks: experiment.bestPacks,
      affectedSegmentOrdinals: affectedOrdinals,
      startRow: constraints[0].startRow,
      endRow: constraints.at(-1).endRow,
      constraints,
    });
  }
  return candidates.sort((left, right) =>
    Number(right.affectedSegmentOrdinals.includes(5)) -
      Number(left.affectedSegmentOrdinals.includes(5)) ||
    left.sourceCoreDamageLossRatio - right.sourceCoreDamageLossRatio ||
    left.id.localeCompare(right.id))
    .slice(0, Math.max(0, Math.floor(Number(limit))));
}
