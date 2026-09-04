import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import {
  replayWhitepaperLianying,
  searchLianyingAxis,
} from "../src/policies/whitepaper-lianying.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";
import { buildWhitepaperAxisArtifact } from
  "../src/reports/whitepaper-axis-export.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-duration-search.json",
);
const targetDurationSeconds = Number(process.argv[4] ?? 240);
const profileName = process.argv[5] ?? "probe";
const profiles = {
  probe: { beamWidth: 24 },
  screen: { beamWidth: 48 },
};
if (!profiles[profileName]) throw new Error("时长搜索档位必须是probe或screen");
if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
  throw new Error("目标战斗时长必须为正数");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的动作包");
const sourceDurationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const sourceReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds: sourceDurationSeconds,
});
const search = searchLianyingAxis(runtime, {
  durationSeconds: targetDurationSeconds,
  mode: "fixed",
  policyMode: "free",
  beamWidth: profiles[profileName].beamWidth,
  warmStartAxes: [sourcePacks],
});
const sourceHorizonReplay = replayWhitepaperLianying(runtime, search.packs, {
  durationSeconds: sourceDurationSeconds,
});
const artifact = buildWhitepaperAxisArtifact(search, runtime, {
  durationSeconds: targetDurationSeconds,
  mode: "fixed",
});
artifact.durationSearch = {
  kind: "warm-start-duration-extension",
  profileName,
  inputPath: path.relative(projectRoot, inputPath),
  sourceDurationSeconds,
  targetDurationSeconds,
  sourceRotationDamage: sourceReplay.state.totalDamage,
  candidateSourceHorizonDamage: sourceHorizonReplay.state.totalDamage,
  sourceHorizonDamageGain:
    sourceHorizonReplay.state.totalDamage - sourceReplay.state.totalDamage,
};
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  profileName,
  sourceDurationSeconds,
  targetDurationSeconds,
  beamWidth: search.beamWidth,
  explored: search.explored,
  legal: search.legal,
  rowCount: search.packs.length,
  rotationDamage: search.state.totalDamage,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  sourceRotationDamage: sourceReplay.state.totalDamage,
  candidateSourceHorizonDamage: sourceHorizonReplay.state.totalDamage,
  sourceHorizonDamageGain:
    sourceHorizonReplay.state.totalDamage - sourceReplay.state.totalDamage,
  finalState: {
    rage: search.state.rage,
    dragonRideStacks: search.state.dragonRideStacks,
    mounted: search.state.mounted,
  },
  mechanicsPassed: artifact.audit.mechanics.passed,
  mechanicsViolationCount: artifact.audit.mechanics.violationCount,
}, null, 2)}\n`);
