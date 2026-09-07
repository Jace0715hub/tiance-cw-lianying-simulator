import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingCompoundNeighborhoodBlocks } from
  "../src/policies/lianying-compound-neighborhood.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "screen";
const profiles = {
  screen: {
    neighborhood: {
      maxPasses: 1,
      shortlistPerHorizon: 48,
      shortlistPerKind: 8,
      fullEvaluationLimit: 192,
      genericCompoundCandidateLimit: 96,
      genericCompoundSourceLimit: 24,
    },
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  fast: {
    neighborhood: {
      maxPasses: 2,
      shortlistPerHorizon: 64,
      shortlistPerKind: 12,
      fullEvaluationLimit: 256,
      genericCompoundCandidateLimit: 160,
      genericCompoundSourceLimit: 32,
    },
    coarseDashStates: 12,
    finalDashCandidateCount: 3,
    fullDashStates: 192,
  },
};
if (!profiles[profileName]) throw new Error("双变换复合邻域档位必须是screen或fast");
const blockNumbers = process.argv[5]
  ? process.argv[5].split(",").map(Number)
  : null;
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const packs = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!packs) throw new Error("输入轴没有可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const optimized = optimizeLianyingCompoundNeighborhoodBlocks(runtime, packs, {
  durationSeconds,
  blockNumbers,
  ...profiles[profileName],
  onProgress: (event) => console.log(JSON.stringify({
    phase: "compound-neighborhood",
    ...event,
  })),
});
const searchResult = {
  durationSeconds,
  mode: source.mode ?? "fixed",
  policyMode: "free",
  beamWidth: null,
  explored: optimized.blockResults.reduce(
    (sum, block) => sum + block.candidatesEvaluated,
    0,
  ),
  legal: optimized.blockResults.reduce(
    (sum, block) => sum + block.candidatesEvaluated - block.illegalCandidates,
    0,
  ),
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [optimized.baselineDamage],
  warmStartDamage: optimized.baselineDamage,
  telemetry: null,
  packs: optimized.packs,
  state: optimized.state,
  axisOptimization: {
    kind: "two-change-compound-neighborhood",
    profile: profileName,
    accepted: optimized.accepted,
    damageGain: optimized.damageGain,
    selectedBlock: optimized.selectedBlock,
    thunderRows: optimized.thunderRows,
    blockResults: optimized.blockResults,
    coarseCandidates: optimized.coarseCandidates,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode: source.mode ?? "fixed",
});
const outputStem = path.resolve(process.argv[4] ?? path.join(
  projectRoot,
  `output/lianying-free-fixed-${durationSeconds}s-compound-neighborhood-${profileName}`,
));
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`, "utf8");
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
  "utf8",
);
console.log(JSON.stringify({
  inputPath,
  outputStem,
  profileName,
  blockNumbers,
  accepted: optimized.accepted,
  baselineDamage: optimized.baselineDamage,
  finalDamage: optimized.state.totalDamage,
  damageGain: optimized.damageGain,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
  selectedBlock: optimized.selectedBlock,
  blockResults: optimized.blockResults,
  coarseCandidates: optimized.coarseCandidates,
}, null, 2));
