import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import {
  buildLianyingForcedRideCounterfactual,
  buildLianyingForcedRideWarmAxes,
} from
  "../src/policies/lianying-stance-interval-macros.js";
import {
  optimizeLianyingAnchorDriftResynthesis,
} from "../src/policies/lianying-multisegment-resynthesis.js";
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
  process.argv[3] ?? "/tmp/lianying-forced-ride-counterfactuals",
);
const profileName = process.argv[4] ?? "probe";
const ordinalArgument = process.argv[5] ?? "2,3,4,5";
const profiles = {
  probe: {
    rowBeamWidth: 16,
    boundaryBeamWidth: 8,
    coreFinalistCount: 12,
    coarseCandidateLimit: 2,
    coarseDashStates: 4,
    finalDashCandidateCount: 1,
    fullDashStates: 32,
    candidateLimit: 4,
    candidateDashStates: 64,
  },
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 16,
    coreFinalistCount: 24,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 64,
    candidateLimit: 8,
    candidateDashStates: 128,
  },
};
if (!profiles[profileName]) {
  throw new Error("强制任驰骋反事实档位必须是probe或screen");
}
const rideOrdinals = [...new Set(ordinalArgument.split(",").map(Number))];
if (rideOrdinals.some((value) => !Number.isInteger(value))) {
  throw new Error("任驰骋序号必须是逗号分隔整数");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入轴没有可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const baseline = replayWhitepaperLianying(runtime, sourcePacks, { durationSeconds });
const profile = profiles[profileName];

function actionMetrics(state) {
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
    finalRage: state.rage,
    finalDragonRideStacks: state.dragonRideStacks,
  };
}

function scheduleKey(rows) {
  return JSON.stringify(rows);
}

