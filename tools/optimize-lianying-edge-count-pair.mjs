import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import {
  lianyingCompanionAnchorRows,
  optimizeLianyingAnchorDriftResynthesis,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import {
  identifyLianyingThunderSegments,
  stripLianyingDashPacks,
} from "../src/policies/lianying-segment-resynthesis.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-edge-count-pair.json",
);
const profileName = process.argv[4] ?? "probe";
const sourceArguments = process.argv.slice(5);
const profiles = {
  probe: {
    rowBeamWidth: 16,
    boundaryBeamWidth: 12,
    coreFinalistCount: 16,
    coreCandidatePackLimit: 16,
    structureQuota: 6,
    dashStates: 128,
  },
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 24,
    coreFinalistCount: 32,
    coreCandidatePackLimit: 32,
    structureQuota: 10,
    dashStates: 256,
  },
};
if (!profiles[profileName]) throw new Error("双计数补偿档位必须是probe或screen");
if (sourceArguments.length !== 4) {
  throw new Error("必须依次提供reportA、templateA、reportB、templateB");
}

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function packActions(pack) {
  return [...(pack?.prefix ?? []), pack?.primary, ...(pack?.tail ?? [])];
}

function countAction(packs, experiment) {
  const selected = packs.slice(
    experiment.segment.startRow - 1,
    experiment.segment.endRow,
  );
  return selected.reduce((sum, pack) => sum +
    (experiment.location === "primary"
      ? Number(actionId(pack.primary) === experiment.action)
      : packActions(pack).filter(
          (action) => actionId(action) === experiment.action).length), 0);
}

function experimentSatisfied(packs, experiment) {
  return countAction(packs, experiment) === Number(experiment.targetCount);
}

function readExperiment(reportPath, id) {
  const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), "utf8"));
  const experiment = report.experiments?.find((candidate) => candidate.id === id);
  if (!experiment?.bestPacks) throw new Error(`报告中缺少完整候选${id}`);
  return {
    reportPath: path.resolve(reportPath),
    experiment: {
      ...experiment,
      bestPacks: stripLianyingDashPacks(experiment.bestPacks),
    },
  };
}

