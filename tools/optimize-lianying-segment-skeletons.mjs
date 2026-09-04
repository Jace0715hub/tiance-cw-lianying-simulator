import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
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
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-segment-skeletons.json",
);
const profileName = process.argv[4] ?? "probe";
const templateLimit = Number(process.argv[5] ?? 18);
const templateOffset = Number(process.argv[6] ?? 0);
const warmReportPath = process.argv[7]
  ? path.resolve(process.argv[7])
  : null;

const profiles = {
  probe: {
    rowBeamWidth: 16,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coreCandidatePackLimit: 16,
    structureQuota: 6,
    fullDashCandidateLimit: 2,
  },
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 32,
    coreFinalistCount: 32,
    coreCandidatePackLimit: 32,
    structureQuota: 8,
    fullDashCandidateLimit: 4,
  },
};
if (!profiles[profileName]) throw new Error("未知区段技能计数骨架搜索档位");
if (!Number.isInteger(templateLimit) || templateLimit < 1 || templateLimit > 64) {
  throw new Error("模板上限必须是1至64之间的整数");
}
if (!Number.isInteger(templateOffset) || templateOffset < 0) {
  throw new Error("模板偏移必须是非负整数");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const warmReport = warmReportPath
  ? JSON.parse(fs.readFileSync(warmReportPath, "utf8"))
  : null;
const warmPacksByTemplateId = new Map(
  (warmReport?.experiments ?? []).flatMap((experiment) =>
    experiment.bestPacks ? [[experiment.id, experiment.bestPacks]] : []),
);
const durationSeconds = Number(source.durationSeconds ?? 180);
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的技能轴");
const corePacks = stripLianyingDashPacks(sourcePacks);
const anchors = identifyLianyingThunderSegments(corePacks).anchors;
if (anchors.length < 6) throw new Error("输入轴不足以构造第3至第5雷区段骨架");
const companionAnchors = lianyingCompanionAnchorRows(corePacks);
const actionId = (action) => typeof action === "string" ? action : action?.id;
const trackedActionIds = [
  "dragonFang",
  "destroy",
  "dragonRoar",
  "cloudStrike",
  "charge",
];
const resourceActionIds = trackedActionIds.slice(1);

function segmentDescriptor(anchorIndex) {
  const startIndex = anchors[anchorIndex];
  const endIndex = anchors[anchorIndex + 1] - 1;
  const counts = Object.fromEntries(trackedActionIds.map((id) => [id, 0]));
  for (const pack of corePacks.slice(startIndex, endIndex + 1)) {
    const id = actionId(pack.primary);
    if (Object.hasOwn(counts, id)) counts[id] += 1;
  }
  return {
    ordinal: anchorIndex + 1,
    startRow: startIndex + 1,
    endRow: endIndex + 1,
    counts,
  };
}

const segments = [2, 3, 4].map(segmentDescriptor);
const cloneCounts = (counts) => ({ ...counts });
const constraintFor = (segment, counts) => ({
  startRow: segment.startRow,
  endRow: segment.endRow,
  counts,
});

function buildTransferTemplates() {
  const templates = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const pair = [segments[index], segments[index + 1]];
    for (const [source, destination] of [pair, [...pair].reverse()]) {
      for (const resourceId of resourceActionIds) {
        if (
          source.counts[resourceId] < 1 ||
          destination.counts.dragonFang < 1
        ) continue;
        const sourceCounts = cloneCounts(source.counts);
        const destinationCounts = cloneCounts(destination.counts);
        sourceCounts[resourceId] -= 1;
        sourceCounts.dragonFang += 1;
        destinationCounts[resourceId] += 1;
        destinationCounts.dragonFang -= 1;
        templates.push({
          id: `transfer-s${source.ordinal}-to-s${destination.ordinal}-${resourceId}`,
          kind: "adjacent-resource-transfer",
          description: `第${source.ordinal}雷区段向第${destination.ordinal}雷区段转移1个${resourceId}`,
          startRow: Math.min(source.startRow, destination.startRow),
          endRow: Math.max(source.endRow, destination.endRow),
          constraints: [
            constraintFor(source, sourceCounts),
            constraintFor(destination, destinationCounts),
          ].sort((left, right) => left.startRow - right.startRow),
        });
      }
    }
  }
  return templates;
}

function buildReplacementTemplates() {
  const templates = [];
  for (const segment of segments) {
    for (const fromId of resourceActionIds) {
      if (segment.counts[fromId] < 1) continue;
      for (const toId of resourceActionIds) {
        if (fromId === toId) continue;
        const counts = cloneCounts(segment.counts);
        counts[fromId] -= 1;
        counts[toId] += 1;
        templates.push({
          id: `replace-s${segment.ordinal}-${fromId}-with-${toId}`,
          kind: "within-segment-resource-replacement",
          description: `第${segment.ordinal}雷区段以1个${toId}替换${fromId}`,
          startRow: segment.startRow,
          endRow: segment.endRow,
          constraints: [constraintFor(segment, counts)],
        });
      }
    }
  }
  return templates;
}

const allTemplates = [
  ...buildTransferTemplates(),
  ...buildReplacementTemplates(),
];
const templates = allTemplates.slice(templateOffset, templateOffset + templateLimit);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const baselineReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const results = [];

