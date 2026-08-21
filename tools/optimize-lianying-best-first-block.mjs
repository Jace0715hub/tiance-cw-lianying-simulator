import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  searchLianyingBoundedLocalBlock,
} from "../src/policies/lianying-best-first-resynthesis.js";
import { moveLianyingThunderAnchor } from "../src/policies/lianying-segment-skeletons.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-best-first-block.json",
);
const profileName = process.argv[4] ?? "probe";
const startRow = Number(process.argv[5] ?? 107);
const endRow = Number(process.argv[6] ?? 128);
const targetAnchorOrdinal = process.argv[7] === undefined
  ? null
  : Number(process.argv[7]);
const targetAnchorRow = process.argv[8] === undefined
  ? null
  : Number(process.argv[8]);
if ((targetAnchorOrdinal === null) !== (targetAnchorRow === null)) {
  throw new Error("雷锚点变换必须同时提供序号与目标行");
}
const profiles = {
  probe: {
    beamWidth: 24,
    queueLimit: 4096,
    candidateLimit: 24,
    dashCandidateCount: 2,
    dashStates: 128,
    wallClockMs: 300000,
  },
  screen: {
    beamWidth: 48,
    queueLimit: 8192,
    candidateLimit: 48,
    dashCandidateCount: 4,
    dashStates: 256,
    wallClockMs: 600000,
  },
};
if (!profiles[profileName]) throw new Error("未知最佳优先局部块搜索档位");

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const formalPacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!formalPacks) throw new Error("输入文件缺少可恢复的技能轴");
const sourcePacks = targetAnchorOrdinal === null
  ? formalPacks
  : moveLianyingThunderAnchor(
      formalPacks,
      targetAnchorOrdinal,
      targetAnchorRow,
    );
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const formalReplay = replayWhitepaperLianying(runtime, formalPacks, {
  durationSeconds,
});
const sourceReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const profile = profiles[profileName];
const common = {
  durationSeconds,
  startRow,
  endRow,
  beamWidth: profile.beamWidth,
  targetAnchorOrdinal,
  targetAnchorRow,
  sourceRotationDamage: sourceReplay.state.totalDamage,
  sourceDamageLossFromFormal:
    formalReplay.state.totalDamage - sourceReplay.state.totalDamage,
  queueLimit: profile.queueLimit,
  candidateLimit: profile.candidateLimit,
  wallClockMs: profile.wallClockMs,
};

process.stdout.write(`${JSON.stringify({
  phase: "best-first-block-ab",
  stage: "beam-start",
  profileName,
  startRow,
  endRow,
  beamWidth: profile.beamWidth,
})}\n`);
const beam = searchLianyingBoundedLocalBlock(runtime, sourcePacks, {
  ...common,
  strategy: "beam",
});
process.stdout.write(`${JSON.stringify({
  phase: "best-first-block-ab",
  stage: "beam-complete",
  expandedNodes: beam.expandedNodes,
  exploredTransitions: beam.exploredTransitions,
  legalTransitions: beam.legalTransitions,
  completeCandidateCount: beam.completeCandidateCount,
})}\n`);

process.stdout.write(`${JSON.stringify({
  phase: "best-first-block-ab",
  stage: "best-first-start",
  expansionBudget: beam.expandedNodes,
  queueLimit: profile.queueLimit,
})}\n`);
const bestFirst = searchLianyingBoundedLocalBlock(runtime, sourcePacks, {
  ...common,
  strategy: "best-first",
  expansionBudget: beam.expandedNodes,
});
process.stdout.write(`${JSON.stringify({
  phase: "best-first-block-ab",
  stage: "best-first-complete",
  expandedNodes: bestFirst.expandedNodes,
  exploredTransitions: bestFirst.exploredTransitions,
  legalTransitions: bestFirst.legalTransitions,
  completeCandidateCount: bestFirst.completeCandidateCount,
  peakFrontier: bestFirst.peakFrontier,
  trimmedNodes: bestFirst.trimmedNodes,
  warmRestarts: bestFirst.warmRestarts,
})}\n`);

const pathKey = (packs) => JSON.stringify(packs);
const primaryId = (pack) => typeof pack?.primary === "string"
  ? pack.primary
  : pack?.primary?.id;
const baselinePaths = new Set(beam.candidates.map((candidate) =>
  pathKey(candidate.packs)));
const summarizeCandidate = (candidate) => ({
  coreDamage: candidate.coreDamage,
  coreDamageGain: candidate.coreDamage - beam.baselineDamage,
  coreDamageLossRatio:
    (beam.baselineDamage - candidate.coreDamage) / beam.baselineDamage,
  isIncumbent: candidate.isIncumbent,
  differingRows: candidate.packs.flatMap((pack, index) =>
    primaryId(pack) === primaryId(sourcePacks[index]) ? [] : [index + 1]),
});
const buildRun = (kind, result) => {
  const alternatives = result.candidates.filter((candidate) =>
    !candidate.isIncumbent);
  const newCandidates = kind === "best-first"
    ? alternatives.filter((candidate) => !baselinePaths.has(pathKey(candidate.packs)))
    : [];
  return {
    kind,
    expandedNodes: result.expandedNodes,
    exploredTransitions: result.exploredTransitions,
    legalTransitions: result.legalTransitions,
    staleNodes: result.staleNodes,
    trimmedNodes: result.trimmedNodes,
    warmRestarts: result.warmRestarts,
    peakFrontier: result.peakFrontier,
    stoppedByWallClock: result.stoppedByWallClock,
    completeCandidateCount: result.completeCandidateCount,
    retainedCandidateCount: result.candidates.length,
    alternativeCount: alternatives.length,
    newCandidateCount: newCandidates.length,
    bestCoreCandidate: alternatives[0]
      ? summarizeCandidate(alternatives[0])
      : null,
    bestNewCoreCandidate: newCandidates[0]
      ? summarizeCandidate(newCandidates[0])
      : null,
    alternatives,
    newCandidates,
  };
};
const runs = [buildRun("beam", beam), buildRun("best-first", bestFirst)];

