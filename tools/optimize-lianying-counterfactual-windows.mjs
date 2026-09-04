import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
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
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-counterfactual-windows.json",
);
const profileName = process.argv[4] ?? "probe";
const windowArgument = process.argv[5] ?? null;
const modeName = process.argv[6] ?? "both";
const companionSlackRows = Number(process.argv[7] ?? 0);

const profiles = {
  probe: {
    rowBeamWidth: 16,
    boundaryBeamWidth: 16,
    coreFinalistCount: 16,
    coreCandidatePackLimit: 16,
    structureQuota: 6,
    fullDashCandidateLimit: 2,
  },
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 32,
    coreFinalistCount: 32,
    coreCandidatePackLimit: 32,
    structureQuota: 8,
    fullDashCandidateLimit: 4,
  },
};
if (!profiles[profileName]) throw new Error("未知窗口反事实搜索档位");
if (!new Set(["sequence", "counts", "both"]).has(modeName)) {
  throw new Error("窗口反事实模式必须是sequence、counts或both");
}
if (!Number.isInteger(companionSlackRows) || companionSlackRows < 0) {
  throw new Error("伴随锚点松弛必须是非负整数");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const durationSeconds = Number(source.durationSeconds ?? 180);
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的技能轴");
const corePacks = stripLianyingDashPacks(sourcePacks);
const anchors = identifyLianyingThunderSegments(corePacks).anchors;
const companionAnchors = lianyingCompanionAnchorRows(corePacks);
const actionId = (action) => typeof action === "string" ? action : action?.id;
const resourceActionIds = ["destroy", "dragonRoar", "cloudStrike", "charge"];

function coupledBlock(window) {
  const thunderRows = anchors.map((row) => row + 1);
  const nextThunderIndex = thunderRows.findIndex(
    (row) => row > window.endRow,
  );
  if (nextThunderIndex <= 0) return null;
  return {
    startRow: thunderRows[nextThunderIndex - 1],
    endRow: thunderRows[Math.min(
      thunderRows.length - 1,
      nextThunderIndex + 1,
    )],
  };
}

function coupledCompanionTemplate(block) {
  if (!block || companionSlackRows === 0) return companionAnchors;
  return Object.fromEntries([
    ["rideRows", "rideWindows"],
    ["orangeRows", "orangeWindows"],
    ["dismountRows", "dismountWindows"],
  ].map(([rowsKey, windowsKey]) => [windowsKey, companionAnchors[rowsKey].map(
    (row) => {
      const slack = row >= block.startRow && row <= block.endRow
        ? companionSlackRows
        : 0;
      return {
        targetRow: row,
        earliestRow: row - slack,
        latestRow: row + slack,
      };
    },
  )]));
}

function unfixedRideRows(block) {
  if (!block || companionSlackRows === 0) return new Set();
  return new Set(companionAnchors.rideRows.flatMap((row) =>
    row >= block.startRow && row <= block.endRow
      ? Array.from(
          { length: companionSlackRows * 2 + 1 },
          (_, index) => row - companionSlackRows + index,
        )
      : []));
}

function defaultWindows() {
  return anchors.slice(1, -1).map((anchor) => ({
    startRow: Math.max(1, anchor - 5),
    endRow: anchor,
  }));
}

function parseWindows(value) {
  if (!value) return defaultWindows();
  return [...new Set(value.split(",").map((entry) => entry.trim()))].map(
    (entry) => {
      const match = entry.match(/^(\d+)-(\d+)$/u);
      if (!match) throw new Error(`窗口必须使用起始行-结束行格式: ${entry}`);
      return { startRow: Number(match[1]), endRow: Number(match[2]) };
    },
  );
}

const windows = parseWindows(windowArgument);
if (windows.some((window) =>
  !Number.isInteger(window.startRow) ||
  !Number.isInteger(window.endRow) ||
  window.startRow < 1 ||
  window.startRow > window.endRow ||
  window.endRow > corePacks.length)) {
  throw new Error("窗口必须位于技能轴范围内且起点不晚于终点");
}
const modes = modeName === "both" ? ["sequence", "counts"] : [modeName];
const experiments = windows.flatMap((window) => modes.map((mode) => ({
  ...window,
  mode,
})));

const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const baselineReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const results = [];
for (const [index, experiment] of experiments.entries()) {
  const block = coupledBlock(experiment);
  const unfixedPrimaryRows = unfixedRideRows(block);
  const constraint = {
    startRow: experiment.startRow,
    endRow: experiment.endRow,
    signatureMode: experiment.mode,
    ...(experiment.mode === "counts"
      ? { trackedActionIds: resourceActionIds }
      : {}),
  };
  process.stdout.write(`${JSON.stringify({
    phase: "counterfactual-window",
    stage: "start",
    experiment: index + 1,
    experimentCount: experiments.length,
    ...experiment,
  })}\n`);
  let optimized;
  try {
    optimized = optimizeLianyingAnchorDriftResynthesis(
      runtime,
      sourcePacks,
      {
        durationSeconds,
        anchorSlackRows: 0,
        fixFirstAnchor: true,
        fixLastAnchor: true,
        allowedAnchorSchedules: [anchors],
        rowBeamWidth: profiles[profileName].rowBeamWidth,
        boundaryBeamWidth: profiles[profileName].boundaryBeamWidth,
        coreFinalistCount: profiles[profileName].coreFinalistCount,
        coarseCandidateLimit: 2,
        coarseDashStates: 4,
        finalDashCandidateCount: 1,
        fullDashStates: 4,
        includeCoreCandidatePacks: true,
        coreCandidatePackLimit: profiles[profileName].coreCandidatePackLimit,
        companionAnchorTemplate: coupledCompanionTemplate(block),
        primaryActionConstraints: corePacks
          .slice(0, experiment.startRow - 1)
          .flatMap((pack, rowIndex) =>
            unfixedPrimaryRows.has(rowIndex + 1)
              ? []
              : [{
                  row: rowIndex + 1,
                  allowedActionIds: [actionId(pack.primary)],
                }]),
        primaryWindowConstraints: [constraint],
        primaryStructureDiversity: {
          startRow: experiment.startRow,
          endRow: experiment.endRow,
          rowBucketSize: 1,
          maximumDifferences: Math.min(
            6,
            experiment.endRow - experiment.startRow + 1,
          ),
          rowQuota: profiles[profileName].structureQuota,
          boundaryQuota: profiles[profileName].structureQuota,
        },
      },
    );
  } catch (error) {
    const result = {
      ...experiment,
      explored: 0,
      legal: 0,
      alternativeCount: 0,
      baselineCoreDamage: null,
      bestCoreDamage: null,
      coreDamageLoss: null,
      coreDamageLossRatio: null,
      firstPrimaryDifferenceRow: null,
      fixedPrimaryThroughRow: experiment.startRow - 1,
      companionSlackRows,
      coupledBlock: block,
      windowDifferingRows: [],
      bestPacks: null,
      failure: error instanceof Error ? error.message : String(error),
    };
    results.push(result);
    process.stdout.write(`${JSON.stringify({
      phase: "counterfactual-window",
      stage: "complete",
      ...Object.fromEntries(Object.entries(result).filter(
        ([key]) => key !== "bestPacks",
      )),
    })}\n`);
    continue;
  }
  const baseline = optimized.coreCandidatePacks.find(
    (candidate) => candidate.isIncumbent,
  );
  const alternatives = optimized.coreCandidatePacks.filter(
    (candidate) => !candidate.isIncumbent,
  );
  const best = alternatives[0] ?? null;
  const differingRows = best?.packs.flatMap((pack, rowIndex) =>
    actionId(pack.primary) === actionId(corePacks[rowIndex].primary)
      ? []
      : [rowIndex + 1]) ?? [];
  const result = {
    ...experiment,
    explored: optimized.explored,
    legal: optimized.legal,
    alternativeCount: alternatives.length,
    baselineCoreDamage: baseline?.coreDamage ?? null,
    bestCoreDamage: best?.coreDamage ?? null,
    coreDamageLoss: best && baseline
      ? baseline.coreDamage - best.coreDamage
      : null,
    coreDamageLossRatio: best && baseline
      ? (baseline.coreDamage - best.coreDamage) / baseline.coreDamage
      : null,
    firstPrimaryDifferenceRow: differingRows[0] ?? null,
    fixedPrimaryThroughRow: experiment.startRow - 1,
    companionSlackRows,
    coupledBlock: block,
    windowDifferingRows: differingRows.filter((row) =>
      row >= experiment.startRow && row <= experiment.endRow),
    bestPacks: best?.packs ?? null,
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify({
    phase: "counterfactual-window",
    stage: "complete",
    ...Object.fromEntries(Object.entries(result).filter(
      ([key]) => key !== "bestPacks",
    )),
  })}\n`);
}

const dashFinalists = results.filter((experiment) =>
  experiment.bestPacks && experiment.coreDamageLossRatio <= 0.01)
  .sort((left, right) => right.bestCoreDamage - left.bestCoreDamage)
  .slice(0, profiles[profileName].fullDashCandidateLimit);
for (const result of dashFinalists) {
  const dash = optimizeLianyingDashOverlay(runtime, result.bestPacks, {
    durationSeconds,
    maxStatesPerRow: 128,
  });
  const audit = auditWhitepaperAxis(dash.state, { mode: "fixed" });
  result.bestPacks = dash.packs;
  result.rotationDamage = dash.state.totalDamage;
  result.rotationDamageLoss = baselineReplay.state.totalDamage -
    dash.state.totalDamage;
  result.rotationDamageLossRatio = result.rotationDamageLoss /
    baselineReplay.state.totalDamage;
  result.dashCount = dash.dashCount;
  result.mechanicsPassed = audit.mechanics.passed;
  result.mechanicsViolationCount = audit.mechanics.violationCount;
}

const ranked = results
  .filter((experiment) => Number.isFinite(experiment.bestCoreDamage))
  .sort((left, right) =>
    Number(right.rotationDamage ?? right.bestCoreDamage) -
      Number(left.rotationDamage ?? left.bestCoreDamage));
const report = {
  schemaVersion: 1,
  kind: "lianying-counterfactual-primary-window-screen",
  inputPath,
  durationSeconds,
  profileName,
  modeName,
  companionSlackRows,
  windows,
  successGateMaximumCoreDamageLossRatio: 0.01,
  explored: results.reduce((sum, experiment) => sum + experiment.explored, 0),
  legal: results.reduce((sum, experiment) => sum + experiment.legal, 0),
  successfulExperimentCount: results.filter(
    (experiment) => Number.isFinite(experiment.coreDamageLossRatio) &&
      experiment.coreDamageLossRatio <= 0.01,
  ).length,
  fullDashCandidateCount: dashFinalists.length,
  bestExperiment: ranked[0] ?? null,
  actionPacks: ranked[0]?.bestPacks ?? null,
  experiments: results,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  explored: report.explored,
  legal: report.legal,
  successfulExperimentCount: report.successfulExperimentCount,
  bestExperiment: report.bestExperiment
    ? Object.fromEntries(Object.entries(report.bestExperiment).filter(
        ([key]) => key !== "bestPacks",
      ))
    : null,
}, null, 2)}\n`);
