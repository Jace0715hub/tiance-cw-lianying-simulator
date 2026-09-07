import {
  buildLianyingBoundedMultiSegmentSpan,
  lianyingDifferingThunderSegmentIndices,
  normalizeLianyingDonorPrefix,
  optimizeLianyingTripleSegmentRecombination,
} from "./lianying-triple-segment-recombination.js";

function clone(value) {
  return structuredClone(value);
}

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function structuralPack(pack) {
  return {
    prefix: (pack?.prefix ?? []).filter((action) => actionId(action) !== "dash"),
    primary: pack?.primary,
    tail: (pack?.tail ?? []).filter((action) => actionId(action) !== "dash"),
  };
}

function structuralPackKey(pack) {
  return JSON.stringify(structuralPack(pack));
}

export function mergeLianyingSourceDifferences(referencePacks, sourceAxes) {
  if (!Array.isArray(sourceAxes) || sourceAxes.length < 2) {
    throw new Error("多来源联合重组至少需要两条来源轴");
  }
  const jointPacks = clone(referencePacks);
  const claimedRows = new Map();
  const sources = [];
  for (const source of sourceAxes) {
    const packs = source?.packs ?? source;
    const id = source?.id ?? `source-${sources.length + 1}`;
    if (!Array.isArray(packs) || packs.length !== referencePacks.length) {
      throw new Error(`多来源轴 ${id} 与正式轴行数不同`);
    }
    const difference = lianyingDifferingThunderSegmentIndices(
      referencePacks,
      packs,
    );
    for (const row of difference.differenceRows) {
      const index = row - 1;
      const key = structuralPackKey(packs[index]);
      const existing = claimedRows.get(row);
      if (existing && existing.key !== key) {
        throw new Error(`多来源轴在第${row}行存在冲突：${existing.id} 与 ${id}`);
      }
      claimedRows.set(row, { id, key });
      jointPacks[index] = clone(packs[index]);
    }
    sources.push({
      id,
      differenceRows: difference.differenceRows,
      thunderRows: difference.donorThunderRows,
    });
  }
  return {
    packs: jointPacks,
    differenceRows: [...claimedRows.keys()].sort((left, right) => left - right),
    sources,
  };
}

export function swapLianyingPrimaryActions(packs, firstRow, secondRow) {
  const firstIndex = Number(firstRow) - 1;
  const secondIndex = Number(secondRow) - 1;
  if (
    !Number.isInteger(firstIndex) || !Number.isInteger(secondIndex) ||
    firstIndex < 0 || secondIndex < 0 ||
    firstIndex >= packs.length || secondIndex >= packs.length
  ) {
    throw new Error("主要技能换位行号超出技能轴范围");
  }
  const swapped = clone(packs);
  [swapped[firstIndex].primary, swapped[secondIndex].primary] = [
    clone(swapped[secondIndex].primary),
    clone(swapped[firstIndex].primary),
  ];
  return swapped;
}

export function normalizeLianyingSourceAxes(
  referencePacks,
  sourceAxes,
  normalizeBeforeRow = null,
) {
  return sourceAxes.map((source, index) => {
    const packs = source?.packs ?? source;
    return {
      id: source?.id ?? `source-${index + 1}`,
      packs: normalizeLianyingDonorPrefix(
        referencePacks,
        packs,
        normalizeBeforeRow,
      ),
    };
  });
}

export function buildLianyingMultiSourceRecombination(
  referencePacks,
  sourceAxes,
  { segmentCount = 3, sourceNormalizeBeforeRow = null } = {},
) {
  const normalizedSourceAxes = normalizeLianyingSourceAxes(
    referencePacks,
    sourceAxes,
    sourceNormalizeBeforeRow,
  );
  const joint = mergeLianyingSourceDifferences(
    referencePacks,
    normalizedSourceAxes,
  );
  const span = buildLianyingBoundedMultiSegmentSpan(
    referencePacks,
    joint.packs,
    { segmentCount },
  );
  return { ...joint, span, normalizedSourceAxes };
}

export function optimizeLianyingMultiSourceRecombination(
  runtime,
  incumbentPacks,
  sourceAxes,
  {
    orderSwapRows = [100, 101],
    additionalWarmAxes = [],
    ...options
  } = {},
) {
  const joint = buildLianyingMultiSourceRecombination(
    incumbentPacks,
    sourceAxes,
    {
      segmentCount: options.segmentCount ?? 3,
      sourceNormalizeBeforeRow: options.sourceNormalizeBeforeRow ?? null,
    },
  );
  const sourcePacks = joint.normalizedSourceAxes.map((source) => source.packs);
  const orderSwapPacks = Array.isArray(orderSwapRows) && orderSwapRows.length === 2
    ? swapLianyingPrimaryActions(
      incumbentPacks,
      orderSwapRows[0],
      orderSwapRows[1],
    )
    : null;
  const optimized = optimizeLianyingTripleSegmentRecombination(
    runtime,
    incumbentPacks,
    joint.packs,
    {
      ...options,
      additionalWarmAxes: [
        ...sourcePacks,
        ...(orderSwapPacks ? [orderSwapPacks] : []),
        ...additionalWarmAxes,
      ],
    },
  );
  return {
    ...optimized,
    joint,
    orderSwapRows: orderSwapPacks ? orderSwapRows.map(Number) : null,
    orderSwapPacks,
  };
}
