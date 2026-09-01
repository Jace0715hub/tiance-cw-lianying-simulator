import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import { buildLianyingStanceIntervalMacro } from
  "../src/policies/lianying-stance-interval-macros.js";
import {
  applyLianyingDismountTransferMutations,
  lianyingDismountTransferMutations,
} from "../src/policies/lianying-dismount-pair-neighborhood.js";
import {
  lianyingCompanionAnchorRows,
  optimizeLianyingAnchorDriftResynthesis,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import {
  identifyLianyingThunderSegments,
  stripLianyingDashPacks,
} from "../src/policies/lianying-segment-resynthesis.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";
import { buildWhitepaperAxisArtifact } from
  "../src/reports/whitepaper-axis-export.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputStem = path.resolve(
  process.argv[3] ?? "/tmp/lianying-stance-interval-macros",
);
const profileName = process.argv[4] ?? "screen";
const macroSelection = process.argv[5] ?? "all";
const profiles = {
  probe: {
    rowBeamWidth: 16,
    boundaryBeamWidth: 8,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 64,
    coreCandidatePackLimit: 16,
    distinctCandidateLimit: 2,
    distinctDashStates: 64,
    warmAxisLimit: 4,
  },
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 12,
    coreFinalistCount: 24,
    coarseCandidateLimit: 6,
    coarseDashStates: 12,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
    coreCandidatePackLimit: 32,
    distinctCandidateLimit: 4,
    distinctDashStates: 128,
    warmAxisLimit: 8,
  },
};
if (!profiles[profileName]) throw new Error("姿态区间宏档位必须是probe或screen");

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入轴没有可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const baseline = replayWhitepaperLianying(runtime, sourcePacks, { durationSeconds });
const corePacks = stripLianyingDashPacks(sourcePacks);
const baselineCoreAnchors = identifyLianyingThunderSegments(corePacks)
  .anchors.map((row) => row + 1);
const baselineCompanions = lianyingCompanionAnchorRows(corePacks);
const profile = profiles[profileName];
const allMacroSpecs = [
  { fromThunderOrdinal: 2, toThunderOrdinal: 3 },
  { fromThunderOrdinal: 4, toThunderOrdinal: 5 },
];
const macroSpecs = macroSelection === "all"
  ? allMacroSpecs
  : allMacroSpecs.filter((spec) =>
      `${spec.fromThunderOrdinal}-${spec.toThunderOrdinal}` === macroSelection);
if (macroSpecs.length === 0) {
  throw new Error("姿态区间必须是all、2-3或4-5");
}

function postureSignature(anchorRows, companions) {
  return JSON.stringify({
    thunderRows: anchorRows,
    rideRows: companions.rideRows,
    dismountRows: companions.dismountRows,
  });
}

const baselineSignature = postureSignature(
  baselineCoreAnchors,
  baselineCompanions,
);

function stanceMetrics(state) {
  const casts = state.timeline.filter((event) => event.type === "cast");
  const fangs = casts.filter((event) => event.action === "dragonFang");
  const rides = casts.filter((event) => event.action === "ride");
  return {
    dragonFangs: fangs.length,
    dragonRideGenerated:
      fangs.filter((event) =>
        !event.mounted && event.stacksAfter > event.stacksBefore).length +
      rides.reduce((sum, event) =>
        sum + Math.max(0, event.stacksAfter - event.stacksBefore), 0),
    dragonRideEnhancedFangs:
      fangs.filter((event) => event.dragonRideBonus).length,
    mountedFangs: fangs.filter((event) => event.mounted).length,
    mountedNormalFangs:
      fangs.filter((event) => event.mounted && !event.dragonRideBonus).length,
    onFootFangs: fangs.filter((event) => !event.mounted).length,
    finalRage: state.rage,
    finalDragonRideStacks: state.dragonRideStacks,
  };
}

function conversionSignature(metrics) {
  return JSON.stringify([
    metrics.dragonRideGenerated,
    metrics.dragonRideEnhancedFangs,
    metrics.mountedFangs,
    metrics.mountedNormalFangs,
    metrics.onFootFangs,
  ]);
}

const baselineMetrics = stanceMetrics(baseline.state);
const baselineConversionSignature = conversionSignature(baselineMetrics);

