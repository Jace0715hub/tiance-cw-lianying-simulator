function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function canonicalAction(action) {
  if (typeof action === "string") return { id: action };
  return {
    id: action?.id,
    ...(action?.frames === undefined ? {} : { frames: action.frames }),
    ...(action?.leadFrames === undefined
      ? {}
      : { leadFrames: action.leadFrames }),
  };
}

export function canonicalPack(pack) {
  return {
    prefix: (pack?.prefix ?? []).map(canonicalAction),
    primary: canonicalAction(pack?.primary),
    tail: (pack?.tail ?? []).map(canonicalAction),
  };
}

export function packSignature(pack) {
  return JSON.stringify(canonicalPack(pack));
}

function actionCounts(packs) {
  const counts = {};
  for (const pack of packs) {
    for (const action of [
      ...(pack.prefix ?? []),
      pack.primary,
      ...(pack.tail ?? []),
    ]) {
      const id = actionId(action);
      counts[id] = Number(counts[id] ?? 0) + 1;
    }
  }
  return counts;
}

function countDelta(baseline, candidate) {
  const left = actionCounts(baseline);
  const right = actionCounts(candidate);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Object.fromEntries(
    [...keys]
      .sort()
      .map((key) => [key, Number(right[key] ?? 0) - Number(left[key] ?? 0)])
      .filter(([, value]) => value !== 0),
  );
}

export function compareLianyingAxes(
  baselinePacks,
  candidatePacks,
  { candidateRows = [] } = {},
) {
  const length = Math.max(baselinePacks.length, candidatePacks.length);
  const differingRows = [];
  for (let index = 0; index < length; index += 1) {
    if (
      packSignature(baselinePacks[index]) !==
      packSignature(candidatePacks[index])
    ) {
      differingRows.push(index + 1);
    }
  }
  const firstDivergenceRow = differingRows[0] ?? null;
  const firstDivergenceSeconds = firstDivergenceRow
    ? Number(candidateRows[firstDivergenceRow - 1]?.castSeconds ?? NaN)
    : null;
  return {
    identical: differingRows.length === 0,
    baselineRows: baselinePacks.length,
    candidateRows: candidatePacks.length,
    differingRowCount: differingRows.length,
    firstDivergenceRow,
    firstDivergenceSeconds:
      firstDivergenceSeconds === null || Number.isNaN(firstDivergenceSeconds)
        ? null
        : firstDivergenceSeconds,
    actionCountDelta: countDelta(baselinePacks, candidatePacks),
  };
}

export function lianyingConvergenceToCsv(report) {
  const columns = [
    "beamWidth",
    "elapsedMs",
    "rotationDamage",
    "rotationDps",
    "gainDamage",
    "gainDps",
    "exploredTransitions",
    "legalTransitions",
    "exactStateCollisions",
    "beamPruned",
    "peakUniqueCandidates",
    "firstDivergenceRow",
    "firstDivergenceSeconds",
    "mechanicsPassed",
    "strategyDeviationCount",
  ];
  const rows = report.runs.map((run) =>
    columns.map((column) => run[column] ?? "").join(","),
  );
  return [columns.join(","), ...rows].join("\n");
}
