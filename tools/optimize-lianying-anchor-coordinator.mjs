import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  buildLianyingFocusedCompanionAnchorTemplate,
  lianyingAnchorCoordinationTemplatesToCsv,
  optimizeLianyingFocusedCompanionAnchorCoordination,
  optimizeLianyingHierarchicalAnchorCoordination,
  optimizeLianyingIterativeFocusedCompanionAnchorCoordination,
  optimizeLianyingRankedPairAnchorCoordination,
} from "../src/policies/lianying-anchor-coordinator.js";
import {
  identifyLianyingThunderSegments,
  stripLianyingDashPacks,
} from "../src/policies/lianying-segment-resynthesis.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "screen";
const pairProfile = profileName.startsWith("pair-");
const focusedProfile = profileName.startsWith("focused-");
const targetedProfile = profileName.startsWith("target-anchor-");
const singleResultPath = pairProfile && process.argv[5]
  ? path.resolve(process.argv[5])
  : null;
const pairTemplateLimit = !pairProfile || process.argv[6] == null
  ? null
  : Number(process.argv[6]);
if (
  pairTemplateLimit !== null &&
  (!Number.isInteger(pairTemplateLimit) || pairTemplateLimit < 1)
) {
  throw new Error("双锚点模板数量必须是正整数");
}
const companionSlackOverride = !pairProfile || process.argv[7] == null
  ? null
  : Number(process.argv[7]);
if (
  companionSlackOverride !== null &&
  (!Number.isInteger(companionSlackOverride) || companionSlackOverride < 0)
) {
  throw new Error("伴随锚点窗口必须是非负整数");
}
const pairTemplateIds = pairProfile && process.argv[8]
  ? process.argv[8].split(",").map((id) => id.trim()).filter(Boolean)
  : null;
const focusedFixedThroughOrdinal = focusedProfile && process.argv[5] != null
  ? Number(process.argv[5])
  : null;
const focusedBeforeRows = focusedProfile && process.argv[6] != null
  ? Number(process.argv[6])
  : null;
const focusedAfterRows = focusedProfile && process.argv[7] != null
  ? Number(process.argv[7])
  : null;
const focusedMaximumPasses = focusedProfile && process.argv[8] != null
  ? Number(process.argv[8])
  : null;
for (const [label, value] of [
  ["固定任驰骋序号", focusedFixedThroughOrdinal],
  ["前向窗口", focusedBeforeRows],
  ["后向窗口", focusedAfterRows],
  ["聚焦重心轮次", focusedMaximumPasses],
]) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${label}必须是非负整数`);
  }
}
const targetedAnchorNumber = targetedProfile
  ? Number(process.argv[5] ?? 6)
  : null;
const targetedAnchorSlackRows = targetedProfile
  ? Number(process.argv[6] ?? 2)
  : null;
const targetedRideSlackRows = targetedProfile
  ? Number(process.argv[7] ?? 2)
  : null;
const targetedDismountSlackRows = targetedProfile
  ? Number(process.argv[8] ?? 6)
  : null;
for (const [label, value] of [
  ["指定雷序号", targetedAnchorNumber],
  ["指定雷窗口", targetedAnchorSlackRows],
  ["任驰骋窗口", targetedRideSlackRows],
  ["下马窗口", targetedDismountSlackRows],
]) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${label}必须是非负整数`);
  }
}
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const seedPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!seedPacks) throw new Error("输入文件既没有actionPacks，也没有可恢复的rows");

