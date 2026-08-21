import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  createLianyingOptimizationProfile,
  LIANYING_OPTIMIZATION_PROFILES,
} from "../src/policies/lianying-optimization-profiles.js";
import {
  optimizeLianyingAxis,
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
const profileName = process.argv[3] ?? "balanced";
if (!LIANYING_OPTIMIZATION_PROFILES.includes(profileName)) {
  throw new Error(`优化档位必须是${LIANYING_OPTIMIZATION_PROFILES.join("、")}`);
}
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const mode = source.mode ?? source.horizonMode ?? "fixed";
const preserveThunderSchedule = process.argv.slice(5).some(
  (value) => ["preserve-thunder", "--preserve-thunder"].includes(value),
);
const preferExperimentSeed = process.argv.slice(5).some(
  (value) => ["experiment-seed", "--experiment-seed"].includes(value),
);
const packs = (preferExperimentSeed ? source.bestExperimentActionPacks : null) ??
  source.actionPacks ?? source.bestExperimentActionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!packs) throw new Error("输入文件既没有actionPacks，也没有可恢复的rows");

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seedReplay = replayWhitepaperLianying(runtime, packs, { durationSeconds });
const profile = createLianyingOptimizationProfile(profileName, {
  durationSeconds,
  onPass: (event) => {
    console.log(JSON.stringify({ phase: "seed-neighborhood", ...event }));
  },
});
if (preserveThunderSchedule) {
  profile.neighborhood.requiredThunderRows = packs.flatMap((pack, index) =>
    [...(pack.prefix ?? []), ...(pack.tail ?? [])].some(
      (action) => (typeof action === "string" ? action : action?.id) === "thunder",
    ) ? [index + 1] : []);
}
const optimized = optimizeLianyingAxis(runtime, packs, {
  durationSeconds,
  ...profile,
});
const accepted = optimized.state.totalDamage > seedReplay.state.totalDamage;
const finalPacks = accepted ? optimized.packs : packs;
const finalState = accepted ? optimized.state : seedReplay.state;
const searchResult = {
  durationSeconds,
  mode,
  policyMode: "free",
  beamWidth: source.search?.beamWidth ?? null,
  explored: 0,
  legal: 0,
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [seedReplay.state.totalDamage],
  warmStartDamage: seedReplay.state.totalDamage,
  telemetry: null,
  packs: finalPacks,
  state: finalState,
  axisOptimization: {
    kind: "seed-continuation",
    profile: profileName,
    preserveThunderSchedule,
    preferExperimentSeed,
    accepted,
    seedPath: path.relative(projectRoot, inputPath),
    damageGain: finalState.totalDamage - seedReplay.state.totalDamage,
    phases: optimized.phases,
    roundReports: optimized.roundReports,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode,
});
const parsed = path.parse(inputPath);
const defaultStem = `${parsed.name}-continued-${profileName}`;
const outputStem = path.resolve(
  process.argv[4] ?? path.join(parsed.dir, defaultStem),
);
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
  accepted,
  seedRotationDamage: seedReplay.state.totalDamage,
  finalRotationDamage: finalState.totalDamage,
  damageGain: finalState.totalDamage - seedReplay.state.totalDamage,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
  structure: artifact.structureAnalysis.summary,
}, null, 2));
