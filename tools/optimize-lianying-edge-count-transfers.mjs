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
  lianyingActionCountSkeletonSegments,
  lianyingCountSkeletonSegments,
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
  process.argv[3] ?? "/tmp/lianying-edge-count-transfers.json",
);
const profileName = process.argv[4] ?? "probe";
const boundaryPairs = parseBoundaryPairs(process.argv[5] ?? "1-2,2-3,5-6,6-7");
const templateLimit = Math.max(1, Math.floor(Number(process.argv[6] ?? 32)));
const templateOffset = Math.max(0, Math.floor(Number(process.argv[7] ?? 0)));
const warmReportPath = process.argv[8] ? path.resolve(process.argv[8]) : null;
const profiles = {
  probe: {
    rowBeamWidth: 12,
    boundaryBeamWidth: 8,
    coreFinalistCount: 12,
    coreCandidatePackLimit: 12,
    structureQuota: 4,
    dashFinalistLimit: 4,
    dashStates: 64,
  },
  screen: {
    rowBeamWidth: 24,
    boundaryBeamWidth: 16,
    coreFinalistCount: 24,
    coreCandidatePackLimit: 24,
    structureQuota: 8,
    dashFinalistLimit: 8,
    dashStates: 128,
  },
};
if (!profiles[profileName]) {
  throw new Error("边缘区段计数转移档位必须是probe或screen");
}

function parseBoundaryPairs(value) {
  const pairs = String(value).split(",").filter(Boolean).map((entry) => {
    const match = entry.match(/^(\d+)-(\d+)$/u);
    if (!match) throw new Error("边界必须使用1-2,2-3格式");
    const pair = match.slice(1).map(Number);
    if (pair[1] !== pair[0] + 1) throw new Error("只允许相邻区段边界");
    return pair;
  });
  return pairs;
}

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function allActionLocations(pack, id) {
  const locations = [];
  for (const area of ["prefix", "tail"]) {
    for (let index = 0; index < (pack?.[area] ?? []).length; index += 1) {
      if (actionId(pack[area][index]) === id) locations.push({ area, index });
    }
  }
  return locations;
}

function buildTemplates(primarySegments, chargeSegments, pairs) {
  const primaryByOrdinal = new Map(primarySegments.map((segment) => [
    segment.ordinal,
    segment,
  ]));
  const chargeByOrdinal = new Map(chargeSegments.map((segment) => [
    segment.ordinal,
    segment,
  ]));
  const templates = [];
  for (const pair of pairs) {
    for (const [sourceOrdinal, destinationOrdinal] of [pair, [...pair].reverse()]) {
      const source = primaryByOrdinal.get(sourceOrdinal);
      const destination = primaryByOrdinal.get(destinationOrdinal);
      if (!source || !destination) throw new Error("边界引用了不存在的雷区段");
      for (const action of ["destroy", "dragonRoar", "cloudStrike"]) {
        if (source.counts[action] < 1 || destination.counts.dragonFang < 1) {
          continue;
        }
        const sourceCounts = { ...source.counts };
        const destinationCounts = { ...destination.counts };
        sourceCounts[action] -= 1;
        sourceCounts.dragonFang += 1;
        destinationCounts[action] += 1;
        destinationCounts.dragonFang -= 1;
        templates.push({
          id: `primary-${action}-s${sourceOrdinal}-to-s${destinationOrdinal}`,
          location: "primary",
          action,
          source,
          destination,
          constraints: [
            { startRow: source.startRow, endRow: source.endRow, counts: sourceCounts },
            {
              startRow: destination.startRow,
              endRow: destination.endRow,
              counts: destinationCounts,
            },
          ].sort((left, right) => left.startRow - right.startRow),
        });
      }
      const sourceCharge = chargeByOrdinal.get(sourceOrdinal);
      const destinationCharge = chargeByOrdinal.get(destinationOrdinal);
      if (sourceCharge?.counts.charge >= 1 && destinationCharge) {
        templates.push({
          id: `action-charge-s${sourceOrdinal}-to-s${destinationOrdinal}`,
          location: "all",
          action: "charge",
          source: sourceCharge,
          destination: destinationCharge,
          constraints: [
            {
              startRow: sourceCharge.startRow,
              endRow: sourceCharge.endRow,
              counts: { charge: sourceCharge.counts.charge - 1 },
            },
            {
              startRow: destinationCharge.startRow,
              endRow: destinationCharge.endRow,
              counts: { charge: destinationCharge.counts.charge + 1 },
            },
          ].sort((left, right) => left.startRow - right.startRow),
        });
      }
    }
  }
  return templates;
}

