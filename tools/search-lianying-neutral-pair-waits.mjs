import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import { searchLianyingPairWaitAnchors } from
  "../src/policies/lianying-wait-search.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import { stripLianyingDashPacks } from
  "../src/policies/lianying-segment-resynthesis.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(
  projectRoot,
  process.argv[2] ??
    "output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json",
);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-neutral-pair-waits.json",
);
const formalPath = resolveLianyingResearchPath(projectRoot, process.argv[4]);
const totalWaitFrames = Math.max(2, Math.floor(Number(process.argv[5] ?? 16)));
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const formal = JSON.parse(fs.readFileSync(formalPath, "utf8"));
const recoverPacks = (artifact) => artifact.actionPacks ??
  (artifact.rows ? lianyingRowsToActionPacks(artifact.rows) : null);
const sourcePacks = recoverPacks(source);
const formalPacks = recoverPacks(formal);
if (!sourcePacks || !formalPacks) throw new Error("输入轴缺少可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const sourceReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const formalReplay = replayWhitepaperLianying(runtime, formalPacks, {
  durationSeconds,
});
const scan = searchLianyingPairWaitAnchors(runtime, sourcePacks, {
  durationSeconds,
  totalWaitFrames,
  singleSeedMode: "non-positive",
  preserveCastCount: true,
});
const bestPair = scan.bestPair;
let bestPacks = formalPacks;
let bestState = formalReplay.state;
let candidateAfterDashDamage = null;
if (bestPair) {
  const dash = optimizeLianyingDashOverlay(
    runtime,
    stripLianyingDashPacks(bestPair.packs),
    { durationSeconds, maxStatesPerRow: 128 },
  );
  candidateAfterDashDamage = dash.state.totalDamage;
  if (dash.state.totalDamage > bestState.totalDamage) {
    bestPacks = dash.packs;
    bestState = dash.state;
  }
}
const audit = auditWhitepaperAxis(bestState, { mode: "fixed" });
const report = {
  schemaVersion: 1,
  kind: "lianying-neutral-pair-wait-search",
  inputPath,
  formalPath,
  durationSeconds,
  totalWaitFrames,
  selectedSingleSeeds: scan.seeds.map((seed) => ({
    rowNumber: seed.rowNumber,
    waitFrames: seed.waitFrames,
    damageGain: seed.damageGain,
  })),
  explored: scan.explored,
  legal: scan.legal,
  preservedCastCount: scan.preservedCastCount,
  sourceRotationDamage: sourceReplay.state.totalDamage,
  formalRotationDamage: formalReplay.state.totalDamage,
  bestPair: bestPair ? {
    firstRowNumber: bestPair.firstRowNumber,
    firstWaitFrames: bestPair.firstWaitFrames,
    secondRowNumber: bestPair.secondRowNumber,
    secondWaitFrames: bestPair.secondWaitFrames,
    totalWaitFrames: bestPair.totalWaitFrames,
    rotationDamageBeforeDashReoptimization: bestPair.state.totalDamage,
    damageGainOverSourceBeforeDashReoptimization: bestPair.damageGain,
    rotationDamageAfterDashReoptimization: candidateAfterDashDamage,
    damageGainOverFormalAfterDashReoptimization:
      candidateAfterDashDamage - formalReplay.state.totalDamage,
  } : null,
  accepted: bestState.totalDamage > formalReplay.state.totalDamage,
  bestRotationDamage: bestState.totalDamage,
  damageGain: bestState.totalDamage - formalReplay.state.totalDamage,
  mechanicsPassed: audit.mechanics.passed,
  mechanicsViolationCount: audit.mechanics.violationCount,
  actionPacks: bestPacks,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  selectedSingleSeedCount: report.selectedSingleSeeds.length,
  explored: report.explored,
  legal: report.legal,
  preservedCastCount: report.preservedCastCount,
  bestPair: report.bestPair,
  accepted: report.accepted,
  bestRotationDamage: report.bestRotationDamage,
  damageGain: report.damageGain,
  mechanicsPassed: report.mechanicsPassed,
  mechanicsViolationCount: report.mechanicsViolationCount,
}, null, 2)}\n`);
