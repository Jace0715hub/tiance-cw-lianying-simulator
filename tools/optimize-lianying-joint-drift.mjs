import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import { optimizeLianyingCrossoverJointBridge } from "../src/policies/lianying-crossover-bridge.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adaptiveSuffixRepair = process.argv.includes("--adaptive");
const valuePolicyArgument = process.argv.slice(2).find((value) =>
  value.startsWith("--value-policy="));
const positionalArgs = process.argv.slice(2).filter((value) =>
  value !== "--adaptive" && !value.startsWith("--value-policy="));
const valueShadowPolicyPath = valuePolicyArgument
  ? resolveLianyingResearchPath(
    projectRoot,
    valuePolicyArgument.slice("--value-policy=".length),
  )
  : null;
const valueShadowPolicy = valueShadowPolicyPath
  ? JSON.parse(fs.readFileSync(valueShadowPolicyPath, "utf8"))
  : null;
if (valueShadowPolicy && valueShadowPolicy.enabled !== true) {
  throw new Error("价值影子策略未通过验证门控，拒绝用于自适应后缀搜索");
}
const incumbentPath = resolveLianyingResearchPath(projectRoot, positionalArgs[0]);
const targetPath = resolveLianyingResearchPath(
  projectRoot,
  positionalArgs[1] ??
    "output/lianying-free-fixed-180s-crossover-bridge-portfolio-joint-target-best-alternative.json",
);
const profileName = positionalArgs[2] ?? "screen";
const profiles = {
  screen: {
    beamWidth: 32,
    finalistCount: 10,
    coarseCandidateLimit: 8,
    coarseDashStates: 16,
    finalDashCandidateCount: 3,
    fullDashStates: 128,
    boundaryPaddingRows: 6,
  },
  fast: {
    beamWidth: 64,
    finalistCount: 16,
    coarseCandidateLimit: 12,
    coarseDashStates: 32,
    finalDashCandidateCount: 4,
    fullDashStates: 256,
    boundaryPaddingRows: 8,
  },
};
if (!profiles[profileName]) throw new Error("联合漂移档位必须是screen或fast");

