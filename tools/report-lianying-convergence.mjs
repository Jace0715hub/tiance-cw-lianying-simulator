import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  optimizeLianyingAxis,
  searchLianyingAxis,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import {
  compareLianyingAxes,
  lianyingConvergenceToCsv,
} from "../src/reports/lianying-convergence.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const beamWidths = String(process.argv[2] ?? "16,32,64")
  .split(",")
  .map(Number);
const durationSeconds = Number(process.argv[3] ?? 180);
const horizonMode = process.argv[4] ?? "fixed";
const outputDirectory = path.resolve(
  process.argv[5] ?? path.join(projectRoot, "output"),
);

if (
  beamWidths.length === 0 ||
  beamWidths.some((width) => !Number.isInteger(width) || width <= 0)
) {
  throw new Error("束宽列表必须是逗号分隔的正整数，例如16,32,64");
}
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  throw new Error("战斗时长必须为正数");
}
if (!["fixed", "stable"].includes(horizonMode)) {
  throw new Error("时长模式必须是fixed或stable");
}

const uniqueBeamWidths = [...new Set(beamWidths)].sort((left, right) => left - right);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const strictStarted = performance.now();
const strict = searchWhitepaperLianying(runtime, {
  durationSeconds,
  mode: horizonMode,
  beamWidth: 48,
});
const strictElapsedMs = performance.now() - strictStarted;
const baselineDamage = strict.state.totalDamage;
const baselineDps = baselineDamage / durationSeconds;
const runs = [];
const searches = [];

for (const beamWidth of uniqueBeamWidths) {
  const started = performance.now();
  const beamSearch = searchLianyingAxis(runtime, {
    durationSeconds,
    mode: horizonMode,
    policyMode: "free",
    beamWidth,
    warmStartPacks: strict.packs,
  });
  const axisOptimization = optimizeLianyingAxis(
    runtime,
    beamSearch.packs,
    {
      durationSeconds,
      maxRounds: 1,
      neighborhood: durationSeconds > 180
        ? {
            maxPasses: 8,
            localLookaheadRows: 8,
            fullEvaluationLimit: 32,
          }
        : {
            maxPasses: 6,
            maxSwapDistance: 8,
            maxRotationLength: 6,
            localLookaheadRows: [8, 16, 32],
            shortlistPerHorizon: 32,
            shortlistPerKind: 4,
            fullEvaluationLimit: 128,
          },
    },
  );
  const search = axisOptimization.damageGain > 0
    ? {
        ...beamSearch,
        packs: axisOptimization.packs,
        state: axisOptimization.state,
        axisOptimization: {
          damageGain: axisOptimization.damageGain,
          phases: axisOptimization.phases,
        },
      }
    : beamSearch;
  const elapsedMs = performance.now() - started;
  const artifact = buildWhitepaperAxisArtifact(search, runtime, {
    durationSeconds,
    mode: horizonMode,
  });
  const comparison = compareLianyingAxes(strict.packs, search.packs, {
    candidateRows: artifact.rows,
  });
  const telemetry = search.telemetry;
  const run = {
    beamWidth,
    elapsedMs,
    rotationDamage: search.state.totalDamage,
    rotationDps: search.state.totalDamage / durationSeconds,
    gainDamage: search.state.totalDamage - baselineDamage,
    gainDps: (search.state.totalDamage - baselineDamage) / durationSeconds,
    exploredTransitions: search.explored,
    legalTransitions: search.legal,
    exactStateCollisions: telemetry.exactStateCollisions,
    exactStateReplacements: telemetry.exactStateReplacements,
    exactStateDominated: telemetry.exactStateDominated,
    beamPruned: telemetry.beamPruned,
    peakUniqueCandidates: telemetry.peakUniqueCandidates,
    peakBeamSize: telemetry.peakBeamSize,
    illegalReasons: telemetry.illegalReasons,
    firstDivergenceRow: comparison.firstDivergenceRow,
    firstDivergenceSeconds: comparison.firstDivergenceSeconds,
    differingRowCount: comparison.differingRowCount,
    actionCountDelta: comparison.actionCountDelta,
    mechanicsPassed: artifact.audit.mechanics.passed,
    resourceWaste: artifact.audit.resourceWaste,
    strategyDeviationCount:
      artifact.audit.whitepaperStrategy.deviationCount,
    strategyDeviations: artifact.audit.whitepaperStrategy.deviations,
    axisOptimization: search.axisOptimization ?? null,
    layers: telemetry.layers,
  };
  runs.push(run);
  searches.push({ search, artifact, run });
  console.log(JSON.stringify({
    beamWidth,
    elapsedMs: Math.round(elapsedMs),
    rotationDps: run.rotationDps,
    gainDps: run.gainDps,
    exploredTransitions: run.exploredTransitions,
    firstDivergenceSeconds: run.firstDivergenceSeconds,
    mechanicsPassed: run.mechanicsPassed,
  }));
}

const best = [...searches].sort(
  (left, right) =>
    right.search.state.totalDamage - left.search.state.totalDamage ||
    left.search.beamWidth - right.search.beamWidth,
)[0];
const report = {
  schemaVersion: 1,
  kind: "tiance-cw-lianying-beam-convergence",
  policyMode: "free",
  horizonMode,
  durationSeconds,
  strictBaseline: {
    beamWidth: strict.beamWidth,
    elapsedMs: strictElapsedMs,
    rows: strict.packs.length,
    rotationDamage: baselineDamage,
    rotationDps: baselineDps,
  },
  runs,
  best: {
    beamWidth: best.run.beamWidth,
    rotationDamage: best.run.rotationDamage,
    rotationDps: best.run.rotationDps,
    gainDamage: best.run.gainDamage,
    gainDps: best.run.gainDps,
    firstDivergenceRow: best.run.firstDivergenceRow,
    firstDivergenceSeconds: best.run.firstDivergenceSeconds,
    actionCountDelta: best.run.actionCountDelta,
  },
};

const stem = `lianying-free-${horizonMode}-${durationSeconds}s-convergence`;
const bestStem = `lianying-free-${horizonMode}-${durationSeconds}s-best`;
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(
  path.join(outputDirectory, `${stem}.json`),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDirectory, `${stem}.csv`),
  `\uFEFF${lianyingConvergenceToCsv(report)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDirectory, `${bestStem}.json`),
  `${JSON.stringify(best.artifact, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDirectory, `${bestStem}.csv`),
  `\uFEFF${whitepaperAxisToCsv(best.artifact)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDirectory, `${bestStem}-equipment.csv`),
  `\uFEFF${whitepaperEquipmentToCsv(best.artifact)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  outputDirectory,
  reportStem: stem,
  bestAxisStem: bestStem,
  strictRotationDps: baselineDps,
  best: report.best,
}, null, 2));
