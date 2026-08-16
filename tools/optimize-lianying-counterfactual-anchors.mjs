import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  optimizeLianyingAnchorDriftResynthesis,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import {
  identifyLianyingThunderSegments,
  stripLianyingDashPacks,
} from "../src/policies/lianying-segment-resynthesis.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-counterfactual-anchors.json",
);
const profileName = process.argv[4] ?? "probe";
const rowArgument = process.argv[5] ?? null;

const profiles = {
  probe: {
    rowBeamWidth: 16,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coreCandidatePackLimit: 16,
  },
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 32,
    coreFinalistCount: 32,
    coreCandidatePackLimit: 32,
  },
};
if (!profiles[profileName]) throw new Error("未知反事实搜索档位");

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的技能轴");
const corePacks = stripLianyingDashPacks(sourcePacks);
const anchors = identifyLianyingThunderSegments(corePacks).anchors;
const actionId = (action) => typeof action === "string" ? action : action?.id;

function defaultProbeRows() {
  return anchors.slice(1, -1).flatMap((anchor) => {
    for (let index = anchor - 1; index >= Math.max(0, anchor - 6); index -= 1) {
      const primary = actionId(corePacks[index]?.primary);
      if (primary !== "dragonFang" && primary !== "ride") return [index + 1];
    }
    return [];
  });
}

const targetRows = rowArgument
  ? [...new Set(rowArgument.split(",").map(Number))]
  : defaultProbeRows();
if (
  targetRows.length === 0 ||
  targetRows.some((row) => !Number.isInteger(row) || row < 1 || row > corePacks.length)
) {
  throw new Error("反事实行必须是技能轴范围内的逗号分隔整数");
}

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const experiments = [];
for (const [index, row] of targetRows.entries()) {
  const incumbentPrimary = actionId(corePacks[row - 1].primary);
  process.stdout.write(`${JSON.stringify({
    phase: "counterfactual-anchor",
    stage: "start",
    experiment: index + 1,
    experimentCount: targetRows.length,
    row,
    incumbentPrimary,
  })}\n`);
  const optimized = optimizeLianyingAnchorDriftResynthesis(
    runtime,
    sourcePacks,
    {
      durationSeconds,
      anchorSlackRows: 0,
      fixFirstAnchor: true,
      fixLastAnchor: true,
      allowedAnchorSchedules: [anchors],
      ...profiles[profileName],
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      includeCoreCandidatePacks: true,
      primaryActionConstraints: [{
        row,
        forbiddenActionIds: [incumbentPrimary],
      }],
    },
  );
  const baseline = optimized.coreCandidatePacks.find(
    (candidate) => candidate.isIncumbent,
  );
  const alternatives = optimized.coreCandidatePacks.filter(
    (candidate) => !candidate.isIncumbent,
  );
  const best = alternatives[0] ?? null;
  const result = {
    row,
    incumbentPrimary,
    explored: optimized.explored,
    legal: optimized.legal,
    alternativeCount: alternatives.length,
    baselineCoreDamage: baseline?.coreDamage ?? null,
    bestCoreDamage: best?.coreDamage ?? null,
    coreDamageLoss: best && baseline
      ? baseline.coreDamage - best.coreDamage
      : null,
    coreDamageLossRatio: best && baseline
      ? (baseline.coreDamage - best.coreDamage) / baseline.coreDamage
      : null,
    bestPrimary: best ? actionId(best.packs[row - 1]?.primary) : null,
    bestPacks: best?.packs ?? null,
  };
  experiments.push(result);
  process.stdout.write(`${JSON.stringify({
    phase: "counterfactual-anchor",
    stage: "complete",
    ...Object.fromEntries(Object.entries(result).filter(
      ([key]) => key !== "bestPacks",
    )),
  })}\n`);
}

const ranked = experiments
  .filter((experiment) => Number.isFinite(experiment.bestCoreDamage))
  .sort((left, right) => right.bestCoreDamage - left.bestCoreDamage);
const report = {
  schemaVersion: 1,
  kind: "lianying-counterfactual-primary-anchor-screen",
  inputPath,
  durationSeconds,
  profileName,
  targetRows,
  successGateMaximumCoreDamageLossRatio: 0.01,
  explored: experiments.reduce((sum, experiment) => sum + experiment.explored, 0),
  legal: experiments.reduce((sum, experiment) => sum + experiment.legal, 0),
  successfulExperimentCount: experiments.filter(
    (experiment) => experiment.coreDamageLossRatio <= 0.01,
  ).length,
  bestExperiment: ranked[0] ?? null,
  experiments,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  explored: report.explored,
  legal: report.legal,
  successfulExperimentCount: report.successfulExperimentCount,
  bestExperiment: report.bestExperiment
    ? Object.fromEntries(Object.entries(report.bestExperiment).filter(
        ([key]) => key !== "bestPacks",
      ))
    : null,
}, null, 2)}\n`);
