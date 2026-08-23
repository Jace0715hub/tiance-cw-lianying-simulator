import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingTripleSegmentRecombination } from
  "../src/policies/lianying-triple-segment-recombination.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-triple-segment-recombination.json",
);
const profileName = process.argv[4] ?? "probe";
const donorPath = resolveLianyingResearchPath(
  projectRoot,
  process.argv[5] ?? "output/lianying-ranking-sensitivity.json",
);
const donorId = process.argv[6] ?? "heterogeneous";
const warmPath = process.argv[7]
  ? resolveLianyingResearchPath(projectRoot, process.argv[7])
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
};
if (!profiles[profileName]) {
  throw new Error("三雷区段重组档位必须是probe、screen或adaptive-probe");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const incumbentPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!incumbentPacks) throw new Error("正式轴缺少可恢复的动作包");
const donorSource = JSON.parse(fs.readFileSync(donorPath, "utf8"));
const donorEntry = Array.isArray(donorSource.candidates)
  ? donorSource.candidates.find((candidate) => candidate.id === donorId)
  : donorSource;
const donorPacks = donorEntry?.actionPacks ??
  (donorEntry?.rows ? lianyingRowsToActionPacks(donorEntry.rows) : null);
if (!donorPacks) throw new Error(`供体文件中找不到候选 ${donorId}`);
const warmSource = warmPath
  ? JSON.parse(fs.readFileSync(warmPath, "utf8"))
  : null;
const warmPacks = warmSource?.candidateActionPacks ?? warmSource?.actionPacks ??
  (warmSource?.rows ? lianyingRowsToActionPacks(warmSource.rows) : null);
if (warmPath && !warmPacks) throw new Error("额外热启动文件缺少可恢复的动作包");

const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const optimized = optimizeLianyingTripleSegmentRecombination(
  runtime,
  incumbentPacks,
  donorPacks,
  {
    durationSeconds,
    ...profiles[profileName],
    additionalWarmAxes: warmPacks ? [warmPacks] : [],
    onProgress: (event) => process.stdout.write(`${JSON.stringify({
      phase: "triple-segment-recombination",
      ...event,
    })}\n`),
  },
);
const candidateAudit = auditWhitepaperAxis(optimized.candidateState, {
  mode: "fixed",
});
const report = {
  schemaVersion: 1,
  kind: "lianying-triple-segment-recombination",
  inputPath,
  donorPath,
  donorId,
  warmPath,
  durationSeconds,
  profileName,
  span: optimized.span,
  baselineRotationDamage: optimized.baselineDamage,
  donorRotationDamage: optimized.donorDamage,
  candidateRotationDamage: optimized.candidateDamage,
  donorDamageGain: optimized.donorDamageGain,
  globalDamageGain: optimized.globalDamageGain,
  improvedDonor: optimized.candidateDamage > optimized.donorDamage,
  narrowedFormalGap: optimized.candidateDamage > optimized.donorDamage,
  accepted: optimized.accepted,
  candidateMechanicsPassed: candidateAudit.mechanics.passed,
  candidateMechanicsViolationCount: candidateAudit.mechanics.violationCount,
  passes: optimized.resynthesis.passes,
  diverseCandidates: optimized.resynthesis.diverseCandidates.map((candidate) => ({
    segmentId: candidate.segmentId,
    coreDamage: candidate.coreDamage,
    coreDamageLoss: candidate.coreDamageLoss,
    coreDamageLossRatio: candidate.coreDamageLossRatio,
    structuralDistanceFromReference: candidate.structuralDistanceFromReference,
    thunderRows: candidate.thunderRows,
  })),
  candidateActionPacks: optimized.candidatePacks,
  actionPacks: optimized.packs,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  donorId,
  profileName,
  span: report.span,
  baselineRotationDamage: report.baselineRotationDamage,
  donorRotationDamage: report.donorRotationDamage,
  candidateRotationDamage: report.candidateRotationDamage,
  donorDamageGain: report.donorDamageGain,
  globalDamageGain: report.globalDamageGain,
  improvedDonor: report.improvedDonor,
  accepted: report.accepted,
  candidateMechanicsPassed: report.candidateMechanicsPassed,
  candidateMechanicsViolationCount: report.candidateMechanicsViolationCount,
  passes: report.passes,
}, null, 2)}\n`);
