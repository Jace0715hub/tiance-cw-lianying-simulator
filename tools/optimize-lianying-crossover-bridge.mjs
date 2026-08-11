import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { optimizeLianyingCrossoverBridge } from "../src/policies/lianying-crossover-bridge.js";
import { optimizeLianyingSeedCrossovers } from "../src/policies/lianying-seed-crossover.js";
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
const profiles = {
  screen: {
    crossover: {
      maxSeeds: 4,
      coreCandidateLimit: 12,
      coarseDashStates: 8,
      finalDashCandidateCount: 2,
      fullDashStates: 128,
    },
    bridge: {
      maxPasses: 2,
      beamWidth: 16,
      finalistCount: 4,
      coarseCandidateLimit: 4,
      coarseDashStates: 8,
      finalDashCandidateCount: 2,
      fullDashStates: 128,
      boundaryPaddingRows: 4,
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
    bridge: {
      maxPasses: 2,
      beamWidth: 32,
      finalistCount: 8,
      coarseCandidateLimit: 8,
      coarseDashStates: 16,
      finalDashCandidateCount: 2,
      fullDashStates: 256,
      boundaryPaddingRows: 6,
    },
  },
};
if (!profiles[profileName]) throw new Error("桥接档位必须是screen或fast");
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
  throw new Error("桥接搜索要求所有输入使用相同战斗时长");
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
if (!crossover.bestAlternative) {
  throw new Error("交叉搜索没有产生可桥接的合法备选轴");
}
const bridge = optimizeLianyingCrossoverBridge(
  runtime,
  crossover.packs,
  crossover.bestAlternative.packs,
  {
    durationSeconds,
    crossoverAnchorNumber: crossover.bestAlternative.anchorNumber,
    ...profiles[profileName].bridge,
    onProgress: (event) => console.log(JSON.stringify({ phase: "bridge", ...event })),
  },
);

function summarizePasses(passes) {
  return passes.map((pass) => ({
    pass: pass.pass,
    anchors: pass.anchors,
    segments: pass.segments,
    coreCandidates: pass.coreCandidates,
    coarseCandidates: pass.coarseCandidates,
    bestSegmentId: pass.bestSegmentId,
    damageGain: pass.damageGain,
  }));
}

function makeArtifact(packs, state, kind, accepted) {
  const searchResult = {
    durationSeconds,
    mode,
    policyMode: "free",
    beamWidth: profiles[profileName].bridge.beamWidth,
    explored: bridge.resynthesis.passes.reduce(
      (sum, pass) => sum + pass.segments.reduce((inner, segment) => inner + segment.explored, 0),
      0,
    ),
    legal: bridge.resynthesis.passes.reduce(
      (sum, pass) => sum + pass.segments.reduce((inner, segment) => inner + segment.legal, 0),
      0,
    ),
    warmStarted: true,
    warmStartCount: seeds.length,
    warmStartDamages: seeds.map((seed) =>
      replayWhitepaperLianying(runtime, seed.packs, { durationSeconds }).state.totalDamage),
    warmStartDamage: bridge.baselineDamage,
    telemetry: null,
    packs,
    state,
    axisOptimization: {
      kind,
      profile: profileName,
      accepted,
      crossover: {
        prefixSeedId: crossover.bestAlternative.prefixSeedId,
        suffixSeedId: crossover.bestAlternative.suffixSeedId,
        anchorNumber: crossover.bestAlternative.anchorNumber,
        boundaryRow: crossover.bestAlternative.boundaryRow,
        boundaryDistance: crossover.bestAlternative.boundaryDistance,
        exactBoundaryState: crossover.bestAlternative.exactBoundaryState,
      },
      baselineDamage: bridge.baselineDamage,
      crossoverDamage: bridge.crossoverDamage,
      bridgedDamage: bridge.bridgedDamage,
      crossoverGap: bridge.crossoverGap,
      bridgeDamageGain: bridge.bridgeDamageGain,
      globalDamageGain: bridge.globalDamageGain,
      anchors: bridge.anchors,
      segmentIndices: bridge.segmentIndices,
      segmentIds: bridge.segmentIds,
      preserveNovelStructure: bridge.preserveNovelStructure,
      passes: summarizePasses(bridge.resynthesis.passes),
      options: bridge.resynthesis.options,
    },
  };
  return buildWhitepaperAxisArtifact(searchResult, runtime, { durationSeconds, mode });
}

const artifact = makeArtifact(
  bridge.packs,
  bridge.state,
  "crossover-adjacent-segment-bridge",
  bridge.accepted,
);
const candidateArtifact = makeArtifact(
  bridge.candidatePacks,
  bridge.candidateState,
  "crossover-adjacent-segment-bridge-candidate",
  bridge.accepted,
);
const outputStem = path.resolve(
  process.argv[4] ?? path.join(
    projectRoot,
    `output/lianying-free-fixed-${durationSeconds}s-crossover-bridge-${profileName}`,
  ),
);
for (const [suffix, value] of [
  [".json", `${JSON.stringify(artifact, null, 2)}\n`],
  [".csv", `\uFEFF${whitepaperAxisToCsv(artifact)}\n`],
  ["-equipment.csv", `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`],
  ["-candidate.json", `${JSON.stringify(candidateArtifact, null, 2)}\n`],
  ["-candidate.csv", `\uFEFF${whitepaperAxisToCsv(candidateArtifact)}\n`],
]) {
  fs.writeFileSync(`${outputStem}${suffix}`, value, "utf8");
}
console.log(JSON.stringify({
  inputPaths,
  outputStem,
  profileName,
  accepted: bridge.accepted,
  crossover: {
    prefixSeedId: crossover.bestAlternative.prefixSeedId,
    suffixSeedId: crossover.bestAlternative.suffixSeedId,
    anchorNumber: crossover.bestAlternative.anchorNumber,
    boundaryRow: crossover.bestAlternative.boundaryRow,
  },
  segmentIds: bridge.segmentIds,
  preserveNovelStructure: bridge.preserveNovelStructure,
  baselineDamage: bridge.baselineDamage,
  crossoverDamage: bridge.crossoverDamage,
  bridgedDamage: bridge.bridgedDamage,
  crossoverGap: bridge.crossoverGap,
  bridgeDamageGain: bridge.bridgeDamageGain,
  globalDamageGain: bridge.globalDamageGain,
  finalRotationDps: artifact.summary.rotationDps,
  finalTotalDps: artifact.summary.dps,
  candidateRotationDps: candidateArtifact.summary.rotationDps,
  candidateTotalDps: candidateArtifact.summary.dps,
  passes: summarizePasses(bridge.resynthesis.passes),
}, null, 2));
