import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import {
  searchLianyingCompoundEventTimings,
  searchLianyingEventTimingBreakpoints,
} from
  "../src/policies/lianying-event-timing-search.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? "/tmp/lianying-event-breakpoints.json",
);
const dashFinalists = Math.max(1, Math.floor(Number(process.argv[4] ?? 6)));
const artifactStem = process.argv[5]
  ? path.resolve(process.argv[5])
  : null;
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入轴缺少可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const formalReplay = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const scan = searchLianyingEventTimingBreakpoints(runtime, sourcePacks, {
  durationSeconds,
  preserveEventCounts: true,
});
const compound = searchLianyingCompoundEventTimings(
  runtime,
  sourcePacks,
  scan.candidates,
  { durationSeconds, seedLimit: 12 },
);
const timingCandidates = [
  ...scan.candidates.map((candidate) => ({
    mutations: [candidate],
    packs: candidate.packs,
    state: candidate.state,
    damageGain: candidate.damageGain,
  })),
  ...compound.candidates,
].sort((left, right) => right.state.totalDamage - left.state.totalDamage);
const finalists = [{
  kind: "incumbent",
  mutations: [],
  packs: sourcePacks,
  state: formalReplay.state,
}];
for (const candidate of timingCandidates.slice(0, dashFinalists)) {
  const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
    durationSeconds,
    maxStatesPerRow: 128,
  });
  finalists.push({
    kind: "event-breakpoint",
    mutations: candidate.mutations,
    packs: dash.packs,
    state: dash.state,
  });
}
finalists.sort((left, right) => right.state.totalDamage - left.state.totalDamage);
const best = finalists[0];
const audit = auditWhitepaperAxis(best.state, { mode: "fixed" });
const summarize = (candidate) => ({
  rowNumber: candidate.rowNumber,
  action: candidate.action,
  sourceLocation: candidate.sourceLocation,
  sourceLeadFrames: candidate.sourceLeadFrames,
  targetLocation: candidate.targetLocation,
  targetLeadFrames: candidate.targetLeadFrames,
  eventKinds: candidate.eventKinds,
  rotationDamageBeforeDash: candidate.state.totalDamage,
  coreDamageGain: candidate.damageGain,
});
const report = {
  schemaVersion: 1,
  kind: "lianying-event-breakpoint-timing-search",
  inputPath,
  durationSeconds,
  dashFinalists,
  explored: scan.explored,
  legal: scan.legal,
  preservedEventCounts: scan.preservedEventCounts,
  baselineRotationDamage: formalReplay.state.totalDamage,
  bestRotationDamage: best.state.totalDamage,
  damageGain: best.state.totalDamage - formalReplay.state.totalDamage,
  accepted: best.kind === "event-breakpoint" &&
    best.state.totalDamage > formalReplay.state.totalDamage,
  compoundExplored: compound.explored,
  compoundLegal: compound.legal,
  bestMutations: best.mutations.map(summarize),
  mechanicsPassed: audit.mechanics.passed,
  mechanicsViolationCount: audit.mechanics.violationCount,
  shortlist: scan.candidates.slice(0, 24).map(summarize),
  actionPacks: best.packs,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
if (report.accepted && artifactStem) {
  const searchResult = {
    durationSeconds,
    mode: source.mode ?? "fixed",
    policyMode: "free",
    beamWidth: null,
    explored: scan.explored,
    legal: scan.legal,
    warmStarted: true,
    warmStartCount: 1,
    warmStartDamages: [formalReplay.state.totalDamage],
    warmStartDamage: formalReplay.state.totalDamage,
    telemetry: null,
    packs: best.packs,
    state: best.state,
    axisOptimization: {
      kind: "event-breakpoint-timing-search",
      sourcePath: path.relative(projectRoot, inputPath),
      explored: scan.explored,
      legal: scan.legal,
      preservedEventCounts: scan.preservedEventCounts,
      compoundExplored: compound.explored,
      compoundLegal: compound.legal,
      selectedMutations: best.mutations.map(summarize),
      damageGain: best.state.totalDamage - formalReplay.state.totalDamage,
      shortlist: scan.candidates.slice(0, 24).map(summarize),
    },
  };
  const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
    durationSeconds,
    mode: source.mode ?? "fixed",
  });
  fs.writeFileSync(`${artifactStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(`${artifactStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`);
  fs.writeFileSync(
    `${artifactStem}-equipment.csv`,
    `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
  );
}
process.stdout.write(`${JSON.stringify({
  outputPath,
  artifactStem: report.accepted ? artifactStem : null,
  explored: report.explored,
  legal: report.legal,
  preservedEventCounts: report.preservedEventCounts,
  baselineRotationDamage: report.baselineRotationDamage,
  bestRotationDamage: report.bestRotationDamage,
  damageGain: report.damageGain,
  accepted: report.accepted,
  bestMutations: report.bestMutations,
  mechanicsPassed: report.mechanicsPassed,
  mechanicsViolationCount: report.mechanicsViolationCount,
}, null, 2)}\n`);
