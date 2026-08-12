import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import {
  optimizeLianyingCrossScheduleBridge,
} from "../src/policies/lianying-crossover-bridge.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const incumbentPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const alternatePath = resolveLianyingResearchPath(projectRoot, process.argv[3]);
const profileName = process.argv[4] ?? "screen";
const profiles = {
  screen: {
    maxPasses: 1,
    beamWidth: 24,
    finalistCount: 8,
    coarseCandidateLimit: 6,
    coarseDashStates: 8,
    finalDashCandidateCount: 2,
    fullDashStates: 128,
    boundaryPaddingRows: 4,
    thunderDriftRows: 0,
  },
  fast: {
    maxPasses: 1,
    beamWidth: 48,
    finalistCount: 16,
    coarseCandidateLimit: 8,
    coarseDashStates: 16,
    finalDashCandidateCount: 3,
    fullDashStates: 256,
    boundaryPaddingRows: 6,
    thunderDriftRows: 1,
    adaptiveSuffixRepair: true,
    adaptiveSuffixMaxExpansions: 1,
    adaptiveSuffixLookaheadRows: 4,
    adaptiveSuffixMaximumAddedRows: 12,
    adaptiveSuffixFailureChainLimit: 2,
    adaptiveSuffixDirectedRepairLimit: 4,
  },
};
if (!profiles[profileName]) {
  throw new Error("跨雷坐标桥接档位必须是screen或fast");
}

function loadAxis(inputPath) {
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const packs = source.actionPacks ??
    (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
  if (!packs) throw new Error(`${inputPath}没有可恢复的动作包`);
  return {
    source,
    packs,
    durationSeconds: Number(source.durationSeconds ?? 180),
    mode: source.mode ?? "fixed",
  };
}

const incumbentSource = loadAxis(incumbentPath);
const alternateSource = loadAxis(alternatePath);
if (incumbentSource.durationSeconds !== alternateSource.durationSeconds) {
  throw new Error("跨坐标桥接要求两条轴使用相同战斗时长");
}
const durationSeconds = incumbentSource.durationSeconds;
const mode = incumbentSource.mode;
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const bridge = optimizeLianyingCrossScheduleBridge(
  runtime,
  incumbentSource.packs,
  alternateSource.packs,
  {
    durationSeconds,
    ...profiles[profileName],
    onProgress: (event) => console.log(JSON.stringify({
      phase: "cross-schedule-bridge",
      ...event,
    })),
  },
);

function summarizePasses(passes) {
  return passes.map((pass) => ({
    pass: pass.pass,
    anchors: pass.anchors,
    segments: pass.segments,
    coreCandidates: pass.coreCandidates,
    coarseCandidates: pass.coarseCandidates,
    bestSegmentId: pass.bestSegmentId,
    damageGain: pass.damageGain,
  }));
}

function makeArtifact(packs, state, kind, accepted) {
  const explored = bridge.resynthesis.passes.reduce(
    (sum, pass) => sum + pass.segments.reduce(
      (inner, segment) => inner + Number(segment.explored ?? 0), 0), 0);
  const legal = bridge.resynthesis.passes.reduce(
    (sum, pass) => sum + pass.segments.reduce(
      (inner, segment) => inner + Number(segment.legal ?? 0), 0), 0);
  return buildWhitepaperAxisArtifact({
    durationSeconds,
    mode,
    policyMode: "free",
    beamWidth: profiles[profileName].beamWidth,
    explored,
    legal,
    warmStarted: true,
    warmStartCount: 2,
    warmStartDamages: [incumbentSource.packs, alternateSource.packs].map(
      (packsToReplay) => replayWhitepaperLianying(runtime, packsToReplay, {
        durationSeconds,
      }).state.totalDamage),
    warmStartDamage: bridge.baselineDamage,
    telemetry: null,
    packs,
    state,
    axisOptimization: {
      kind,
      profile: profileName,
      accepted,
      incumbentPath: path.relative(projectRoot, incumbentPath),
      alternatePath: path.relative(projectRoot, alternatePath),
      baselineDamage: bridge.baselineDamage,
      alternateDamage: bridge.alternateDamage,
      bridgedDamage: bridge.bridgedDamage,
      bridgeDamageGain: bridge.bridgeDamageGain,
      globalDamageGain: bridge.globalDamageGain,
      structuralBridgedDamage: bridge.structuralBridgedDamage,
      structuralBridgeDamageGain: bridge.structuralBridgeDamageGain,
      structuralGlobalDamageGain: bridge.structuralGlobalDamageGain,
      structuralAnchorRows: bridge.structuralAnchorRows,
      structuralFinalists: bridge.structuralFinalists,
      plan: bridge.plan,
      preserveNovelStructure: bridge.preserveNovelStructure,
      passes: summarizePasses(bridge.resynthesis.passes),
      options: bridge.resynthesis.options,
    },
  }, runtime, { durationSeconds, mode });
}

const artifact = makeArtifact(
  bridge.packs,
  bridge.state,
  "cross-schedule-bounded-bridge",
  bridge.accepted,
);
const candidateArtifact = makeArtifact(
  bridge.candidatePacks,
  bridge.candidateState,
  "cross-schedule-bounded-bridge-candidate",
  bridge.accepted,
);
const outputStem = path.resolve(
  process.argv[5] ?? path.join(
    projectRoot,
    `output/lianying-free-fixed-${durationSeconds}s-cross-schedule-bridge-${profileName}`,
  ),
);
for (const [suffix, value] of [
  [".json", `${JSON.stringify(artifact, null, 2)}\n`],
  [".csv", `\uFEFF${whitepaperAxisToCsv(artifact)}\n`],
  ["-equipment.csv", `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`],
  ["-candidate.json", `${JSON.stringify(candidateArtifact, null, 2)}\n`],
  ["-candidate.csv", `\uFEFF${whitepaperAxisToCsv(candidateArtifact)}\n`],
]) fs.writeFileSync(`${outputStem}${suffix}`, value, "utf8");

console.log(JSON.stringify({
  incumbentPath,
  alternatePath,
  outputStem,
  profileName,
  accepted: bridge.accepted,
  baselineDamage: bridge.baselineDamage,
  alternateDamage: bridge.alternateDamage,
  bridgedDamage: bridge.bridgedDamage,
  bridgeDamageGain: bridge.bridgeDamageGain,
  globalDamageGain: bridge.globalDamageGain,
  structuralBridgedDamage: bridge.structuralBridgedDamage,
  structuralBridgeDamageGain: bridge.structuralBridgeDamageGain,
  structuralGlobalDamageGain: bridge.structuralGlobalDamageGain,
  structuralAnchorRows: bridge.structuralAnchorRows,
  structuralFinalists: bridge.structuralFinalists,
  finalRotationDps: artifact.summary.rotationDps,
  finalTotalDps: artifact.summary.dps,
  candidateRotationDps: candidateArtifact.summary.rotationDps,
  candidateTotalDps: candidateArtifact.summary.dps,
  plan: bridge.plan,
  passes: summarizePasses(bridge.resynthesis.passes),
}, null, 2));
