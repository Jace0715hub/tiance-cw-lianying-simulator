import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import {
  searchLianyingEventTimingBreakpoints,
  searchLianyingNeutralCompoundEventTimings,
} from "../src/policies/lianying-event-timing-search.js";
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
  process.argv[3] ?? "/tmp/lianying-neutral-event-timings.json",
);
const maximumSingleLoss = Math.max(0, Number(process.argv[4] ?? 500_000));
const seedLimit = Math.max(2, Math.floor(Number(process.argv[5] ?? 32)));
const dashFinalists = Math.max(1, Math.floor(Number(process.argv[6] ?? 6)));
const artifactStem = process.argv[7] ? path.resolve(process.argv[7]) : null;
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourcePacks = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!sourcePacks) throw new Error("输入轴缺少可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const incumbent = replayWhitepaperLianying(runtime, sourcePacks, {
  durationSeconds,
});
const scan = searchLianyingEventTimingBreakpoints(runtime, sourcePacks, {
  durationSeconds,
  preserveEventCounts: true,
});
const compound = searchLianyingNeutralCompoundEventTimings(
  runtime,
  sourcePacks,
  scan.candidates,
  {
    durationSeconds,
    maximumSingleLoss,
    representativesPerPlatform: 2,
    seedLimit,
  },
);
const finalists = [{
  kind: "incumbent",
  mutations: [],
  packs: sourcePacks,
  state: incumbent.state,
  rawDamageGain: 0,
  synergyGain: 0,
}];
for (const candidate of compound.candidates.slice(0, dashFinalists)) {
  const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
    durationSeconds,
    maxStatesPerRow: 128,
  });
  finalists.push({
    kind: "neutral-event-compound",
    mutations: candidate.mutations,
    packs: dash.packs,
    state: dash.state,
    rawDamageGain: candidate.damageGain,
    synergyGain: candidate.synergyGain,
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
  singleDamageGain: candidate.damageGain,
});
const accepted = best.kind === "neutral-event-compound" &&
  best.state.totalDamage > incumbent.state.totalDamage;
const report = {
  schemaVersion: 1,
  kind: "lianying-neutral-event-timing-search",
  inputPath,
  durationSeconds,
  maximumSingleLoss,
  seedLimit,
  dashFinalists,
  singleExplored: scan.explored,
  singleLegal: scan.legal,
  platformSeedCount: compound.seeds.length,
  compoundExplored: compound.explored,
  compoundLegal: compound.legal,
  baselineRotationDamage: incumbent.state.totalDamage,
  bestRotationDamage: best.state.totalDamage,
  damageGain: best.state.totalDamage - incumbent.state.totalDamage,
  rawDamageGain: best.rawDamageGain,
  synergyGain: best.synergyGain,
  accepted,
  bestMutations: best.mutations.map(summarize),
  mechanicsPassed: audit.mechanics.passed,
  mechanicsViolationCount: audit.mechanics.violationCount,
  seeds: compound.seeds.map(summarize),
  shortlist: compound.candidates.slice(0, 24).map((candidate) => ({
    damageGain: candidate.damageGain,
    synergyGain: candidate.synergyGain,
    mutations: candidate.mutations.map(summarize),
  })),
  actionPacks: best.packs,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
if (accepted && artifactStem) {
  const searchResult = {
    durationSeconds,
    mode: source.mode ?? "fixed",
    policyMode: "free",
    beamWidth: null,
    explored: compound.explored,
    legal: compound.legal,
    warmStarted: true,
    warmStartCount: 1,
    warmStartDamages: [incumbent.state.totalDamage],
    warmStartDamage: incumbent.state.totalDamage,
    telemetry: null,
    packs: best.packs,
    state: best.state,
    axisOptimization: {
      kind: report.kind,
      sourcePath: path.relative(projectRoot, inputPath),
      maximumSingleLoss,
      platformSeedCount: compound.seeds.length,
      compoundExplored: compound.explored,
      compoundLegal: compound.legal,
      selectedMutations: best.mutations.map(summarize),
      damageGain: report.damageGain,
      synergyGain: report.synergyGain,
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
  artifactStem: accepted ? artifactStem : null,
  platformSeedCount: report.platformSeedCount,
  compoundExplored: report.compoundExplored,
  compoundLegal: report.compoundLegal,
  baselineRotationDamage: report.baselineRotationDamage,
  bestRotationDamage: report.bestRotationDamage,
  damageGain: report.damageGain,
  rawDamageGain: report.rawDamageGain,
  synergyGain: report.synergyGain,
  accepted: report.accepted,
  bestMutations: report.bestMutations,
  mechanicsPassed: report.mechanicsPassed,
  mechanicsViolationCount: report.mechanicsViolationCount,
}, null, 2)}\n`);
