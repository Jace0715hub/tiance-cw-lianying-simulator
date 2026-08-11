import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  lianyingSeedCrossoverToCsv,
  optimizeLianyingSeedCrossovers,
} from "../src/policies/lianying-seed-crossover.js";
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
  "output/lianying-free-fixed-180s-best-continued-fast.json",
  "output/lianying-free-fixed-180s-best.json",
];
const inputPaths = (process.argv[2] ?? defaultInputs.join(","))
  .split(",")
  .map((value) => path.resolve(value.trim()))
  .filter(Boolean);
const profileName = process.argv[3] ?? "screen";
const maxSeeds = Number(process.argv[5] ?? 4);
const profiles = {
  screen: {
    coreCandidateLimit: 12,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  fast: {
    coreCandidateLimit: 24,
    coarseDashStates: 16,
    finalDashCandidateCount: 3,
    fullDashStates: 256,
  },
  balanced: {
    coreCandidateLimit: 48,
    coarseDashStates: 32,
    finalDashCandidateCount: 4,
    fullDashStates: 256,
  },
};
if (!profiles[profileName]) {
  throw new Error("跨种子重组档位必须是screen、fast或balanced");
}
if (inputPaths.length < 2) throw new Error("至少需要两条种子路径");

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
  throw new Error("跨种子重组要求所有输入使用相同战斗时长");
}
const mode = sources[0].mode;
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seeds = sources.map((source, index) => ({
  id: `${index + 1}:${path.parse(source.inputPath).name}`,
  sourcePath: path.relative(projectRoot, source.inputPath),
  packs: source.packs,
}));
const optimized = optimizeLianyingSeedCrossovers(runtime, seeds, {
  durationSeconds,
  maxSeeds,
  ...profiles[profileName],
  onProgress: (event) => {
    console.log(JSON.stringify({ phase: "seed-crossover", ...event }));
  },
});
const seedDamages = seeds.map((seed) =>
  replayWhitepaperLianying(runtime, seed.packs, { durationSeconds }).state.totalDamage);
const searchResult = {
  durationSeconds,
  mode,
  policyMode: "free",
  beamWidth: null,
  explored: optimized.totalCrossovers,
  legal: optimized.legalCrossovers,
  warmStarted: true,
  warmStartCount: optimized.searchedSeedCount,
  warmStartDamages: seedDamages,
  warmStartDamage: optimized.baselineDamage,
  telemetry: null,
  packs: optimized.packs,
  state: optimized.state,
  axisOptimization: {
    kind: "seed-thunder-segment-crossover",
    profile: profileName,
    accepted: optimized.accepted,
    damageGain: optimized.damageGain,
    selectedCrossover: optimized.selectedCrossover,
    anchors: optimized.anchors,
    inputSeedCount: optimized.inputSeedCount,
    uniqueSeedCount: optimized.uniqueSeedCount,
    searchedSeedCount: optimized.searchedSeedCount,
    totalCrossovers: optimized.totalCrossovers,
    legalCrossovers: optimized.legalCrossovers,
    illegalCrossovers: optimized.illegalCrossovers,
    novelCrossovers: optimized.novelCrossovers,
    exactBoundaryStates: optimized.exactBoundaryStates,
    uniqueLegalCandidates: optimized.uniqueLegalCandidates,
    selectedCoreCandidates: optimized.selectedCoreCandidates,
    failureReasons: optimized.failureReasons,
    coarseCandidates: optimized.coarseCandidates,
    options: optimized.options,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode,
});
const outputStem = path.resolve(
  process.argv[4] ?? path.join(
    projectRoot,
    `output/lianying-free-fixed-${durationSeconds}s-seed-crossover-${profileName}`,
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
  `${outputStem}-crossovers.csv`,
  `\uFEFF${lianyingSeedCrossoverToCsv(optimized)}\n`,
  "utf8",
);
console.log(JSON.stringify({
  inputPaths,
  outputStem,
  profileName,
  maxSeeds,
  accepted: optimized.accepted,
  selectedCrossover: optimized.selectedCrossover,
  baselineDamage: optimized.baselineDamage,
  finalDamage: optimized.state.totalDamage,
  damageGain: optimized.damageGain,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
  anchors: optimized.anchors,
  inputSeedCount: optimized.inputSeedCount,
  uniqueSeedCount: optimized.uniqueSeedCount,
  searchedSeedCount: optimized.searchedSeedCount,
  totalCrossovers: optimized.totalCrossovers,
  legalCrossovers: optimized.legalCrossovers,
  illegalCrossovers: optimized.illegalCrossovers,
  novelCrossovers: optimized.novelCrossovers,
  exactBoundaryStates: optimized.exactBoundaryStates,
  uniqueLegalCandidates: optimized.uniqueLegalCandidates,
  selectedCoreCandidates: optimized.selectedCoreCandidates,
  failureReasons: optimized.failureReasons,
  coarseCandidates: optimized.coarseCandidates,
}, null, 2));