function loadAxis(inputPath) {
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const packs = source.actionPacks ??
    (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
  if (!packs) throw new Error(`${inputPath}没有可恢复的动作包`);
  return {
    inputPath,
    source,
    packs,
    durationSeconds: Number(source.durationSeconds ?? 180),
    mode: source.mode ?? "fixed",
  };
}

const incumbent = loadAxis(incumbentPath);
const target = loadAxis(targetPath);
if (incumbent.durationSeconds !== target.durationSeconds) {
  throw new Error("联合漂移要求全局最优与定向轴战斗时长一致");
}
const durationSeconds = incumbent.durationSeconds;
const mode = incumbent.mode;
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const optimized = optimizeLianyingCrossoverJointBridge(
  runtime,
  incumbent.packs,
  target.packs,
  {
    durationSeconds,
    crossoverAnchorNumber: 2,
    middleThunderDriftRows: 1,
    useIncumbentWarmStart: true,
    preserveNovelStructure: true,
    preserveThunderPositions: true,
    adaptiveSuffixRepair,
    adaptiveSuffixMaxExpansions: profileName === "fast" ? 4 : 2,
    adaptiveSuffixLookaheadRows: profileName === "fast" ? 6 : 4,
    adaptiveSuffixMaximumAddedRows: profileName === "fast" ? 48 : 40,
    adaptiveSuffixPreferDriftedLineages: true,
    adaptiveSuffixWarmFailureLimit: profileName === "fast" ? 8 : 4,
    adaptiveSuffixFailureChainLimit: adaptiveSuffixRepair
      ? profileName === "fast" ? 6 : 4
      : 1,
    adaptiveSuffixFailureRowBucketSize: 8,
    adaptiveSuffixDirectedRepairLimit: adaptiveSuffixRepair
      ? profileName === "fast" ? 16 : 8
      : 0,
    adaptiveSuffixDirectedRepairLookBehindRows: 4,
    adaptiveSuffixDirectedRepairLookAheadRows: profileName === "fast" ? 8 : 6,
    valueShadowPolicy,
    ...profiles[profileName],
    onProgress: (event) => console.log(JSON.stringify({
      phase: adaptiveSuffixRepair ? "adaptive-suffix" : "joint-drift",
      ...event,
    })),
  },
);

function summarizePasses(passes) {
  return passes.map((pass) => ({
    pass: pass.pass,
    anchors: pass.anchors,
    segments: pass.segments,
    coreCandidates: pass.coreCandidates,
    coarseCandidates: pass.coarseCandidates,
    bestSegmentId: pass.bestSegmentId,
    damageGain: pass.damageGain,
  }));
}

function makeArtifact(packs, state, kind) {
  const explored = optimized.resynthesis.passes.reduce(
    (sum, pass) => sum + pass.segments.reduce(
      (inner, segment) => inner + segment.explored,
      0,
    ),
    0,
  );
  const legal = optimized.resynthesis.passes.reduce(
    (sum, pass) => sum + pass.segments.reduce(
      (inner, segment) => inner + segment.legal,
      0,
    ),
    0,
  );
  return buildWhitepaperAxisArtifact({
    durationSeconds,
    mode,
    policyMode: "free",
    beamWidth: profiles[profileName].beamWidth,
    explored,
    legal,
    warmStarted: true,
    warmStartCount: optimized.warmStartAxisCount,
    warmStartDamages: [optimized.baselineDamage, optimized.crossoverDamage],
    warmStartDamage: optimized.baselineDamage,
    telemetry: null,
    packs,
    state,
    axisOptimization: {
      kind,
      profile: profileName,
      accepted: optimized.accepted,
      baselineDamage: optimized.baselineDamage,
      targetDamage: optimized.crossoverDamage,
      bridgedDamage: optimized.bridgedDamage,
      bridgeDamageGain: optimized.bridgeDamageGain,
      globalDamageGain: optimized.globalDamageGain,
      crossoverAnchorNumber: optimized.crossoverAnchorNumber,
      jointSegment: optimized.jointSegment,
      thunderPositionWindows: optimized.thunderPositionWindows,
      warmStartAxisCount: optimized.warmStartAxisCount,
      adaptiveSuffixRepair,
      valueShadowPolicyPath: valueShadowPolicyPath
        ? path.relative(projectRoot, valueShadowPolicyPath)
        : null,
      passes: summarizePasses(optimized.resynthesis.passes),
      options: optimized.resynthesis.options,
    },
  }, runtime, { durationSeconds, mode });
}

const artifact = makeArtifact(
  optimized.packs,
  optimized.state,
  adaptiveSuffixRepair
    ? "crossover-joint-adaptive-suffix"
    : "crossover-joint-anchor-drift",
);
const candidateArtifact = makeArtifact(
  optimized.candidatePacks,
  optimized.candidateState,
  adaptiveSuffixRepair
    ? "crossover-joint-adaptive-suffix-candidate"
    : "crossover-joint-anchor-drift-candidate",
);
const incumbentParsed = path.parse(incumbentPath);
const outputStem = path.resolve(
  positionalArgs[3] ?? path.join(
    incumbentParsed.dir,
    `${incumbentParsed.name}-${
      adaptiveSuffixRepair ? "adaptive-suffix" : "joint-drift"
    }-${profileName}`,
  ),
);
for (const [suffix, value] of [
  [".json", `${JSON.stringify(artifact, null, 2)}\n`],
  [".csv", `\uFEFF${whitepaperAxisToCsv(artifact)}\n`],
  ["-equipment.csv", `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`],
  ["-candidate.json", `${JSON.stringify(candidateArtifact, null, 2)}\n`],
  ["-candidate.csv", `\uFEFF${whitepaperAxisToCsv(candidateArtifact)}\n`],
]) {
  fs.writeFileSync(`${outputStem}${suffix}`, value, "utf8");
}
console.log(JSON.stringify({
  incumbentPath,
  targetPath,
  outputStem,
  profileName,
  adaptiveSuffixRepair,
  valueShadowPolicyPath,
  accepted: optimized.accepted,
  baselineDamage: optimized.baselineDamage,
  targetDamage: optimized.crossoverDamage,
  candidateDamage: optimized.candidateState.totalDamage,
  bridgeDamageGain: optimized.bridgeDamageGain,
  globalDamageGain: optimized.globalDamageGain,
  finalRotationDps: artifact.summary.rotationDps,
  finalTotalDps: artifact.summary.dps,
  candidateRotationDps: candidateArtifact.summary.rotationDps,
  candidateTotalDps: candidateArtifact.summary.dps,
  thunderPositionWindows: optimized.thunderPositionWindows,
  passes: summarizePasses(optimized.resynthesis.passes),
}, null, 2));
