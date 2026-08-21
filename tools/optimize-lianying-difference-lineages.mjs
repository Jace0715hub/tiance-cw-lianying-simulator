import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  lianyingCompanionAnchorRows,
  lianyingPrimaryDifferenceBucketKey,
  lianyingPrimaryDifferenceCount,
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
  process.argv[3] ?? "/tmp/lianying-difference-lineages.json",
);
const profileName = process.argv[4] ?? "probe";

const profiles = {
  probe: {
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 16,
    coreCandidatePackLimit: 32,
    coarseCandidateLimit: 4,
  },
  screen: {
    rowBeamWidth: 48,
    boundaryBeamWidth: 24,
    coreFinalistCount: 32,
    coreCandidatePackLimit: 48,
    coarseCandidateLimit: 6,
  },
};
if (!profiles[profileName]) throw new Error("未知差异谱系搜索档位");

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的技能轴");
const corePacks = stripLianyingDashPacks(sourcePacks);
const anchors = identifyLianyingThunderSegments(corePacks).anchors;
const companionAnchors = lianyingCompanionAnchorRows(corePacks);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const formalReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const formalCoreReplay = replayWhitepaperLianying(runtime, corePacks, {
  durationSeconds,
});
const profile = profiles[profileName];
const commonOptions = {
  durationSeconds,
  anchorSlackRows: 0,
  fixFirstAnchor: true,
  fixLastAnchor: true,
  allowedAnchorSchedules: [anchors],
  companionAnchorTemplate: companionAnchors,
  rowBeamWidth: profile.rowBeamWidth,
  boundaryBeamWidth: profile.boundaryBeamWidth,
  coreFinalistCount: profile.coreFinalistCount,
  coarseCandidateLimit: profile.coarseCandidateLimit,
  coarseDashStates: 8,
  finalDashCandidateCount: 2,
  fullDashStates: 128,
  includeCoreCandidatePacks: true,
  coreCandidatePackLimit: profile.coreCandidatePackLimit,
  useSuffixValue: true,
};
const differenceOptions = {
  startRow: anchors[0] + 1,
  endRow: anchors.at(-1),
  bucketUpperBounds: [0, 2, 4, 8],
  rowQuota: 5,
  boundaryQuota: 5,
  lineageQuota: 4,
  lineageTenureSegments: 2,
};

const runs = [];
for (const [kind, extraOptions] of [
  ["baseline", {}],
  ["difference-lineage", { primaryDifferenceLineage: differenceOptions }],
]) {
  process.stdout.write(`${JSON.stringify({
    phase: "difference-lineage-ab",
    stage: "start",
    kind,
    rowBeamWidth: profile.rowBeamWidth,
    boundaryBeamWidth: profile.boundaryBeamWidth,
  })}\n`);
  const result = optimizeLianyingAnchorDriftResynthesis(
    runtime,
    sourcePacks,
    { ...commonOptions, ...extraOptions },
  );
  runs.push({ kind, result });
  process.stdout.write(`${JSON.stringify({
    phase: "difference-lineage-ab",
    stage: "complete-core",
    kind,
    explored: result.explored,
    legal: result.legal,
    peakRowStates: result.peakRowStates,
    coreCandidateCount: result.coreCandidatePacks.length,
    accepted: result.accepted,
    damageGain: result.damageGain,
  })}\n`);
}

const pathKey = (packs) => JSON.stringify(packs);
const actionId = (action) => typeof action === "string" ? action : action?.id;
const baselinePaths = new Set(runs[0].result.coreCandidatePacks.map((candidate) =>
  pathKey(candidate.packs)));