const common = {
  anchorSlackRows: 1,
  fixFirstAnchor: true,
  fixLastAnchor: true,
  maximumShiftedAnchors: 1,
  maximumTemplates: 16,
  evaluationMode: "independent",
  useSuffixValue: true,
};
const profiles = {
  screen: {
    ...common,
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 128,
  },
  fast: {
    ...common,
    rowBeamWidth: 32,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coarseCandidateLimit: 5,
    coarseDashStates: 12,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "pair-screen": {
    ...common,
    maximumShiftedAnchors: 2,
    rankedSingleTemplateLimit: 5,
    maximumPairTemplates: 6,
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 128,
  },
  "pair-fast": {
    ...common,
    maximumShiftedAnchors: 2,
    rankedSingleTemplateLimit: 5,
    maximumPairTemplates: 6,
    rowBeamWidth: 32,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coarseCandidateLimit: 5,
    coarseDashStates: 12,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "pair-rides-screen": {
    ...common,
    maximumShiftedAnchors: 2,
    rankedSingleTemplateLimit: 5,
    maximumPairTemplates: 6,
    preserveCompanionAnchorTypes: ["ride"],
    companionAnchorSlackRows: 1,
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 128,
  },
  "pair-rides-dismount-screen": {
    ...common,
    maximumShiftedAnchors: 2,
    rankedSingleTemplateLimit: 5,
    maximumPairTemplates: 6,
    preserveCompanionAnchorTypes: ["ride", "dismount"],
    companionAnchorSlackRows: 2,
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "focused-rides-screen": {
    ...common,
    companionTypes: ["ride"],
    fixedThroughOrdinal: 4,
    beforeRows: 0,
    afterRows: 2,
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    // Keep one slot for the incumbent and one for the strongest challenger.
    // A limit of one is diagnostic-only because the incumbent is pinned.
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "focused-rides-fast": {
    ...common,
    companionTypes: ["ride"],
    fixedThroughOrdinal: 4,
    beforeRows: 0,
    afterRows: 2,
    rowBeamWidth: 32,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coarseCandidateLimit: 5,
    coarseDashStates: 12,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "focused-rides-iterative-fast": {
    ...common,
    companionTypes: ["ride"],
    fixedThroughOrdinal: 4,
    beforeRows: 0,
    afterRows: 2,
    maximumFocusedPasses: 3,
    rowBeamWidth: 32,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coarseCandidateLimit: 5,
    coarseDashStates: 12,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "focused-rides-dismount-screen": {
    ...common,
    companionTypes: ["ride", "dismount"],
    companionPolicies: {
      ride: { fixedThroughOrdinal: 7, beforeRows: 0, afterRows: 0 },
      dismount: { fixedThroughOrdinal: 4, beforeRows: 2, afterRows: 2 },
    },
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "focused-rides-dismount-fast": {
    ...common,
    companionTypes: ["ride", "dismount"],
    companionPolicies: {
      ride: { fixedThroughOrdinal: 7, beforeRows: 0, afterRows: 0 },
      dismount: { fixedThroughOrdinal: 4, beforeRows: 2, afterRows: 2 },
    },
    rowBeamWidth: 32,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coarseCandidateLimit: 5,
    coarseDashStates: 12,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "focused-rides-dismount-wide-screen": {
    ...common,
    companionTypes: ["ride", "dismount"],
    companionPolicies: {
      ride: { fixedThroughOrdinal: 7, beforeRows: 0, afterRows: 0 },
      dismount: { fixedThroughOrdinal: 4, beforeRows: 12, afterRows: 12 },
    },
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "focused-rides-dismount-joint-wide-screen": {
    ...common,
    companionTypes: ["ride", "dismount"],
    companionPolicies: {
      ride: { fixedThroughOrdinal: 4, beforeRows: 4, afterRows: 4 },
      dismount: { fixedThroughOrdinal: 4, beforeRows: 12, afterRows: 12 },
    },
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "focused-orange-rides-dismount-screen": {
    ...common,
    preserveCompanionLineageTypes: ["orange"],
    companionTypes: ["orange", "ride", "dismount"],
    companionPolicies: {
      orange: { fixedThroughOrdinal: 2, beforeRows: 2, afterRows: 2 },
      ride: { fixedThroughOrdinal: 4, beforeRows: 2, afterRows: 2 },
      dismount: { fixedThroughOrdinal: 4, beforeRows: 6, afterRows: 6 },
    },
    rowBeamWidth: 32,
    boundaryBeamWidth: 32,
    coreFinalistCount: 32,
    coarseCandidateLimit: 8,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "focused-orange-rides-dismount-fast": {
    ...common,
    preserveCompanionLineageTypes: ["orange"],
    companionTypes: ["orange", "ride", "dismount"],
    companionPolicies: {
      orange: { fixedThroughOrdinal: 2, beforeRows: 2, afterRows: 2 },
      ride: { fixedThroughOrdinal: 4, beforeRows: 2, afterRows: 2 },
      dismount: { fixedThroughOrdinal: 4, beforeRows: 6, afterRows: 6 },
    },
    rowBeamWidth: 32,
    boundaryBeamWidth: 32,
    coreFinalistCount: 32,
    coarseCandidateLimit: 8,
    coarseDashStates: 12,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "target-anchor-rides-dismount-screen": {
    ...common,
    rowBeamWidth: 24,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "target-anchor-rides-dismount-fast": {
    ...common,
    rowBeamWidth: 32,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coarseCandidateLimit: 5,
    coarseDashStates: 12,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
  "target-anchor-orange-rides-dismount-screen": {
    ...common,
    preserveCompanionLineageTypes: ["orange"],
    rowBeamWidth: 32,
    boundaryBeamWidth: 32,
    coreFinalistCount: 32,
    coarseCandidateLimit: 8,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
  },
};
if (!profiles[profileName]) {
  throw new Error(
    "未知锚点协调档位",
  );
}

let singleTemplateDiagnostics = null;
if (pairProfile) {
  if (!singleResultPath) {
    throw new Error("pair-screen需要第5个参数指定单锚点协调结果JSON");
  }
  const singleResult = JSON.parse(fs.readFileSync(singleResultPath, "utf8"));
  singleTemplateDiagnostics =
    singleResult.search?.axisOptimization?.coordination?.templateDiagnostics ??
    singleResult.coordination?.templateDiagnostics ??
    null;
  if (!Array.isArray(singleTemplateDiagnostics)) {
    throw new Error("单锚点协调结果中缺少templateDiagnostics");
  }
}

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const seedReplay = replayWhitepaperLianying(runtime, seedPacks, { durationSeconds });
const targetedAnchors = targetedProfile
  ? identifyLianyingThunderSegments(stripLianyingDashPacks(seedPacks)).anchors
  : null;
if (
  targetedProfile &&
  (targetedAnchorNumber < 2 || targetedAnchorNumber >= targetedAnchors.length)
) {
  throw new Error("指定雷序号必须是非首尾雷");
}
const targetedAnchorTemplates = targetedProfile
  ? [
      {
        templateId: "incumbent",
        anchorRows: targetedAnchors,
        shiftedAnchors: [],
      },
      ...Array.from(
        { length: targetedAnchorSlackRows * 2 },
        (_, index) => index < targetedAnchorSlackRows
          ? index - targetedAnchorSlackRows
          : index - targetedAnchorSlackRows + 1,
      ).flatMap((delta) => {
        const anchorIndex = targetedAnchorNumber - 1;
        const anchorRows = [...targetedAnchors];
        anchorRows[anchorIndex] += delta;
        if (
          anchorRows[anchorIndex] <= anchorRows[anchorIndex - 1] ||
          anchorRows[anchorIndex] >= anchorRows[anchorIndex + 1]
        ) return [];
        return [{
          templateId: `target-${targetedAnchorNumber}:${delta > 0 ? "+" : ""}${delta}`,
          anchorRows,
          shiftedAnchors: [{
            anchorNumber: targetedAnchorNumber,
            fromRow: targetedAnchors[anchorIndex] + 1,
            toRow: anchorRows[anchorIndex] + 1,
            deltaRows: delta,
          }],
        }];
      }),
    ]
  : null;
const targetedCompanionAnchorTemplate = targetedProfile
  ? buildLianyingFocusedCompanionAnchorTemplate(seedPacks, {
      companionTypes: profileName.includes("-orange-")
        ? ["orange", "ride", "dismount"]
        : ["ride", "dismount"],
      companionPolicies: {
        ...(profileName.includes("-orange-")
          ? {
              orange: {
                fixedThroughOrdinal: 2,
                beforeRows: 2,
                afterRows: 2,
              },
            }
          : {}),
        ride: {
          fixedThroughOrdinal: 4,
          beforeRows: targetedRideSlackRows,
          afterRows: targetedRideSlackRows,
        },
        dismount: {
          fixedThroughOrdinal: 4,
          beforeRows: targetedDismountSlackRows,
          afterRows: targetedDismountSlackRows,
        },
      },
    })
  : null;
const targetedWarmAxes = targetedProfile
  ? targetedAnchorTemplates.slice(1).flatMap((template) => {
      const source = stripLianyingDashPacks(seedPacks);
      const anchorIndex = targetedAnchorNumber - 1;
      const sourceRow = targetedAnchors[anchorIndex];
      const targetRow = template.anchorRows[anchorIndex];
      const candidate = structuredClone(source);
      for (const location of ["prefix", "tail"]) {
        candidate[sourceRow][location] = (candidate[sourceRow][location] ?? [])
          .filter((action) =>
            (typeof action === "string" ? action : action?.id) !== "thunder");
      }
      const primary = typeof candidate[targetRow].primary === "string"
        ? candidate[targetRow].primary
        : candidate[targetRow].primary?.id;
      if (primary === "ride") {
        candidate[targetRow].tail = [
          { id: "thunder", leadFrames: 1 },
          ...(candidate[targetRow].tail ?? []),
        ];
      } else {
        candidate[targetRow].prefix = [
          "thunder",
          ...(candidate[targetRow].prefix ?? []),
        ];
      }
      try {
        replayWhitepaperLianying(runtime, candidate, { durationSeconds });
        return [candidate];
      } catch {
        return [];
      }
    })
  : [];
const optimizeOptions = {
    durationSeconds,
    ...profiles[profileName],
    ...(pairProfile && pairTemplateLimit !== null
      ? { maximumPairTemplates: pairTemplateLimit }
      : {}),
    ...(pairProfile && companionSlackOverride !== null
      ? { companionAnchorSlackRows: companionSlackOverride }
      : {}),
    ...(pairProfile && pairTemplateIds
      ? { pairTemplateIds }
      : {}),
    ...(focusedFixedThroughOrdinal !== null
      ? { fixedThroughOrdinal: focusedFixedThroughOrdinal }
      : {}),
    ...(focusedBeforeRows !== null ? { beforeRows: focusedBeforeRows } : {}),
    ...(focusedAfterRows !== null ? { afterRows: focusedAfterRows } : {}),
    ...(focusedMaximumPasses !== null
      ? { maximumFocusedPasses: focusedMaximumPasses }
      : {}),
    ...(targetedProfile
      ? {
          anchorTemplates: targetedAnchorTemplates,
          companionAnchorTemplate: targetedCompanionAnchorTemplate,
          additionalWarmAxes: targetedWarmAxes,
        }
      : {}),
    includeScheduleCandidatePacks: pairProfile || focusedProfile || targetedProfile,
    onProgress: (event) => {
      console.log(JSON.stringify({ phase: "anchor-coordination", ...event }));
    },
  };
const optimized = pairProfile
  ? optimizeLianyingRankedPairAnchorCoordination(
      runtime,
      seedPacks,
      singleTemplateDiagnostics,
      optimizeOptions,
    )
  : focusedProfile
    ? profileName.includes("iterative")
      ? optimizeLianyingIterativeFocusedCompanionAnchorCoordination(
          runtime,
          seedPacks,
          optimizeOptions,
        )
      : optimizeLianyingFocusedCompanionAnchorCoordination(
        runtime,
        seedPacks,
        optimizeOptions,
      )
  : targetedProfile
    ? optimizeLianyingHierarchicalAnchorCoordination(
        runtime,
        seedPacks,
        optimizeOptions,
      )
  : optimizeLianyingHierarchicalAnchorCoordination(
      runtime,
      seedPacks,
      optimizeOptions,
    );
const finalPacks = optimized.accepted ? optimized.packs : seedPacks;
const finalState = optimized.accepted ? optimized.state : seedReplay.state;
const searchResult = {
  durationSeconds,
  mode: source.mode ?? "fixed",
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
    kind: "hierarchical-anchor-coordination",
    profile: profileName,
    singleResultPath: singleResultPath
      ? path.relative(projectRoot, singleResultPath)
      : null,
    accepted: optimized.accepted,
    seedPath: path.relative(projectRoot, inputPath),
    damageGain: optimized.damageGain,
    options: optimized.options,
    coordination: optimized.coordination,
    anchors: optimized.anchors,
    selectedAnchors: optimized.selectedAnchors,
    segments: optimized.segments,
    peakRowStates: optimized.peakRowStates,
    finalBoundaryStates: optimized.finalBoundaryStates,
    finalSchedules: optimized.finalSchedules,
    finalCompanionLineages: optimized.finalCompanionLineages,
    coreCandidates: optimized.coreCandidates,
    coreScheduleDiagnostics: optimized.coreScheduleDiagnostics,
    coreCompanionLineageDiagnostics: optimized.coreCompanionLineageDiagnostics,
    coreScheduleCandidates: optimized.coreScheduleCandidates,
    additionalWarmDiagnostics: optimized.additionalWarmDiagnostics,
    coarseCandidates: optimized.coarseCandidates,
    iteration: optimized.iteration ?? null,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode: source.mode ?? "fixed",
});
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[4] ?? path.join(
    parsed.dir,
    `${parsed.name}-anchor-coordinator-${profileName}`,
  ),
);
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`);
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
);
fs.writeFileSync(
  `${outputStem}-templates.csv`,
  `\uFEFF${lianyingAnchorCoordinationTemplatesToCsv(optimized)}\n`,
);
console.log(JSON.stringify({
  inputPath,
  outputStem,
  profileName,
  singleResultPath,
  accepted: optimized.accepted,
  seedRotationDamage: seedReplay.state.totalDamage,
  finalRotationDamage: finalState.totalDamage,
  damageGain: optimized.damageGain,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
  coordination: optimized.coordination,
  explored: optimized.explored,
  legal: optimized.legal,
  finalSchedules: optimized.finalSchedules,
  finalCompanionLineages: optimized.finalCompanionLineages,
  coreCandidates: optimized.coreCandidates,
  coreScheduleDiagnostics: optimized.coreScheduleDiagnostics,
  coreCompanionLineageDiagnostics: optimized.coreCompanionLineageDiagnostics,
  additionalWarmDiagnostics: optimized.additionalWarmDiagnostics,
  coarseCandidates: optimized.coarseCandidates,
  iteration: optimized.iteration ?? null,
}, null, 2));
