import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  lianyingCompanionAnchorRows,
  optimizeLianyingAnchorDriftResynthesis,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import { buildLianyingRideThunderUsageTemplates } from
  "../src/policies/lianying-ride-thunder-templates.js";
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
  process.argv[3] ?? "/tmp/lianying-ride-thunder-templates.json",
);
const profileName = process.argv[4] ?? "probe";
const profiles = {
  probe: {
    rowBeamWidth: 24,
    boundaryBeamWidth: 16,
    coreFinalistCount: 24,
    coarseCandidateLimit: 8,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
    templateDashStates: 128,
  },
  screen: {
    rowBeamWidth: 48,
    boundaryBeamWidth: 32,
    coreFinalistCount: 48,
    coarseCandidateLimit: 12,
    coarseDashStates: 12,
    finalDashCandidateCount: 4,
    fullDashStates: 256,
    templateDashStates: 256,
  },
};
if (!profiles[profileName]) throw new Error("未知任雷充能模板搜索档位");

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的技能轴");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const baseline = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const corePacks = stripLianyingDashPacks(sourcePacks);
const coreBaseline = replayWhitepaperLianying(runtime, corePacks, {
  durationSeconds,
});
const built = buildLianyingRideThunderUsageTemplates(corePacks);
const thunderAnchors = identifyLianyingThunderSegments(corePacks).anchors;
const orangeRows = lianyingCompanionAnchorRows(corePacks).orangeRows;
const profile = profiles[profileName];

process.stdout.write(`${JSON.stringify({
  phase: "ride-thunder-usage-templates",
  stage: "search-start",
  profileName,
  templateCount: built.templates.length,
  templates: built.templates.map((template) => ({
    templateId: template.templateId,
    soloThunderOrdinal: template.soloThunderOrdinal,
    rideRows: template.rideRows,
  })),
})}\n`);

const optimized = optimizeLianyingAnchorDriftResynthesis(
  runtime,
  sourcePacks,
  {
    durationSeconds,
    ...profile,
    allowedAnchorSchedules: [thunderAnchors],
    companionAnchorTemplate: {
      allowedRideSchedules: built.templates.map((template) => template.rideRows),
      orangeRows,
    },
    preserveCompanionLineageTypes: ["ride"],
    useSuffixValue: true,
    includeCompanionLineageCandidatePacks: true,
    onProgress: (event) => process.stdout.write(`${JSON.stringify({
      phase: "ride-thunder-usage-templates",
      ...event,
    })}\n`),
  },
);

const candidateByRideRows = new Map(
  optimized.coreCompanionLineageCandidates.map((candidate) => [
    JSON.stringify(candidate.companionAnchors.rideRows),
    candidate,
  ]),
);
const templateResults = [];
for (const [index, template] of built.templates.entries()) {
  if (template.isIncumbent) {
    templateResults.push({
      ...template,
      reachedCore: true,
      coreDamage: coreBaseline.state.totalDamage,
      rotationDamage: baseline.state.totalDamage,
      rotationDamageGain: 0,
      rotationDamageLossRatio: 0,
      mechanicsPassed: true,
      mechanicsViolationCount: 0,
      packs: sourcePacks,
    });
    continue;
  }
  const candidate = candidateByRideRows.get(JSON.stringify(template.rideRows));
  if (!candidate) {
    templateResults.push({ ...template, reachedCore: false });
    continue;
  }
  process.stdout.write(`${JSON.stringify({
    phase: "ride-thunder-usage-templates",
    stage: "template-dash-start",
    template: index + 1,
    templateCount: built.templates.length,
    templateId: template.templateId,
  })}\n`);
  const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
    durationSeconds,
    maxStatesPerRow: profile.templateDashStates,
  });
  const audit = auditWhitepaperAxis(dash.state, { mode: "fixed" });
  templateResults.push({
    ...template,
    reachedCore: true,
    coreDamage: candidate.bestCoreDamage,
    rotationDamage: dash.state.totalDamage,
    rotationDamageGain: dash.state.totalDamage - baseline.state.totalDamage,
    rotationDamageLossRatio:
      (baseline.state.totalDamage - dash.state.totalDamage) /
      baseline.state.totalDamage,
    mechanicsPassed: audit.mechanics.passed,
    mechanicsViolationCount: audit.mechanics.violationCount,
    packs: dash.packs,
  });
}

templateResults.sort((left, right) =>
  Number(right.rotationDamage ?? -Infinity) -
  Number(left.rotationDamage ?? -Infinity));
const best = templateResults[0];
const accepted = !best.isIncumbent &&
  best.mechanicsPassed &&
  best.rotationDamage > baseline.state.totalDamage;
const report = {
  schemaVersion: 1,
  kind: "lianying-ride-thunder-usage-templates",
  inputPath,
  durationSeconds,
  profileName,
  baselineRotationDamage: baseline.state.totalDamage,
  thunderRows: built.thunderRows,
  incumbentRideRows: built.incumbentRideRows,
  incumbentSoloThunderOrdinal: built.incumbentSoloThunderOrdinal,
  phaseOffsets: built.phaseOffsets,
  terminalRideRows: built.terminalRideRows,
  exploredTransitions: optimized.explored,
  legalTransitions: optimized.legal,
  finalBoundaryStates: optimized.finalBoundaryStates,
  finalCompanionLineages: optimized.finalCompanionLineages,
  templates: templateResults.map(({ packs: _packs, ...template }) => template),
  qualifiedAlternativeCount: templateResults.filter((template) =>
    !template.isIncumbent &&
    template.mechanicsPassed &&
    template.rotationDamageLossRatio <= 0.01).length,
  accepted,
  selectedTemplateId: accepted ? best.templateId : built.templates[0].templateId,
  bestAlternativeActionPacks: templateResults.find(
    (template) => !template.isIncumbent && template.reachedCore,
  )?.packs ?? null,
  actionPacks: accepted ? best.packs : sourcePacks,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  baselineRotationDamage: report.baselineRotationDamage,
  exploredTransitions: report.exploredTransitions,
  legalTransitions: report.legalTransitions,
  finalBoundaryStates: report.finalBoundaryStates,
  finalCompanionLineages: report.finalCompanionLineages,
  templates: report.templates,
  qualifiedAlternativeCount: report.qualifiedAlternativeCount,
  accepted: report.accepted,
  selectedTemplateId: report.selectedTemplateId,
}, null, 2)}\n`);
