import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import { searchLianyingDismountTripleNeighborhood } from
  "../src/policies/lianying-dismount-pair-neighborhood.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputStem = path.resolve(
  process.argv[3] ?? "/tmp/lianying-dismount-triples",
);
const maxDistance = Math.max(1, Math.floor(Number(process.argv[4] ?? 6)));
const representativesPerSegment = Math.max(
  1,
  Math.floor(Number(process.argv[5] ?? 8)),
);
const maxTripleCandidates = Math.max(
  1,
  Math.floor(Number(process.argv[6] ?? 5000)),
);
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const packs = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!packs) throw new Error("输入轴没有可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const searched = searchLianyingDismountTripleNeighborhood(runtime, packs, {
  durationSeconds,
  maxDistance,
  maxRepresentativesPerSegment: representativesPerSegment,
  maxTripleCandidates,
});
const searchResult = {
  durationSeconds,
  mode: source.mode ?? "fixed",
  policyMode: "free",
  beamWidth: null,
  explored:
    searched.generatedSingleCandidates +
    searched.evaluatedRepresentativePairs +
    searched.evaluatedTripleCandidates,
  legal:
    searched.legalSingleCandidates +
    searched.legalRepresentativePairs +
    searched.legalTripleCandidates,
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [searched.baselineDamage],
  warmStartDamage: searched.baselineDamage,
  telemetry: null,
  packs: searched.packs,
  state: searched.state,
  axisOptimization: {
    kind: "dismount-triple-neighborhood",
    sourcePath: path.relative(projectRoot, inputPath),
    accepted: searched.accepted,
    damageGain: searched.damageGain,
    maxDistance,
    representativesPerSegment,
    maxTripleCandidates,
    generatedSingleCandidates: searched.generatedSingleCandidates,
    legalSingleCandidates: searched.legalSingleCandidates,
    eligibleSingleCandidates: searched.eligibleSingleCandidates,
    representativeSingleCandidates: searched.representativeSingleCandidates,
    evaluatedRepresentativePairs: searched.evaluatedRepresentativePairs,
    legalRepresentativePairs: searched.legalRepresentativePairs,
    generatedTripleCandidates: searched.generatedTripleCandidates,
    evaluatedTripleCandidates: searched.evaluatedTripleCandidates,
    legalTripleCandidates: searched.legalTripleCandidates,
    bestTripleDamage: searched.bestTripleDamage,
    finalists: searched.finalists,
    bestExperimentActionPacks: searched.bestExperimentActionPacks,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode: source.mode ?? "fixed",
});
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`);
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
);
console.log(JSON.stringify({
  inputPath,
  outputStem,
  maxDistance,
  representativesPerSegment,
  maxTripleCandidates,
  accepted: searched.accepted,
  baselineDamage: searched.baselineDamage,
  bestTripleDamage: searched.bestTripleDamage,
  damageGain: searched.damageGain,
  generatedSingleCandidates: searched.generatedSingleCandidates,
  legalSingleCandidates: searched.legalSingleCandidates,
  eligibleSingleCandidates: searched.eligibleSingleCandidates,
  representativeSingleCandidates: searched.representativeSingleCandidates,
  evaluatedRepresentativePairs: searched.evaluatedRepresentativePairs,
  legalRepresentativePairs: searched.legalRepresentativePairs,
  generatedTripleCandidates: searched.generatedTripleCandidates,
  evaluatedTripleCandidates: searched.evaluatedTripleCandidates,
  legalTripleCandidates: searched.legalTripleCandidates,
  finalists: searched.finalists.map(({ actionPacks: _packs, ...entry }) => entry),
}, null, 2));