function compactMacro(macro) {
  return {
    macroId: macro.macroId,
    fromThunderOrdinal: macro.fromThunderOrdinal,
    toThunderOrdinal: macro.toThunderOrdinal,
    blockStartRow: macro.blockStartRow,
    blockEndRow: macro.blockEndRow,
    movableThunderOrdinals: macro.movableThunderOrdinals,
    movableRideOrdinals: macro.movableRideOrdinals,
    movableDismountOrdinals: macro.movableDismountOrdinals,
    allowedAnchorScheduleCount: macro.allowedAnchorSchedules.length,
    companionAnchorTemplate: macro.companionAnchorTemplate,
    options: macro.options,
  };
}

function buildMacroWarmAxes(macro) {
  const sourceRows = macro.movableDismountOrdinals.map(
    (ordinal) => baselineCompanions.dismountRows[ordinal - 1],
  );
  const candidates = [];
  const seen = new Set();
  for (const mutation of lianyingDismountTransferMutations(corePacks, {
    maxDistance: macro.options.dismountSlackRows,
    sourceRows,
  })) {
    const targetRow = mutation.targetIndex + 1;
    if (targetRow < macro.blockStartRow || targetRow >= macro.blockEndRow) {
      continue;
    }
    const packs = applyLianyingDismountTransferMutations(corePacks, [mutation]);
    const key = JSON.stringify(packs);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const replay = replayWhitepaperLianying(runtime, packs, {
        durationSeconds,
      });
      candidates.push({
        packs,
        damage: replay.state.totalDamage,
        description: mutation.description,
        companions: lianyingCompanionAnchorRows(packs),
      });
    } catch {
      // 高层只向低层传递可完整复演的姿态种子。
    }
  }
  candidates.sort((left, right) => right.damage - left.damage);
  return candidates.slice(0, profile.warmAxisLimit);
}

