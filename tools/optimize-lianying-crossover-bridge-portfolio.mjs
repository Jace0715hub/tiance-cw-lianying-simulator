import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPaths } from "../src/config/lianying-research-defaults.js";
import {
  lianyingCrossoverBridgePortfolioToCsv,
  optimizeLianyingCrossoverBridgePortfolio,
} from "../src/policies/lianying-crossover-bridge-portfolio.js";
import { optimizeLianyingSeedCrossovers } from "../src/policies/lianying-seed-crossover.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPaths = resolveLianyingResearchPaths(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "screen";
const profiles = {
  screen: {
    crossover: {
      maxSeeds: 4,
      coreCandidateLimit: 12,
      coarseDashStates: 8,
      finalDashCandidateCount: 2,
      fullDashStates: 128,
    },
    portfolio: {
      candidateLimit: 4,
      initialDashStates: 64,
      bridgeOptions: {
        maxPasses: 1,
        beamWidth: 12,
        finalistCount: 4,
        coarseCandidateLimit: 4,
        coarseDashStates: 8,
        finalDashCandidateCount: 2,
        fullDashStates: 64,
        boundaryPaddingRows: 4,
      },
    },
  },
  fast: {
    crossover: {
      maxSeeds: 4,
      coreCandidateLimit: 24,
      coarseDashStates: 16,
      finalDashCandidateCount: 3,
      fullDashStates: 256,
    },
    portfolio: {
      candidateLimit: 6,
      initialDashStates: 128,
      bridgeOptions: {
        maxPasses: 1,
        beamWidth: 24,
        finalistCount: 6,
        coarseCandidateLimit: 6,
        coarseDashStates: 12,
        finalDashCandidateCount: 2,
        fullDashStates: 128,
        boundaryPaddingRows: 6,
      },
    },
  },
  "joint-screen": {
    crossover: {
      maxSeeds: 4,
      coreCandidateLimit: 12,
      coarseDashStates: 8,
      finalDashCandidateCount: 2,
      fullDashStates: 128,
    },
    portfolio: {
      candidateLimit: 3,
      initialDashStates: 64,
      bridgeMode: "joint",
      bridgeOptions: {
        maxPasses: 1,
        beamWidth: 16,
        finalistCount: 6,
        coarseCandidateLimit: 6,
        coarseDashStates: 8,
        finalDashCandidateCount: 2,
        fullDashStates: 64,
        boundaryPaddingRows: 4,
        preserveThunderPositions: true,
        preserveNovelStructureIgnoredActionIds: ["thunder", "dash", "orange"],
      },
    },
  },
  "joint-fast": {
    crossover: {
      maxSeeds: 4,
      coreCandidateLimit: 24,
      coarseDashStates: 16,
      finalDashCandidateCount: 3,
      fullDashStates: 256,
    },
    portfolio: {
      candidateLimit: 4,
      initialDashStates: 128,
      bridgeMode: "joint",
      bridgeOptions: {
        maxPasses: 1,
        beamWidth: 32,
        finalistCount: 8,
        coarseCandidateLimit: 8,
        coarseDashStates: 16,
        finalDashCandidateCount: 2,
        fullDashStates: 128,
        boundaryPaddingRows: 6,
        preserveThunderPositions: true,
        preserveNovelStructureIgnoredActionIds: ["thunder", "dash", "orange"],
      },
    },
  },
  "joint-target": {
    crossover: {
      maxSeeds: 4,
      coreCandidateLimit: 12,
      coarseDashStates: 8,
      finalDashCandidateCount: 2,
      fullDashStates: 128,
    },
    portfolio: {
      candidateLimit: 3,
      selectedCandidateNumbers: [3],
      initialDashStates: 128,
      bridgeMode: "joint",
      bridgeOptions: {
        maxPasses: 1,
        beamWidth: 32,
        finalistCount: 8,
        coarseCandidateLimit: 8,
        coarseDashStates: 16,
        finalDashCandidateCount: 2,
        fullDashStates: 128,
        boundaryPaddingRows: 6,
        preserveThunderPositions: true,
        preserveNovelStructureIgnoredActionIds: ["thunder", "dash", "orange"],
      },
    },
  },
  "joint-best-fast": {
    crossover: {
      maxSeeds: 4,
      coreCandidateLimit: 24,
      coarseDashStates: 16,
      finalDashCandidateCount: 3,
      fullDashStates: 256,
    },
    portfolio: {
      candidateLimit: 4,
      selectedCandidateNumbers: [1],
      initialDashStates: 128,
      bridgeMode: "joint",
      bridgeOptions: {
        maxPasses: 1,
        beamWidth: 32,
        finalistCount: 8,
        coarseCandidateLimit: 8,
        coarseDashStates: 16,
        finalDashCandidateCount: 2,
        fullDashStates: 128,
        boundaryPaddingRows: 6,
        preserveThunderPositions: true,
        preserveNovelStructureIgnoredActionIds: ["thunder", "dash", "orange"],
      },
    },
  },
};
if (!profiles[profileName]) {
  throw new Error(
    "组合桥接档位必须是screen、fast、joint-screen、joint-fast、joint-target或joint-best-fast",
  );
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
  throw new Error("组合桥接要求所有输入使用相同战斗时长");
}
const mode = sources[0].mode;
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seeds = sources.map((source, index) => ({
  id: `${index + 1}:${path.parse(source.inputPath).name}`,
  sourcePath: path.relative(projectRoot, source.inputPath),
  packs: source.packs,
}));
const crossover = optimizeLianyingSeedCrossovers(runtime, seeds, {
  durationSeconds,
  ...profiles[profileName].crossover,
  onProgress: (event) => console.log(JSON.stringify({ phase: "crossover", ...event })),
});
const optimized = optimizeLianyingCrossoverBridgePortfolio(
  runtime,
  crossover.packs,
  crossover.bridgeCandidates,
  {
    durationSeconds,
    ...profiles[profileName].portfolio,
    onProgress: (event) => console.log(JSON.stringify({ phase: "portfolio", ...event })),
  },
);

