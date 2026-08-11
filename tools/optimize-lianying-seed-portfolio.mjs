import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  lianyingAnchorDriftScheduleToCsv,
  lianyingMultiSegmentAnchorDiagnosticsToCsv,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import {
  lianyingSeedPortfolioToCsv,
  optimizeLianyingAnchorDriftPortfolio,
} from "../src/policies/lianying-seed-portfolio.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultInputs = [
  "output/lianying-free-fixed-180s-segments-balanced.json",
  "output/lianying-free-fixed-180s-segments-fast-guided-pass2.json",
  "output/lianying-free-fixed-180s-segments-fast-v2.json",
  "output/lianying-free-fixed-180s-dash-fast.json",
];
const inputPaths = (process.argv[2] ?? defaultInputs.join(","))
  .split(",")
  .map((value) => path.resolve(value.trim()))
  .filter(Boolean);
const profileName = process.argv[3] ?? "screen";
const maxSeeds = Number(process.argv[5] ?? 4);

const common = {
  anchorSlackRows: 1,
  fixFirstAnchor: true,
  fixLastAnchor: true,
  useSuffixValue: true,
};
const profiles = {
  screen: {
    ...common,
    rowBeamWidth: 20,
    boundaryBeamWidth: 10,
    coreFinalistCount: 10,
    coarseCandidateLimit: 3,
    coarseDashStates: 6,
    finalDashCandidateCount: 2,
    fullDashStates: 64,
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
};
if (!profiles[profileName]) {
  throw new Error("多种子组合档位必须是screen、fast或balanced");
}
if (inputPaths.length === 0) throw new Error("没有可用的种子文件路径");

const sources = inputPaths.map((inputPath) => {
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const packs = source.actionPacks ??
    (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
  if (!packs) throw new Error(`${inputPath}没有可恢复的动作包`);
  return {
    inputPath,
    source,
    packs,
    durationSeconds: Number(source.durationSeconds ?? 180),
    mode: source.mode ?? "fixed",
  };
});
const durationSeconds = sources[0].durationSeconds;
if (sources.some((source) => source.durationSeconds !== durationSeconds)) {
  throw new Error("多种子组合要求所有输入使用相同战斗时长");
}
const mode = sources[0].mode;
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seeds = sources.map((source, index) => ({
  id: `${index + 1}:${path.parse(source.inputPath).name}`,
  sourcePath: path.relative(projectRoot, source.inputPath),
  packs: source.packs,
}));
const optimized = optimizeLianyingAnchorDriftPortfolio(runtime, seeds, {
  durationSeconds,
  maxSeeds,
  optimizerOptions: profiles[profileName],
  onProgress: (event) => {
    const { candidateDiagnostics: _diagnostics, ...summary } = event;
    console.log(JSON.stringify({ phase: "seed-portfolio", ...summary }));
  },
});
const seedDamages = seeds.map((seed) =>
  replayWhitepaperLianying(runtime, seed.packs, { durationSeconds }).state.totalDamage);
const selected = optimized.selectedResult;
const searchResult = {
  durationSeconds,
  mode,
  policyMode: "free",
  beamWidth: null,
  explored: optimized.explored,
  legal: optimized.legal,
  warmStarted: true,
  warmStartCount: optimized.searchedSeedCount,
  warmStartDamages: seedDamages,
  warmStartDamage: optimized.baselineDamage,
  telemetry: null,
  packs: optimized.packs,
  state: optimized.state,
  axisOptimization: {
    kind: "seed-portfolio-anchor-drift",
    profile: profileName,
    lineageLongTermScoring:
      selected?.options?.lineageLongTermScoring ?? true,
    accepted: optimized.accepted,
    selectedSeedId: optimized.selectedSeedId,
    damageGain: optimized.damageGain,
    inputSeedCount: optimized.inputSeedCount,
    uniqueSeedCount: optimized.uniqueSeedCount,
    searchedSeedCount: optimized.searchedSeedCount,
    seedReports: optimized.seedReports,
    options: optimized.options,
    anchors: selected?.anchors ?? [],
    selectedAnchors: selected?.selectedAnchors ?? [],
    segments: selected?.segments ?? [],
    peakRowStates: selected?.peakRowStates ?? null,
    finalBoundaryStates: selected?.finalBoundaryStates ?? null,
    finalSchedules: selected?.finalSchedules ?? null,
    coreCandidates: selected?.coreCandidates ?? null,
    coarseCandidates: selected?.coarseCandidates ?? [],
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode,
});
const outputStem = path.resolve(
  process.argv[4] ?? path.join(
    projectRoot,
    `output/lianying-free-fixed-${durationSeconds}s-seed-portfolio-${profileName}`,
  ),
);
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`, "utf8");
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
  "utf8",
);
fs.writeFileSync(
  `${outputStem}-portfolio.csv`,
  `\uFEFF${lianyingSeedPortfolioToCsv(optimized)}\n`,
  "utf8",
);
fs.writeFileSync(
  `${outputStem}-anchors.csv`,
  `\uFEFF${lianyingMultiSegmentAnchorDiagnosticsToCsv(selected ?? {})}\n`,
  "utf8",
);
fs.writeFileSync(
  `${outputStem}-drift.csv`,
  `\uFEFF${lianyingAnchorDriftScheduleToCsv(selected ?? {})}\n`,
  "utf8",
);
console.log(JSON.stringify({
  inputPaths,
  outputStem,
  profileName,
  maxSeeds,
  accepted: optimized.accepted,
  selectedSeedId: optimized.selectedSeedId,
  baselineDamage: optimized.baselineDamage,
  finalDamage: optimized.state.totalDamage,
  damageGain: optimized.damageGain,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
  inputSeedCount: optimized.inputSeedCount,
  uniqueSeedCount: optimized.uniqueSeedCount,
  searchedSeedCount: optimized.searchedSeedCount,
  explored: optimized.explored,
  legal: optimized.legal,
  seedReports: optimized.seedReports,
}, null, 2));
