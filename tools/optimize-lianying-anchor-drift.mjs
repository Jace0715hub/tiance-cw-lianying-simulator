import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  buildLianyingFocusedCompanionAnchorTemplate,
  selectLianyingStructuralSeedCandidates,
} from "../src/policies/lianying-anchor-coordinator.js";
import {
  lianyingAnchorDriftScheduleToCsv,
  lianyingMultiSegmentAnchorDiagnosticsToCsv,
  optimizeLianyingAnchorDriftResynthesis,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "fast";
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const mode = source.mode ?? "fixed";
const seedPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!seedPacks) throw new Error("输入文件既没有actionPacks，也没有可恢复的rows");

const common = {
  anchorSlackRows: 1,
  fixFirstAnchor: true,
  fixLastAnchor: true,
  useSuffixValue: true,
};
const profiles = {
  fast: {
    ...common,
    rowBeamWidth: 32,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coarseCandidateLimit: 5,
    coarseDashStates: 12,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  balanced: {
    ...common,
    rowBeamWidth: 64,
    boundaryBeamWidth: 32,
    coreFinalistCount: 32,
    coarseCandidateLimit: 7,
    coarseDashStates: 16,
    finalDashCandidateCount: 2,
    fullDashStates: 256,
  },
  deep: {
    ...common,
    rowBeamWidth: 96,
    boundaryBeamWidth: 48,
    coreFinalistCount: 48,
    coarseCandidateLimit: 8,
    coarseDashStates: 32,
    finalDashCandidateCount: 3,
    fullDashStates: 256,
  },
  "structural-screen": {
    ...common,
    anchorSlackRows: 4,
    rowBeamWidth: 64,
    boundaryBeamWidth: 32,
    coreFinalistCount: 32,
    coarseCandidateLimit: 7,
    coarseDashStates: 16,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
    includeScheduleCandidatePacks: true,
    structuralSeedLimit: 4,
    structuralSeedMaximumCoreLossRatio: 0.05,
  },
};
if (!profiles[profileName]) {
  throw new Error("雷锚点漂移档位必须是fast、balanced、deep或structural-screen");
}

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seedReplay = replayWhitepaperLianying(runtime, seedPacks, { durationSeconds });
const companionAnchorTemplate = profileName === "structural-screen"
  ? buildLianyingFocusedCompanionAnchorTemplate(seedPacks, {
      companionTypes: ["ride", "dismount"],
      companionPolicies: {
        ride: { fixedThroughOrdinal: 0, beforeRows: 6, afterRows: 6 },
        dismount: { fixedThroughOrdinal: 0, beforeRows: 12, afterRows: 12 },
      },
    })
  : null;
const optimized = optimizeLianyingAnchorDriftResynthesis(runtime, seedPacks, {
  durationSeconds,
  ...profiles[profileName],
  companionAnchorTemplate,
  onProgress: (event) => {
    console.log(JSON.stringify({ phase: "anchor-drift-resynthesis", ...event }));
  },
});
const finalPacks = optimized.accepted ? optimized.packs : seedPacks;
const finalState = optimized.accepted ? optimized.state : seedReplay.state;
const searchResult = {
  durationSeconds,
  mode,
  policyMode: "free",
  beamWidth: source.search?.beamWidth ?? null,
  explored: optimized.explored,
  legal: optimized.legal,
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [seedReplay.state.totalDamage],
  warmStartDamage: seedReplay.state.totalDamage,
  telemetry: null,
  packs: finalPacks,
  state: finalState,
  axisOptimization: {
    kind: "anchor-drift-resynthesis",
    profile: profileName,
    accepted: optimized.accepted,
    seedPath: path.relative(projectRoot, inputPath),
    damageGain: optimized.damageGain,
    options: optimized.options,
    anchors: optimized.anchors,
    selectedAnchors: optimized.selectedAnchors,
    segments: optimized.segments,
    peakRowStates: optimized.peakRowStates,
    finalBoundaryStates: optimized.finalBoundaryStates,
    finalSchedules: optimized.finalSchedules,
    coreCandidates: optimized.coreCandidates,
    coarseCandidates: optimized.coarseCandidates,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode,
});
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[4] ?? path.join(
    parsed.dir,
    `${parsed.name}-anchor-drift-${profileName}`,
  ),
);
const structuralSeeds = profileName === "structural-screen"
  ? selectLianyingStructuralSeedCandidates(
      optimized.coreScheduleCandidates,
      optimized.anchors,
      {
        limit: profiles[profileName].structuralSeedLimit,
        maximumCoreDamageLossRatio:
          profiles[profileName].structuralSeedMaximumCoreLossRatio,
      },
    )
  : [];
