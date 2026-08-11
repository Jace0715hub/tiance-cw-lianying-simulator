import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  LIANYING_POLICY_MODES,
  optimizeLianyingAxis,
  searchLianyingAxis,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import {
  createLianyingOptimizationProfile,
  LIANYING_OPTIMIZATION_PROFILES,
} from "../src/policies/lianying-optimization-profiles.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";

const policyMode = process.argv[2] ?? "free";
const beamWidth = Number(process.argv[3] ?? 32);
const durationSeconds = Number(process.argv[4] ?? 180);
const horizonMode = process.argv[5] ?? "fixed";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.resolve(
  process.argv[6] ?? path.join(projectRoot, "output"),
);
const optimizationProfile = process.argv[7] ?? "balanced";

if (!LIANYING_POLICY_MODES.includes(policyMode)) {
  throw new Error(`策略模式必须是${LIANYING_POLICY_MODES.join("/")}`);
}
if (!["fixed", "stable"].includes(horizonMode)) {
  throw new Error("时长模式必须是fixed或stable");
}
if (!LIANYING_OPTIMIZATION_PROFILES.includes(optimizationProfile)) {
  throw new Error("优化档位必须是fast、balanced或deep");
}

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const strictWarmStart = policyMode === "strict"
  ? null
  : searchWhitepaperLianying(runtime, {
      durationSeconds,
      mode: horizonMode,
      beamWidth: Math.max(48, beamWidth),
    });
const baselineSearch = searchLianyingAxis(runtime, {
  durationSeconds,
  mode: horizonMode,
  policyMode,
  beamWidth,
  warmStartPacks: strictWarmStart?.packs ?? [],
});
const selectedProfile = createLianyingOptimizationProfile(
  optimizationProfile,
  {
    durationSeconds,
    onPass: (event) => {
      console.log(JSON.stringify({ phase: "axis-neighborhood", ...event }));
    },
  },
);
const axisOptimization = policyMode === "strict"
  ? null
  : optimizeLianyingAxis(runtime, baselineSearch.packs, {
      durationSeconds,
      ...selectedProfile,
    });
const search = axisOptimization?.damageGain > 0
  ? {
      ...baselineSearch,
      packs: axisOptimization.packs,
      state: axisOptimization.state,
      axisOptimization: {
        profile: optimizationProfile,
        damageGain: axisOptimization.damageGain,
        phases: axisOptimization.phases,
      },
    }
  : {
      ...baselineSearch,
      axisOptimization: axisOptimization
          ? {
            profile: optimizationProfile,
            damageGain: axisOptimization.damageGain,
            phases: axisOptimization.phases,
          }
        : null,
    };
const artifact = buildWhitepaperAxisArtifact(search, runtime, {
  durationSeconds,
  optimizationProfile,
  mode: horizonMode,
});
const stem = `lianying-${policyMode}-${horizonMode}-${durationSeconds}s`;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(
  path.join(outputDirectory, `${stem}.json`),
  `${JSON.stringify(artifact, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDirectory, `${stem}.csv`),
  `\uFEFF${whitepaperAxisToCsv(artifact)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDirectory, `${stem}-equipment.csv`),
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  outputDirectory,
  stem,
  policyMode,
  horizonMode,
  beamWidth,
  durationSeconds,
  exploredTransitions: search.explored,
  legalTransitions: search.legal,
  warmStarted: search.warmStarted,
  warmStartCount: search.warmStartCount,
  axisOptimization: search.axisOptimization,
  warmStartRotationDps: strictWarmStart
    ? strictWarmStart.state.totalDamage / durationSeconds
    : null,
  rotationDpsGainOverWarmStart: strictWarmStart
    ? artifact.summary.rotationDps -
      strictWarmStart.state.totalDamage / durationSeconds
    : null,
  rows: artifact.rows.length,
  dps: artifact.summary.dps,
  rotationDps: artifact.summary.rotationDps,
  equipmentAndDamageEnchantDps:
    artifact.summary.equipmentAndDamageEnchantDps,
  mechanics: artifact.audit.mechanics,
  resourceWaste: artifact.audit.resourceWaste,
  whitepaperStrategy: artifact.audit.whitepaperStrategy,
}, null, 2));