const summarizeCoreCandidate = (candidate) => {
  const differenceCount = lianyingPrimaryDifferenceCount(
    candidate.packs,
    corePacks,
    differenceOptions,
  );
  return {
    coreDamage: candidate.coreDamage,
    coreDamageLoss: formalCoreReplay.state.totalDamage - candidate.coreDamage,
    isIncumbent: candidate.isIncumbent,
    differenceCount,
    differenceBucket: lianyingPrimaryDifferenceBucketKey(
      candidate.packs,
      corePacks,
      differenceOptions,
    ),
    differingRows: candidate.packs.flatMap((pack, index) =>
      actionId(pack.primary) === actionId(corePacks[index]?.primary)
        ? []
        : [index + 1]),
  };
};
const runReports = runs.map(({ kind, result }) => {
  const alternatives = result.coreCandidatePacks
    .filter((candidate) => !candidate.isIncumbent)
    .sort((left, right) => right.coreDamage - left.coreDamage);
  const newCandidates = kind === "difference-lineage"
    ? alternatives.filter((candidate) => !baselinePaths.has(pathKey(candidate.packs)))
    : [];
  return {
    kind,
    explored: result.explored,
    legal: result.legal,
    peakRowStates: result.peakRowStates,
    finalBoundaryStates: result.finalBoundaryStates,
    coreCandidateCount: result.coreCandidatePacks.length,
    alternativeCount: alternatives.length,
    newCandidateCount: newCandidates.length,
    bestCoreCandidate: alternatives[0]
      ? summarizeCoreCandidate(alternatives[0])
      : null,
    bestNewCoreCandidate: newCandidates[0]
      ? summarizeCoreCandidate(newCandidates[0])
      : null,
    differenceBucketHistogram: Object.fromEntries(
      [...new Set(alternatives.map((candidate) =>
        summarizeCoreCandidate(candidate).differenceBucket))]
        .map((bucket) => [bucket, alternatives.filter((candidate) =>
          summarizeCoreCandidate(candidate).differenceBucket === bucket).length]),
    ),
    boundaryDifferenceDiagnostics: result.segments.map((segment) => ({
      anchorNumber: segment.anchorNumber,
      availableBuckets: segment.availablePrimaryDifferenceBuckets ?? 0,
      survivingBuckets: segment.survivingPrimaryDifferenceBuckets ?? 0,
      activeLineages: segment.activePrimaryDifferenceLineages ?? 0,
      retainedLineages: segment.retainedPrimaryDifferenceLineages ?? 0,
      newLineages: segment.newPrimaryDifferenceLineages ?? 0,
    })),
    alternatives,
    newCandidates,
  };
});

for (const run of runReports) {
  const candidate = run.kind === "difference-lineage"
    ? run.newCandidates[0] ?? run.alternatives[0]
    : run.alternatives[0];
  if (!candidate) continue;
  run.dashCandidateKind = run.kind === "difference-lineage" &&
    run.newCandidates[0]
    ? "best-new-difference-lineage"
    : "best-core-alternative";
  run.dashCandidateCore = summarizeCoreCandidate(candidate);
  process.stdout.write(`${JSON.stringify({
    phase: "difference-lineage-ab",
    stage: "dash-start",
    kind: run.kind,
  })}\n`);
  const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
    durationSeconds,
    maxStatesPerRow: 128,
  });
  const audit = auditWhitepaperAxis(dash.state, { mode: "fixed" });
  run.bestRotationDamage = dash.state.totalDamage;
  run.bestRotationDamageGain = dash.state.totalDamage -
    formalReplay.state.totalDamage;
  run.bestRotationDamageLossRatio = (formalReplay.state.totalDamage -
    dash.state.totalDamage) / formalReplay.state.totalDamage;
  run.bestMechanicsPassed = audit.mechanics.passed;
  run.bestMechanicsViolationCount = audit.mechanics.violationCount;
  run.bestActionPacks = dash.packs;
}

const serializableRun = (run) => Object.fromEntries(Object.entries(run)
  .filter(([key]) => ![
    "alternatives",
    "newCandidates",
    "bestActionPacks",
  ].includes(key)));
const experimental = runReports[1];
const report = {
  schemaVersion: 1,
  kind: "lianying-primary-difference-lineage-ab",
  inputPath,
  durationSeconds,
  profileName,
  rowBeamWidth: profile.rowBeamWidth,
  boundaryBeamWidth: profile.boundaryBeamWidth,
  formalRotationDamage: formalReplay.state.totalDamage,
  differenceOptions,
  runs: runReports.map(serializableRun),
  bestExperimentActionPacks: experimental.bestActionPacks ?? null,
  actionPacks: experimental.bestActionPacks ?? null,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  formalRotationDamage: report.formalRotationDamage,
  runs: report.runs,
}, null, 2)}\n`);
