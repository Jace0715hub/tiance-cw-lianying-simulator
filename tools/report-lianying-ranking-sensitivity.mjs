import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  LIANYING_CURRENT_BEST_AXIS,
  LIANYING_DEFAULT_VALUE_TRAINING_SEEDS,
} from
  "../src/config/lianying-research-defaults.js";
import { createInitialState } from "../src/engine/state.js";
import { applyExpectedEquipmentDamage } from "../src/effects/expected-equipment.js";
import { replayProfileRows } from "../src/policies/profile-replay.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import { buildBaselineAlignment } from "../src/reports/baseline-alignment.js";
import {
  analyzeLianyingDivineStackBoundary,
  analyzeLianyingFormulaUncertainty,
  analyzeLianyingOrangeHitBoundary,
  buildLianyingExcelSkillCalibration,
  compareLianyingRankingSensitivity,
} from "../src/reports/lianying-ranking-sensitivity.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixture = JSON.parse(fs.readFileSync(path.join(
  projectRoot,
  "data/excel-v1.3-profile-reference.json",
), "utf8"));
const persistedReportPath = path.join(
  projectRoot,
  "output/lianying-ranking-sensitivity.json",
);
const persistedCandidateSpec = (id, temporarySpec) =>
  fs.existsSync(persistedReportPath)
    ? `${persistedReportPath}#candidate:${id}`
    : temporarySpec;
const defaultSpecs = [
  `formal=${path.join(projectRoot, LIANYING_CURRENT_BEST_AXIS)}`,
  `previousTiming=${path.join(projectRoot, "output/lianying-free-fixed-180s-pair-anchor-wait.json")}`,
  `heterogeneous=${persistedCandidateSpec(
    "heterogeneous",
    "/tmp/lianying-m79-early-structural-bridge-candidate.json",
  )}`,
  `thunder106=${persistedCandidateSpec(
    "thunder106",
    "/tmp/lianying-m62-lineage-fixed-bridge-screen-candidate.json",
  )}`,
  `qualityTerminal=${persistedCandidateSpec(
    "qualityTerminal",
    "/tmp/lianying-m96-quality-diversity-restart-screen.json#core:2",
  )}`,
];
const outputStem = path.resolve(
  process.argv[2] ?? path.join(projectRoot, "output/lianying-ranking-sensitivity"),
);
const specs = process.argv.slice(3).length > 0
  ? process.argv.slice(3)
  : defaultSpecs;

