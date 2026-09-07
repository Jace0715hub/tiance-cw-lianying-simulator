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
  process.argv[3] ?? "/tmp/lianying-edge-count-skeletons.json",
);
const profileName = process.argv[4] ?? "probe";
const segmentOrdinals = parseIntegerList(process.argv[5] ?? "1,2,6,7");
const templateLimit = Math.max(1, Math.floor(Number(process.argv[6] ?? 16)));
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
if (!profiles[profileName]) throw new Error("边缘区段计数档位必须是probe或screen");

function parseIntegerList(value) {
  const parsed = [...new Set(String(value).split(",").map(Number))];
  if (parsed.some((item) => !Number.isInteger(item) || item < 1)) {
    throw new Error("区段序号必须是逗号分隔的正整数");
  }
  return parsed;
}

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function clonePack(pack) {
  return structuredClone(pack);
}

function packActions(pack) {
  return [...(pack?.prefix ?? []), pack?.primary, ...(pack?.tail ?? [])];
}

function countAction(packs, segment, action, location) {
  const selected = packs.slice(segment.startRow - 1, segment.endRow);
  return selected.reduce((sum, pack) => sum + (location === "primary"
    ? Number(actionId(pack.primary) === action)
    : packActions(pack).filter((entry) => actionId(entry) === action).length), 0);
}

function templateSatisfied(packs, template) {
  return countAction(packs, template.segment, template.action, template.location) ===
    template.targetCount;
}

function directWarmAxes(corePacks, template) {
  const candidates = [];
  const start = template.segment.startRow - 1;
  const end = template.segment.endRow;
  if (template.location === "primary") {
    const source = template.delta > 0 ? "dragonFang" : template.action;
    const replacement = template.delta > 0 ? template.action : "dragonFang";
    for (let index = start; index < end; index += 1) {
      if (actionId(corePacks[index].primary) !== source) continue;
      const packs = corePacks.map(clonePack);
      packs[index].primary = replacement;
      candidates.push(packs);
    }
  } else if (template.delta < 0) {
    for (let index = start; index < end; index += 1) {
      for (const location of ["prefix", "tail"]) {
        const actions = corePacks[index][location] ?? [];
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          if (actionId(actions[actionIndex]) !== template.action) continue;
          const packs = corePacks.map(clonePack);
          packs[index][location].splice(actionIndex, 1);
          candidates.push(packs);
        }
      }
    }
  } else {
    for (let index = start; index < end; index += 1) {
      if (packActions(corePacks[index]).some(
        (action) => actionId(action) === template.action)) continue;
      const packs = corePacks.map(clonePack);
      packs[index].prefix = [template.action, ...(packs[index].prefix ?? [])];
      candidates.push(packs);
    }
  }
  return candidates;
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const warmReport = warmReportPath
  ? JSON.parse(fs.readFileSync(warmReportPath, "utf8"))
  : null;
