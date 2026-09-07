import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingSegmentResynthesis } from "../src/policies/lianying-segment-resynthesis.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import { buildWhitepaperAxisArtifact } from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "screen";
const profiles = {
  sample: {
    beamWidth: 8,
    finalistCount: 8,
    boundaryPaddingRows: 2,
    diverseCandidateLimit: 4,
    diverseCandidateMaximumLossRatio: 0.005,
    dashStates: 16,
    segmentIndices: [0],
  },
  screen: {
    beamWidth: 16,
    finalistCount: 16,
    boundaryPaddingRows: 4,
    diverseCandidateLimit: 8,
    diverseCandidateMaximumLossRatio: 0.005,
    dashStates: 32,
  },
  balanced: {
    beamWidth: 32,
    finalistCount: 32,
    boundaryPaddingRows: 6,
    diverseCandidateLimit: 12,
    diverseCandidateMaximumLossRatio: 0.005,
    dashStates: 64,
  },
};
if (!profiles[profileName]) {
  throw new Error("价值训练种子生成档位必须是sample、screen或balanced");
}
const profile = profiles[profileName];
const outputDirectory = path.resolve(
  process.argv[4] ?? path.join(projectRoot, "output", `value-seeds-${profileName}`),
);
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const mode = source.mode ?? "fixed";
const seedPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!seedPacks) throw new Error("输入文件既没有actionPacks，也没有可恢复的rows");

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seedReplay = replayWhitepaperLianying(runtime, seedPacks, { durationSeconds });
const generated = optimizeLianyingSegmentResynthesis(runtime, seedPacks, {
  durationSeconds,
  maxPasses: 1,
  beamWidth: profile.beamWidth,
  finalistCount: profile.finalistCount,
  coarseCandidateLimit: 1,
  coarseDashStates: 4,
  finalDashCandidateCount: 1,
  fullDashStates: 4,
  boundaryPaddingRows: profile.boundaryPaddingRows,
  segmentIndices: profile.segmentIndices,
  collectDiverseCandidates: true,
  diverseCandidateLimit: profile.diverseCandidateLimit,
  diverseCandidateMaximumLossRatio: profile.diverseCandidateMaximumLossRatio,
  onProgress: (event) => console.log(JSON.stringify({
    phase: "value-seed-generation",
    ...event,
  })),
});

fs.mkdirSync(outputDirectory, { recursive: true });
const exported = generated.diverseCandidates.map((candidate, index) => {
  console.log(JSON.stringify({
    phase: "value-seed-dash",
    candidate: index + 1,
    candidateCount: generated.diverseCandidates.length,
    segmentId: candidate.segmentId,
  }));
  const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
    durationSeconds,
    maxStatesPerRow: profile.dashStates,
  });
  const searchResult = {
    durationSeconds,
    mode,
    policyMode: "free",
    beamWidth: profile.beamWidth,
    explored: 0,
    legal: 0,
    warmStarted: true,
    warmStartCount: 1,
    warmStartDamages: [seedReplay.state.totalDamage],
    warmStartDamage: seedReplay.state.totalDamage,
    telemetry: null,
    packs: dash.packs,
    state: dash.state,
    axisOptimization: {
      kind: "near-optimal-diverse-value-seed",
      profile: profileName,
      source: path.relative(projectRoot, inputPath),
      diversityRank: candidate.diversityRank,
      sourcePass: candidate.sourcePass,
      segmentId: candidate.segmentId,
      coreDamageLoss: candidate.coreDamageLoss,
      coreDamageLossRatio: candidate.coreDamageLossRatio,
      structuralDistanceFromReference:
        candidate.structuralDistanceFromReference,
      thunderRows: candidate.thunderRows,
    },
  };
  const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
    durationSeconds,
    mode,
  });
  const segment = String(candidate.segmentId ?? "unknown")
    .replace(/[^a-zA-Z0-9-]+/g, "-");
  const filename = `seed-${String(candidate.diversityRank).padStart(2, "0")}-${segment}.json`;
  const outputPath = path.join(outputDirectory, filename);
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return {
    outputPath: path.relative(projectRoot, outputPath),
    diversityRank: candidate.diversityRank,
    isReference: candidate.isReference,
    segmentId: candidate.segmentId,
    sourcePass: candidate.sourcePass,
    thunderRows: candidate.thunderRows,
    structuralDistanceFromReference: candidate.structuralDistanceFromReference,
    coreDamage: candidate.coreDamage,
    coreDamageLoss: candidate.coreDamageLoss,
    coreDamageLossRatio: candidate.coreDamageLossRatio,
    rotationDamage: dash.state.totalDamage,
    rotationDps: dash.state.totalDamage / durationSeconds,
    totalDps: artifact.summary.dps,
    dashCount: dash.dashCount,
  };
});
const bestRotationDamage = Math.max(...exported.map(
  (candidate) => candidate.rotationDamage));
for (const candidate of exported) {
  candidate.rotationDamageLoss = bestRotationDamage - candidate.rotationDamage;
  candidate.rotationDamageLossRatio = bestRotationDamage > 0
    ? candidate.rotationDamageLoss / bestRotationDamage
    : 0;
}
const manifest = {
  kind: "tiance-cw-lianying-diverse-value-seed-portfolio",
  source: path.relative(projectRoot, inputPath),
  profileName,
  durationSeconds,
  outputDirectory: path.relative(projectRoot, outputDirectory),
  seedRotationDamage: seedReplay.state.totalDamage,
  generatedCoreCandidates: generated.passes.reduce(
    (sum, pass) => sum + pass.coreCandidates,
    0,
  ),
  selectedCandidates: exported.length,
  maximumCoreLossRatio: profile.diverseCandidateMaximumLossRatio,
  candidates: exported,
};
const manifestPath = path.join(outputDirectory, "manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ manifestPath, ...manifest }, null, 2));