function summarizeRun(run) {
  return {
    index: run.index,
    prefixSeedId: run.prefixSeedId,
    suffixSeedId: run.suffixSeedId,
    anchorNumber: run.anchorNumber,
    boundaryRow: run.boundaryRow,
    boundaryDistance: run.boundaryDistance,
    exactBoundaryState: run.exactBoundaryState,
    coarseDamage: run.coarseDamage,
    normalizedDamage: run.normalizedDamage,
    normalizedGap: run.normalizedGap,
    bridgedDamage: run.bridgedDamage,
    bridgeDamageGain: run.bridgeDamageGain,
    globalDamageGain: run.globalDamageGain,
    dashCount: run.dashCount,
    segmentIds: run.segmentIds,
    explored: run.explored,
    legal: run.legal,
    passes: run.passes,
  };
}

function makeArtifact(packs, state, kind, candidateRun = null) {
  const explored = optimized.runs.reduce((sum, run) => sum + run.explored, 0);
  const legal = optimized.runs.reduce((sum, run) => sum + run.legal, 0);
  return buildWhitepaperAxisArtifact({
    durationSeconds,
    mode,
    policyMode: "free",
    beamWidth: profiles[profileName].portfolio.bridgeOptions.beamWidth,
    explored,
    legal,
    warmStarted: true,
    warmStartCount: seeds.length,
    warmStartDamages: seeds.map((seed) =>
      replayWhitepaperLianying(runtime, seed.packs, { durationSeconds }).state.totalDamage),
    warmStartDamage: optimized.baselineDamage,
    telemetry: null,
    packs,
    state,
    axisOptimization: {
      kind,
      profile: profileName,
      accepted: optimized.accepted,
      baselineDamage: optimized.baselineDamage,
      damageGain: optimized.damageGain,
      inputCandidateCount: optimized.inputCandidateCount,
      selectedCandidateCount: optimized.selectedCandidateCount,
      bestRunIndex: optimized.bestRunIndex,
      bestAlternativeRunIndex: optimized.bestAlternativeRunIndex,
      candidateRun: candidateRun ? summarizeRun(candidateRun) : null,
      runs: optimized.runs.map(summarizeRun),
      options: optimized.options,
    },
  }, runtime, { durationSeconds, mode });
}

const artifact = makeArtifact(
  optimized.packs,
  optimized.state,
  profiles[profileName].portfolio.bridgeMode === "joint"
    ? "crossover-joint-bridge-portfolio"
    : "crossover-bridge-portfolio",
);
const alternativeArtifact = makeArtifact(
  optimized.bestAlternative.packs,
  optimized.bestAlternative.state,
  profiles[profileName].portfolio.bridgeMode === "joint"
    ? "crossover-joint-bridge-portfolio-best-alternative"
    : "crossover-bridge-portfolio-best-alternative",
  optimized.bestAlternative,
);
const outputStem = path.resolve(
  process.argv[4] ?? path.join(
    projectRoot,
    `output/lianying-free-fixed-${durationSeconds}s-crossover-bridge-portfolio-${profileName}`,
  ),
);
for (const [suffix, value] of [
  [".json", `${JSON.stringify(artifact, null, 2)}\n`],
  [".csv", `\uFEFF${whitepaperAxisToCsv(artifact)}\n`],
  ["-equipment.csv", `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`],
  ["-best-alternative.json", `${JSON.stringify(alternativeArtifact, null, 2)}\n`],
  ["-best-alternative.csv", `\uFEFF${whitepaperAxisToCsv(alternativeArtifact)}\n`],
  ["-portfolio.csv", `\uFEFF${lianyingCrossoverBridgePortfolioToCsv(optimized)}\n`],
]) {
  fs.writeFileSync(`${outputStem}${suffix}`, value, "utf8");
}
console.log(JSON.stringify({
  inputPaths,
  outputStem,
  profileName,
  accepted: optimized.accepted,
  baselineDamage: optimized.baselineDamage,
  finalDamage: optimized.state.totalDamage,
  damageGain: optimized.damageGain,
  inputCandidateCount: optimized.inputCandidateCount,
  selectedCandidateCount: optimized.selectedCandidateCount,
  bridgeMode: optimized.options.bridgeMode,
  bestRunIndex: optimized.bestRunIndex,
  bestAlternativeRunIndex: optimized.bestAlternativeRunIndex,
  finalRotationDps: artifact.summary.rotationDps,
  finalTotalDps: artifact.summary.dps,
  bestAlternativeRotationDps: alternativeArtifact.summary.rotationDps,
  bestAlternativeTotalDps: alternativeArtifact.summary.dps,
  runs: optimized.runs.map(summarizeRun),
}, null, 2));
