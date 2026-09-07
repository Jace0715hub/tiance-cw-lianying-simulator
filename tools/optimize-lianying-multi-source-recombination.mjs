import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import { optimizeLianyingMultiSourceRecombination } from
  "../src/policies/lianying-multi-source-recombination.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-multi-source-recombination.json",
);
const profileName = process.argv[4] ?? "probe";
const sourcePath = resolveLianyingResearchPath(
  projectRoot,
  process.argv[5] ?? "output/lianying-ranking-sensitivity.json",
);
const sourceIds = (process.argv[6] ?? "heterogeneous,thunder106")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const warmPaths = (process.argv[7] === "-" ? "" : (process.argv[7] ?? ""))
  .split(",")
  .map((candidate) => candidate.trim())
  .filter(Boolean)
  .map((candidate) => resolveLianyingResearchPath(projectRoot, candidate));
const sourceNormalizeBeforeRow = process.argv[8]
  ? Number(process.argv[8])
  : null;

const profiles = {
  probe: {
    segmentCount: 3,
    maxPasses: 1,
    beamWidth: 24,
    finalistCount: 12,
    coarseCandidateLimit: 8,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
    boundaryPaddingRows: 0,
    diverseCandidateLimit: 16,
  },
  screen: {
    segmentCount: 3,
    maxPasses: 1,
    beamWidth: 48,
    finalistCount: 24,
    coarseCandidateLimit: 12,
    coarseDashStates: 12,
    finalDashCandidateCount: 4,
    fullDashStates: 256,
    boundaryPaddingRows: 0,
    diverseCandidateLimit: 24,
  },
  "adaptive-probe": {
    segmentCount: 3,
    maxPasses: 1,
    beamWidth: 24,
    finalistCount: 12,
    coarseCandidateLimit: 8,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
    boundaryPaddingRows: 0,
    diverseCandidateLimit: 16,
    adaptiveSuffixRepair: true,
    adaptiveSuffixMaxExpansions: 2,
    adaptiveSuffixLookaheadRows: 4,
    adaptiveSuffixMaximumAddedRows: 16,
    adaptiveSuffixPreferDriftedLineages: false,
    adaptiveSuffixWarmFailureLimit: 4,
    adaptiveSuffixFailureChainLimit: 2,
    adaptiveSuffixFailureRowBucketSize: 8,
    adaptiveSuffixDirectedRepairLimit: 4,
  },
  "quad-probe": {
    segmentCount: 4,
    maxPasses: 1,
    beamWidth: 24,
    finalistCount: 12,
    coarseCandidateLimit: 8,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
    boundaryPaddingRows: 0,
    diverseCandidateLimit: 16,
  },
  "quad-screen": {
    segmentCount: 4,
    maxPasses: 1,
    beamWidth: 48,
    finalistCount: 24,
    coarseCandidateLimit: 12,
    coarseDashStates: 12,
    finalDashCandidateCount: 4,
    fullDashStates: 256,
    boundaryPaddingRows: 0,
    diverseCandidateLimit: 24,
  },
  "quint-probe": {
    segmentCount: 5,
    maxPasses: 1,
    beamWidth: 24,
    finalistCount: 12,
    coarseCandidateLimit: 8,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
    boundaryPaddingRows: 0,
    diverseCandidateLimit: 16,
  },
};
if (!profiles[profileName]) {
  throw new Error("未知的多来源重组档位");
}

function packsFromReport(source, label) {
  const packs = source?.candidateActionPacks ?? source?.actionPacks ??
    (source?.rows ? lianyingRowsToActionPacks(source.rows) : null);
  if (!packs) throw new Error(`${label}缺少可恢复的动作包`);
  return packs;
}

const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const incumbentPacks = packsFromReport(input, "正式轴");
const sourceReport = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
if (!Array.isArray(sourceReport.candidates)) {
  throw new Error("多来源报告缺少候选列表");
}
const sourceAxes = sourceIds.map((id) => {
  const candidate = sourceReport.candidates.find((entry) => entry.id === id);
  if (!candidate) throw new Error(`多来源报告中找不到候选 ${id}`);
  return { id, packs: packsFromReport(candidate, `候选 ${id}`) };
});
const explicitWarmAxes = warmPaths.map((warmPath) => packsFromReport(
  JSON.parse(fs.readFileSync(warmPath, "utf8")),
  `热启动 ${warmPath}`,
));
const durationSeconds = Number(input.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });

