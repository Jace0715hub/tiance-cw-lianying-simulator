import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  buildLianyingMultiSourceRecombination,
  mergeLianyingSourceDifferences,
  normalizeLianyingSourceAxes,
  optimizeLianyingMultiSourceRecombination,
  swapLianyingPrimaryActions,
} from "../src/policies/lianying-multi-source-recombination.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";

const formalReport = JSON.parse(fs.readFileSync(new URL(
  "../output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json",
  import.meta.url,
)));
const formal = formalReport.actionPacks;
const sensitivity = JSON.parse(fs.readFileSync(new URL(
  "../output/lianying-ranking-sensitivity.json",
  import.meta.url,
)));
const sourceAxes = ["heterogeneous", "thunder106"].map((id) => ({
  id,
  packs: sensitivity.candidates.find((candidate) => candidate.id === id).actionPacks,
}));
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const currentFormal = sensitivity.candidates.find(
  (candidate) => candidate.id === "formal",
).actionPacks;

test("多来源合并只移植各来源相对正式轴的真实差异", () => {
  const joint = mergeLianyingSourceDifferences(formal, sourceAxes);
  assert.deepEqual(joint.differenceRows, [75, 106, 107]);
  const replay = replayWhitepaperLianying(runtime, joint.packs, {
    durationSeconds: 180,
  });
  assert.equal(replay.state.totalDamage, 2557330151.2739363);
});

test("联合差异自动选择覆盖第75与106至107行的三个雷区段", () => {
  const joint = buildLianyingMultiSourceRecombination(formal, sourceAxes);
  assert.deepEqual(joint.span.segmentIndices, [3, 4, 5]);
  assert.equal(joint.span.startIndex + 1, 59);
  assert.equal(joint.span.endIndex, 127);
  assert.deepEqual(joint.span.thunderPositionWindows, [{
    anchorNumber: 6,
    sourceIndex: 105,
    earliestIndex: 105,
    latestIndex: 106,
  }]);
});

test("当前正式轴归一化多来源后联合搜索后四个雷区段", () => {
  const normalized = normalizeLianyingSourceAxes(
    currentFormal,
    sourceAxes,
    59,
  );
  assert.deepEqual(normalized.map(({ packs }) => packs.length), [150, 150]);
  const joint = buildLianyingMultiSourceRecombination(
    currentFormal,
    sourceAxes,
    { segmentCount: 4, sourceNormalizeBeforeRow: 59 },
  );
  assert.deepEqual(joint.differenceRows, [75, 106, 107, 121, 124]);
  assert.deepEqual(joint.span.segmentIndices, [3, 4, 5, 6]);
  assert.equal(joint.span.startIndex + 1, 59);
  assert.equal(joint.span.endIndex, 150);
  assert.deepEqual(joint.span.thunderPositionWindows, [{
    anchorNumber: 6,
    sourceIndex: 105,
    earliestIndex: 105,
    latestIndex: 106,
  }]);
});

test("五区段联合搜索向左扩展到第三雷且覆盖战斗末段", () => {
  const joint = buildLianyingMultiSourceRecombination(
    currentFormal,
    sourceAxes,
    { segmentCount: 5, sourceNormalizeBeforeRow: 59 },
  );
  assert.deepEqual(joint.differenceRows, [75, 106, 107, 121, 124]);
  assert.deepEqual(joint.span.segmentIndices, [2, 3, 4, 5, 6]);
  assert.equal(joint.span.startIndex + 1, 38);
  assert.equal(joint.span.endIndex, 150);
});

test("100与101行主要技能换位复现已知近优轴", () => {
  const swapped = swapLianyingPrimaryActions(formal, 100, 101);
  const replay = replayWhitepaperLianying(runtime, swapped, {
    durationSeconds: 180,
  });
  assert.equal(replay.state.totalDamage, 2558816344.4559956);
});

test("小预算多来源重组保持正式轴全局不降级", () => {
  const optimized = optimizeLianyingMultiSourceRecombination(
    runtime,
    formal,
    sourceAxes,
    {
      durationSeconds: 180,
      beamWidth: 4,
      finalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 2,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      diverseCandidateLimit: 2,
    },
  );
  assert.deepEqual(optimized.joint.differenceRows, [75, 106, 107]);
  assert.ok(optimized.state.totalDamage >= optimized.baselineDamage);
  assert.ok(optimized.candidateDamage >= 2558816344.4559956);
  assert.ok(optimized.resynthesis.passes[0].pinnedWarmAxisCount >= 2);
});
