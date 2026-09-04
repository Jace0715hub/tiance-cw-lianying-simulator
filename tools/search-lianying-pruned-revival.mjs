import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
  searchLianyingAxis,
} from "../src/policies/whitepaper-lianying.js";
import {
  spliceLianyingReferenceSuffix,
  stripLianyingDashPacks,
} from
  "../src/policies/lianying-segment-resynthesis.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";
import { executeActionPack } from "../src/engine/simulator.js";
import { createInitialState } from "../src/engine/state.js";
import { millisecondsToTicks } from "../src/engine/clock.js";
import { evaluateLianyingReferenceSuffixValue } from
  "../src/policies/lianying-multisegment-resynthesis.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-pruned-revival.json",
);
const archiveBeamWidth = Math.max(1, Math.floor(Number(process.argv[4] ?? 48)));
const requestedContinuationBeamWidth = Math.floor(Number(process.argv[5] ?? 4));
const directSuffixOnly = requestedContinuationBeamWidth === 0;
const continuationBeamWidth = directSuffixOnly
  ? 0
  : Math.max(1, requestedContinuationBeamWidth);
const archivePerRow = Math.max(1, Math.floor(Number(process.argv[6] ?? 1)));
const dashFinalists = Math.max(1, Math.floor(Number(process.argv[7] ?? 4)));
const requestedArchiveRows = process.argv[8]
  ? process.argv[8].split(",").map(Number)
  : null;
const archiveRanking = process.argv[9] ?? "damage";
const damageTolerance = 1e-6;
if (!["damage", "reference-suffix"].includes(archiveRanking)) {
  throw new Error("裁剪祖先排序必须是damage或reference-suffix");
}
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入文件缺少可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const corePacks = stripLianyingDashPacks(sourcePacks);
const actionId = (action) => typeof action === "string" ? action : action?.id;
const packHasAction = (pack, id) => [
  ...(pack?.prefix ?? []),
  pack?.primary,
  ...(pack?.tail ?? []),
].some((action) => actionId(action) === id);
const thunderRows = corePacks.flatMap((pack, index) =>
  packHasAction(pack, "thunder") ? [index + 1] : []);
const archiveRows = requestedArchiveRows ?? thunderRows.slice(1, -1);
const fixedPacksByDepth = new Map(corePacks.flatMap((pack, index) =>
  actionId(pack.primary) === "wait" ? [[index + 1, pack]] : []));
const baseline = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const endTick = millisecondsToTicks(durationSeconds * 1000);
let referenceState = createInitialState(runtime.config, {
  rage: 5,
  bleedStacks: 0,
  executePhase: true,
  ...runtime.initialStateOverrides,
});
const referenceStates = [referenceState];
for (const pack of corePacks) {
  referenceState = executeActionPack(
    referenceState,
    pack,
    runtime.config,
    runtime.oracle,
    { endTick },
  );
  referenceStates.push(referenceState);
}
const referenceCoreDamage = referenceState.totalDamage;
const averageRowDamage = referenceCoreDamage / corePacks.length;
const referenceSuffixScore = (node) => {
  const depth = node.packs.length;
  return evaluateLianyingReferenceSuffixValue(
    runtime,
    node.state,
    corePacks.slice(depth),
    referenceStates,
    depth,
    referenceCoreDamage,
    {
      endTick,
      averageRowDamage,
      repairPenaltyRows: 1,
    },
  ).score;
};
const archiveValueCache = new WeakMap();
const cachedReferenceSuffixValue = (node) => {
  if (!archiveValueCache.has(node)) {
    const depth = node.packs.length;
    archiveValueCache.set(node, evaluateLianyingReferenceSuffixValue(
      runtime,
      node.state,
      corePacks.slice(depth),
      referenceStates,
      depth,
      referenceCoreDamage,
      {
        endTick,
        averageRowDamage,
        repairPenaltyRows: 1,
      },
    ));
  }
  return archiveValueCache.get(node);
};
const cachedReferenceSuffixScore = (node) =>
  cachedReferenceSuffixValue(node).score;
const referenceSuffixArchiveRanker = (left, right) =>
  cachedReferenceSuffixScore(right) - cachedReferenceSuffixScore(left) ||
  right.state.totalDamage - left.state.totalDamage;