function mergeExperimentPacks(referencePacks, sources) {
  const merged = structuredClone(referencePacks);
  const claimed = new Map();
  for (const { experiment } of sources) {
    for (
      let row = experiment.segment.startRow;
      row <= experiment.segment.endRow;
      row += 1
    ) {
      const index = row - 1;
      const reference = JSON.stringify(referencePacks[index]);
      const candidate = JSON.stringify(experiment.bestPacks[index]);
      if (candidate === reference) continue;
      if (claimed.has(row) && claimed.get(row) !== candidate) {
        throw new Error(`双计数来源在第${row}行冲突`);
      }
      claimed.set(row, candidate);
      merged[index] = structuredClone(experiment.bestPacks[index]);
    }
  }
  return { packs: merged, changedRows: [...claimed.keys()] };
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入轴缺少可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const corePacks = stripLianyingDashPacks(sourcePacks);
const sources = [
  readExperiment(sourceArguments[0], sourceArguments[1]),
  readExperiment(sourceArguments[2], sourceArguments[3]),
];
const merged = mergeExperimentPacks(corePacks, sources);
if (!sources.every(({ experiment }) =>
  experimentSatisfied(merged.packs, experiment))) {
  throw new Error("合并热启动没有同时满足两项计数约束");
}
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const baseline = replayWhitepaperLianying(runtime, sourcePacks, { durationSeconds });
const coreBaseline = replayWhitepaperLianying(runtime, corePacks, {
  durationSeconds,
});
const mergedReplay = replayWhitepaperLianying(runtime, merged.packs, {
  durationSeconds,
});
const anchors = identifyLianyingThunderSegments(corePacks).anchors;
const profile = profiles[profileName];
const primaryCountConstraints = sources.flatMap(({ experiment }) =>
  experiment.location === "primary" ? [{
    startRow: experiment.segment.startRow,
    endRow: experiment.segment.endRow,
    counts: { [experiment.action]: experiment.targetCount },
  }] : []);
const actionCountConstraints = sources.flatMap(({ experiment }) =>
  experiment.location === "all" ? [{
    startRow: experiment.segment.startRow,
    endRow: experiment.segment.endRow,
    counts: { [experiment.action]: experiment.targetCount },
  }] : []);
const startRow = Math.min(...sources.map(
  ({ experiment }) => experiment.segment.startRow));
const endRow = Math.max(...sources.map(
  ({ experiment }) => experiment.segment.endRow));

const optimized = optimizeLianyingAnchorDriftResynthesis(
  runtime,
  sourcePacks,
  {
    durationSeconds,
    allowedAnchorSchedules: [anchors],
    companionAnchorTemplate: lianyingCompanionAnchorRows(corePacks),
    allowIncumbentConstraintExit: true,
    preserveReferenceWaitRows: true,
    additionalWarmAxes: [merged.packs],
    rowBeamWidth: profile.rowBeamWidth,
    boundaryBeamWidth: profile.boundaryBeamWidth,
    coreFinalistCount: profile.coreFinalistCount,
    coarseCandidateLimit: 2,
    coarseDashStates: 4,
    finalDashCandidateCount: 1,
    fullDashStates: 4,
    includeCoreCandidatePacks: true,
    coreCandidatePackLimit: profile.coreCandidatePackLimit,
    primaryActionConstraints: corePacks.slice(0, startRow - 1)
      .map((pack, rowIndex) => ({
        row: rowIndex + 1,
        allowedActionIds: [actionId(pack.primary)],
      })),
    primaryCountConstraints,
    actionCountConstraints,
    primaryStructureDiversity: {
      startRow,
      endRow,
      rowBucketSize: 2,
      maximumDifferences: 12,
      rowQuota: profile.structureQuota,
      boundaryQuota: profile.structureQuota,
    },
  },
);
const candidates = optimized.coreCandidatePacks.filter((candidate) =>
  sources.every(({ experiment }) => experimentSatisfied(
    candidate.packs,
    experiment,
  ))).sort((left, right) => right.coreDamage - left.coreDamage);
const bestCore = candidates[0] ?? null;
if (!bestCore) throw new Error("双计数约束没有生成完整合法轴");
const dash = optimizeLianyingDashOverlay(runtime, bestCore.packs, {
  durationSeconds,
  maxStatesPerRow: profile.dashStates,
});
const audit = auditWhitepaperAxis(dash.state, { mode: "fixed" });
const report = {
  schemaVersion: 1,
  kind: "lianying-edge-count-pair",
  inputPath,
  outputPath,
  durationSeconds,
  profileName,
  sources: sources.map(({ reportPath, experiment }) => ({
    reportPath,
    id: experiment.id,
    segment: experiment.segment,
    action: experiment.action,
    location: experiment.location,
    targetCount: experiment.targetCount,
    sourceDamageDifference: experiment.damageDifference,
  })),
  primaryCountConstraints,
  actionCountConstraints,
  startRow,
  endRow,
  mergedWarmChangedRows: merged.changedRows,
  mergedWarmCoreDamage: mergedReplay.state.totalDamage,
  mergedWarmCoreDamageDifference:
    mergedReplay.state.totalDamage - coreBaseline.state.totalDamage,
  explored: optimized.explored,
  legal: optimized.legal,
  candidateCount: candidates.length,
  bestCoreDamage: bestCore.coreDamage,
  rotationDamage: dash.state.totalDamage,
  damageDifference: dash.state.totalDamage - baseline.state.totalDamage,
  damageLossRatio:
    (baseline.state.totalDamage - dash.state.totalDamage) /
    baseline.state.totalDamage,
  improvement: dash.state.totalDamage > baseline.state.totalDamage,
  closerThanBestSource: dash.state.totalDamage > Math.max(
    ...sources.map(({ experiment }) =>
      baseline.state.totalDamage + Number(experiment.damageDifference)),
  ),
  mechanicsPassed: audit.mechanics.passed,
  mechanicsViolationCount: audit.mechanics.violationCount,
  bestPacks: dash.packs,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  phase: "edge-count-pair",
  stage: "complete",
  outputPath,
  profileName,
  mergedWarmChangedRows: report.mergedWarmChangedRows,
  explored: report.explored,
  legal: report.legal,
  candidateCount: report.candidateCount,
  rotationDamage: report.rotationDamage,
  damageDifference: report.damageDifference,
  damageLossRatio: report.damageLossRatio,
  improvement: report.improvement,
  closerThanBestSource: report.closerThanBestSource,
  mechanicsPassed: report.mechanicsPassed,
}, null, 2)}\n`);
