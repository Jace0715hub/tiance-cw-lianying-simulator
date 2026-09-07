import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import {
  searchLianyingPairWaitAnchors,
} from "../src/policies/lianying-wait-search.js";
import {
  stripLianyingDashPacks,
} from "../src/policies/lianying-segment-resynthesis.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(
  projectRoot,
  process.argv[2] ??
    "output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json",
);
const outputStem = path.resolve(
  process.argv[3] ??
    path.join(projectRoot, "output/lianying-free-fixed-180s-pair-anchor-wait"),
);
const totalWaitFrames = Math.max(2, Math.floor(Number(process.argv[4] ?? 16)));
const singleSeedLimit = Math.max(1, Math.floor(Number(process.argv[5] ?? 3)));
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const mode = source.mode ?? "fixed";
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的动作包");

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const scan = searchLianyingPairWaitAnchors(runtime, sourcePacks, {
  durationSeconds,
  totalWaitFrames,
  singleSeedLimit,
  preserveCastCount: true,
});
if (!scan.bestPair || scan.bestPair.damageGain <= 0) {
  throw new Error("双锚点短等待搜索没有找到正增益候选");
}

const sourceReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const corePacks = stripLianyingDashPacks(scan.bestPair.packs);
const dash = optimizeLianyingDashOverlay(runtime, corePacks, {
  durationSeconds,
});
const seedSummary = scan.seeds.map((seed) => ({
  rowNumber: seed.rowNumber,
  waitFrames: seed.waitFrames,
  damageGain: seed.damageGain,
}));
const searchResult = {
  durationSeconds,
  mode,
  policyMode: "free",
  beamWidth: null,
  explored: scan.explored,
  legal: scan.legal,
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [sourceReplay.state.totalDamage],
  warmStartDamage: sourceReplay.state.totalDamage,
  telemetry: null,
  packs: dash.packs,
  state: dash.state,
  axisOptimization: {
    kind: "bounded-pair-anchor-wait-search",
    sourcePath: path.relative(projectRoot, inputPath),
    previousBestPath: "output/lianying-free-fixed-180s-anchor-wait.json",
    totalWaitFrames,
    singleSeedLimit,
    preserveCastCount: true,
    explored: scan.explored,
    legal: scan.legal,
    preservedCastCount: scan.preservedCastCount,
    selectedSingleSeeds: seedSummary,
    selectedWaits: [
      {
        rowNumber: scan.bestPair.firstRowNumber,
        waitFrames: scan.bestPair.firstWaitFrames,
      },
      {
        rowNumber: scan.bestPair.secondRowNumber,
        waitFrames: scan.bestPair.secondWaitFrames,
      },
    ],
    selectedPreDashDamageGain: scan.bestPair.damageGain,
    finalDamageGain: dash.state.totalDamage - sourceReplay.state.totalDamage,
    shortlist: scan.candidates.slice(0, 16).map((candidate) => ({
      firstRowNumber: candidate.firstRowNumber,
      firstWaitFrames: candidate.firstWaitFrames,
      secondRowNumber: candidate.secondRowNumber,
      secondWaitFrames: candidate.secondWaitFrames,
      totalWaitFrames: candidate.totalWaitFrames,
      rotationDamage: candidate.state.totalDamage,
      damageGain: candidate.damageGain,
      castCount: candidate.castCount,
    })),
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode,
});
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`);
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
);
process.stdout.write(`${JSON.stringify({
  inputPath,
  outputStem,
  totalWaitFrames,
  singleSeedLimit,
  selectedSingleSeeds: seedSummary,
  explored: scan.explored,
  legal: scan.legal,
  preservedCastCount: scan.preservedCastCount,
  selectedWaits: searchResult.axisOptimization.selectedWaits,
  rotationDamage: dash.state.totalDamage,
  damageGain: dash.state.totalDamage - sourceReplay.state.totalDamage,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
}, null, 2)}\n`);
