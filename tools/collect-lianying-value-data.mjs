import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  addLianyingValueCenteredTargets,
  resolveLianyingResearchPath,
  resolveLianyingResearchPaths,
} from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingSegmentResynthesis } from "../src/policies/lianying-segment-resynthesis.js";
import {
  lianyingValueTrainingToCsv,
  lianyingValueTrainingToJsonl,
  prepareLianyingValueTrainingRows,
  summarizeLianyingValueTrainingRows,
} from "../src/reports/lianying-value-training.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputArgument = process.argv[2] ?? "-";
const profileName = process.argv[3] ?? "sample";
const inputPaths = inputArgument === "portfolio"
  ? resolveLianyingResearchPaths(projectRoot)
  : inputArgument.split(",")
    .map((entry) => resolveLianyingResearchPath(projectRoot, entry.trim()));

const profiles = {
  sample: {
    maxPasses: 1,
    beamWidth: 8,
    finalistCount: 8,
    coarseCandidateLimit: 1,
    coarseDashStates: 4,
    finalDashCandidateCount: 1,
    fullDashStates: 4,
    boundaryPaddingRows: 2,
    segmentIndices: [0],
  },
  screen: {
    maxPasses: 1,
    beamWidth: 16,
    finalistCount: 16,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 64,
    boundaryPaddingRows: 4,
  },
};
if (!profiles[profileName]) {
  throw new Error("状态价值数据档位必须是sample或screen");
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

const axes = inputPaths.map(loadAxis);
const durations = new Set(axes.map((axis) => axis.durationSeconds));
if (durations.size !== 1) throw new Error("多种子状态价值数据要求战斗时长一致");
const durationSeconds = axes[0].durationSeconds;
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const rawRows = [];
const sources = [];

for (const [sourceIndex, axis] of axes.entries()) {
  const optimized = optimizeLianyingSegmentResynthesis(runtime, axis.packs, {
    durationSeconds,
    collectValueTrainingData: true,
    ...profiles[profileName],
    onProgress: (event) => console.log(JSON.stringify({
      phase: "value-data",
      source: sourceIndex + 1,
      sourceCount: axes.length,
      sourceAxis: axis.sourceAxis,
      ...event,
    })),
  });
  rawRows.push(...optimized.valueTraining.rows.map((row) => ({
    sourceAxis: axis.sourceAxis,
    ...row,
  })));
  sources.push({
    sourceAxis: axis.sourceAxis,
    ...optimized.valueTraining.summary,
  });
}

const splitGroup = axes.length > 1 ? "source-axis" : "trace";
const rows = addLianyingValueCenteredTargets(
  prepareLianyingValueTrainingRows(rawRows, { splitGroup }),
);
const firstParsed = path.parse(inputPaths[0]);
const defaultStem = axes.length > 1
  ? path.join(projectRoot, "output", `lianying-value-portfolio-${profileName}`)
  : path.join(firstParsed.dir, `${firstParsed.name}-value-data-${profileName}`);
const outputStem = path.resolve(process.argv[4] ?? defaultStem);
const summary = {
  sourceAxes: axes.map((axis) => axis.sourceAxis),
  outputStem,
  profileName,
  durationSeconds,
  splitGroup,
  search: {
    sourceCount: axes.length,
    traceCount: sources.reduce((sum, source) => sum + source.traceCount, 0),
    outcomeCount: sources.reduce((sum, source) => sum + source.outcomeCount, 0),
    rowCount: sources.reduce((sum, source) => sum + source.rowCount, 0),
    sources,
  },
  dataset: summarizeLianyingValueTrainingRows(rows),
  splitSources: Object.fromEntries(axes.map((axis) => [
    axis.sourceAxis,
    rows.find((row) => row.sourceAxis === axis.sourceAxis)?.datasetSplit ?? null,
  ])),
  featureColumns: [...new Set(rows.flatMap((row) => Object.keys(row)))]
    .filter((column) => ![
      "datasetSplit",
      "sourceAxis",
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
      "centeredRemainingDamageResidual",
      "descendantOutcomeCount",
    ].includes(column))
    .sort(),
};

fs.writeFileSync(`${outputStem}.jsonl`, `${lianyingValueTrainingToJsonl(rows)}\n`, "utf8");
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${lianyingValueTrainingToCsv(rows)}\n`, "utf8");
fs.writeFileSync(`${outputStem}-summary.json`, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