function parseSpec(spec) {
  const separator = spec.indexOf("=");
  if (separator <= 0) {
    throw new Error(
      `候选参数必须是id=JSON路径[#core:序号|#candidate:id]: ${spec}`,
    );
  }
  const id = spec.slice(0, separator);
  const source = spec.slice(separator + 1);
  const coreMatch = source.match(/^(.*)#core:(\d+)$/u);
  const candidateMatch = source.match(/^(.*)#candidate:([^#]+)$/u);
  return {
    id,
    sourcePath: path.resolve(coreMatch?.[1] ?? candidateMatch?.[1] ?? source),
    coreIndex: coreMatch ? Number(coreMatch[2]) : null,
    candidateId: candidateMatch?.[2] ?? null,
  };
}

function loadPacks(parsed, runtime, durationSeconds) {
  if (!fs.existsSync(parsed.sourcePath)) {
    throw new Error(`候选文件不存在: ${parsed.sourcePath}`);
  }
  const artifact = JSON.parse(fs.readFileSync(parsed.sourcePath, "utf8"));
  if (parsed.candidateId !== null) {
    const candidate = artifact.candidates?.find(
      (entry) => entry.id === parsed.candidateId,
    );
    if (!candidate?.actionPacks) {
      throw new Error(
        `${parsed.sourcePath}缺少候选${parsed.candidateId}的动作包`,
      );
    }
    return candidate.actionPacks;
  }
  if (parsed.coreIndex !== null) {
    const core = artifact.search?.axisOptimization?.coreCandidatePacks?.[
      parsed.coreIndex
    ];
    if (!core?.packs) {
      throw new Error(`${parsed.sourcePath}缺少第${parsed.coreIndex}条核心候选`);
    }
    return optimizeLianyingDashOverlay(runtime, core.packs, {
      durationSeconds,
      maxStatesPerRow: 128,
    }).packs;
  }
  const packs = artifact.actionPacks ??
    (artifact.rows ? lianyingRowsToActionPacks(artifact.rows) : null);
  if (!packs) throw new Error(`${parsed.sourcePath}没有可恢复的动作包`);
  return packs;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

const durationSeconds = 180;
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const calibrationRuntime = loadDefaultGearRuntime({ rotation: "lianying" });
const calibrationReplay = replayProfileRows(
  createInitialState(calibrationRuntime.config, { rage: 5 }),
  fixture.profiles.lianying.rows,
  calibrationRuntime.config,
  calibrationRuntime.oracle,
  { combatEndSeconds: fixture.durationSeconds },
);
const calibrationState = applyExpectedEquipmentDamage(
  calibrationReplay.state,
  calibrationRuntime.expectedEquipmentEffects,
  calibrationRuntime.panel,
  calibrationRuntime.oracle,
  { durationSeconds: fixture.durationSeconds },
);
const alignment = buildBaselineAlignment(
  calibrationState,
  fixture.references.lianying,
);
const calibration = buildLianyingExcelSkillCalibration(alignment);

function replayCandidate(parsed) {
  const packs = loadPacks(parsed, runtime, durationSeconds);
  const replay = replayWhitepaperLianying(runtime, packs, { durationSeconds });
  const audit = auditWhitepaperAxis(replay.state, { mode: "fixed" });
  if (!audit.mechanics.passed) {
    throw new Error(`${parsed.id}存在${audit.mechanics.violationCount}项机制违规`);
  }
  return {
    id: parsed.id,
    label: parsed.id,
    source: path.basename(parsed.sourcePath) + (
      parsed.coreIndex !== null
        ? `#core:${parsed.coreIndex}`
        : parsed.candidateId !== null
          ? `#candidate:${parsed.candidateId}`
          : ""
    ),
    packs,
    state: applyExpectedEquipmentDamage(
      replay.state,
      runtime.expectedEquipmentEffects,
      runtime.panel,
      runtime.oracle,
      { durationSeconds },
    ),
    audit: audit.mechanics,
  };
}

function summarizeUncertaintyBasis(basis) {
  return {
    baselineId: basis.baselineId,
    grids: basis.grids.map((grid) => ({
      id: grid.id,
      levels: grid.levels,
      scenarioCount: grid.scenarioCount,
      winnerCounts: grid.winnerCounts,
      continuousHyperrectangleCertified:
        grid.continuousHyperrectangleCertified,
      minimumBaselineMargin: grid.minimumBaselineMargin,
      worstScenario: grid.worstScenario,
    })),
  };
}

const candidates = specs.map(parseSpec).map(replayCandidate);

const comparison = compareLianyingRankingSensitivity(
  candidates,
  calibration,
  { openingDamageEventCount: 5 },
);
const divineStackBoundary = analyzeLianyingDivineStackBoundary(candidates);
const orangeHitBoundary = analyzeLianyingOrangeHitBoundary(candidates);
const historicalCandidates = LIANYING_DEFAULT_VALUE_TRAINING_SEEDS.map(
  (source, index) => replayCandidate({
    id: index === 0 ? "formal" : path.basename(source, ".json"),
    sourcePath: path.join(projectRoot, source),
    coreIndex: null,
    candidateId: null,
  }),
);
const historicalComparison = compareLianyingRankingSensitivity(
  historicalCandidates,
  calibration,
  { openingDamageEventCount: 5 },
);
const historicalUncertainty = analyzeLianyingFormulaUncertainty(
  historicalComparison.candidates,
);
const historicalSeedCoverage = {
  source: "LIANYING_DEFAULT_VALUE_TRAINING_SEEDS",
  candidateCount: historicalComparison.candidates.length,
  eventRanking: historicalComparison.eventRanking,
  calibratedRanking: historicalComparison.calibratedRanking,
  winnerStable: historicalComparison.winnerStable,
  candidates: historicalComparison.candidates.map((candidate) => ({
    id: candidate.id,
    source: historicalCandidates.find(
      (entry) => entry.id === candidate.id,
    )?.source ?? null,
    eventDamageDelta: candidate.eventDamageDelta,
    calibratedDamageDelta: candidate.calibratedDamageDelta,
  })),
  formulaUncertainty: {
    native: summarizeUncertaintyBasis(historicalUncertainty.native),
    excelCalibrated: summarizeUncertaintyBasis(
      historicalUncertainty.excelCalibrated,
    ),
  },
};
for (const candidate of comparison.candidates) {
  candidate.actionPacks = candidates.find(
    (sourceCandidate) => sourceCandidate.id === candidate.id,
  ).packs;
}
const formulaUncertainty = analyzeLianyingFormulaUncertainty(
  comparison.candidates,
);
const report = {
  schemaVersion: 5,
  kind: "lianying-ranking-sensitivity",
  durationSeconds,
  calibration: {
    source: "data/excel-v1.3-profile-reference.json#references.lianying",
    method: "按离线连营基准的Excel/事件模型技能总伤害比缩放候选同技能伤害",
    baselineDamageDelta: alignment.damageDelta,
    baselineDamageDeltaPercent: alignment.damageDeltaPercent,
    skills: calibration,
    limitations: [
      "这是排序敏感性边界，不是让Excel重新参与运行时模拟",
      "未出现在离线连营基准中的斩杀附伤、橙武附伤与突保持原生金标准权重",
      "神兵无双动态属性仍未直接重算；保守玩家命中边界已另证五条候选在4.870秒以前叠层状态完全一致，且后续不会掉层",
    ],
  },
  divineStackBoundary,
  orangeHitBoundary,
  historicalSeedCoverage,
  formulaUncertainty,
  ...comparison,
};

fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(report, null, 2)}\n`);
const headers = [
  "候选",
  "来源",
  "首个动作差异行",
  "开场前5伤害事件相同",
  "事件模型伤害",
  "事件模型相对正式轴",
  "Excel分项校准伤害",
  "校准后相对正式轴",
  "校准修正量",
];
const csvRows = report.candidates.map((candidate) => [
  candidate.id,
  candidate.source,
  candidate.firstDifferenceRow,
  candidate.openingDamageEventsIdentical,
  candidate.eventDamage,
  candidate.eventDamageDelta,
  candidate.calibratedDamage,
  candidate.calibratedDamageDelta,
  candidate.calibrationCorrection,
]);
fs.writeFileSync(
  `${outputStem}.csv`,
  `\uFEFF${[headers, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
);
console.log(JSON.stringify({
  outputStem,
  rankingStable: report.rankingStable,
  winnerStable: report.winnerStable,
  openingBoundaryEquivalent: report.openingBoundaryEquivalent,
  eventRanking: report.eventRanking,
  calibratedRanking: report.calibratedRanking,
  divineStackBoundary: {
    openingPlayerHitStateEquivalent:
      report.divineStackBoundary.openingPlayerHitStateEquivalent,
    allReachAndKeepFullStacks:
      report.divineStackBoundary.allReachAndKeepFullStacks,
    candidateSpecificStackPathRisk:
      report.divineStackBoundary.candidateSpecificStackPathRisk,
    candidates: report.divineStackBoundary.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      fullStacksAtMs: candidate.fullStacksAtMs,
      maxGapAfterFullMs: candidate.maxGapAfterFullMs,
    })),
  },
  orangeHitBoundary: {
    candidateBoundariesEquivalent:
      report.orangeHitBoundary.candidateBoundariesEquivalent,
    globalSafeHitDelayExclusiveMs:
      report.orangeHitBoundary.globalSafeHitDelayExclusiveMs,
    currentAxisAtRiskUnderRepresentativeDelays:
      report.orangeHitBoundary.currentAxisAtRiskUnderRepresentativeDelays,
    candidates: report.orangeHitBoundary.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      safeHitDelayExclusiveMs: candidate.safeHitDelayExclusiveMs,
      windowMarginsMs: candidate.windows.map(
        (window) => window.lastCastMarginMs,
      ),
    })),
  },
  historicalSeedCoverage: {
    candidateCount: report.historicalSeedCoverage.candidateCount,
    eventRanking: report.historicalSeedCoverage.eventRanking,
    calibratedRanking: report.historicalSeedCoverage.calibratedRanking,
    nativeStress: report.historicalSeedCoverage.formulaUncertainty.native.grids
      .find((grid) => grid.id === "stress-25-percent"),
    excelCalibratedStress:
      report.historicalSeedCoverage.formulaUncertainty.excelCalibrated.grids
        .find((grid) => grid.id === "stress-25-percent"),
  },
  formulaUncertainty: {
    native: report.formulaUncertainty.native.grids.map((grid) => ({
      id: grid.id,
      scenarioCount: grid.scenarioCount,
      baselineWinsAllScenarios: grid.baselineWinsAllScenarios,
      continuousHyperrectangleCertified:
        grid.continuousHyperrectangleCertified,
      minimumBaselineMargin: grid.minimumBaselineMargin,
      worstScenario: grid.worstScenario,
    })),
    excelCalibrated: report.formulaUncertainty.excelCalibrated.grids.map(
      (grid) => ({
        id: grid.id,
        scenarioCount: grid.scenarioCount,
        baselineWinsAllScenarios: grid.baselineWinsAllScenarios,
        continuousHyperrectangleCertified:
          grid.continuousHyperrectangleCertified,
        minimumBaselineMargin: grid.minimumBaselineMargin,
        worstScenario: grid.worstScenario,
      }),
    ),
  },
  candidates: report.candidates.map((candidate) => ({
    id: candidate.id,
    firstDifferenceRow: candidate.firstDifferenceRow,
    eventDamageDelta: candidate.eventDamageDelta,
    calibratedDamageDelta: candidate.calibratedDamageDelta,
  })),
}, null, 2));