function directWarmAxes(corePacks, template) {
  const candidates = [];
  if (template.location === "primary") {
    for (
      let sourceIndex = template.source.startRow - 1;
      sourceIndex < template.source.endRow;
      sourceIndex += 1
    ) {
      if (actionId(corePacks[sourceIndex].primary) !== template.action) continue;
      for (
        let destinationIndex = template.destination.startRow - 1;
        destinationIndex < template.destination.endRow;
        destinationIndex += 1
      ) {
        if (actionId(corePacks[destinationIndex].primary) !== "dragonFang") continue;
        const packs = structuredClone(corePacks);
        [packs[sourceIndex].primary, packs[destinationIndex].primary] = [
          packs[destinationIndex].primary,
          packs[sourceIndex].primary,
        ];
        candidates.push({
          distance: Math.abs(destinationIndex - sourceIndex),
          packs,
        });
      }
    }
  } else {
    for (
      let sourceIndex = template.source.startRow - 1;
      sourceIndex < template.source.endRow;
      sourceIndex += 1
    ) {
      for (const location of allActionLocations(corePacks[sourceIndex], template.action)) {
        for (
          let destinationIndex = template.destination.startRow - 1;
          destinationIndex < template.destination.endRow;
          destinationIndex += 1
        ) {
          for (const destinationArea of ["prefix", "tail"]) {
            const packs = structuredClone(corePacks);
            const [moved] = packs[sourceIndex][location.area].splice(location.index, 1);
            const action = typeof moved === "string" ? { id: moved } : { ...moved };
            if (destinationArea === "prefix") {
              delete action.leadFrames;
            } else if (action.leadFrames === undefined) {
              action.leadFrames = 1;
            }
            packs[destinationIndex][destinationArea].push(action);
            candidates.push({
              distance: Math.abs(destinationIndex - sourceIndex),
              packs,
            });
          }
        }
      }
    }
  }
  const unique = new Map();
  for (const candidate of candidates.sort((left, right) =>
    left.distance - right.distance)) {
    const key = JSON.stringify(candidate.packs);
    if (!unique.has(key)) unique.set(key, candidate.packs);
  }
  return [...unique.values()];
}