const stageProfiles = {
  probe: ["probe"],
  screen: ["probe", "screen"],
  "adaptive-probe": ["probe", "adaptive-probe"],
  "quad-probe": ["quad-probe"],
  "quad-screen": ["quad-probe", "quad-screen"],
  "quint-probe": ["quint-probe"],
}[profileName];
const stages = [];
const inheritedElites = [...explicitWarmAxes];
for (const stageProfile of stageProfiles) {
  const optimized = optimizeLianyingMultiSourceRecombination(
    runtime,
    incumbentPacks,
    sourceAxes,
    {
      durationSeconds,
      ...profiles[stageProfile],
      additionalWarmAxes: inheritedElites,
      sourceNormalizeBeforeRow,
      onProgress: (event) => process.stdout.write(`${JSON.stringify({
        phase: "multi-source-recombination",
        requestedProfile: profileName,
        stageProfile,
        ...event,
      })}\n`),
    },
  );
  stages.push({ stageProfile, optimized });
  inheritedElites.push(optimized.candidatePacks);
}

const bestStage = stages.reduce((best, stage) =>
  stage.optimized.candidateDamage > best.optimized.candidateDamage
    ? stage
    : best);
const best = bestStage.optimized;
const accepted = best.candidateDamage > best.baselineDamage;
const candidateAudit = auditWhitepaperAxis(best.candidateState, { mode: "fixed" });
const report = {
  schemaVersion: 1,
  kind: "lianying-multi-source-recombination",
  inputPath,
  sourcePath,
  sourceIds,
  warmPaths,
  sourceNormalizeBeforeRow,
  durationSeconds,
  profileName,
  stageProfiles,
  bestStageProfile: bestStage.stageProfile,
  jointDifferenceRows: best.joint.differenceRows,
  jointSources: best.joint.sources,
  span: best.span,
  baselineRotationDamage: best.baselineDamage,
  jointDonorRotationDamage: best.donorDamage,
  candidateRotationDamage: best.candidateDamage,
  jointDonorDamageGain: best.candidateDamage - best.donorDamage,
  globalDamageGain: best.candidateDamage - best.baselineDamage,
  improvedJointDonor: best.candidateDamage > best.donorDamage,
  accepted,
  candidateMechanicsPassed: candidateAudit.mechanics.passed,
  candidateMechanicsViolationCount: candidateAudit.mechanics.violationCount,
  stages: stages.map(({ stageProfile, optimized }) => ({
    stageProfile,
    candidateRotationDamage: optimized.candidateDamage,
    jointDonorDamageGain: optimized.candidateDamage - optimized.donorDamage,
    globalDamageGain: optimized.candidateDamage - optimized.baselineDamage,
    passes: optimized.resynthesis.passes,
  })),
  candidateActionPacks: best.candidatePacks,
  actionPacks: accepted ? best.candidatePacks : incumbentPacks,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  profileName,
  bestStageProfile: report.bestStageProfile,
  sourceIds,
  jointDifferenceRows: report.jointDifferenceRows,
  span: report.span,
  baselineRotationDamage: report.baselineRotationDamage,
  jointDonorRotationDamage: report.jointDonorRotationDamage,
  candidateRotationDamage: report.candidateRotationDamage,
  jointDonorDamageGain: report.jointDonorDamageGain,
  globalDamageGain: report.globalDamageGain,
  improvedJointDonor: report.improvedJointDonor,
  accepted: report.accepted,
  candidateMechanicsPassed: report.candidateMechanicsPassed,
  candidateMechanicsViolationCount: report.candidateMechanicsViolationCount,
  stages: report.stages.map((stage) => ({
    stageProfile: stage.stageProfile,
    candidateRotationDamage: stage.candidateRotationDamage,
    jointDonorDamageGain: stage.jointDonorDamageGain,
    globalDamageGain: stage.globalDamageGain,
  })),
}, null, 2)}\n`);
