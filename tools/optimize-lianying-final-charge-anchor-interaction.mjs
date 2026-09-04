import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import {
  lianyingCompanionAnchorRows,
  optimizeLianyingAnchorDriftResynthesis,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import {
  buildLianyingForcedRideCounterfactual,
  buildLianyingForcedRideWarmAxes,
} from "../src/policies/lianying-stance-interval-macros.js";
import {
  lianyingActionCountSkeletonSegments,
  moveLianyingThunderAnchor,
} from "../src/policies/lianying-segment-skeletons.js";
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
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-final-charge-anchor-interaction.json",
);
const profileName = process.argv[4] ?? "probe";
const transferReportPath = process.argv[5]
  ? path.resolve(process.argv[5])
  : null;
const thunderOffsets = parseOffsets(process.argv[6] ?? "-2,-1,0,1,2");
const rideOffsets = parseOffsets(process.argv[7] ?? "-2,-1,0,1,2");
const warmReportPath = process.argv[8] ? path.resolve(process.argv[8]) : null;
const lookbackSegments = Math.max(0, Math.floor(Number(process.argv[9] ?? 0)));
if (!Number.isInteger(lookbackSegments)) {
  throw new Error("向前重合成区段数必须是非负整数");
}
const requestedRideOrdinal = process.argv[10]
  ? Math.floor(Number(process.argv[10]))
  : null;
const profiles = {
  probe: {
    rowBeamWidth: 12,
    boundaryBeamWidth: 8,
    coreFinalistCount: 12,
    coreCandidatePackLimit: 12,
    dashFinalistLimit: 6,
    dashStates: 64,
  },
  screen: {
    rowBeamWidth: 24,
    boundaryBeamWidth: 16,
    coreFinalistCount: 24,
    coreCandidatePackLimit: 24,
    dashFinalistLimit: 10,
    dashStates: 128,
  },
};
if (!profiles[profileName]) {
  throw new Error("最终断魂刺锚点联合档位必须是probe或screen");
}
if (!transferReportPath) {
  throw new Error("必须提供M5.64相邻计数转移报告路径");
}

function parseOffsets(value) {
  const offsets = [...new Set(String(value).split(",").map(Number))];
  if (offsets.some((offset) => !Number.isInteger(offset))) {
    throw new Error("偏移必须是逗号分隔整数");
  }
  return offsets;
}

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function allActions(pack) {
  return [...(pack?.prefix ?? []), pack?.primary, ...(pack?.tail ?? [])];
}

function countAction(packs, startRow, endRow, id) {
  return packs.slice(startRow - 1, endRow).reduce((sum, pack) =>
    sum + allActions(pack).filter((action) => actionId(action) === id).length, 0);
}

function chargeConstraintSatisfied(packs, constraints) {
  return constraints.every((constraint) =>
    countAction(packs, constraint.startRow, constraint.endRow, "charge") ===
      constraint.counts.charge);
}

function uniquePacks(candidates) {
  const unique = new Map();
  for (const packs of candidates) {
    const key = JSON.stringify(packs);
    if (!unique.has(key)) unique.set(key, packs);
  }
  return [...unique.values()];
}