for (const [index, template] of templates.entries()) {
  process.stdout.write(`${JSON.stringify({
    phase: "segment-skeleton",
    stage: "start",
    experiment: index + 1,
    experimentCount: templates.length,
    id: template.id,
  })}\n`);
  let optimized;
  try {
    optimized = optimizeLianyingAnchorDriftResynthesis(
      runtime,
      sourcePacks,
      {
        durationSeconds,
        anchorSlackRows: 0,
        fixFirstAnchor: true,
        fixLastAnchor: true,
        allowedAnchorSchedules: [anchors],
        rowBeamWidth: profiles[profileName].rowBeamWidth,
        boundaryBeamWidth: profiles[profileName].boundaryBeamWidth,
        coreFinalistCount: profiles[profileName].coreFinalistCount,
        coarseCandidateLimit: 2,
        coarseDashStates: 4,
        finalDashCandidateCount: 1,
        fullDashStates: 4,
        includeCoreCandidatePacks: true,
        coreCandidatePackLimit: profiles[profileName].coreCandidatePackLimit,
        additionalWarmAxes: warmPacksByTemplateId.has(template.id)
          ? [warmPacksByTemplateId.get(template.id)]
          : [],
        companionAnchorTemplate: companionAnchors,
        primaryActionConstraints: corePacks
          .slice(0, template.startRow - 1)
          .map((pack, rowIndex) => ({
            row: rowIndex + 1,
            allowedActionIds: [actionId(pack.primary)],
          })),
        primaryCountConstraints: template.constraints,
        primaryStructureDiversity: {
          startRow: template.startRow,
          endRow: template.endRow,
          rowBucketSize: 2,
          maximumDifferences: 8,
          rowQuota: profiles[profileName].structureQuota,
          boundaryQuota: profiles[profileName].structureQuota,
        },
      },
    );
  } catch (error) {
    const result = {
      ...template,
      explored: 0,
      legal: 0,
      alternativeCount: 0,
      baselineCoreDamage: null,
      bestCoreDamage: null,
      coreDamageLoss: null,
      coreDamageLossRatio: null,
      bestPacks: null,
      failure: error instanceof Error ? error.message : String(error),
    };
    results.push(result);
    process.stdout.write(`${JSON.stringify({
      phase: "segment-skeleton",
      stage: "complete",
      id: template.id,
      failure: result.failure,
    })}\n`);
    continue;
  }
  const baseline = optimized.coreCandidatePacks.find(
    (candidate) => candidate.isIncumbent,
  );
  const alternatives = optimized.coreCandidatePacks.filter(
    (candidate) => !candidate.isIncumbent,
  );
  const best = alternatives[0] ?? null;
  const differingRows = best?.packs.flatMap((pack, rowIndex) =>
    actionId(pack.primary) === actionId(corePacks[rowIndex].primary)
      ? []
      : [rowIndex + 1]) ?? [];
  const result = {
    ...template,
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
    differingRows,
    bestPacks: best?.packs ?? null,
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify({
    phase: "segment-skeleton",
    stage: "complete",
    ...Object.fromEntries(Object.entries(result).filter(
      ([key]) => key !== "bestPacks" && key !== "constraints",
    )),
  })}\n`);
}

const dashFinalists = results.filter((experiment) =>
  experiment.bestPacks && experiment.coreDamageLossRatio <= 0.01)
  .sort((left, right) => right.bestCoreDamage - left.bestCoreDamage)
  .slice(0, profiles[profileName].fullDashCandidateLimit);
for (const result of dashFinalists) {
  const dash = optimizeLianyingDashOverlay(runtime, result.bestPacks, {
    durationSeconds,
    maxStatesPerRow: 128,
  });
  const audit = auditWhitepaperAxis(dash.state, { mode: "fixed" });
  result.bestPacks = dash.packs;
  result.rotationDamage = dash.state.totalDamage;
  result.rotationDamageLoss = baselineReplay.state.totalDamage -
    dash.state.totalDamage;
  result.rotationDamageLossRatio = result.rotationDamageLoss /
    baselineReplay.state.totalDamage;
  result.dashCount = dash.dashCount;
  result.mechanicsPassed = audit.mechanics.passed;
  result.mechanicsViolationCount = audit.mechanics.violationCount;
}

const ranked = results
  .filter((experiment) => Number.isFinite(experiment.bestCoreDamage))
  .sort((left, right) =>
    Number(right.rotationDamage ?? right.bestCoreDamage) -
      Number(left.rotationDamage ?? left.bestCoreDamage));
const report = {
  schemaVersion: 1,
  kind: "lianying-segment-primary-count-skeleton-screen",
  inputPath,
  durationSeconds,
  profileName,
  templateLimit,
  templateOffset,
  warmReportPath,
  generatedTemplateCount: allTemplates.length,
  searchedTemplateCount: templates.length,
  trackedActionIds,
  segments,
  successGateMaximumCoreDamageLossRatio: 0.01,
  explored: results.reduce((sum, experiment) => sum + experiment.explored, 0),
  legal: results.reduce((sum, experiment) => sum + experiment.legal, 0),
  successfulExperimentCount: results.filter(
    (experiment) => Number.isFinite(experiment.coreDamageLossRatio) &&
      experiment.coreDamageLossRatio <= 0.01,
  ).length,
  fullDashCandidateCount: dashFinalists.length,
  bestExperiment: ranked[0] ?? null,
  actionPacks: ranked[0]?.bestPacks ?? null,
  experiments: results,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  generatedTemplateCount: report.generatedTemplateCount,
  searchedTemplateCount: report.searchedTemplateCount,
  explored: report.explored,
  legal: report.legal,
  successfulExperimentCount: report.successfulExperimentCount,
  bestExperiment: report.bestExperiment
    ? Object.fromEntries(Object.entries(report.bestExperiment).filter(
        ([key]) => key !== "bestPacks" && key !== "constraints",
      ))
    : null,
}, null, 2)}\n`);
