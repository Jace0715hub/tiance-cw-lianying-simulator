import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import { searchLianyingBoundaryFailureRepairs } from
  "../src/policies/lianying-boundary-failure-repair.js";
import { optimizeLianyingMultiSegmentResynthesis } from
  "../src/policies/lianying-multisegment-resynthesis.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import { lianyingRowsToActionPacks } from
  "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const profileName = process.argv[3] ?? "balanced";
const outputStem = path.resolve(
  process.argv[4] ?? "/tmp/lianying-boundary-failure-repairs",
);
const dashFinalistCount = Math.max(
  1,
  Math.floor(Number(process.argv[5] ?? 6)),
);
const profiles = {
  screen: {
    rowBeamWidth: 32,
    boundaryBeamWidth: 12,
    coreFinalistCount: 12,
    coarseCandidateLimit: 4,
    coarseDashStates: 8,
    finalDashCandidateCount: 1,
    fullDashStates: 64,
  },
  balanced: {
    rowBeamWidth: 48,
    boundaryBeamWidth: 24,
    coreFinalistCount: 24,
    coarseCandidateLimit: 6,
    coarseDashStates: 16,
    finalDashCandidateCount: 2,
    fullDashStates: 256,
  },
};
if (!profiles[profileName]) {
  throw new Error("边界首错修复档位必须是screen或balanced");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const packs = source.actionPacks ??
  (source.rows ? lianyingRowsToActionPacks(source.rows) : null);
if (!packs) throw new Error("输入轴没有可恢复的动作包");
const durationSeconds = Number(source.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const boundarySearch = optimizeLianyingMultiSegmentResynthesis(runtime, packs, {
  durationSeconds,
  ...profiles[profileName],
  boundaryPathExport: {
    segmentNumbers: [2, 3, 5, 6],
    limitPerSegment: 3,
  },
  onProgress: (event) => {
    console.log(JSON.stringify({ phase: "boundary-search", ...event }));
  },
});
const repaired = searchLianyingBoundaryFailureRepairs(
  runtime,
  packs,
  boundarySearch.boundaryPaths,
  {
    durationSeconds,
    pathLimit: 12,
    repairLimitPerPath: 16,
    repairLookBehindRows: 4,
    repairLookAheadRows: 8,
    dashFinalistCount,
    dashStates: 256,
  },
);
const compactFinalists = repaired.dashFinalists.map(
  ({ packs: _packs, state: _state, ...finalist }) => finalist,
);
const report = {
  inputPath,
  profileName,
  durationSeconds,
  accepted: repaired.accepted,
  baselineDamage: repaired.baselineDamage,
  bestDamage: repaired.bestDamage,
  damageGain: repaired.damageGain,
  boundarySearch: {
    explored: boundarySearch.explored,
    legal: boundarySearch.legal,
    anchors: boundarySearch.anchors,
    exportedPaths: boundarySearch.boundaryPaths.map(
      ({ prefixPacks: _packs, ...entry }) => entry,
    ),
  },
  selectedPaths: repaired.selectedPaths,
  generatedRepairs: repaired.generatedRepairs,
  legalRepairs: repaired.legalRepairs,
  attempts: repaired.attempts,
  finalists: compactFinalists,
  options: repaired.options,
};
fs.writeFileSync(
  `${outputStem}-research.json`,
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
const bestCandidate = repaired.dashFinalists[0] ?? null;
let bestCandidateArtifact = null;
if (bestCandidate) {
  bestCandidateArtifact = buildWhitepaperAxisArtifact({
    durationSeconds,
    mode: source.mode ?? "fixed",
    policyMode: "free",
    beamWidth: null,
    explored: boundarySearch.explored,
    legal: boundarySearch.legal,
    warmStarted: true,
    warmStartCount: 1,
    warmStartDamages: [repaired.baselineDamage],
    warmStartDamage: repaired.baselineDamage,
    telemetry: null,
    packs: bestCandidate.packs,
    state: bestCandidate.state,
    axisOptimization: {
      kind: "boundary-first-failure-best-candidate",
      sourcePath: path.relative(projectRoot, inputPath),
      profileName,
      accepted: repaired.accepted,
      formalDamage: repaired.baselineDamage,
      damageDifference: bestCandidate.totalDamage - repaired.baselineDamage,
      candidate: compactFinalists[0],
    },
  }, runtime, {
    durationSeconds,
    mode: source.mode ?? "fixed",
  });
  fs.writeFileSync(
    `${outputStem}-best-candidate.json`,
    `${JSON.stringify(bestCandidateArtifact, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    `${outputStem}-best-candidate.csv`,
    `\uFEFF${whitepaperAxisToCsv(bestCandidateArtifact)}\n`,
    "utf8",
  );
}
if (repaired.accepted) {
  fs.writeFileSync(
    `${outputStem}-axis.json`,
    `${JSON.stringify(bestCandidateArtifact, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    `${outputStem}-axis.csv`,
    `\uFEFF${whitepaperAxisToCsv(bestCandidateArtifact)}\n`,
    "utf8",
  );
}
console.log(JSON.stringify(report, null, 2));