const ordinalResults = [];
for (const rideOrdinal of rideOrdinals) {
  const counterfactual = buildLianyingForcedRideCounterfactual(sourcePacks, {
    rideOrdinal,
  });
  const directWarmCandidates = buildLianyingForcedRideWarmAxes(
    sourcePacks,
    counterfactual,
  );
  const legalDirectWarmCandidates = directWarmCandidates.filter((candidate) => {
    try {
      replayWhitepaperLianying(runtime, candidate.packs, { durationSeconds });
      return true;
    } catch {
      return false;
    }
  });
  process.stdout.write(`${JSON.stringify({
    phase: "forced-ride-counterfactual",
    stage: "search-start",
    profileName,
    counterfactualId: counterfactual.counterfactualId,
    rideOrdinal,
    targetRideRow: counterfactual.targetRideRow,
    pairedThunderOrdinal: counterfactual.pairedThunderOrdinal,
    rideSchedules: counterfactual.allowedRideSchedules,
    anchorScheduleCount: counterfactual.allowedAnchorSchedules.length,
    directWarmCandidateCount: directWarmCandidates.length,
    legalDirectWarmCandidateCount: legalDirectWarmCandidates.length,
  })}\n`);
  let optimized;
  try {
    optimized = optimizeLianyingAnchorDriftResynthesis(
      runtime,
      sourcePacks,
      {
        durationSeconds,
        ...profile,
        allowedAnchorSchedules: counterfactual.allowedAnchorSchedules,
        companionAnchorTemplate: counterfactual.companionAnchorTemplate,
        allowIncumbentConstraintExit: true,
        preserveReferenceWaitRows: true,
        preserveCompanionLineageTypes: ["ride"],
        additionalWarmAxes: legalDirectWarmCandidates.map((candidate) =>
          candidate.packs),
        includeCompanionLineageCandidatePacks: true,
        useSuffixValue: true,
        onProgress: (event) => {
          if (event.stage !== "anchor-complete") return;
          process.stdout.write(`${JSON.stringify({
            phase: "forced-ride-counterfactual",
            counterfactualId: counterfactual.counterfactualId,
            stage: event.stage,
            anchor: event.anchor,
            anchorCount: event.anchorCount,
            outgoingStates: event.outgoingStates,
            outgoingSchedules: event.outgoingSchedules,
          })}\n`);
        },
      },
    );
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({
      phase: "forced-ride-counterfactual",
      stage: "search-exhausted",
      counterfactualId: counterfactual.counterfactualId,
      failure,
    })}\n`);
    ordinalResults.push({
      counterfactualId: counterfactual.counterfactualId,
      rideOrdinal,
      targetRideRow: counterfactual.targetRideRow,
      pairedThunderOrdinal: counterfactual.pairedThunderOrdinal,
      requestedRideSchedules: counterfactual.allowedRideSchedules,
      reachedRideSchedules: [],
      exhausted: true,
      failure,
      explored: null,
      legal: null,
      evaluated: [],
      bestArtifact: null,
    });
    continue;
  }
  const allowedRideKeys = new Set(
    counterfactual.allowedRideSchedules.map(scheduleKey),
  );
  const bestByRideSchedule = new Map();
  for (const candidate of optimized.coreCompanionLineageCandidates) {
    const rideRows = candidate.companionAnchors.rideRows;
    const key = scheduleKey(rideRows);
    if (!allowedRideKeys.has(key)) continue;
    const current = bestByRideSchedule.get(key);
    if (!current || candidate.bestCoreDamage > current.bestCoreDamage) {
      bestByRideSchedule.set(key, candidate);
    }
  }
  const evaluated = [];
  const coreCandidates = [...bestByRideSchedule.values()]
    .sort((left, right) => right.bestCoreDamage - left.bestCoreDamage)
    .slice(0, profile.candidateLimit);
  for (const [index, candidate] of coreCandidates.entries()) {
    process.stdout.write(`${JSON.stringify({
      phase: "forced-ride-counterfactual",
      stage: "candidate-dash",
      counterfactualId: counterfactual.counterfactualId,
      candidate: index + 1,
      candidateCount: coreCandidates.length,
      rideRows: candidate.companionAnchors.rideRows,
    })}\n`);
    const overlay = optimizeLianyingDashOverlay(runtime, candidate.packs, {
      durationSeconds,
      maxStatesPerRow: profile.candidateDashStates,
    });
    const audit = auditWhitepaperAxis(overlay.state, { mode: "fixed" });
    evaluated.push({
      packs: overlay.packs,
      state: overlay.state,
      rideRows: candidate.companionAnchors.rideRows,
      rideOffset:
        candidate.companionAnchors.rideRows[rideOrdinal - 1] -
        counterfactual.targetRideRow,
      thunderRows: candidate.anchorRows,
      rotationDamage: overlay.state.totalDamage,
      damageDifference: overlay.state.totalDamage - baseline.state.totalDamage,
      damageLossRatio:
        (baseline.state.totalDamage - overlay.state.totalDamage) /
        baseline.state.totalDamage,
      withinPointOnePercent:
        overlay.state.totalDamage >= baseline.state.totalDamage * 0.999,
      metrics: actionMetrics(overlay.state),
      mechanicsPassed: audit.mechanics.passed,
      mechanicsViolationCount: audit.mechanics.violationCount,
    });
  }
  evaluated.sort((left, right) => right.rotationDamage - left.rotationDamage);
  const best = evaluated[0] ?? null;
  let bestArtifact = null;
  if (best) {
    bestArtifact = `${outputStem}-ride-${rideOrdinal}-best.json`;
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
      packs: best.packs,
      state: best.state,
    }, runtime, { durationSeconds, mode: "fixed" });
    fs.writeFileSync(bestArtifact, `${JSON.stringify(artifact, null, 2)}\n`);
  }
  ordinalResults.push({
    counterfactualId: counterfactual.counterfactualId,
    rideOrdinal,
    targetRideRow: counterfactual.targetRideRow,
    pairedThunderOrdinal: counterfactual.pairedThunderOrdinal,
    requestedRideSchedules: counterfactual.allowedRideSchedules,
    reachedRideSchedules: [...bestByRideSchedule.keys()].map((key) =>
      JSON.parse(key)),
    directWarmCandidates: directWarmCandidates.map((candidate) => ({
      kind: candidate.kind,
      targetRideRow: candidate.targetRideRow,
      legal: legalDirectWarmCandidates.includes(candidate),
    })),
    explored: optimized.explored,
    legal: optimized.legal,
    evaluated: evaluated.map(({ packs: _packs, state: _state, ...entry }) => entry),
    bestArtifact,
  });
}

const allCandidates = ordinalResults.flatMap((result) =>
  result.evaluated.map((candidate) => ({
    rideOrdinal: result.rideOrdinal,
    ...candidate,
  })));
allCandidates.sort((left, right) => right.rotationDamage - left.rotationDamage);
const report = {
  inputPath,
  profileName,
  durationSeconds,
  baselineDamage: baseline.state.totalDamage,
  baselineMetrics: actionMetrics(baseline.state),
  requestedRideOrdinals: rideOrdinals,
  ordinalResults,
  bestCounterfactual: allCandidates[0] ?? null,
  anyWithinPointOnePercent:
    allCandidates.some((candidate) => candidate.withinPointOnePercent),
  anyImprovement:
    allCandidates.some((candidate) => candidate.damageDifference > 1e-6),
};
const reportPath = `${outputStem}-research.json`;
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  phase: "forced-ride-counterfactual",
  stage: "complete",
  reportPath,
  bestCounterfactual: report.bestCounterfactual,
  anyWithinPointOnePercent: report.anyWithinPointOnePercent,
  anyImprovement: report.anyImprovement,
})}\n`);
