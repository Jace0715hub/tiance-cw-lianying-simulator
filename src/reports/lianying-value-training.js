const LEADING_COLUMNS = [
  "datasetSplit",
  "traceId",
  "pass",
  "segmentId",
  "adaptiveAttempt",
  "durationSeconds",
  "nodeId",
  "parentNodeId",
  "layer",
  "globalRow",
  "thunderLineage",
  "actionPrimary",
  "actionOffGcd",
  "totalDamage",
  "bestFinalDamage",
  "bestRemainingDamage",
  "referenceRemainingDamage",
  "remainingDamageResidual",
  "descendantOutcomeCount",
];

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function lianyingValueDatasetSplit(traceId) {
  const bucket = stableHash(traceId) % 10;
  if (bucket === 8) return "validation";
  if (bucket === 9) return "test";
  return "train";
}

export function prepareLianyingValueTrainingRows(rows) {
  const groupKey = (row) => row.sourceAxis
    ? `${row.sourceAxis}|${row.traceId}`
    : row.traceId;
  const groups = [...new Set(rows
    .filter((row) => !row.datasetSplit)
    .map(groupKey))]
    .sort((left, right) => stableHash(left) - stableHash(right));
  const assignments = new Map();
  if (groups.length >= 3) {
    const validationCount = Math.max(1, Math.floor(groups.length * 0.1));
    const testCount = Math.max(1, Math.floor(groups.length * 0.1));
    const validationStart = groups.length - validationCount - testCount;
    const testStart = groups.length - testCount;
    groups.forEach((group, index) => assignments.set(
      group,
      index >= testStart
        ? "test"
        : index >= validationStart
          ? "validation"
          : "train",
    ));
  }
  return rows.map((row) => ({
    datasetSplit: row.datasetSplit ?? assignments.get(groupKey(row)) ??
      lianyingValueDatasetSplit(groupKey(row)),
    ...row,
  }));
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) || typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function lianyingValueTrainingToCsv(inputRows) {
  const rows = prepareLianyingValueTrainingRows(inputRows);
  const columns = [
    ...LEADING_COLUMNS,
    ...[...new Set(rows.flatMap((row) => Object.keys(row)))]
      .filter((column) => !LEADING_COLUMNS.includes(column))
      .sort(),
  ];
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
}

export function lianyingValueTrainingToJsonl(inputRows) {
  return prepareLianyingValueTrainingRows(inputRows)
    .map((row) => JSON.stringify(row))
    .join("\n");
}

export function summarizeLianyingValueTrainingRows(inputRows) {
  const rows = prepareLianyingValueTrainingRows(inputRows);
  const residuals = rows
    .map((row) => Number(row.remainingDamageResidual))
    .filter(Number.isFinite);
  const splitCounts = rows.reduce((counts, row) => {
    counts[row.datasetSplit] = Number(counts[row.datasetSplit] ?? 0) + 1;
    return counts;
  }, {});
  return {
    rowCount: rows.length,
    traceCount: new Set(rows.map((row) => row.traceId)).size,
    splitCounts,
    residual: residuals.length > 0
      ? {
          minimum: Math.min(...residuals),
          maximum: Math.max(...residuals),
          mean: residuals.reduce((sum, value) => sum + value, 0) / residuals.length,
        }
      : null,
  };
}