const macroResults = [];
for (const macroSpec of macroSpecs) {
  const macro = buildLianyingStanceIntervalMacro(corePacks, macroSpec);
  const warmAxes = buildMacroWarmAxes(macro);
  process.stdout.write(`${JSON.stringify({
    phase: "stance-interval-macro",
    stage: "search-start",
    profileName,
    ...compactMacro(macro),
    warmAxisCount: warmAxes.length,
    warmAxes: warmAxes.map(({ packs: _packs, ...candidate }) => candidate),
  })}\n`);
  const optimized = optimizeLianyingAnchorDriftResynthesis(
    runtime,
    sourcePacks,
    {
      durationSeconds,
      ...profile,
      allowedAnchorSchedules: macro.allowedAnchorSchedules,
      companionAnchorTemplate: macro.companionAnchorTemplate,
      preserveCompanionLineageTypes: ["ride", "dismount"],
      additionalWarmAxes: warmAxes.map((candidate) => candidate.packs),
      includeCoreCandidatePacks: true,
      useSuffixValue: true,
      onProgress: (event) => process.stdout.write(`${JSON.stringify({
        phase: "stance-interval-macro",
        macroId: macro.macroId,
        ...event,
      })}\n`),
    },
  );
  const structuralCore = optimized.coreCandidatePacks.filter((candidate) =>
    postureSignature(candidate.anchorRows, candidate.companionAnchors) !==
      baselineSignature);
  const evaluatedDistinct = [];
  for (const [index, candidate] of structuralCore
    .slice(0, profile.distinctCandidateLimit).entries()) {
    process.stdout.write(`${JSON.stringify({
      phase: "stance-interval-macro",
      stage: "distinct-dash",
      macroId: macro.macroId,
      candidate: index + 1,
      candidateCount: Math.min(
        structuralCore.length,
        profile.distinctCandidateLimit,
      ),
    })}\n`);
    const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
      durationSeconds,
      maxStatesPerRow: profile.distinctDashStates,
    });
    const audit = auditWhitepaperAxis(dash.state, { mode: "fixed" });
    evaluatedDistinct.push({
      packs: dash.packs,
      state: dash.state,
      rotationDamage: dash.state.totalDamage,
      damageDifference: dash.state.totalDamage - baseline.state.totalDamage,
      damageLossRatio:
        (baseline.state.totalDamage - dash.state.totalDamage) /
        baseline.state.totalDamage,
      withinPointOnePercent:
        dash.state.totalDamage >= baseline.state.totalDamage * 0.999,
      anchorRows: candidate.anchorRows,
      companionAnchors: candidate.companionAnchors,
      metrics: stanceMetrics(dash.state),
      mechanicsPassed: audit.mechanics.passed,
      mechanicsViolationCount: audit.mechanics.violationCount,
    });
  }
  evaluatedDistinct.sort(
    (left, right) => right.rotationDamage - left.rotationDamage,
  );
  const bestDistinct = evaluatedDistinct[0] ?? null;
  const bestConversion = evaluatedDistinct.find((candidate) =>
    conversionSignature(candidate.metrics) !== baselineConversionSignature) ?? null;
  let bestDistinctArtifact = null;
  if (bestDistinct) {
    const artifactPath = `${outputStem}-${macro.macroId}-best-distinct.json`;
    const artifact = buildWhitepaperAxisArtifact({
      durationSeconds,
      mode: "fixed",
      policyMode: "free",
      beamWidth: profile.rowBeamWidth,
      explored: optimized.explored,
      legal: optimized.legal,
      warmStarted: true,
      warmStartCount: 1,
      warmStartDamages: [baseline.state.totalDamage],
      warmStartDamage: baseline.state.totalDamage,
      telemetry: null,
      packs: bestDistinct.packs,
      state: bestDistinct.state,
      axisOptimization: {
        kind: "stance-interval-macro-best-distinct",
        macroId: macro.macroId,
        profileName,
      },
    }, runtime, { durationSeconds, mode: "fixed" });
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    bestDistinctArtifact = artifactPath;
  }
  let bestConversionArtifact = null;
  if (bestConversion) {
    const artifactPath = `${outputStem}-${macro.macroId}-best-conversion.json`;
    const artifact = buildWhitepaperAxisArtifact({
      durationSeconds,
      mode: "fixed",
      policyMode: "free",
      beamWidth: profile.rowBeamWidth,
      explored: optimized.explored,
      legal: optimized.legal,
      warmStarted: true,
      warmStartCount: 1,
      warmStartDamages: [baseline.state.totalDamage],
      warmStartDamage: baseline.state.totalDamage,
      telemetry: null,
      packs: bestConversion.packs,
      state: bestConversion.state,
      axisOptimization: {
        kind: "stance-interval-macro-best-conversion",
        macroId: macro.macroId,
        profileName,
      },
    }, runtime, { durationSeconds, mode: "fixed" });
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    bestConversionArtifact = artifactPath;
  }
  const compactDistinct = evaluatedDistinct.map(
    ({ packs: _packs, state: _state, ...candidate }) => candidate,
  );
  macroResults.push({
    macro: compactMacro(macro),
    explored: optimized.explored,
    legal: optimized.legal,
    accepted: optimized.accepted,
    selectedDamage: optimized.state.totalDamage,
    selectedDamageGain: optimized.damageGain,
    selectedAnchors: optimized.selectedAnchors,
    selectedCompanions: lianyingCompanionAnchorRows(
      stripLianyingDashPacks(optimized.packs),
    ),
    selectedMetrics: stanceMetrics(optimized.state),
    coreCandidateCount: optimized.coreCandidates,
    structuralCoreCandidateCount: structuralCore.length,
    warmAxes: warmAxes.map(({ packs: _packs, ...candidate }) => candidate),
    additionalWarmDiagnostics: optimized.additionalWarmDiagnostics,
    evaluatedDistinct: compactDistinct,
    bestDistinctArtifact,
    bestConversion: bestConversion
      ? compactDistinct.find((candidate) =>
          candidate.rotationDamage === bestConversion.rotationDamage &&
          JSON.stringify(candidate.companionAnchors) ===
            JSON.stringify(bestConversion.companionAnchors))
      : null,
    bestConversionArtifact,
  });
}

const distinctResults = macroResults.flatMap((result) =>
  result.evaluatedDistinct.map((candidate) => ({
    macroId: result.macro.macroId,
    ...candidate,
  })));
distinctResults.sort((left, right) => right.rotationDamage - left.rotationDamage);
const report = {
  inputPath,
  profileName,
  durationSeconds,
  baselineDamage: baseline.state.totalDamage,
  baselineAnchors: baselineCoreAnchors,
  baselineCompanions,
  baselineMetrics,
  macroResults,
  bestDistinct: distinctResults[0] ?? null,
  bestConversion: distinctResults.find((candidate) =>
    conversionSignature(candidate.metrics) !== baselineConversionSignature) ?? null,
  anyDistinctWithinPointOnePercent: distinctResults.some(
    (candidate) => candidate.withinPointOnePercent),
  anyImprovement: distinctResults.some(
    (candidate) => candidate.damageDifference > 1e-6),
};
const reportPath = `${outputStem}-research.json`;
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  phase: "stance-interval-macro",
  stage: "complete",
  reportPath,
  baselineDamage: report.baselineDamage,
  bestDistinct: report.bestDistinct,
  anyDistinctWithinPointOnePercent: report.anyDistinctWithinPointOnePercent,
  anyImprovement: report.anyImprovement,
})}\n`);