process.stdout.write(`${JSON.stringify({
  phase: "pruned-revival",
  stage: "archive-start",
  archiveBeamWidth,
  archiveRows,
  archivePerRow,
  archiveRanking,
  directSuffixOnly,
  fixedWaitRows: [...fixedPacksByDepth.keys()],
})}\n`);
const archiveSearch = searchLianyingAxis(runtime, {
  durationSeconds,
  beamWidth: archiveBeamWidth,
  policyMode: "free",
  warmStartPacks: corePacks,
  fixedPacksByDepth,
  prunedArchiveRows: archiveRows,
  prunedArchivePerRow: archivePerRow,
  prunedArchiveRanker: archiveRanking === "reference-suffix"
    ? referenceSuffixArchiveRanker
    : null,
});
process.stdout.write(`${JSON.stringify({
  phase: "pruned-revival",
  stage: "archive-complete",
  explored: archiveSearch.explored,
  legal: archiveSearch.legal,
  beamPruned: archiveSearch.telemetry.beamPruned,
  archived: archiveSearch.prunedArchive.length,
})}\n`);

const continuations = [];
const directSuffixes = [];
for (const [index, ancestor] of archiveSearch.prunedArchive.entries()) {
  const suffixValue = cachedReferenceSuffixValue(ancestor);
  if (suffixValue.suffixLegal) {
    const packs = spliceLianyingReferenceSuffix(ancestor.packs, corePacks);
    const replay = replayWhitepaperLianying(runtime, packs, {
      durationSeconds,
    });
    directSuffixes.push({
      revivalKind: "direct-reference-suffix",
      ancestorIndex: index + 1,
      depth: ancestor.depth,
      ancestorDamage: ancestor.state.totalDamage,
      packs,
      state: replay.state,
      suffixProjectedDamage: suffixValue.projectedFinalDamage,
    });
  }
  if (!directSuffixOnly) {
    process.stdout.write(`${JSON.stringify({
      phase: "pruned-revival",
      stage: "continuation-start",
      ancestor: index + 1,
      ancestorCount: archiveSearch.prunedArchive.length,
      depth: ancestor.depth,
    })}\n`);
    const result = searchLianyingAxis(runtime, {
      durationSeconds,
      beamWidth: continuationBeamWidth,
      policyMode: "free",
      initialPacks: ancestor.packs,
      fixedPacksByDepth,
      nodeScore: referenceSuffixScore,
    });
    continuations.push({
      revivalKind: "beam-continuation",
      ancestorIndex: index + 1,
      depth: ancestor.depth,
      ancestorDamage: ancestor.state.totalDamage,
      packs: result.packs,
      state: result.state,
      explored: result.explored,
      legal: result.legal,
    });
  }
}
continuations.sort((left, right) =>
  right.state.totalDamage - left.state.totalDamage);
directSuffixes.sort((left, right) =>
  right.state.totalDamage - left.state.totalDamage);

const candidateByPacks = new Map();
for (const candidate of [...continuations, ...directSuffixes]) {
  const key = JSON.stringify(candidate.packs);
  const current = candidateByPacks.get(key);
  if (!current || candidate.state.totalDamage > current.state.totalDamage) {
    candidateByPacks.set(key, candidate);
  }
}
const dashCandidates = [...candidateByPacks.values()]
  .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
  .slice(0, dashFinalists);
process.stdout.write(`${JSON.stringify({
  phase: "pruned-revival",
  stage: "direct-suffix-complete",
  directSuffixes: directSuffixes.length,
  dashCandidates: dashCandidates.length,
  bestCoreDamage: dashCandidates[0]?.state.totalDamage ?? null,
  bestCoreDamageDelta: dashCandidates[0]
    ? dashCandidates[0].state.totalDamage - referenceCoreDamage
    : null,
})}\n`);
const finalists = [{
  kind: "incumbent",
  ancestorIndex: null,
  depth: null,
  packs: sourcePacks,
  state: baseline.state,
}];
for (const candidate of dashCandidates) {
  const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
    durationSeconds,
    maxStatesPerRow: 128,
  });
  finalists.push({
    kind: "revived",
    revivalKind: candidate.revivalKind,
    ancestorIndex: candidate.ancestorIndex,
    depth: candidate.depth,
    packs: dash.packs,
    state: dash.state,
  });
}
finalists.sort((left, right) => {
  const damageDifference = right.state.totalDamage - left.state.totalDamage;
  if (Math.abs(damageDifference) > damageTolerance) return damageDifference;
  if (left.kind === "incumbent") return -1;
  if (right.kind === "incumbent") return 1;
  return 0;
});
const best = finalists[0];
const revivedFinalists = finalists.filter((candidate) =>
  candidate.kind === "revived");
