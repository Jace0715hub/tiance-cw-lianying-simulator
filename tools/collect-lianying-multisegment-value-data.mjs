import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  LIANYING_CURRENT_BEST_AXIS,
  LIANYING_DEFAULT_VALUE_TRAINING_SEEDS,
  resolveLianyingResearchPath,
  resolveLianyingResearchPaths,
} from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingMultiSegmentResynthesis } from "../src/policies/lianying-multisegment-resynthesis.js";
import {
  addLianyingValueCenteredTargets,
  lianyingValueTrainingToCsv,
  lianyingValueTrainingToJsonl,
  prepareLianyingValueTrainingRows,
  summarizeLianyingValueTrainingRows,
} from "../src/reports/lianying-value-training.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputArgument = process.argv[2] ?? "-";
const profileName = process.argv[3] ?? "sample";

function resolveInputPaths(argument) {
  if (argument === "portfolio") {
    return resolveLianyingResearchPaths(
      projectRoot,
      undefined,
      LIANYING_DEFAULT_VALUE_TRAINING_SEEDS,
    );
  }
  const possibleManifestPath = resolveLianyingResearchPath(projectRoot, argument);
  if (!argument.includes(",") && fs.existsSync(possibleManifestPath)) {
    const source = JSON.parse(fs.readFileSync(possibleManifestPath, "utf8"));
    if (Array.isArray(source.candidates)) {
      return source.candidates.map((candidate) =>
        resolveLianyingResearchPath(projectRoot, candidate.outputPath));
    }
  }
  return argument.split(",")
    .map((entry) => resolveLianyingResearchPath(projectRoot, entry.trim()));
}

const profiles = {
  sample: {
    rowBeamWidth: 12,
    boundaryBeamWidth: 6,
    coreFinalistCount: 6,
    coarseCandidateLimit: 2,
    coarseDashStates: 4,
    finalDashCandidateCount: 1,
    fullDashStates: 4,
    valueProbeMaximumBaselineRank: 16,
    valueProbeRowStride: 8,
    valueProbeNextSegmentBeamWidth: 2,
  },
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 64,
    valueProbeMaximumBaselineRank: 32,
    valueProbeRowStride: 4,
    valueProbeNextSegmentBeamWidth: 2,
  },
  balanced: {
    rowBeamWidth: 48,
    boundaryBeamWidth: 24,
    coreFinalistCount: 24,
    coarseCandidateLimit: 6,
    coarseDashStates: 16,
    finalDashCandidateCount: 2,
    fullDashStates: 256,
    valueProbeMaximumBaselineRank: 32,
    valueProbeRowStride: 4,
    valueProbeNextSegmentBeamWidth: 4,
  },
};
if (!profiles[profileName]) {
  throw new Error("联合区段状态价值数据档位必须是sample、screen或balanced");
}