function templateSatisfied(packs, template) {
  const count = (constraint) => packs
    .slice(constraint.startRow - 1, constraint.endRow)
    .reduce((totals, pack) => {
      if (template.location === "primary") {
        const id = actionId(pack.primary);
        if (Object.hasOwn(totals, id)) totals[id] += 1;
      } else {
        for (const location of allActionLocations(pack, template.action)) {
          if (location) totals[template.action] += 1;
        }
      }
      return totals;
    }, Object.fromEntries(Object.keys(constraint.counts).map((id) => [id, 0])));
  return template.constraints.every((constraint) => {
    const actual = count(constraint);
    return Object.entries(constraint.counts).every(
      ([id, expected]) => actual[id] === expected,
    );
  });
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入轴缺少可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const corePacks = stripLianyingDashPacks(sourcePacks);
const anchors = identifyLianyingThunderSegments(corePacks).anchors;
const primarySegments = lianyingCountSkeletonSegments(corePacks, {
  firstAnchorOrdinal: 1,
  lastAnchorOrdinal: anchors.length,
  trackedActionIds: ["dragonFang", "destroy", "dragonRoar", "cloudStrike"],
});
const chargeSegments = lianyingActionCountSkeletonSegments(corePacks, {
  firstAnchorOrdinal: 1,
  lastAnchorOrdinal: anchors.length,
  trackedActionIds: ["charge"],
});
const templates = buildTemplates(primarySegments, chargeSegments, boundaryPairs);
const selectedTemplates = templates.slice(templateOffset, templateOffset + templateLimit);
const warmReport = warmReportPath
  ? JSON.parse(fs.readFileSync(warmReportPath, "utf8"))
  : null;
const warmPacksByTemplateId = new Map(
  (warmReport?.experiments ?? []).flatMap((experiment) =>
    experiment.bestPacks ? [[experiment.id, experiment.bestPacks]] : []),
);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const baseline = replayWhitepaperLianying(runtime, sourcePacks, { durationSeconds });
const coreBaseline = replayWhitepaperLianying(runtime, corePacks, {
  durationSeconds,
});
const profile = profiles[profileName];
const companionAnchorTemplate = lianyingCompanionAnchorRows(corePacks);
const results = [];

for (const [index, template] of selectedTemplates.entries()) {
  const warmCandidates = directWarmAxes(corePacks, template);
  const legalWarmAxes = warmCandidates.filter((packs) => {
    try {
      replayWhitepaperLianying(runtime, packs, { durationSeconds });
      return true;
    } catch {
      return false;
    }
  });
  const legalDirectWarmCandidateCount = legalWarmAxes.length;
  const inheritedWarmPacks = warmPacksByTemplateId.get(template.id);
  const inheritedWarmLegal = Boolean(
    inheritedWarmPacks && templateSatisfied(inheritedWarmPacks, template),
  );
  if (inheritedWarmLegal) legalWarmAxes.unshift(inheritedWarmPacks);
  process.stdout.write(`${JSON.stringify({
    phase: "edge-count-transfer",
    stage: "start",
    experiment: index + 1,
    experimentCount: selectedTemplates.length,
    id: template.id,
    directWarmCandidateCount: warmCandidates.length,
    legalDirectWarmCandidateCount,
    inheritedWarmLegal,
  })}\n`);
  try {
    const startRow = Math.min(template.source.startRow, template.destination.startRow);
    const endRow = Math.max(template.source.endRow, template.destination.endRow);
    const optimized = optimizeLianyingAnchorDriftResynthesis(
      runtime,
      sourcePacks,
      {
        durationSeconds,
        allowedAnchorSchedules: [anchors],
        companionAnchorTemplate,
        allowIncumbentConstraintExit: true,
        preserveReferenceWaitRows: true,
        additionalWarmAxes: legalWarmAxes.slice(0, 8),
        rowBeamWidth: profile.rowBeamWidth,
        boundaryBeamWidth: profile.boundaryBeamWidth,
        coreFinalistCount: profile.coreFinalistCount,
        coarseCandidateLimit: 2,
        coarseDashStates: 4,
        finalDashCandidateCount: 1,
        fullDashStates: 4,
        includeCoreCandidatePacks: true,
        coreCandidatePackLimit: profile.coreCandidatePackLimit,
        primaryActionConstraints: corePacks.slice(0, startRow - 1)
          .map((pack, rowIndex) => ({
            row: rowIndex + 1,
            allowedActionIds: [actionId(pack.primary)],
          })),
        primaryCountConstraints: template.location === "primary"
          ? template.constraints
          : [],
        actionCountConstraints: template.location === "all"
          ? template.constraints
          : [],
        primaryStructureDiversity: {
          startRow,
          endRow,
          rowBucketSize: 2,
          maximumDifferences: 12,
          rowQuota: profile.structureQuota,
          boundaryQuota: profile.structureQuota,
        },
      },
    );
    const candidates = optimized.coreCandidatePacks.filter((candidate) =>
      templateSatisfied(candidate.packs, template)).sort((left, right) =>
      right.coreDamage - left.coreDamage);
    const best = candidates[0] ?? null;
    const result = {
      ...template,
      explored: optimized.explored,
      legal: optimized.legal,
      directWarmCandidateCount: warmCandidates.length,
      legalDirectWarmCandidateCount,
      inheritedWarmLegal,
      candidateCount: candidates.length,
      bestCoreDamage: best?.coreDamage ?? null,
      coreDamageDifference: best
        ? best.coreDamage - coreBaseline.state.totalDamage
        : null,
      bestPacks: best?.packs ?? null,
      failure: best ? null : "没有满足转移约束的完整核心轴",
    };
    results.push(result);
    process.stdout.write(`${JSON.stringify({
      phase: "edge-count-transfer",
      stage: "complete",
      id: template.id,
      explored: result.explored,
      legal: result.legal,
      candidateCount: result.candidateCount,
      coreDamageDifference: result.coreDamageDifference,
      failure: result.failure,
    })}\n`);
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    results.push({
      ...template,
      explored: 0,
      legal: 0,
      directWarmCandidateCount: warmCandidates.length,
      legalDirectWarmCandidateCount,
      inheritedWarmLegal,
      candidateCount: 0,
      bestCoreDamage: null,
      coreDamageDifference: null,
      bestPacks: null,
      failure,
    });
    process.stdout.write(`${JSON.stringify({
      phase: "edge-count-transfer",
      stage: "complete",
      id: template.id,
      failure,
    })}\n`);
  }
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
  result.bestPacks = dash.packs;
  result.rotationDamage = dash.state.totalDamage;
  result.damageDifference = dash.state.totalDamage - baseline.state.totalDamage;
  result.damageLossRatio =
    (baseline.state.totalDamage - dash.state.totalDamage) /
    baseline.state.totalDamage;
  result.withinPointOnePercent = dash.state.totalDamage >=
    baseline.state.totalDamage * 0.999;
  result.mechanicsPassed = audit.mechanics.passed;
  result.mechanicsViolationCount = audit.mechanics.violationCount;
}
const rankedFinalists = finalists.sort((left, right) =>
  right.rotationDamage - left.rotationDamage);
const report = {
  schemaVersion: 1,
  kind: "lianying-edge-adjacent-count-transfers",
  inputPath,
  durationSeconds,
  profileName,
  boundaryPairs,
  templateLimit,
  templateOffset,
  warmReportPath,
  generatedTemplateCount: templates.length,
  searchedTemplateCount: selectedTemplates.length,
  primarySegments,
  chargeSegments,
  baselineDamage: baseline.state.totalDamage,
  explored: results.reduce((sum, result) => sum + result.explored, 0),
  legal: results.reduce((sum, result) => sum + result.legal, 0),
  anyImprovement: rankedFinalists.some((result) =>
    result.rotationDamage > baseline.state.totalDamage),
  anyWithinPointOnePercent: rankedFinalists.some((result) =>
    result.withinPointOnePercent === true),
  bestExperiment: rankedFinalists[0] ?? null,
  experiments: results,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  phase: "edge-count-transfer",
  stage: "report",
  outputPath,
  generatedTemplateCount: report.generatedTemplateCount,
  searchedTemplateCount: report.searchedTemplateCount,
  explored: report.explored,
  legal: report.legal,
  anyImprovement: report.anyImprovement,
  anyWithinPointOnePercent: report.anyWithinPointOnePercent,
  bestExperiment: report.bestExperiment
    ? {
        id: report.bestExperiment.id,
        rotationDamage: report.bestExperiment.rotationDamage,
        damageDifference: report.bestExperiment.damageDifference,
        damageLossRatio: report.bestExperiment.damageLossRatio,
      }
    : null,
}, null, 2)}\n`);
