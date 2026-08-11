import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  identifyLianyingThunderSegments,
  lianyingBoundaryStateDistance,
  optimizeLianyingSegmentResynthesis,
} from "../src/policies/lianying-segment-resynthesis.js";
import {
  replayWhitepaperLianying,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";

test("按雷锚点识别两个任雷之间及最后雷后的整段", () => {
  const packs = Array.from({ length: 12 }, () => ({ primary: "cloudStrike" }));
  packs[1] = { prefix: ["thunder"], primary: "dragonFang" };
  packs[5] = { prefix: ["thunder"], primary: "dragonFang" };
  packs[9] = { prefix: ["thunder"], primary: "dragonFang" };
  const identified = identifyLianyingThunderSegments(packs);

  assert.deepEqual(identified.anchors, [1, 5, 9]);
  assert.deepEqual(
    identified.ranges.map((segment) => [segment.startIndex, segment.endIndex]),
    [[1, 5], [5, 9], [9, 12]],
  );
});

test("边界状态距离对同一状态为零并识别资源与冷却差异", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const base = replayWhitepaperLianying(runtime, [], {
    durationSeconds: 1,
  }).state;
  const changed = structuredClone(base);
  changed.rage -= 1;
  changed.cooldownReadyTick.destroy += 1000;

  assert.equal(lianyingBoundaryStateDistance(base, base), 0);
  assert.ok(lianyingBoundaryStateDistance(changed, base) > 0);
});

test("小规模整段重合成保留合法热启动且不降低总伤害", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 12,
    mode: "fixed",
    beamWidth: 4,
  });
  const baseline = replayWhitepaperLianying(runtime, seed.packs, {
    durationSeconds: 12,
  });
  const optimized = optimizeLianyingSegmentResynthesis(runtime, seed.packs, {
    durationSeconds: 12,
    maxPasses: 1,
    beamWidth: 4,
    finalistCount: 2,
    coarseCandidateLimit: 1,
    coarseDashStates: 4,
    finalDashCandidateCount: 1,
    fullDashStates: 4,
    segmentIndices: [0],
  });
  const replay = replayWhitepaperLianying(runtime, optimized.packs, {
    durationSeconds: 12,
  });

  assert.ok(optimized.state.totalDamage >= baseline.state.totalDamage);
  assert.equal(replay.state.totalDamage, optimized.state.totalDamage);
  assert.ok(optimized.passes[0].segments.length <= 1);
});