const bestRevived = revivedFinalists[0] ?? null;
const normalizedDamage = (damage) =>
  Math.abs(damage - baseline.state.totalDamage) <= damageTolerance
    ? baseline.state.totalDamage
    : damage;
const audit = auditWhitepaperAxis(best.state, { mode: "fixed" });
const report = {
  schemaVersion: 1,
  kind: "lianying-pruned-state-revival",
  inputPath,
  durationSeconds,
  archiveBeamWidth,
  continuationBeamWidth,
  directSuffixOnly,
  continuationRanking: "reference-suffix",
  archivePerRow,
  archiveRanking,
  dashFinalists,
  archiveRows,
  fixedWaitRows: [...fixedPacksByDepth.keys()],
  archiveSearch: {
    explored: archiveSearch.explored,
    legal: archiveSearch.legal,
    beamPruned: archiveSearch.telemetry.beamPruned,
    peakUniqueCandidates: archiveSearch.telemetry.peakUniqueCandidates,
    archived: archiveSearch.prunedArchive.length,
    archive: archiveSearch.telemetry.prunedArchive,
  },
  continuations: continuations.map((candidate) => ({
    ancestorIndex: candidate.ancestorIndex,
    depth: candidate.depth,
    ancestorDamage: candidate.ancestorDamage,
    rotationDamageBeforeDash: candidate.state.totalDamage,
    coreDamageLoss: referenceCoreDamage - candidate.state.totalDamage,
    explored: candidate.explored,
    legal: candidate.legal,
  })),
  directSuffixes: directSuffixes.map((candidate) => ({
    ancestorIndex: candidate.ancestorIndex,
    depth: candidate.depth,
    ancestorDamage: candidate.ancestorDamage,
    suffixProjectedDamage: candidate.suffixProjectedDamage,
    rotationDamageBeforeDash: candidate.state.totalDamage,
    coreDamageLoss: referenceCoreDamage - candidate.state.totalDamage,
  })),
  baselineRotationDamage: baseline.state.totalDamage,
  bestRotationDamage: normalizedDamage(best.state.totalDamage),
  damageGain: normalizedDamage(best.state.totalDamage) - baseline.state.totalDamage,
  accepted:
    best.kind === "revived" &&
    best.state.totalDamage > baseline.state.totalDamage + damageTolerance,
  bestKind: best.kind,
  bestRevivalKind: best.revivalKind ?? null,
  bestAncestorIndex: best.ancestorIndex,
  bestDepth: best.depth,
  bestRevivedRotationDamage: bestRevived
    ? normalizedDamage(bestRevived.state.totalDamage)
    : null,
  bestRevivedDamageLoss: bestRevived
    ? baseline.state.totalDamage - normalizedDamage(bestRevived.state.totalDamage)
    : null,
  revivedFinalists: revivedFinalists.map((candidate) => ({
    revivalKind: candidate.revivalKind,
    ancestorIndex: candidate.ancestorIndex,
    depth: candidate.depth,
    rotationDamage: normalizedDamage(candidate.state.totalDamage),
    damageLoss: baseline.state.totalDamage - normalizedDamage(candidate.state.totalDamage),
    actionPacks: candidate.packs,
  })),
  bestExperimentActionPacks: bestRevived?.packs ?? null,
  mechanicsPassed: audit.mechanics.passed,
  mechanicsViolationCount: audit.mechanics.violationCount,
  actionPacks: best.packs,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  archived: report.archiveSearch.archived,
  baselineRotationDamage: report.baselineRotationDamage,
  bestRotationDamage: report.bestRotationDamage,
  damageGain: report.damageGain,
  accepted: report.accepted,
  bestKind: report.bestKind,
  bestRevivalKind: report.bestRevivalKind,
  bestAncestorIndex: report.bestAncestorIndex,
  bestDepth: report.bestDepth,
  bestRevivedRotationDamage: report.bestRevivedRotationDamage,
  bestRevivedDamageLoss: report.bestRevivedDamageLoss,
  mechanicsPassed: report.mechanicsPassed,
  mechanicsViolationCount: report.mechanicsViolationCount,
}, null, 2)}\n`);