const structuralSeedDirectory = structuralSeeds.length > 0
  ? path.resolve(process.argv[5] ?? `${outputStem}-seeds`)
  : null;
const structuralSeedManifest = [];
if (structuralSeedDirectory) {
  fs.mkdirSync(structuralSeedDirectory, { recursive: true });
  for (let index = 0; index < structuralSeeds.length; index += 1) {
    const candidate = structuralSeeds[index];
    const replay = replayWhitepaperLianying(runtime, candidate.packs, {
      durationSeconds,
    });
    const candidateArtifact = buildWhitepaperAxisArtifact({
      durationSeconds,
      mode,
      policyMode: "free",
      beamWidth: profiles[profileName].rowBeamWidth,
      explored: optimized.explored,
      legal: optimized.legal,
      warmStarted: true,
      warmStartCount: 1,
      warmStartDamages: [seedReplay.state.totalDamage],
      warmStartDamage: seedReplay.state.totalDamage,
      telemetry: null,
      packs: candidate.packs,
      state: replay.state,
      axisOptimization: {
        kind: "structural-anchor-seed",
        profile: profileName,
        source: path.relative(projectRoot, inputPath),
        anchorRows: candidate.anchorRows,
        changedAnchors: candidate.changedAnchors,
        anchorDistance: candidate.anchorDistance,
        coreDamageLoss: candidate.coreDamageLoss,
        coreDamageLossRatio: candidate.coreDamageLossRatio,
      },
    }, runtime, { durationSeconds, mode });
    const filename = `seed-${String(index + 1).padStart(2, "0")}-${
      candidate.anchorRows.join("-")}.json`;
    const candidatePath = path.join(structuralSeedDirectory, filename);
    fs.writeFileSync(
      candidatePath,
      `${JSON.stringify(candidateArtifact, null, 2)}\n`,
      "utf8",
    );
    structuralSeedManifest.push({
      path: candidatePath,
      anchorRows: candidate.anchorRows,
      changedAnchors: candidate.changedAnchors,
      anchorDistance: candidate.anchorDistance,
      coreDamage: candidate.bestCoreDamage,
      coreDamageLoss: candidate.coreDamageLoss,
      coreDamageLossRatio: candidate.coreDamageLossRatio,
    });
  }
  fs.writeFileSync(
    path.join(structuralSeedDirectory, "manifest.json"),
    `${JSON.stringify({
      kind: "tiance-cw-lianying-structural-seed-portfolio",
      profileName,
      source: path.relative(projectRoot, inputPath),
      incumbentAnchors: optimized.anchors,
      baselineCoreDamage:
        optimized.coreScheduleDiagnostics.find((candidate) =>
          JSON.stringify(candidate.anchorRows) ===
          JSON.stringify(optimized.anchors))?.bestCoreDamage ?? null,
      candidates: structuralSeedManifest,
    }, null, 2)}\n`,
    "utf8",
  );
}
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`, "utf8");
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
  "utf8",
);
fs.writeFileSync(
  `${outputStem}-anchors.csv`,
  `\uFEFF${lianyingMultiSegmentAnchorDiagnosticsToCsv(optimized)}\n`,
  "utf8",
);
fs.writeFileSync(
  `${outputStem}-drift.csv`,
  `\uFEFF${lianyingAnchorDriftScheduleToCsv(optimized)}\n`,
  "utf8",
);
const segmentSummary = optimized.segments.map(
  ({ candidateDiagnostics: _diagnostics, ...segment }) => segment,
);
console.log(JSON.stringify({
  inputPath,
  outputStem,
  profileName,
  accepted: optimized.accepted,
  seedRotationDamage: seedReplay.state.totalDamage,
  finalRotationDamage: finalState.totalDamage,
  damageGain: optimized.damageGain,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
  structure: artifact.structureAnalysis.summary,
  anchors: optimized.anchors,
  selectedAnchors: optimized.selectedAnchors,
  segments: segmentSummary,
  explored: optimized.explored,
  legal: optimized.legal,
  peakRowStates: optimized.peakRowStates,
  finalBoundaryStates: optimized.finalBoundaryStates,
  finalSchedules: optimized.finalSchedules,
  coreCandidates: optimized.coreCandidates,
  coarseCandidates: optimized.coarseCandidates,
  structuralSeedDirectory,
  structuralSeeds: structuralSeedManifest,
}, null, 2));
