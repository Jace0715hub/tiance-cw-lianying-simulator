import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  selectLianyingEarlyStructuralSeedCandidates,
} from "../src/policies/lianying-anchor-coordinator.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const optimization = source.search?.axisOptimization ?? source.axisOptimization;
if (!optimization) throw new Error("输入JSON缺少axisOptimization");
const candidates = optimization.coreCandidatePacks;
if (!Array.isArray(candidates) || candidates.length === 0) {
  throw new Error("输入JSON没有coreCandidatePacks，请使用核心候选导出档重新运行协调器");
}
const incumbentPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!incumbentPacks) throw new Error("输入JSON没有可恢复的正式轴动作包");

const outputDirectory = path.resolve(
  process.argv[3] ?? `${path.parse(inputPath).name}-early-structural-seeds`,
);
const limit = Math.max(1, Math.floor(Number(process.argv[4] ?? 4)));
const maximumCoreDamageLossRatio = Math.max(
  0,
  Number(process.argv[5] ?? 0.03),
);
const endRow = Math.max(1, Math.floor(Number(process.argv[6] ?? 79)));
const dashStates = Math.max(1, Math.floor(Number(process.argv[7] ?? 128)));
const durationSeconds = Number(source.durationSeconds ?? 180);
const mode = source.mode ?? "fixed";
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const incumbentReplay = replayWhitepaperLianying(runtime, incumbentPacks, {
  durationSeconds,
});
const selected = selectLianyingEarlyStructuralSeedCandidates(
  candidates,
  incumbentPacks,
  {
    limit,
    maximumCoreDamageLossRatio,
    endRow,
  },
);

fs.mkdirSync(outputDirectory, { recursive: true });
const manifestCandidates = [];
for (let index = 0; index < selected.length; index += 1) {
  const candidate = selected[index];
  const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
    durationSeconds,
    maxStatesPerRow: dashStates,
  });
  const artifact = buildWhitepaperAxisArtifact({
    durationSeconds,
    mode,
    policyMode: "free",
    beamWidth: null,
    explored: 0,
    legal: 0,
    warmStarted: true,
    warmStartCount: 1,
    warmStartDamages: [candidate.coreDamage],
    warmStartDamage: candidate.coreDamage,
    telemetry: null,
    packs: dash.packs,
    state: dash.state,
    axisOptimization: {
      kind: "early-structural-core-seed",
      sourcePath: path.relative(projectRoot, inputPath),
      anchorRows: candidate.anchorRows,
      companionAnchors: candidate.companionAnchors,
      baselineCoreDamage: candidate.baselineCoreDamage,
      coreDamage: candidate.coreDamage,
      coreDamageLoss: candidate.coreDamageLoss,
      coreDamageLossRatio: candidate.coreDamageLossRatio,
      earlyEndRow: endRow,
      earlyDifferingRows: candidate.earlyDifferingRows,
      firstEarlyDifferenceRow: candidate.firstEarlyDifferenceRow,
      dashStates,
      dashCount: dash.dashCount,
      damageGainFromDash: dash.state.totalDamage - candidate.coreDamage,
    },
  }, runtime, { durationSeconds, mode });
  const filename = `seed-${String(index + 1).padStart(2, "0")}-row-${
    candidate.firstEarlyDifferenceRow ?? "none"
  }`;
  const outputStem = path.join(outputDirectory, filename);
  fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`);
  fs.writeFileSync(
    `${outputStem}-equipment.csv`,
    `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
  );
  manifestCandidates.push({
    path: `${outputStem}.json`,
    anchorRows: candidate.anchorRows,
    companionAnchors: candidate.companionAnchors,
    coreDamage: candidate.coreDamage,
    coreDamageLoss: candidate.coreDamageLoss,
    coreDamageLossRatio: candidate.coreDamageLossRatio,
    totalDamage: dash.state.totalDamage,
    totalDamageLoss: incumbentReplay.state.totalDamage - dash.state.totalDamage,
    earlyDifferingRows: candidate.earlyDifferingRows,
    firstEarlyDifferenceRow: candidate.firstEarlyDifferenceRow,
    dashCount: dash.dashCount,
  });
}

const manifest = {
  kind: "tiance-cw-lianying-early-structural-seeds",
  sourcePath: inputPath,
  durationSeconds,
  baselineCoreDamage: selected[0]?.baselineCoreDamage ?? null,
  baselineTotalDamage: incumbentReplay.state.totalDamage,
  options: {
    limit,
    maximumCoreDamageLossRatio,
    endRow,
    dashStates,
    ignoredActionIds: ["thunder", "dash"],
  },
  inputCandidateCount: candidates.length,
  selectedCandidateCount: manifestCandidates.length,
  candidates: manifestCandidates,
};
fs.writeFileSync(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest, null, 2));
