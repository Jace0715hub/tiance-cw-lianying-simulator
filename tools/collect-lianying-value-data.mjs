import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingSegmentResynthesis } from "../src/policies/lianying-segment-resynthesis.js";
import {
  lianyingValueTrainingToCsv,
  lianyingValueTrainingToJsonl,
  prepareLianyingValueTrainingRows,
  summarizeLianyingValueTrainingRows,
} from "../src/reports/lianying-value-training.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "sample";
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const packs = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!packs) throw new Error("输入文件既没有actionPacks，也没有可恢复的rows");

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

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const optimized = optimizeLianyingSegmentResynthesis(runtime, packs, {
  durationSeconds,
  collectValueTrainingData: true,
  ...profiles[profileName],
  onProgress: (event) => console.log(JSON.stringify({
    phase: "value-data",
    ...event,
  })),
});
const sourceAxis = path.relative(projectRoot, inputPath);
const rows = prepareLianyingValueTrainingRows(
  optimized.valueTraining.rows.map((row) => ({ sourceAxis, ...row })),
);
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[4] ?? path.join(parsed.dir, `${parsed.name}-value-data-${profileName}`),
);
const summary = {
  sourceAxis,
  outputStem,
  profileName,
  durationSeconds,
  search: optimized.valueTraining.summary,
  dataset: summarizeLianyingValueTrainingRows(rows),
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
      "descendantOutcomeCount",
    ].includes(column))
    .sort(),
};

fs.writeFileSync(`${outputStem}.jsonl`, `${lianyingValueTrainingToJsonl(rows)}\n`, "utf8");
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${lianyingValueTrainingToCsv(rows)}\n`, "utf8");
fs.writeFileSync(`${outputStem}-summary.json`, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
