import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingSegmentResynthesis } from "../src/policies/lianying-segment-resynthesis.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "balanced";
const preserveThunderSchedule = process.argv.includes("--preserve-thunder");
const valueShadowPolicyArgument = process.argv[5]?.startsWith("--")
  ? null
  : process.argv[5];
const valueShadowPolicyPath = valueShadowPolicyArgument
  ? resolveLianyingResearchPath(projectRoot, valueShadowPolicyArgument)
  : null;
const valueShadowPolicy = valueShadowPolicyPath
  ? JSON.parse(fs.readFileSync(valueShadowPolicyPath, "utf8"))
  : null;
if (valueShadowPolicy && valueShadowPolicy.enabled !== true) {
  throw new Error("价值影子策略未通过验证门控，拒绝用于在线搜索");
}
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const mode = source.mode ?? "fixed";
const seedPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!seedPacks) throw new Error("输入文件既没有actionPacks，也没有可恢复的rows");

const profiles = {
  fast: {
    maxPasses: 1,
    beamWidth: 16,
    finalistCount: 16,
    coarseCandidateLimit: 8,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 128,
    boundaryPaddingRows: 4,
  },
  balanced: {
    maxPasses: 1,
    beamWidth: 32,
    finalistCount: 32,
    coarseCandidateLimit: 8,
    coarseDashStates: 32,
    finalDashCandidateCount: 2,
    fullDashStates: 256,
    boundaryPaddingRows: 6,
  },
  deep: {
    maxPasses: 2,
    beamWidth: 64,
    finalistCount: 64,
    coarseCandidateLimit: 10,
    coarseDashStates: 64,
    finalDashCandidateCount: 3,
    fullDashStates: 256,
    boundaryPaddingRows: 8,
  },
};
if (!profiles[profileName]) throw new Error("整段重合成档位必须是fast、balanced或deep");

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seedReplay = replayWhitepaperLianying(runtime, seedPacks, { durationSeconds });
const optimized = optimizeLianyingSegmentResynthesis(runtime, seedPacks, {
  durationSeconds,
  ...profiles[profileName],
  preserveThunderPositions: preserveThunderSchedule,
  valueShadowPolicy,
  onProgress: (event) => {
    console.log(JSON.stringify({ phase: "segment-resynthesis", ...event }));
  },
});
const accepted = optimized.damageGain > 0;
const finalPacks = accepted ? optimized.packs : seedPacks;
const finalState = accepted ? optimized.state : seedReplay.state;
const searchResult = {
  durationSeconds,
  mode,
  policyMode: "free",
  beamWidth: source.search?.beamWidth ?? null,
  explored: optimized.passes.reduce(
    (sum, pass) => sum + pass.segments.reduce((inner, segment) => inner + segment.explored, 0),
    0,
  ),
  legal: optimized.passes.reduce(
    (sum, pass) => sum + pass.segments.reduce((inner, segment) => inner + segment.legal, 0),
    0,
  ),
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [seedReplay.state.totalDamage],
  warmStartDamage: seedReplay.state.totalDamage,
  telemetry: null,
  packs: finalPacks,
  state: finalState,
  axisOptimization: {
    kind: valueShadowPolicy
      ? "segment-resynthesis-value-shadow"
      : "segment-resynthesis",
    profile: profileName,
    accepted,
    preserveThunderSchedule,
    seedPath: path.relative(projectRoot, inputPath),
    valueShadowPolicyPath: valueShadowPolicyPath
      ? path.relative(projectRoot, valueShadowPolicyPath)
      : null,
    damageGain: optimized.damageGain,
    options: optimized.options,
    passes: optimized.passes,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode,
});
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[4] ?? path.join(parsed.dir, `${parsed.name}-segments-${profileName}`),
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
  valueShadowPolicyPath,
  accepted,
  seedRotationDamage: seedReplay.state.totalDamage,
  finalRotationDamage: finalState.totalDamage,
  damageGain: optimized.damageGain,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
  structure: artifact.structureAnalysis.summary,
  passes: optimized.passes,
}, null, 2));