function strictlyIncreasing(values) {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

function uniqueSchedules(schedules) {
  return [...new Map(schedules.map((schedule) => [
    JSON.stringify(schedule),
    schedule,
  ])).values()];
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入轴缺少可恢复的动作包");
const transferReport = JSON.parse(fs.readFileSync(transferReportPath, "utf8"));
const warmReport = warmReportPath
  ? JSON.parse(fs.readFileSync(warmReportPath, "utf8"))
  : null;
const transferExperiment = (transferReport.experiments ?? []).find(
  (experiment) => experiment.id === "action-charge-s6-to-s7",
);
if (!transferExperiment?.bestPacks) {
  throw new Error("M5.64报告缺少action-charge-s6-to-s7完整轴");
}

const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const baseline = replayWhitepaperLianying(runtime, sourcePacks, { durationSeconds });
const sourceCorePacks = stripLianyingDashPacks(sourcePacks);
const transferCorePacks = stripLianyingDashPacks(transferExperiment.bestPacks);
const anchors = identifyLianyingThunderSegments(sourceCorePacks).anchors;
const companionRows = lianyingCompanionAnchorRows(sourceCorePacks);
const finalThunderOrdinal = anchors.length;
const finalThunderRow = anchors.at(-1) + 1;
const automaticRideOrdinal = companionRows.rideRows
  .map((row, index) => ({
    ordinal: index + 1,
    row,
    distance: Math.abs(row - finalThunderRow),
  }))
  .filter(({ row }) => row <= finalThunderRow)
  .sort((left, right) => left.distance - right.distance)[0]?.ordinal;
const relatedRideOrdinal = requestedRideOrdinal ?? automaticRideOrdinal;
if (!relatedRideOrdinal) throw new Error("最终雷之前缺少可关联的任驰骋");
if (relatedRideOrdinal < 1 || relatedRideOrdinal > companionRows.rideRows.length) {
  throw new Error("指定任驰骋序号超出技能轴范围");
}

const transferSegments = lianyingActionCountSkeletonSegments(
  transferCorePacks,
  {
    firstAnchorOrdinal: finalThunderOrdinal - 1,
    lastAnchorOrdinal: finalThunderOrdinal,
    trackedActionIds: ["charge"],
  },
);
const sourceCount = transferSegments[0]?.counts.charge;
const destinationCount = transferSegments[1]?.counts.charge;
if (!Number.isInteger(sourceCount) || !Number.isInteger(destinationCount)) {
  throw new Error("无法读取最终两段断魂刺计数");
}
const nonzeroRideOffsets = rideOffsets.filter((offset) => offset !== 0);
const rideCounterfactual = nonzeroRideOffsets.length > 0
  ? buildLianyingForcedRideCounterfactual(
      transferCorePacks,
      {
        rideOrdinal: relatedRideOrdinal,
        rideOffsets: nonzeroRideOffsets,
        thunderSlackRows: 0,
        maximumAnchorSchedules: 1,
      },
    )
  : null;
const allowedRideSchedules = [];
if (rideOffsets.includes(0)) allowedRideSchedules.push(companionRows.rideRows);
allowedRideSchedules.push(...(rideCounterfactual?.allowedRideSchedules ?? []));
const inheritedRideRows = warmReport?.actionPacks
  ? lianyingCompanionAnchorRows(
      stripLianyingDashPacks(warmReport.actionPacks),
    ).rideRows
  : null;
if (inheritedRideRows) {
  for (const offset of rideOffsets) {
    const schedule = [...inheritedRideRows];
    schedule[relatedRideOrdinal - 1] += offset;
    if (
      schedule[relatedRideOrdinal - 1] >= 1 &&
      schedule[relatedRideOrdinal - 1] <= sourceCorePacks.length &&
      strictlyIncreasing(schedule)
    ) allowedRideSchedules.push(schedule);
  }
}
allowedRideSchedules.splice(
  0,
  allowedRideSchedules.length,
  ...uniqueSchedules(allowedRideSchedules),
);
const rideWarmAxes = rideCounterfactual
  ? buildLianyingForcedRideWarmAxes(
      transferCorePacks,
      rideCounterfactual,
    ).map((candidate) => candidate.packs)
  : [];
const profile = profiles[profileName];
const results = [];

for (const thunderOffset of thunderOffsets) {
  const targetThunderRow = finalThunderRow + thunderOffset;
  const targetAnchors = [...anchors];
  targetAnchors[finalThunderOrdinal - 1] = targetThunderRow - 1;
  if (targetAnchors.at(-1) <= targetAnchors.at(-2)) continue;
  const alternatePacks = moveLianyingThunderAnchor(
    sourcePacks,
    finalThunderOrdinal,
    targetThunderRow,
  );
  const sourceStartRow = targetAnchors.at(-2) + 1;
  const sourceEndRow = targetThunderRow - 1;
  const destinationStartRow = targetThunderRow;
  const destinationEndRow = sourceCorePacks.length;
  const resynthesisStartAnchorIndex = Math.max(
    0,
    finalThunderOrdinal - 2 - lookbackSegments,
  );
  const resynthesisStartRow = targetAnchors[resynthesisStartAnchorIndex] + 1;
  const actionCountConstraints = [
    {
      startRow: sourceStartRow,
      endRow: sourceEndRow,
      counts: { charge: sourceCount },
    },
    {
      startRow: destinationStartRow,
      endRow: destinationEndRow,
      counts: { charge: destinationCount },
    },
  ];
  const warmCandidates = uniquePacks([
    transferCorePacks,
    ...rideWarmAxes,
    ...(warmReport?.experiments ?? [])
      .filter((experiment) =>
        experiment.targetThunderRow === targetThunderRow &&
        experiment.bestPacks)
      .map((experiment) => stripLianyingDashPacks(experiment.bestPacks)),
    ...(warmReport?.actionPacks
      ? [stripLianyingDashPacks(warmReport.actionPacks)]
      : []),
  ].map((packs) => moveLianyingThunderAnchor(
    packs,
    finalThunderOrdinal,
    targetThunderRow,
  )));
  const legalWarmAxes = warmCandidates.filter((packs) => {
    if (!chargeConstraintSatisfied(packs, actionCountConstraints)) return false;
    try {
      replayWhitepaperLianying(runtime, packs, { durationSeconds });
      return true;
    } catch {
      return false;
    }
  });
  let experimentPacks = legalWarmAxes[0] ?? alternatePacks;
  let allowedAnchorSchedules = [targetAnchors];
  if (legalWarmAxes.length === 0) {
    try {
      replayWhitepaperLianying(runtime, alternatePacks, { durationSeconds });
    } catch {
      experimentPacks = sourcePacks;
      allowedAnchorSchedules = [anchors, targetAnchors];
    }
  }
  const experimentCorePacks = stripLianyingDashPacks(experimentPacks);
  const dismountWindows = companionRows.dismountRows.map((row, index) => ({
    targetRow: row,
    earliestRow: index === relatedRideOrdinal - 1 ? Math.max(1, row - 4) : row,
    latestRow: index === relatedRideOrdinal - 1
      ? Math.min(sourceCorePacks.length, row + 4)
      : row,
  }));
  process.stdout.write(`${JSON.stringify({
    phase: "final-charge-anchor-interaction",
    stage: "start",
    thunderOffset,
    targetThunderRow,
    relatedRideOrdinal,
    allowedRideScheduleCount: allowedRideSchedules.length,
    warmCandidateCount: warmCandidates.length,
    legalWarmCandidateCount: legalWarmAxes.length,
    actionCountConstraints,
    resynthesisStartRow,
  })}\n`);
  try {
    const optimized = optimizeLianyingAnchorDriftResynthesis(
      runtime,
      experimentPacks,
      {
        durationSeconds,
        allowedAnchorSchedules,
        companionAnchorTemplate: {
          allowedRideSchedules,
          orangeRows: companionRows.orangeRows,
          dismountWindows,
        },
        allowIncumbentConstraintExit: true,
        preserveReferenceWaitRows: true,
        preserveCompanionLineageTypes: ["ride", "dismount"],
        includeCompanionLineageCandidatePacks: true,
        additionalWarmAxes: legalWarmAxes,
        rowBeamWidth: profile.rowBeamWidth,
        boundaryBeamWidth: profile.boundaryBeamWidth,
        coreFinalistCount: profile.coreFinalistCount,
        coarseCandidateLimit: 2,
        coarseDashStates: 4,
        finalDashCandidateCount: 1,
        fullDashStates: 4,
        includeCoreCandidatePacks: true,
        coreCandidatePackLimit: profile.coreCandidatePackLimit,
        primaryActionConstraints: experimentCorePacks
          .slice(0, resynthesisStartRow - 1)
          .map((pack, rowIndex) => ({
            row: rowIndex + 1,
            allowedActionIds: [actionId(pack.primary)],
          })),
        actionCountConstraints,
        primaryStructureDiversity: {
          startRow: resynthesisStartRow,
          endRow: destinationEndRow,
          rowBucketSize: 2,
          maximumDifferences: 16,
          rowQuota: 4,
          boundaryQuota: 4,
        },
      },
    );
    const candidates = uniquePacks([
      ...optimized.coreCandidatePacks.map((candidate) => candidate.packs),
      ...optimized.coreCompanionLineageCandidates.map((candidate) =>
        candidate.packs),
    ]).filter((packs) =>
      chargeConstraintSatisfied(packs, actionCountConstraints) &&
      JSON.stringify(identifyLianyingThunderSegments(packs).anchors) ===
        JSON.stringify(targetAnchors));
    const rankedCore = candidates.map((packs) => ({
      packs,
      replay: replayWhitepaperLianying(runtime, packs, { durationSeconds }),
    })).sort((left, right) =>
      right.replay.state.totalDamage - left.replay.state.totalDamage);
    const best = rankedCore[0] ?? null;
    results.push({
      thunderOffset,
      targetThunderRow,
      resynthesisStartRow,
      actionCountConstraints,
      explored: optimized.explored,
      legal: optimized.legal,
      candidateCount: candidates.length,
      legalWarmCandidateCount: legalWarmAxes.length,
      bestCoreDamage: best?.replay.state.totalDamage ?? null,
      bestPacks: best?.packs ?? null,
      failure: best ? null : "没有满足联合约束的完整核心轴",
    });
  } catch (error) {
    results.push({
      thunderOffset,
      targetThunderRow,
      resynthesisStartRow,
      actionCountConstraints,
      explored: 0,
      legal: 0,
      candidateCount: 0,
      legalWarmCandidateCount: legalWarmAxes.length,
      bestCoreDamage: null,
      bestPacks: null,
      failure: error instanceof Error ? error.message : String(error),
    });
  }
  const result = results.at(-1);
  process.stdout.write(`${JSON.stringify({
    phase: "final-charge-anchor-interaction",
    stage: "complete",
    thunderOffset,
    targetThunderRow,
    explored: result.explored,
    legal: result.legal,
    candidateCount: result.candidateCount,
    bestCoreDamage: result.bestCoreDamage,
    failure: result.failure,
  })}\n`);
}

const finalists = results.filter((result) => result.bestPacks)
  .sort((left, right) => right.bestCoreDamage - left.bestCoreDamage)
  .slice(0, profile.dashFinalistLimit);
for (const result of finalists) {
  const dash = optimizeLianyingDashOverlay(runtime, result.bestPacks, {
    durationSeconds,
    maxStatesPerRow: profile.dashStates,
  });
  const audit = auditWhitepaperAxis(dash.state, { mode: "fixed" });
  const companions = lianyingCompanionAnchorRows(dash.packs);
  result.bestPacks = dash.packs;
  result.rotationDamage = dash.state.totalDamage;
  result.damageDifference = dash.state.totalDamage - baseline.state.totalDamage;
  result.damageLossRatio =
    (baseline.state.totalDamage - dash.state.totalDamage) /
    baseline.state.totalDamage;
  result.rideRows = companions.rideRows;
  result.dismountRows = companions.dismountRows;
  result.chargeRows = dash.packs.flatMap((pack, index) =>
    allActions(pack).some((action) => actionId(action) === "charge")
      ? [index + 1]
      : []);
  result.withinPointOnePercent = result.rotationDamage >=
    baseline.state.totalDamage * 0.999;
  result.mechanicsPassed = audit.mechanics.passed;
  result.mechanicsViolationCount = audit.mechanics.violationCount;
}
const ranked = finalists.sort((left, right) =>
  right.rotationDamage - left.rotationDamage);
const report = {
  schemaVersion: 1,
  kind: "lianying-final-charge-anchor-interaction",
  inputPath,
  transferReportPath,
  warmReportPath,
  profileName,
  durationSeconds,
  finalThunderOrdinal,
  finalThunderRow,
  relatedRideOrdinal,
  automaticRideOrdinal,
  requestedRideOrdinal,
  thunderOffsets,
  rideOffsets,
  lookbackSegments,
  allowedRideSchedules,
  sourceCount,
  destinationCount,
  baselineDamage: baseline.state.totalDamage,
  explored: results.reduce((sum, result) => sum + result.explored, 0),
  legal: results.reduce((sum, result) => sum + result.legal, 0),
  anyImprovement: ranked.some((result) => result.damageDifference > 0),
  anyWithinPointOnePercent: ranked.some((result) => result.withinPointOnePercent),
  bestExperiment: ranked[0] ?? null,
  actionPacks: ranked[0]?.bestPacks ?? null,
  experiments: results,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  phase: "final-charge-anchor-interaction",
  stage: "report",
  outputPath,
  explored: report.explored,
  legal: report.legal,
  anyImprovement: report.anyImprovement,
  anyWithinPointOnePercent: report.anyWithinPointOnePercent,
  bestExperiment: report.bestExperiment
    ? {
        targetThunderRow: report.bestExperiment.targetThunderRow,
        rideRows: report.bestExperiment.rideRows,
        rotationDamage: report.bestExperiment.rotationDamage,
        damageDifference: report.bestExperiment.damageDifference,
        damageLossRatio: report.bestExperiment.damageLossRatio,
      }
    : null,
}, null, 2)}\n`);
