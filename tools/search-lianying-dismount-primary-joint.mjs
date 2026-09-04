import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import { searchLianyingDismountPrimaryJointNeighborhood } from
  "../src/policies/lianying-dismount-primary-joint-neighborhood.js";
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
  process.argv[3] ?? "/tmp/lianying-dismount-primary-joint",
);
const maxJointCandidates = Math.max(
  1,
  Math.floor(Number(process.argv[4] ?? 5000)),
);
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const packs = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!packs) throw new Error("输入轴没有可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const searched = searchLianyingDismountPrimaryJointNeighborhood(runtime, packs, {
  durationSeconds,
  segmentNumbers: [2, 3, 5],
  maxDismountDistance: 6,
  maxSwapDistance: 8,
  maxRotationLength: 8,
  mainRepresentativesPerKind: 8,
  dismountRepresentativesPerSegment: 8,
  maxJointCandidates,
});
const searchResult = {
  durationSeconds,
  mode: source.mode ?? "fixed",
  policyMode: "free",
  beamWidth: null,
  explored:
    searched.generatedPrimaryCandidates +
    searched.generatedDismountCandidates +
    searched.evaluatedJointCandidates,
  legal:
    searched.legalPrimaryCandidates +
    searched.legalDismountCandidates +
    searched.legalJointCandidates,
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [searched.baselineDamage],
  warmStartDamage: searched.baselineDamage,
  telemetry: null,
  packs: searched.packs,
  state: searched.state,
  axisOptimization: {
    kind: "dismount-primary-joint-neighborhood",
    sourcePath: path.relative(projectRoot, inputPath),
    accepted: searched.accepted,
    damageGain: searched.damageGain,
    segmentNumbers: [2, 3, 5],
    maxDismountDistance: 6,
    maxSwapDistance: 8,
    maxRotationLength: 8,
    mainRepresentativesPerKind: 8,
    dismountRepresentativesPerSegment: 8,
    maxJointCandidates,
    generatedPrimaryCandidates: searched.generatedPrimaryCandidates,
    legalPrimaryCandidates: searched.legalPrimaryCandidates,
    eligiblePrimaryCandidates: searched.eligiblePrimaryCandidates,
    primaryRepresentativeCandidates: searched.primaryRepresentativeCandidates,
    generatedDismountCandidates: searched.generatedDismountCandidates,
    legalDismountCandidates: searched.legalDismountCandidates,
    eligibleDismountCandidates: searched.eligibleDismountCandidates,
    dismountRepresentativeCandidates: searched.dismountRepresentativeCandidates,
    generatedJointCandidates: searched.generatedJointCandidates,
    evaluatedJointCandidates: searched.evaluatedJointCandidates,
    legalJointCandidates: searched.legalJointCandidates,
    bestJointDamage: searched.bestJointDamage,
    finalists: searched.finalists,
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
  accepted: searched.accepted,
  baselineDamage: searched.baselineDamage,
  bestJointDamage: searched.bestJointDamage,
  damageGain: searched.damageGain,
  generatedPrimaryCandidates: searched.generatedPrimaryCandidates,
  legalPrimaryCandidates: searched.legalPrimaryCandidates,
  eligiblePrimaryCandidates: searched.eligiblePrimaryCandidates,
  primaryRepresentativeCandidates: searched.primaryRepresentativeCandidates,
  generatedDismountCandidates: searched.generatedDismountCandidates,
  legalDismountCandidates: searched.legalDismountCandidates,
  eligibleDismountCandidates: searched.eligibleDismountCandidates,
  dismountRepresentativeCandidates: searched.dismountRepresentativeCandidates,
  generatedJointCandidates: searched.generatedJointCandidates,
  evaluatedJointCandidates: searched.evaluatedJointCandidates,
  legalJointCandidates: searched.legalJointCandidates,
  finalists: searched.finalists.map(({ actionPacks: _packs, ...entry }) => entry),
}, null, 2));
