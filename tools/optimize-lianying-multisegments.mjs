import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  lianyingMultiSegmentAnchorDiagnosticsToCsv,
  optimizeLianyingMultiSegmentResynthesis,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "fast";
const valueShadowPolicyPath = process.argv[5]
  ? resolveLianyingResearchPath(projectRoot, process.argv[5])
  : null;
const valueShadowPolicy = valueShadowPolicyPath
  ? JSON.parse(fs.readFileSync(valueShadowPolicyPath, "utf8"))
  : null;
if (valueShadowPolicy && valueShadowPolicy.enabled !== true) {
  throw new Error("价值影子策略未通过验证门控，拒绝用于联合区段搜索");
}
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const mode = source.mode ?? "fixed";
const seedPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!seedPacks) throw new Error("输入文件既没有actionPacks，也没有可恢复的rows");

const profiles = {
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 64,
  },
  fast: {
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  balanced: {
    rowBeamWidth: 48,
    boundaryBeamWidth: 24,
    coreFinalistCount: 24,
    coarseCandidateLimit: 6,
    coarseDashStates: 16,
    finalDashCandidateCount: 2,
    fullDashStates: 256,
  },
  deep: {
    rowBeamWidth: 96,
    boundaryBeamWidth: 48,
    coreFinalistCount: 48,
    coarseCandidateLimit: 8,
    coarseDashStates: 32,
    finalDashCandidateCount: 3,
    fullDashStates: 256,
  },
};
if (!profiles[profileName]) {
  throw new Error("多区段联合重合成档位必须是screen、fast、balanced或deep");
}

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seedReplay = replayWhitepaperLianying(runtime, seedPacks, { durationSeconds });
const optimized = optimizeLianyingMultiSegmentResynthesis(runtime, seedPacks, {
  durationSeconds,
  ...profiles[profileName],
  valueShadowPolicy,
  onProgress: (event) => {
    console.log(JSON.stringify({ phase: "multisegment-resynthesis", ...event }));
  },
});
const finalPacks = optimized.accepted ? optimized.packs : seedPacks;
const finalState = optimized.accepted ? optimized.state : seedReplay.state;
const searchResult = {
  durationSeconds,
  mode,
  policyMode: "free",
  beamWidth: source.search?.beamWidth ?? null,
  explored: optimized.explored,
  legal: optimized.legal,
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [seedReplay.state.totalDamage],
  warmStartDamage: seedReplay.state.totalDamage,
  telemetry: null,
  packs: finalPacks,
  state: finalState,
  axisOptimization: {
    kind: valueShadowPolicy
      ? "multisegment-resynthesis-value-shadow"
      : "multisegment-resynthesis",
    profile: profileName,
    accepted: optimized.accepted,
    seedPath: path.relative(projectRoot, inputPath),
    valueShadowPolicyPath: valueShadowPolicyPath
      ? path.relative(projectRoot, valueShadowPolicyPath)
      : null,
    damageGain: optimized.damageGain,
    options: optimized.options,
    anchors: optimized.anchors,
    segments: optimized.segments,
    peakRowStates: optimized.peakRowStates,
    finalBoundaryStates: optimized.finalBoundaryStates,
    coreCandidates: optimized.coreCandidates,
    valueShadowCoreCandidates: optimized.valueShadowCoreCandidates,
    bestValueShadowCoreDamage: optimized.bestValueShadowCoreDamage,
    bestValueShadowCoreDamageGain: optimized.bestValueShadowCoreDamageGain,
    damageShadowCoreCandidates: optimized.damageShadowCoreCandidates,
    bestDamageShadowCoreDamage: optimized.bestDamageShadowCoreDamage,
    bestDamageShadowCoreDamageGain: optimized.bestDamageShadowCoreDamageGain,
    modelValueShadowCoreCandidates: optimized.modelValueShadowCoreCandidates,
    bestModelValueShadowCoreDamage: optimized.bestModelValueShadowCoreDamage,
    bestModelValueShadowCoreDamageGain:
      optimized.bestModelValueShadowCoreDamageGain,
    valueShadowRows: optimized.valueShadowRows,
    valueShadowSelections: optimized.valueShadowSelections,
    valueShadowRowIntroductions: optimized.valueShadowRowIntroductions,
    valueShadowRowPropagations: optimized.valueShadowRowPropagations,
    valueShadowBoundarySelections: optimized.valueShadowBoundarySelections,
    valueShadowCoreFinalists: optimized.valueShadowCoreFinalists,
    damageShadowCoreFinalists: optimized.damageShadowCoreFinalists,
    coarseCandidates: optimized.coarseCandidates,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode,
});
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[4] ?? path.join(
    parsed.dir,
    `${parsed.name}-multisegments-${profileName}`,
  ),
);
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`, "utf8");
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
  "utf8",
);
fs.writeFileSync(
  `${outputStem}-anchors.csv`,
  `\uFEFF${lianyingMultiSegmentAnchorDiagnosticsToCsv(optimized)}\n`,
  "utf8",
);
const segmentSummary = optimized.segments.map(
  ({ candidateDiagnostics: _diagnostics, ...segment }) => segment,
);
console.log(JSON.stringify({
  inputPath,
  outputStem,
  profileName,
  valueShadowPolicyPath,
  accepted: optimized.accepted,
  seedRotationDamage: seedReplay.state.totalDamage,
  finalRotationDamage: finalState.totalDamage,
  damageGain: optimized.damageGain,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
  structure: artifact.structureAnalysis.summary,
  anchors: optimized.anchors,
  segments: segmentSummary,
  explored: optimized.explored,
  legal: optimized.legal,
  peakRowStates: optimized.peakRowStates,
  finalBoundaryStates: optimized.finalBoundaryStates,
  coreCandidates: optimized.coreCandidates,
  valueShadowCoreCandidates: optimized.valueShadowCoreCandidates,
  bestValueShadowCoreDamage: optimized.bestValueShadowCoreDamage,
  bestValueShadowCoreDamageGain: optimized.bestValueShadowCoreDamageGain,
  damageShadowCoreCandidates: optimized.damageShadowCoreCandidates,
  bestDamageShadowCoreDamage: optimized.bestDamageShadowCoreDamage,
  bestDamageShadowCoreDamageGain: optimized.bestDamageShadowCoreDamageGain,
  modelValueShadowCoreCandidates: optimized.modelValueShadowCoreCandidates,
  bestModelValueShadowCoreDamage: optimized.bestModelValueShadowCoreDamage,
  bestModelValueShadowCoreDamageGain:
    optimized.bestModelValueShadowCoreDamageGain,
  valueShadowRows: optimized.valueShadowRows,
  valueShadowSelections: optimized.valueShadowSelections,
  valueShadowRowIntroductions: optimized.valueShadowRowIntroductions,
  valueShadowRowPropagations: optimized.valueShadowRowPropagations,
  valueShadowBoundarySelections: optimized.valueShadowBoundarySelections,
  valueShadowCoreFinalists: optimized.valueShadowCoreFinalists,
  damageShadowCoreFinalists: optimized.damageShadowCoreFinalists,
  coarseCandidates: optimized.coarseCandidates,
}, null, 2));