const warmPacksByTemplateId = new Map(
  (warmReport?.experiments ?? []).flatMap((experiment) =>
    experiment.bestPacks ? [[experiment.id, experiment.bestPacks]] : []),
);
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入轴缺少可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const corePacks = stripLianyingDashPacks(sourcePacks);
const anchors = identifyLianyingThunderSegments(corePacks).anchors;
const primaryActions = ["destroy", "dragonRoar", "cloudStrike"];
const primarySegments = lianyingCountSkeletonSegments(corePacks, {
  firstAnchorOrdinal: 1,
  lastAnchorOrdinal: anchors.length,
  trackedActionIds: ["dragonFang", ...primaryActions],
});
const chargeSegments = lianyingActionCountSkeletonSegments(corePacks, {
  firstAnchorOrdinal: 1,
  lastAnchorOrdinal: anchors.length,
  trackedActionIds: ["charge"],
});
const segmentByOrdinal = new Map(primarySegments.map((segment) => [
  segment.ordinal,
  segment,
]));
const chargeByOrdinal = new Map(chargeSegments.map((segment) => [
  segment.ordinal,
  segment,
]));
const templates = [];
for (const ordinal of segmentOrdinals) {
  const segment = segmentByOrdinal.get(ordinal);
  const chargeSegment = chargeByOrdinal.get(ordinal);
  if (!segment || !chargeSegment) throw new Error(`找不到第${ordinal}雷区段`);
  for (const action of primaryActions) {
    for (const delta of [-1, 1]) {
      const targetCount = segment.counts[action] + delta;
      if (targetCount < 0) continue;
      templates.push({
        id: `primary-s${ordinal}-${action}-${delta > 0 ? "plus" : "minus"}1`,
        segment,
        ordinal,
        action,
        location: "primary",
        delta,
        baselineCount: segment.counts[action],
        targetCount,
      });
    }
  }
  for (const delta of [-1, 1]) {
    const targetCount = chargeSegment.counts.charge + delta;
    if (targetCount < 0) continue;
    templates.push({
      id: `action-s${ordinal}-charge-${delta > 0 ? "plus" : "minus"}1`,
      segment: chargeSegment,
      ordinal,
      action: "charge",
      location: "all",
      delta,
      baselineCount: chargeSegment.counts.charge,
      targetCount,
    });
  }
}
const selectedTemplates = templates.slice(templateOffset, templateOffset + templateLimit);
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
    phase: "edge-count-skeleton",
    stage: "start",
    experiment: index + 1,
    experimentCount: selectedTemplates.length,
    id: template.id,
    directWarmCandidateCount: warmCandidates.length,
    legalDirectWarmCandidateCount,
    inheritedWarmLegal,
  })}\n`);
  try {
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
        primaryCountConstraints: template.location === "primary"
          ? [{
              startRow: template.segment.startRow,
              endRow: template.segment.endRow,
              counts: { [template.action]: template.targetCount },
            }]
          : [],
        actionCountConstraints: template.location === "all"
          ? [{
              startRow: template.segment.startRow,
              endRow: template.segment.endRow,
              counts: { [template.action]: template.targetCount },
            }]
          : [],
        primaryStructureDiversity: {
          startRow: template.segment.startRow,
          endRow: template.segment.endRow,
          rowBucketSize: 2,
          maximumDifferences: 8,
          rowQuota: profile.structureQuota,
          boundaryQuota: profile.structureQuota,
        },
      },
    );
    const candidates = optimized.coreCandidatePacks.filter((candidate) =>
      templateSatisfied(candidate.packs, template));
    const best = candidates.sort((left, right) =>
      right.coreDamage - left.coreDamage)[0] ?? null;
    const result = {
      ...template,
      segment: { ...template.segment },
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
      failure: best ? null : "没有满足计数约束的完整核心轴",
    };
    results.push(result);
    process.stdout.write(`${JSON.stringify({
      phase: "edge-count-skeleton",
      stage: "complete",
      id: template.id,
      explored: result.explored,
      legal: result.legal,
      candidateCount: result.candidateCount,
      bestCoreDamage: result.bestCoreDamage,
      coreDamageDifference: result.coreDamageDifference,
      failure: result.failure,
    })}\n`);
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    results.push({
      ...template,
      segment: { ...template.segment },
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
      phase: "edge-count-skeleton",
      stage: "complete",
      id: template.id,
      failure,
    })}\n`);
  }
}

const finalists = results
  .filter((result) => result.bestPacks)
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

const rankedCore = results.filter((result) => result.bestPacks).sort((left, right) =>
  Number(right.rotationDamage ?? right.bestCoreDamage) -
  Number(left.rotationDamage ?? left.bestCoreDamage));
const rankedFinalists = finalists.sort((left, right) =>
  Number(right.rotationDamage) - Number(left.rotationDamage));
const bestExperiment = rankedFinalists[0] ?? rankedCore[0] ?? null;
const report = {
  schemaVersion: 1,
  kind: "lianying-edge-segment-count-skeletons",
  inputPath,
  durationSeconds,
  profileName,
  requestedSegmentOrdinals: segmentOrdinals,
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
    Number(result.rotationDamage) > baseline.state.totalDamage),
  anyWithinPointOnePercent: rankedFinalists.some((result) =>
    result.withinPointOnePercent === true),
  bestExperiment,
  experiments: results,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  phase: "edge-count-skeleton",
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
        rotationDamage: report.bestExperiment.rotationDamage ?? null,
        damageDifference: report.bestExperiment.damageDifference ?? null,
        damageLossRatio: report.bestExperiment.damageLossRatio ?? null,
      }
    : null,
}, null, 2)}\n`);
