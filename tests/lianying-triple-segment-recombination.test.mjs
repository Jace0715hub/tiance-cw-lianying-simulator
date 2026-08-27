import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  alignLianyingDonorWaitPacks,
  buildLianyingBoundedMultiSegmentSpan,
  lianyingDifferingThunderSegmentIndices,
  normalizeLianyingDonorPrefix,
  optimizeLianyingTripleSegmentRecombination,
} from "../src/policies/lianying-triple-segment-recombination.js";

const formal = JSON.parse(fs.readFileSync(new URL(
  "../output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json",
  import.meta.url,
))).actionPacks;
const sensitivity = JSON.parse(fs.readFileSync(new URL(
  "../output/lianying-ranking-sensitivity.json",
  import.meta.url,
)));
const heterogeneous = sensitivity.candidates.find(
  (candidate) => candidate.id === "heterogeneous",
).actionPacks;
const thunder106 = sensitivity.candidates.find(
  (candidate) => candidate.id === "thunder106",
).actionPacks;
const currentFormal = sensitivity.candidates.find(
  (candidate) => candidate.id === "formal",
).actionPacks;

test("旧供体只按正式轴显式等待行对齐而不改写其他动作", () => {
  const aligned = alignLianyingDonorWaitPacks(currentFormal, heterogeneous);
  const waitRows = aligned.flatMap((pack, index) =>
    pack.primary?.id === "wait" ? [index + 1] : []);
  assert.equal(aligned.length, currentFormal.length);
  assert.deepEqual(waitRows, [125, 129]);
  assert.equal(aligned[74].primary, "cloudStrike");
  assert.deepEqual(
    aligned.filter((pack) => pack.primary?.id !== "wait"),
    heterogeneous,
  );
});

test("当前正式轴与旧异构供体可扩展为四个连续雷区段", () => {
  const span = buildLianyingBoundedMultiSegmentSpan(
    currentFormal,
    heterogeneous,
    { segmentCount: 4 },
  );
  assert.deepEqual(span.differenceRows, [3, 38, 75]);
  assert.deepEqual(span.differenceSegmentIndices, [0, 2, 3]);
  assert.deepEqual(span.segmentIndices, [0, 1, 2, 3]);
  assert.equal(span.startIndex + 1, 3);
  assert.equal(span.endIndex, 78);
});

test("旧106行雷供体归一化早期时点后只保留真实晚段差异", () => {
  const normalized = normalizeLianyingDonorPrefix(
    currentFormal,
    thunder106,
    79,
  );
  const difference = lianyingDifferingThunderSegmentIndices(
    currentFormal,
    normalized,
  );
  assert.deepEqual(difference.differenceRows, [106, 107]);
  assert.deepEqual(difference.segmentIndices, [4, 5]);
  assert.deepEqual(difference.referenceThunderRows, [3, 20, 38, 59, 79, 107, 130]);
  assert.deepEqual(difference.donorThunderRows, [3, 20, 38, 59, 79, 106, 130]);
  const span = buildLianyingBoundedMultiSegmentSpan(
    currentFormal,
    normalized,
    { segmentCount: 4 },
  );
  assert.deepEqual(span.segmentIndices, [3, 4, 5, 6]);
  assert.equal(span.startIndex + 1, 59);
  assert.equal(span.endIndex, 150);
});

test("第75行异构热启动自动扩为第3至5雷的三个完整区段", () => {
  const span = buildLianyingBoundedMultiSegmentSpan(
    formal,
    heterogeneous,
    { segmentCount: 3 },
  );
  assert.deepEqual(span.differenceRows, [75]);
  assert.deepEqual(span.differenceSegmentIndices, [3]);
  assert.deepEqual(span.segmentIndices, [2, 3, 4]);
  assert.equal(span.startIndex + 1, 38);
  assert.equal(span.endIndex, 106);
  assert.deepEqual(span.sourceSegmentIds, [
    "thunder-3-to-4",
    "thunder-4-to-5",
    "thunder-5-to-6",
  ]);
});

test("不同雷表只开放正式位置与供体位置之间的有界雷窗口", () => {
  const span = buildLianyingBoundedMultiSegmentSpan(formal, thunder106, {
    segmentCount: 3,
  });
  assert.deepEqual(span.differenceRows, [106, 107]);
  assert.deepEqual(span.differenceSegmentIndices, [4, 5]);
  assert.deepEqual(span.segmentIndices, [4, 5, 6]);
  assert.deepEqual(span.referenceThunderRows, [3, 20, 38, 59, 79, 107, 128]);
  assert.deepEqual(span.donorThunderRows, [3, 20, 38, 59, 79, 106, 128]);
  assert.deepEqual(span.thunderPositionWindows, [{
    anchorNumber: 6,
    sourceIndex: 105,
    earliestIndex: 105,
    latestIndex: 106,
  }]);
});

test("小预算三段重组保持正式轴全局不降级", () => {
  const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
  const optimized = optimizeLianyingTripleSegmentRecombination(
    runtime,
    formal,
    heterogeneous,
    {
      durationSeconds: 180,
      beamWidth: 4,
      finalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      diverseCandidateLimit: 2,
    },
  );
  assert.equal(optimized.span.startIndex + 1, 38);
  assert.equal(optimized.span.endIndex, 106);
  assert.ok(optimized.state.totalDamage >= optimized.baselineDamage);
  assert.ok(optimized.candidateDamage >= optimized.donorDamage);
});

test("三段重组透传自适应后缀参数与额外热启动", () => {
  const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
  const optimized = optimizeLianyingTripleSegmentRecombination(
    runtime,
    formal,
    heterogeneous,
    {
      durationSeconds: 180,
      beamWidth: 4,
      finalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 2,
      finalDashCandidateCount: 1,
      fullDashStates: 4,
      diverseCandidateLimit: 2,
      additionalWarmAxes: [formal],
      adaptiveSuffixRepair: true,
      adaptiveSuffixMaxExpansions: 0,
    },
  );
  const segment = optimized.resynthesis.passes[0].segments[0];
  assert.equal(segment.adaptiveSuffixRepair, true);
  assert.equal(segment.warmStartCount, 3);
});