for (const run of runs) {
  const prioritized = run.kind === "best-first"
    ? [
        run.alternatives[0],
        run.newCandidates[0],
        ...run.newCandidates,
        ...run.alternatives,
      ]
    : run.alternatives;
  const selected = [...new Map(prioritized.filter(Boolean).map((candidate) =>
    [pathKey(candidate.packs), candidate])).values()]
    .slice(0, profile.dashCandidateCount);
  for (const [index, candidate] of selected.entries()) {
    process.stdout.write(`${JSON.stringify({
      phase: "best-first-block-ab",
      stage: "dash-start",
      kind: run.kind,
      candidate: index + 1,
      candidateCount: selected.length,
    })}\n`);
    const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
      durationSeconds,
      maxStatesPerRow: profile.dashStates,
    });
    const audit = auditWhitepaperAxis(dash.state, { mode: "fixed" });
    const isNewCandidate = run.kind === "best-first" &&
      !baselinePaths.has(pathKey(candidate.packs));
    if (
      run.bestRotationDamage === undefined ||
      dash.state.totalDamage > run.bestRotationDamage
    ) {
      run.bestRotationDamage = dash.state.totalDamage;
      run.bestRotationDamageGain = dash.state.totalDamage -
        formalReplay.state.totalDamage;
      run.bestRotationDamageGainFromSource = dash.state.totalDamage -
        sourceReplay.state.totalDamage;
      run.bestRotationDamageLossRatio =
        (formalReplay.state.totalDamage - dash.state.totalDamage) /
        formalReplay.state.totalDamage;
      run.bestMechanicsPassed = audit.mechanics.passed;
      run.bestMechanicsViolationCount = audit.mechanics.violationCount;
      run.bestActionPacks = dash.packs;
    }
    if (
      isNewCandidate &&
      (
        run.bestNewRotationDamage === undefined ||
        dash.state.totalDamage > run.bestNewRotationDamage
      )
    ) {
      run.bestNewRotationDamage = dash.state.totalDamage;
      run.bestNewRotationDamageGain = dash.state.totalDamage -
        formalReplay.state.totalDamage;
      run.bestNewRotationDamageGainFromSource = dash.state.totalDamage -
        sourceReplay.state.totalDamage;
      run.bestNewRotationDamageLossRatio =
        (formalReplay.state.totalDamage - dash.state.totalDamage) /
        formalReplay.state.totalDamage;
      run.bestNewMechanicsPassed = audit.mechanics.passed;
      run.bestNewMechanicsViolationCount = audit.mechanics.violationCount;
      run.bestNewActionPacks = dash.packs;
    }
  }
}

const serializableRun = (run) => Object.fromEntries(Object.entries(run)
  .filter(([key]) => ![
    "alternatives",
    "newCandidates",
    "bestActionPacks",
    "bestNewActionPacks",
  ].includes(key)));
const experiment = runs[1];
const acceptedExperiment = Number(experiment.bestRotationDamage ?? -Infinity) >
  sourceReplay.state.totalDamage;
const promotedExperiment = Number(experiment.bestRotationDamage ?? -Infinity) >
  formalReplay.state.totalDamage;
const report = {
  schemaVersion: 1,
  kind: "lianying-bounded-best-first-block-ab",
  inputPath,
  durationSeconds,
  profileName,
  startRow,
  endRow,
  sourceTransform: targetAnchorOrdinal === null
    ? null
    : { targetAnchorOrdinal, targetAnchorRow },
  formalRotationDamage: formalReplay.state.totalDamage,
  sourceRotationDamage: sourceReplay.state.totalDamage,
  sourceDamageLossFromFormal:
    formalReplay.state.totalDamage - sourceReplay.state.totalDamage,
  equalExpansionBudget: beam.expandedNodes,
  runs: runs.map(serializableRun),
  acceptedExperiment,
  promotedExperiment,
  bestExperimentActionPacks:
    experiment.bestNewActionPacks ?? experiment.bestActionPacks ?? null,
  actionPacks: acceptedExperiment
    ? experiment.bestActionPacks
    : sourcePacks,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  formalRotationDamage: report.formalRotationDamage,
  sourceRotationDamage: report.sourceRotationDamage,
  equalExpansionBudget: report.equalExpansionBudget,
  runs: report.runs,
  acceptedExperiment,
  promotedExperiment,
}, null, 2)}\n`);