function loadAxis(inputPath) {
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const packs = source.actionPacks ??
    (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
  if (!packs) throw new Error(`${inputPath}没有可恢复的动作包`);
  return {
    inputPath,
    sourceAxis: path.relative(projectRoot, inputPath),
    durationSeconds: Number(source.durationSeconds ?? 180),
    packs,
  };
}

function countsBy(rows, column) {
  return Object.fromEntries([...rows.reduce((counts, row) => {
    const key = String(row[column] ?? "unknown");
    counts.set(key, Number(counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

function writeDataset(outputStem, rows) {
  fs.writeFileSync(
    `${outputStem}.jsonl`,
    rows.length > 0 ? `${lianyingValueTrainingToJsonl(rows)}\n` : "",
    "utf8",
  );
  fs.writeFileSync(
    `${outputStem}.csv`,
    `\uFEFF${lianyingValueTrainingToCsv(rows)}\n`,
    "utf8",
  );
}

const inputPaths = inputArgument === "current"
  ? [resolveLianyingResearchPath(projectRoot, LIANYING_CURRENT_BEST_AXIS)]
  : resolveInputPaths(inputArgument);
const axes = inputPaths.map(loadAxis);
const durations = new Set(axes.map((axis) => axis.durationSeconds));
if (durations.size !== 1) throw new Error("多种子联合区段数据要求战斗时长一致");
const durationSeconds = axes[0].durationSeconds;
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const rawRows = [];
const sources = [];

for (const [sourceIndex, axis] of axes.entries()) {
  const optimized = optimizeLianyingMultiSegmentResynthesis(
    runtime,
    axis.packs,
    {
      durationSeconds,
      ...profiles[profileName],
      collectValueTrainingData: true,
      onProgress: (event) => console.log(JSON.stringify({
        phase: "multisegment-value-data",
        source: sourceIndex + 1,
        sourceCount: axes.length,
        sourceAxis: axis.sourceAxis,
        ...event,
      })),
    },
  );
  rawRows.push(...optimized.valueTraining.rows.map((row) => ({
    sourceAxis: axis.sourceAxis,
    ...row,
  })));
  sources.push({
    sourceAxis: axis.sourceAxis,
    explored: optimized.explored,
    legal: optimized.legal,
    segmentCount: optimized.segments.length,
    ...optimized.valueTraining.summary,
  });
}

const splitGroup = axes.length > 1 ? "source-axis" : "trace";
const rows = addLianyingValueCenteredTargets(
  prepareLianyingValueTrainingRows(rawRows, { splitGroup }),
);
const referenceRows = rows.filter((row) => row.labelKind === "reference-suffix");
const actualRows = rows.filter((row) =>
  row.labelKind === "actual-next-segment");
const fullDescendantRows = rows.filter((row) =>
  row.labelKind === "actual-full-descendant");
const firstParsed = path.parse(inputPaths[0]);
const defaultStem = axes.length > 1
  ? path.join(projectRoot, "output", `lianying-multisegment-value-portfolio-${profileName}`)
  : path.join(
      firstParsed.dir,
      `${firstParsed.name}-multisegment-value-data-${profileName}`,
    );
const outputStem = path.resolve(process.argv[4] ?? defaultStem);

writeDataset(outputStem, rows);
writeDataset(`${outputStem}-reference`, referenceRows);
writeDataset(`${outputStem}-actual`, actualRows);
writeDataset(`${outputStem}-full-descendant`, fullDescendantRows);

const summary = {
  sourceAxes: axes.map((axis) => axis.sourceAxis),
  outputStem,
  profileName,
  durationSeconds,
  splitGroup,
  profile: profiles[profileName],
  search: {
    sourceCount: axes.length,
    explored: sources.reduce((sum, source) => sum + source.explored, 0),
    legal: sources.reduce((sum, source) => sum + source.legal, 0),
    rowProbeAttempts: sources.reduce(
      (sum, source) => sum + source.rowProbeAttempts, 0),
    rowProbeLegal: sources.reduce(
      (sum, source) => sum + source.rowProbeLegal, 0),
    boundaryProbeAttempts: sources.reduce(
      (sum, source) => sum + source.boundaryProbeAttempts, 0),
    boundaryProbeReferenceLegal: sources.reduce(
      (sum, source) => sum + source.boundaryProbeReferenceLegal, 0),
    boundaryActualRows: sources.reduce(
      (sum, source) => sum + source.boundaryActualRows, 0),
    boundaryNextSegmentRows: sources.reduce(
      (sum, source) => sum + source.boundaryNextSegmentRows, 0),
    boundaryFullDescendantRows: sources.reduce(
      (sum, source) => sum + source.boundaryFullDescendantRows, 0),
    boundaryNextSegmentProbeAttempts: sources.reduce(
      (sum, source) => sum + source.boundaryNextSegmentProbeAttempts, 0),
    boundaryNextSegmentProbeLegal: sources.reduce(
      (sum, source) => sum + source.boundaryNextSegmentProbeLegal, 0),
    boundaryNextSegmentProbeExplored: sources.reduce(
      (sum, source) => sum + source.boundaryNextSegmentProbeExplored, 0),
    boundaryNextSegmentProbeLegalTransitions: sources.reduce(
      (sum, source) => sum + source.boundaryNextSegmentProbeLegalTransitions, 0),
    sources,
  },
  dataset: summarizeLianyingValueTrainingRows(rows),
  referenceDataset: summarizeLianyingValueTrainingRows(referenceRows),
  actualDataset: summarizeLianyingValueTrainingRows(actualRows),
  fullDescendantDataset:
    summarizeLianyingValueTrainingRows(fullDescendantRows),
  traceCounts: countsBy(rows, "traceId"),
  selectionStageCounts: countsBy(rows, "selectionStage"),
  labelKindCounts: countsBy(rows, "labelKind"),
  selectedCounts: {
    baselineBeam: rows.filter((row) => row.selectedByBaselineBeam === 1).length,
    valueShadow: rows.filter((row) => row.selectedByValueShadow === 1).length,
  },
  baselineRank: rows.length > 0
    ? {
        minimum: Math.min(...rows.map((row) => Number(row.baselineRank))),
        maximum: Math.max(...rows.map((row) => Number(row.baselineRank))),
        above12: rows.filter((row) => Number(row.baselineRank) > 12).length,
        from12To32: rows.filter((row) =>
          Number(row.baselineRank) >= 12 && Number(row.baselineRank) <= 32).length,
      }
    : null,
};
fs.writeFileSync(
  `${outputStem}-summary.json`,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary, null, 2));
