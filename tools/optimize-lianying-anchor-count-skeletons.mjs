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
  buildLianyingAnchorCountSkeletons,
  lianyingCountSkeletonSegments,
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
  process.argv[3] ?? "/tmp/lianying-anchor-count-skeletons.json",
);
const profileName = process.argv[4] ?? "probe";
const reportArgument = process.argv[5];
const templateLimit = Number(process.argv[6] ?? 6);
const targetAnchorOrdinal = Number(process.argv[7] ?? 6);
const targetAnchorRow = Number(process.argv[8] ?? 106);

const profiles = {
  probe: {
    rowBeamWidth: 16,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coreCandidatePackLimit: 16,
    structureQuota: 6,
    fullDashCandidateLimit: 3,
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
if (!profiles[profileName]) throw new Error("未知雷表计数联合搜索档位");
if (!reportArgument) throw new Error("必须提供逗号分隔的单骨架报告路径");
if (!Number.isInteger(templateLimit) || templateLimit < 1 || templateLimit > 24) {
  throw new Error("模板上限必须是1至24之间的整数");
}
if (!Number.isInteger(targetAnchorOrdinal) || targetAnchorOrdinal < 1) {
  throw new Error("目标雷序号必须是正整数");
}
if (!Number.isInteger(targetAnchorRow) || targetAnchorRow < 1) {
  throw new Error("目标雷行必须是正整数");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的技能轴");
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
const actionId = (action) => typeof action === "string" ? action : action?.id;

const singleReportPaths = reportArgument.split(",")
  .map((value) => path.resolve(value.trim()))
  .filter(Boolean);
const singleReports = singleReportPaths.map((reportPath) =>
  JSON.parse(fs.readFileSync(reportPath, "utf8")));
const sourceSegments = singleReports[0]?.segments;
if (!Array.isArray(sourceSegments) || sourceSegments.length === 0) {
  throw new Error("单骨架报告缺少区段基线");
}
if (singleReports.some((report) =>
  JSON.stringify(report.segments) !== JSON.stringify(sourceSegments))) {
  throw new Error("单骨架报告的区段基线不一致");
}
const firstSegmentOrdinal = Math.min(...sourceSegments.map(
  (segment) => Number(segment.ordinal),
));
const targetSegments = lianyingCountSkeletonSegments(alternateCorePacks, {
  firstAnchorOrdinal: firstSegmentOrdinal,
  lastAnchorOrdinal: Math.max(
    targetAnchorOrdinal,
    ...sourceSegments.map((segment) => Number(segment.ordinal)),
  ),
});
const templates = buildLianyingAnchorCountSkeletons(
  sourceSegments,
  targetSegments,
  singleReports.flatMap((report) => report.experiments ?? []),
  { limit: templateLimit },
);

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const formalReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const alternateReplay = replayWhitepaperLianying(runtime, alternatePacks, {
  durationSeconds,
});
const results = [];

for (const [index, template] of templates.entries()) {
  const transformedWarm = moveLianyingThunderAnchor(
    template.sourceBestPacks,
    targetAnchorOrdinal,
    targetAnchorRow,
  );
  const { sourceBestPacks, ...templateMetadata } = template;
  process.stdout.write(`${JSON.stringify({
    phase: "anchor-count-skeleton",
    stage: "start",
    experiment: index + 1,
    experimentCount: templates.length,
    id: template.id,
    sourceExperimentId: template.sourceExperimentId,
  })}\n`);
  let optimized;
  try {
    optimized = optimizeLianyingAnchorDriftResynthesis(
      runtime,
      alternatePacks,
      {
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
        primaryCountConstraints: template.constraints,
        primaryStructureDiversity: {
          startRow: template.startRow,
          endRow: template.endRow,
          rowBucketSize: 2,
          maximumDifferences: 10,
          rowQuota: profiles[profileName].structureQuota,
          boundaryQuota: profiles[profileName].structureQuota,
        },
      },
    );
  } catch (error) {
    const result = {
      ...templateMetadata,
      explored: 0,
      legal: 0,
      alternativeCount: 0,
      bestCoreDamage: null,
      alternateCoreDamageGain: null,
      bestPacks: null,
      failure: error instanceof Error ? error.message : String(error),
    };
    results.push(result);
    process.stdout.write(`${JSON.stringify({
      phase: "anchor-count-skeleton",
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
  const differingRows = best?.packs.flatMap((pack, rowIndex) =>
    actionId(pack.primary) === actionId(alternateCorePacks[rowIndex].primary)
      ? []
      : [rowIndex + 1]) ?? [];
  const result = {
    ...templateMetadata,
    explored: optimized.explored,
    legal: optimized.legal,
    alternativeCount: alternatives.length,
    alternateCoreDamage: incumbent?.coreDamage ?? null,
    bestCoreDamage: best?.coreDamage ?? null,
    alternateCoreDamageGain: best && incumbent
      ? best.coreDamage - incumbent.coreDamage
      : null,
    differingRows,
    bestPacks: best?.packs ?? null,
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify({
    phase: "anchor-count-skeleton",
    stage: "complete",
    ...Object.fromEntries(Object.entries(result).filter(
      ([key]) => !["bestPacks", "constraints"].includes(key),
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
  kind: "lianying-anchor-segment-count-skeleton-screen",
  inputPath,
  durationSeconds,
  profileName,
  singleReportPaths,
  templateLimit,
  targetAnchorOrdinal,
  targetAnchorRow,
  alternateAnchorRows: alternateAnchors.map((row) => row + 1),
  sourceSegments,
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
        ([key]) => !["bestPacks", "constraints"].includes(key),
      ))
    : null,
}, null, 2)}\n`);
