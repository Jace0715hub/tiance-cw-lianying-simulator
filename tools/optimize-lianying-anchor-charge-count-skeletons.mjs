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
  buildLianyingAnchorActionCountSkeletons,
  lianyingActionCountSkeletonSegments,
  moveLianyingThunderAnchor,
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
  process.argv[3] ?? "/tmp/lianying-anchor-charge-count-skeletons.json",
);
const profileName = process.argv[4] ?? "probe";
const chargeReportPath = path.resolve(process.argv[5] ?? "");
const templateLimit = Number(process.argv[6] ?? 6);
const targetAnchorOrdinal = Number(process.argv[7] ?? 6);
const targetAnchorRow = Number(process.argv[8] ?? 106);

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
if (!profiles[profileName]) throw new Error("未知雷表断魂刺计数联合搜索档位");
if (!process.argv[5]) throw new Error("必须提供断魂刺计数骨架报告路径");
if (!Number.isInteger(templateLimit) || templateLimit < 1 || templateLimit > 14) {
  throw new Error("模板上限必须是1至14之间的整数");
}
if (!Number.isInteger(targetAnchorOrdinal) || targetAnchorOrdinal < 1) {
  throw new Error("目标雷序号必须是正整数");
}
if (!Number.isInteger(targetAnchorRow) || targetAnchorRow < 1) {
  throw new Error("目标雷行必须是正整数");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const chargeReport = JSON.parse(fs.readFileSync(chargeReportPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的技能轴");
if (!Array.isArray(chargeReport.segments) || chargeReport.segments.length === 0) {
  throw new Error("断魂刺计数报告缺少源区段");
}

const alternatePacks = moveLianyingThunderAnchor(
  sourcePacks,
  targetAnchorOrdinal,
  targetAnchorRow,
);
const alternateCorePacks = stripLianyingDashPacks(alternatePacks);
const alternateAnchors = identifyLianyingThunderSegments(
  alternateCorePacks,
).anchors;
const alternateCompanionAnchors = lianyingCompanionAnchorRows(
  alternateCorePacks,
);
const targetSegments = lianyingActionCountSkeletonSegments(alternateCorePacks, {
  firstAnchorOrdinal: 1,
  lastAnchorOrdinal: 6,
  trackedActionIds: ["charge"],
});
const templates = buildLianyingAnchorActionCountSkeletons(
  chargeReport.segments,
  targetSegments,
  chargeReport.experiments,
  { action: "charge", maximumLossRatio: 0.01, limit: templateLimit },
);
const targetByOrdinal = new Map(targetSegments.map((segment) => [
  Number(segment.ordinal),
  segment,
]));
const actionId = (action) => typeof action === "string" ? action : action?.id;
const chargeRows = (packs) => (packs ?? []).flatMap((pack, index) => [
  ...(pack.prefix ?? []),
  pack.primary,
  ...(pack.tail ?? []),
].some((action) => actionId(action) === "charge") ? [index + 1] : []);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const formalReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const alternateReplay = replayWhitepaperLianying(runtime, alternatePacks, {
  durationSeconds,
});
const alternateChargeRows = chargeRows(alternateCorePacks);
const results = [];

for (const [index, template] of templates.entries()) {
  const constraintByOrdinal = new Map(template.constraints.map((constraint) => {
    const segment = targetSegments.find((candidate) =>
      candidate.startRow === constraint.startRow &&
      candidate.endRow === constraint.endRow);
    return [Number(segment.ordinal), constraint];
  }));
  const finalOrdinal = Math.max(...template.affectedSegmentOrdinals);
  const actionCountConstraints = [];
  for (let ordinal = 1; ordinal <= finalOrdinal; ordinal += 1) {
    const segment = targetByOrdinal.get(ordinal);
    actionCountConstraints.push(constraintByOrdinal.get(ordinal) ?? {
      startRow: segment.startRow,
      endRow: segment.endRow,
      counts: { charge: segment.counts.charge },
    });
  }
  const transformedWarm = moveLianyingThunderAnchor(
    stripLianyingDashPacks(template.sourceBestPacks),
    targetAnchorOrdinal,
    targetAnchorRow,
  );
  const { sourceBestPacks, ...metadata } = template;
  process.stdout.write(`${JSON.stringify({
    phase: "anchor-charge-count-skeleton",
    stage: "start",
    experiment: index + 1,
    experimentCount: templates.length,
    id: template.id,
    sourceExperimentId: template.sourceExperimentId,
  })}\n`);
  let optimized;
  try {
    optimized = optimizeLianyingAnchorDriftResynthesis(runtime, alternatePacks, {
      durationSeconds,
      anchorSlackRows: 0,
      fixFirstAnchor: true,
      fixLastAnchor: true,
      allowedAnchorSchedules: [alternateAnchors],
      rowBeamWidth: profiles[profileName].rowBeamWidth,
      boundaryBeamWidth: profiles[profileName].boundaryBeamWidth,
      coreFinalistCount: profiles[profileName].coreFinalistCount,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      includeCoreCandidatePacks: true,
      coreCandidatePackLimit: profiles[profileName].coreCandidatePackLimit,
      companionAnchorTemplate: alternateCompanionAnchors,
      additionalWarmAxes: [transformedWarm],
      primaryActionConstraints: alternateCorePacks
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
    });
  } catch (error) {
    const result = {
      ...metadata,
      actionCountConstraints,
      explored: 0,
      legal: 0,
      alternativeCount: 0,
      bestCoreDamage: null,
      bestPacks: null,
      failure: error instanceof Error ? error.message : String(error),
    };
    results.push(result);
    process.stdout.write(`${JSON.stringify({
      phase: "anchor-charge-count-skeleton",
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
    ...metadata,
    actionCountConstraints,
    explored: optimized.explored,
    legal: optimized.legal,
    alternativeCount: alternatives.length,
    alternateCoreDamage: incumbent?.coreDamage ?? null,
    bestCoreDamage: best?.coreDamage ?? null,
    alternateCoreDamageGain: best && incumbent
      ? best.coreDamage - incumbent.coreDamage
      : null,
    chargeRows: best ? chargeRows(best.packs) : [],
    changedChargeRows: best ? [
      ...alternateChargeRows.filter((row) => !chargeRows(best.packs).includes(row)),
      ...chargeRows(best.packs).filter((row) => !alternateChargeRows.includes(row)),
    ].sort((left, right) => left - right) : [],
    bestPacks: best?.packs ?? null,
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify({
    phase: "anchor-charge-count-skeleton",
    stage: "complete",
    ...Object.fromEntries(Object.entries(result).filter(
      ([key]) => !["bestPacks", "constraints", "actionCountConstraints"].includes(key),
    )),
  })}\n`);
}

const dashFinalists = results.filter((experiment) => experiment.bestPacks)
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
  result.alternateRotationDamageGain = dash.state.totalDamage -
    alternateReplay.state.totalDamage;
  result.formalRotationDamageGain = dash.state.totalDamage -
    formalReplay.state.totalDamage;
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
  kind: "lianying-anchor-charge-action-count-skeleton-screen",
  inputPath,
  chargeReportPath,
  durationSeconds,
  profileName,
  templateLimit,
  targetAnchorOrdinal,
  targetAnchorRow,
  alternateAnchorRows: alternateAnchors.map((row) => row + 1),
  sourceSegments: chargeReport.segments,
  targetSegments,
  formalRotationDamage: formalReplay.state.totalDamage,
  alternateRotationDamage: alternateReplay.state.totalDamage,
  alternateRotationDamageLoss: formalReplay.state.totalDamage -
    alternateReplay.state.totalDamage,
  searchedTemplateCount: templates.length,
  explored: results.reduce((sum, experiment) => sum + experiment.explored, 0),
  legal: results.reduce((sum, experiment) => sum + experiment.legal, 0),
  improvedAlternateCount: results.filter((experiment) =>
    Number(experiment.alternateRotationDamageGain) > 0).length,
  improvedFormalCount: results.filter((experiment) =>
    Number(experiment.formalRotationDamageGain) > 0).length,
  fullDashCandidateCount: dashFinalists.length,
  alternateBaselineActionPacks: alternatePacks,
  bestExperiment: ranked[0] ?? null,
  actionPacks: ranked[0]?.bestPacks ?? alternatePacks,
  experiments: results,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  alternateAnchorRows: report.alternateAnchorRows,
  formalRotationDamage: report.formalRotationDamage,
  alternateRotationDamage: report.alternateRotationDamage,
  alternateRotationDamageLoss: report.alternateRotationDamageLoss,
  searchedTemplateCount: report.searchedTemplateCount,
  explored: report.explored,
  legal: report.legal,
  improvedAlternateCount: report.improvedAlternateCount,
  improvedFormalCount: report.improvedFormalCount,
  bestExperiment: report.bestExperiment
    ? Object.fromEntries(Object.entries(report.bestExperiment).filter(
        ([key]) => !["bestPacks", "constraints", "actionCountConstraints"].includes(key),
      ))
    : null,
}, null, 2)}\n`);
