import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  LIANYING_CURRENT_BEST_AXIS,
  resolveLianyingResearchPath,
} from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingSegmentResynthesis } from
  "../src/policies/lianying-segment-resynthesis.js";
import { replayWhitepaperLianying } from
  "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(
  process.argv[2] ?? "/tmp/lianying-m557-boundary-seed-balanced-best-candidate.json",
);
const outputStem = path.resolve(
  process.argv[3] ?? "/tmp/lianying-m557-boundary-continuation-screen",
);
const formalPath = resolveLianyingResearchPath(
  projectRoot,
  process.argv[4] ?? LIANYING_CURRENT_BEST_AXIS,
);
const loadPacks = (filePath) => {
  const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const packs = source.actionPacks ??
    (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
  if (!packs) throw new Error(`${filePath}没有可恢复的动作包`);
  return { source, packs };
};
const input = loadPacks(inputPath);
const formal = loadPacks(formalPath);
const durationSeconds = Number(input.source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const inputReplay = replayWhitepaperLianying(runtime, input.packs, {
  durationSeconds,
});
const formalReplay = replayWhitepaperLianying(runtime, formal.packs, {
  durationSeconds,
});
const optimized = optimizeLianyingSegmentResynthesis(runtime, input.packs, {
  durationSeconds,
  maxPasses: 2,
  beamWidth: 24,
  finalistCount: 24,
  coarseCandidateLimit: 8,
  coarseDashStates: 8,
  finalDashCandidateCount: 1,
  fullDashStates: 256,
  boundaryPaddingRows: 0,
  segmentIndices: [3, 4],
  preserveThunderPositions: true,
  onProgress: (event) => {
    console.log(JSON.stringify({ phase: "boundary-continuation", ...event }));
  },
});
const finalReplay = replayWhitepaperLianying(runtime, optimized.packs, {
  durationSeconds,
});
const formalGain = finalReplay.state.totalDamage - formalReplay.state.totalDamage;
const artifact = buildWhitepaperAxisArtifact({
  durationSeconds,
  mode: input.source.mode ?? "fixed",
  policyMode: "free",
  beamWidth: 24,
  explored: optimized.passes.reduce(
    (sum, pass) => sum + pass.segments.reduce(
      (inner, segment) => inner + segment.explored,
      0,
    ),
    0,
  ),
  legal: optimized.passes.reduce(
    (sum, pass) => sum + pass.segments.reduce(
      (inner, segment) => inner + segment.legal,
      0,
    ),
    0,
  ),
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [inputReplay.state.totalDamage],
  warmStartDamage: inputReplay.state.totalDamage,
  telemetry: null,
  packs: optimized.packs,
  state: finalReplay.state,
  axisOptimization: {
    kind: "boundary-candidate-continuation-screen",
    sourcePath: inputPath,
    formalPath: path.relative(projectRoot, formalPath),
    segmentIndices: [3, 4],
    fixedPrefixEndRow: 58,
    damageGainFromSeed: optimized.damageGain,
    damageGainFromFormal: formalGain,
    passes: optimized.passes,
  },
}, runtime, {
  durationSeconds,
  mode: input.source.mode ?? "fixed",
});
fs.writeFileSync(
  `${outputStem}.json`,
  `${JSON.stringify(artifact, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  `${outputStem}.csv`,
  `\uFEFF${whitepaperAxisToCsv(artifact)}\n`,
  "utf8",
);
console.log(JSON.stringify({
  inputPath,
  formalPath,
  outputStem,
  inputDamage: inputReplay.state.totalDamage,
  finalDamage: finalReplay.state.totalDamage,
  damageGainFromSeed: optimized.damageGain,
  formalDamage: formalReplay.state.totalDamage,
  damageGainFromFormal: formalGain,
  formalLossRatio: formalGain < 0
    ? -formalGain / formalReplay.state.totalDamage
    : 0,
  acceptedAsFormal: formalGain > 0,
  passes: optimized.passes,
}, null, 2));

