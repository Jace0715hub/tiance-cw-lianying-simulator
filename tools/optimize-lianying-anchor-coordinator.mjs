import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  lianyingAnchorCoordinationTemplatesToCsv,
  optimizeLianyingHierarchicalAnchorCoordination,
} from "../src/policies/lianying-anchor-coordinator.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "screen";
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const seedPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!seedPacks) throw new Error("输入文件既没有actionPacks，也没有可恢复的rows");

const common = {
  anchorSlackRows: 1,
  fixFirstAnchor: true,
  fixLastAnchor: true,
  maximumShiftedAnchors: 1,
  maximumTemplates: 16,
  evaluationMode: "independent",
  useSuffixValue: true,
};
const profiles = {
  screen: {
    ...common,
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 128,
  },
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
};
if (!profiles[profileName]) {
  throw new Error("锚点协调档位必须是screen或fast");
}

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seedReplay = replayWhitepaperLianying(runtime, seedPacks, { durationSeconds });
const optimized = optimizeLianyingHierarchicalAnchorCoordination(
  runtime,
  seedPacks,
  {
    durationSeconds,
    ...profiles[profileName],
    onProgress: (event) => {
      console.log(JSON.stringify({ phase: "anchor-coordination", ...event }));
    },
  },
);
const finalPacks = optimized.accepted ? optimized.packs : seedPacks;
const finalState = optimized.accepted ? optimized.state : seedReplay.state;
const searchResult = {
  durationSeconds,
  mode: source.mode ?? "fixed",
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
    kind: "hierarchical-anchor-coordination",
    profile: profileName,
    accepted: optimized.accepted,
    seedPath: path.relative(projectRoot, inputPath),
    damageGain: optimized.damageGain,
    options: optimized.options,
    coordination: optimized.coordination,
    anchors: optimized.anchors,
    selectedAnchors: optimized.selectedAnchors,
    segments: optimized.segments,
    peakRowStates: optimized.peakRowStates,
    finalBoundaryStates: optimized.finalBoundaryStates,
    finalSchedules: optimized.finalSchedules,
    coreCandidates: optimized.coreCandidates,
    coreScheduleDiagnostics: optimized.coreScheduleDiagnostics,
    coarseCandidates: optimized.coarseCandidates,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode: source.mode ?? "fixed",
});
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[4] ?? path.join(
    parsed.dir,
    `${parsed.name}-anchor-coordinator-${profileName}`,
  ),
);
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`);
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
);
fs.writeFileSync(
  `${outputStem}-templates.csv`,
  `\uFEFF${lianyingAnchorCoordinationTemplatesToCsv(optimized)}\n`,
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
  coordination: optimized.coordination,
  explored: optimized.explored,
  legal: optimized.legal,
  finalSchedules: optimized.finalSchedules,
  coreCandidates: optimized.coreCandidates,
  coreScheduleDiagnostics: optimized.coreScheduleDiagnostics,
  coarseCandidates: optimized.coarseCandidates,
}, null, 2));
