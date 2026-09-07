import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingTwoSegmentBlockRecombination } from
  "../src/policies/lianying-block-recombination.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const donorPaths = String(process.argv[3] ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
const profileName = process.argv[4] ?? "screen";
const profiles = {
  screen: {
    candidateLimit: 6,
    neighborhood: {
      maxPasses: 2,
      shortlistPerHorizon: 48,
      shortlistPerKind: 8,
      fullEvaluationLimit: 192,
    },
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  fast: {
    candidateLimit: 8,
    neighborhood: {
      maxPasses: 3,
      shortlistPerHorizon: 64,
      shortlistPerKind: 12,
      fullEvaluationLimit: 256,
    },
    coarseDashStates: 12,
    finalDashCandidateCount: 3,
    fullDashStates: 192,
  },
};
if (!profiles[profileName]) throw new Error("动作块重组档位必须是screen或fast");
if (donorPaths.length === 0) throw new Error("至少需要一个带核心候选的协调结果JSON");

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const incumbentPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!incumbentPacks) throw new Error("正式轴没有可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const donors = donorPaths.flatMap((donorPath) => {
  const donor = JSON.parse(fs.readFileSync(donorPath, "utf8"));
  const candidates = donor.search?.axisOptimization?.coreCandidatePacks;
  if (!Array.isArray(candidates)) {
    throw new Error(`${donorPath}缺少coreCandidatePacks`);
  }
  return candidates.map((candidate, index) => ({
    sourceId: `${path.parse(donorPath).name}:${index + 1}`,
    sourceCandidateIndex: index,
    packs: candidate.packs,
  }));
});

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const optimized = optimizeLianyingTwoSegmentBlockRecombination(
  runtime,
  incumbentPacks,
  donors,
  {
    durationSeconds,
    minimumPrimaryDifferences: 2,
    maximumCoreDamageLossRatio: 0.01,
    ...profiles[profileName],
    onProgress: (event) => console.log(JSON.stringify({
      phase: "two-segment-block-recombination",
      ...event,
    })),
  },
);
const searchResult = {
  durationSeconds,
  mode: source.mode ?? "fixed",
  policyMode: "free",
  beamWidth: null,
  explored: optimized.selection.diagnostics.attemptedBlocks,
  legal: optimized.selection.diagnostics.legalBlocks,
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [optimized.baselineDamage],
  warmStartDamage: optimized.baselineDamage,
  telemetry: null,
  packs: optimized.packs,
  state: optimized.state,
  axisOptimization: {
    kind: "two-segment-block-recombination",
    profile: profileName,
    accepted: optimized.accepted,
    damageGain: optimized.damageGain,
    selection: {
      diagnostics: optimized.selection.diagnostics,
      uniqueCandidates: optimized.selection.uniqueCandidates,
      selected: optimized.selection.selected.map((candidate) => ({
        sourceId: candidate.sourceId,
        blockNumber: candidate.blockNumber,
        startRow: candidate.startRow,
        endRow: candidate.endRow,
        primaryDifferenceRows: candidate.primaryDifferenceRows,
        coreDamageLoss: candidate.coreDamageLoss,
      })),
    },
    coarseCandidates: optimized.coarseCandidates,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode: source.mode ?? "fixed",
});
const outputStem = path.resolve(process.argv[5] ?? path.join(
  projectRoot,
  `output/lianying-free-fixed-${durationSeconds}s-block-recombination-${profileName}`,
));
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`, "utf8");
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
  "utf8",
);
fs.writeFileSync(`${outputStem}-blocks.json`, `${JSON.stringify({
  inputPath,
  donorPaths,
  profileName,
  accepted: optimized.accepted,
  baselineDamage: optimized.baselineDamage,
  finalDamage: optimized.state.totalDamage,
  damageGain: optimized.damageGain,
  selection: searchResult.axisOptimization.selection,
  coarseCandidates: optimized.coarseCandidates,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  inputPath,
  donorPaths,
  outputStem,
  profileName,
  accepted: optimized.accepted,
  baselineDamage: optimized.baselineDamage,
  finalDamage: optimized.state.totalDamage,
  damageGain: optimized.damageGain,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
  selection: searchResult.axisOptimization.selection,
  coarseCandidates: optimized.coarseCandidates,
}, null, 2));
