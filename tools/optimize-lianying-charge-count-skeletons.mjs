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
  buildLianyingActionCountSkeletons,
  lianyingActionCountSkeletonSegments,
} from "../src/policies/lianying-segment-skeletons.js";
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
  process.argv[3] ?? "/tmp/lianying-charge-count-skeletons.json",
);
const profileName = process.argv[4] ?? "probe";
const templateLimit = Number(process.argv[5] ?? 14);
const templateOffset = Number(process.argv[6] ?? 0);

const profiles = {
  probe: {
    rowBeamWidth: 16,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coreCandidatePackLimit: 16,
    fullDashCandidateLimit: 3,
  },
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 32,
    coreFinalistCount: 32,
    coreCandidatePackLimit: 32,
    fullDashCandidateLimit: 4,
  },
};
if (!profiles[profileName]) throw new Error("未知断魂刺计数骨架搜索档位");
if (!Number.isInteger(templateLimit) || templateLimit < 1 || templateLimit > 24) {
  throw new Error("模板上限必须是1至24之间的整数");
}
if (!Number.isInteger(templateOffset) || templateOffset < 0) {
  throw new Error("模板偏移必须是非负整数");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的技能轴");
const corePacks = stripLianyingDashPacks(sourcePacks);
const anchors = identifyLianyingThunderSegments(corePacks).anchors;
const companionAnchors = lianyingCompanionAnchorRows(corePacks);
const actionId = (action) => typeof action === "string" ? action : action?.id;
const chargeRows = (packs) => packs.flatMap((pack, index) => [
  ...(pack.prefix ?? []),
  pack.primary,
  ...(pack.tail ?? []),
].some((action) => actionId(action) === "charge") ? [index + 1] : []);

const allSegments = lianyingActionCountSkeletonSegments(corePacks, {
  firstAnchorOrdinal: 1,
  lastAnchorOrdinal: 6,
  trackedActionIds: ["charge"],
});
const allTemplates = buildLianyingActionCountSkeletons(allSegments, {
  action: "charge",
  firstSegmentOrdinal: 3,
  lastSegmentOrdinal: 6,
});
const templates = allTemplates.slice(
  templateOffset,
  templateOffset + templateLimit,
);
const segmentByOrdinal = new Map(allSegments.map((segment) => [
  Number(segment.ordinal),
  segment,
]));
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const baselineReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const baselineChargeRows = chargeRows(corePacks);
const results = [];

for (const [index, template] of templates.entries()) {
  const targetByOrdinal = new Map(template.constraints.map((constraint) => {
    const segment = allSegments.find((candidate) =>
      candidate.startRow === constraint.startRow &&
      candidate.endRow === constraint.endRow);
    return [Number(segment.ordinal), constraint];
  }));
  const finalConstrainedOrdinal = Math.max(...template.affectedSegmentOrdinals);
  const actionCountConstraints = [];
  for (let ordinal = 1; ordinal <= finalConstrainedOrdinal; ordinal += 1) {
    const segment = segmentByOrdinal.get(ordinal);
    const target = targetByOrdinal.get(ordinal);
    actionCountConstraints.push(target ?? {
      startRow: segment.startRow,
      endRow: segment.endRow,
      counts: { charge: segment.counts.charge },
    });
  }
  process.stdout.write(`${JSON.stringify({
    phase: "charge-count-skeleton",
    stage: "start",
    experiment: index + 1,
    experimentCount: templates.length,
    id: template.id,
    targetCounts: actionCountConstraints.map((constraint) =>
      constraint.counts.charge),
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
        companionAnchorTemplate: companionAnchors,
        primaryActionConstraints: corePacks
          .slice(0, template.startRow - 1)
          .map((pack, rowIndex) => ({
            row: rowIndex + 1,
            allowedActionIds: [actionId(pack.primary)],
          })),
        actionCountConstraints,
        qualityDiversityRestart: {
          bucketTicks: 16000,
          candidateMultiplier: 8,
          rowQuota: 6,
          boundaryQuota: 6,
          lineageQuota: 4,
          lineageTenureSegments: 1,
          seed: index,
        },
      },
    );
  } catch (error) {
    const result = {
      ...template,
      actionCountConstraints,
      explored: 0,
      legal: 0,
      alternativeCount: 0,
      bestCoreDamage: null,
      coreDamageLoss: null,
      coreDamageLossRatio: null,
      bestPacks: null,
      failure: error instanceof Error ? error.message : String(error),
    };
    results.push(result);
    process.stdout.write(`${JSON.stringify({
      phase: "charge-count-skeleton",
      stage: "complete",
      id: template.id,
      failure: result.failure,
    })}\n`);
    continue;
  }
  const incumbent = optimized.coreCandidatePacks.find(
    (candidate) => candidate.isIncumbent,
  );
  const alternatives = optimized.coreCandidatePacks.filter(
    (candidate) => !candidate.isIncumbent,
  );
  const best = alternatives[0] ?? null;
  const result = {
    ...template,
    actionCountConstraints,
    explored: optimized.explored,
    legal: optimized.legal,
    alternativeCount: alternatives.length,
    baselineCoreDamage: incumbent?.coreDamage ?? null,
    bestCoreDamage: best?.coreDamage ?? null,
    coreDamageLoss: best && incumbent
      ? incumbent.coreDamage - best.coreDamage
      : null,
    coreDamageLossRatio: best && incumbent
      ? (incumbent.coreDamage - best.coreDamage) / incumbent.coreDamage
      : null,
    chargeRows: best ? chargeRows(best.packs) : [],
    changedChargeRows: best ? [
      ...baselineChargeRows.filter((row) => !chargeRows(best.packs).includes(row)),
      ...chargeRows(best.packs).filter((row) => !baselineChargeRows.includes(row)),
    ].sort((left, right) => left - right) : [],
    bestPacks: best?.packs ?? null,
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify({
    phase: "charge-count-skeleton",
    stage: "complete",
    ...Object.fromEntries(Object.entries(result).filter(
      ([key]) => !["bestPacks", "constraints", "actionCountConstraints"].includes(key),
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

const ranked = results.filter((experiment) =>
  Number.isFinite(experiment.bestCoreDamage))
  .sort((left, right) =>
    Number(right.rotationDamage ?? right.bestCoreDamage) -
      Number(left.rotationDamage ?? left.bestCoreDamage));
const report = {
  schemaVersion: 1,
  kind: "lianying-charge-action-count-skeleton-screen",
  inputPath,
  durationSeconds,
  profileName,
  templateLimit,
  templateOffset,
  generatedTemplateCount: allTemplates.length,
  searchedTemplateCount: templates.length,
  segments: allSegments,
  baselineChargeRows,
  explored: results.reduce((sum, experiment) => sum + experiment.explored, 0),
  legal: results.reduce((sum, experiment) => sum + experiment.legal, 0),
  successfulExperimentCount: results.filter((experiment) =>
    Number.isFinite(experiment.coreDamageLossRatio) &&
    experiment.coreDamageLossRatio <= 0.01).length,
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
        ([key]) => !["bestPacks", "constraints", "actionCountConstraints"].includes(key),
      ))
    : null,
}, null, 2)}\n`);
