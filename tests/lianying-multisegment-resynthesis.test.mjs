import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import {
  isLianyingThunderAnchorPackAllowed,
  lianyingAnchorDriftLongTermScore,
  isLianyingAnchorDriftPackAllowed,
  lianyingAnchorDriftScheduleToCsv,
  lianyingAnchorDriftWindow,
  lianyingMultiSegmentAnchorDiagnosticsToCsv,
  optimizeLianyingAnchorDriftResynthesis,
  optimizeLianyingMultiSegmentResynthesis,
  selectLianyingJointBoundaryNodes,
} from "../src/policies/lianying-multisegment-resynthesis.js";
import { lianyingResynthesisStateKey } from "../src/policies/lianying-segment-resynthesis.js";
import {
  replayWhitepaperLianying,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";

test("联合搜索固定每个区段首行开雷且区段内部不重复开雷", () => {
  assert.equal(
    isLianyingThunderAnchorPackAllowed(
      { prefix: ["thunder"], primary: "dragonFang" },
      0,
    ),
    true,
  );
  assert.equal(
    isLianyingThunderAnchorPackAllowed(
      { prefix: [], primary: "dragonFang" },
      0,
    ),
    false,
  );
  assert.equal(
    isLianyingThunderAnchorPackAllowed(
      { prefix: ["thunder"], primary: "dragonFang" },
      1,
    ),
    false,
  );
});

test("雷锚点漂移窗口在最晚行强制开雷并固定首尾锚点", () => {
  const anchors = [2, 20, 36];
  assert.deepEqual(lianyingAnchorDriftWindow(anchors, 0), {
    target: 2,
    earliest: 2,
    latest: 2,
    slack: 0,
    fixed: true,
  });
  assert.deepEqual(lianyingAnchorDriftWindow(anchors, 1), {
    target: 20,
    earliest: 19,
    latest: 21,
    slack: 1,
    fixed: false,
  });
  const thunder = { prefix: ["thunder"], primary: "dragonFang" };
  const noThunder = { prefix: [], primary: "dragonFang" };
  assert.equal(
    isLianyingAnchorDriftPackAllowed(thunder, 19, 1, anchors),
    true,
  );
  assert.equal(
    isLianyingAnchorDriftPackAllowed(noThunder, 19, 1, anchors),
    true,
  );
  assert.equal(
    isLianyingAnchorDriftPackAllowed(noThunder, 21, 1, anchors),
    false,
  );
  assert.equal(
    isLianyingAnchorDriftPackAllowed(thunder, 21, 1, anchors),
    true,
  );
  assert.equal(
    isLianyingAnchorDriftPackAllowed(thunder, 22, 1, anchors),
    false,
  );
});

test("雷坐标谱系长期评分累加锚点后的新增实际伤害", () => {
  assert.equal(
    lianyingAnchorDriftLongTermScore({
      state: { totalDamage: 150 },
      lineageBaseDamage: 100,
      lineageProjectedFinal: 1000,
    }),
    1050,
  );
  assert.equal(
    lianyingAnchorDriftLongTermScore({ state: { totalDamage: 150 } }),
    150,
  );
});

test("锚点候选压缩同时保留高伤状态和钉住的热启动状态", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const base = createInitialState(runtime.config, { rage: 5, executePhase: true });
  const high = structuredClone(base);
  high.totalDamage = 100;
  const middle = structuredClone(base);
  middle.rage = 4;
  middle.totalDamage = 90;
  const pinned = structuredClone(base);
  pinned.rage = 0;
  pinned.totalDamage = 1;
  const selected = selectLianyingJointBoundaryNodes(
    [high, middle, pinned].map((state) => ({ state, packs: [] })),
    2,
    lianyingResynthesisStateKey(pinned),
  ).nodes;

  assert.equal(selected.length, 2);
  assert.ok(selected.some((node) => node.state.totalDamage === 100));
  assert.ok(selected.some((node) => node.state.rage === 0));
});

test("后缀价值评分能为低即时伤害候选保留独立名额", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const base = createInitialState(runtime.config, { rage: 5, executePhase: true });
  const highDamage = structuredClone(base);
  highDamage.totalDamage = 100;
  const highSuffixValue = structuredClone(base);
  highSuffixValue.rage = 4;
  highSuffixValue.totalDamage = 10;
  const selected = selectLianyingJointBoundaryNodes(
    [
      { state: highDamage, packs: [], suffixScore: 100 },
      { state: highSuffixValue, packs: [], suffixScore: 1000 },
    ],
    2,
    null,
    { scoreNode: (node) => node.suffixScore },
  ).nodes;

  assert.ok(selected.some((node) => node.state.totalDamage === 100));
  assert.ok(selected.some((node) => node.suffixScore === 1000));
});

test("双雷样例能连续拼接区段并以完整含突伤害不降级", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const baseline = replayWhitepaperLianying(runtime, seed.packs, {
    durationSeconds: 30,
  });
  const optimized = optimizeLianyingMultiSegmentResynthesis(
    runtime,
    seed.packs,
    {
      durationSeconds: 30,
      rowBeamWidth: 4,
      boundaryBeamWidth: 2,
      coreFinalistCount: 2,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 2,
      fullDashStates: 4,
    },
  );
  const replay = replayWhitepaperLianying(runtime, optimized.packs, {
    durationSeconds: 30,
  });

  assert.equal(optimized.segments.length, 2);
  assert.ok(optimized.segments.every((segment) => segment.outgoingStates > 0));
  assert.ok(optimized.segments.every(
    (segment) => segment.survivingIncomingLineages > 0,
  ));
  assert.ok(optimized.segments.every((segment) => segment.suffixValueEnabled));
  assert.ok(optimized.segments.every(
    (segment) => segment.candidateDiagnostics.length > 0,
  ));
  const diagnosticsCsv = lianyingMultiSegmentAnchorDiagnosticsToCsv(optimized);
  assert.match(diagnosticsCsv, /预计最终伤害差/);
  assert.match(diagnosticsCsv, /thunder-1-to-2/);
  assert.ok(optimized.state.totalDamage >= baseline.state.totalDamage);
  assert.equal(replay.state.totalDamage, optimized.state.totalDamage);
});

test("三雷样例只漂移中间锚点并完成不降级复演", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 50,
    mode: "fixed",
    beamWidth: 4,
  });
  const baseline = replayWhitepaperLianying(runtime, seed.packs, {
    durationSeconds: 50,
  });
  const optimized = optimizeLianyingAnchorDriftResynthesis(
    runtime,
    seed.packs,
    {
      durationSeconds: 50,
      rowBeamWidth: 6,
      boundaryBeamWidth: 6,
      coreFinalistCount: 3,
      coarseCandidateLimit: 2,
      coarseDashStates: 4,
      finalDashCandidateCount: 2,
      fullDashStates: 4,
    },
  );
  const replay = replayWhitepaperLianying(runtime, optimized.packs, {
    durationSeconds: 50,
  });

  assert.equal(optimized.selectedAnchors[0], optimized.anchors[0]);
  assert.equal(optimized.selectedAnchors.at(-1), optimized.anchors.at(-1));
  assert.ok(
    Math.abs(optimized.selectedAnchors[1] - optimized.anchors[1]) <= 1,
  );
  assert.ok(optimized.segments[1].outgoingSchedules > 0);
  assert.equal(optimized.options.lineageLongTermScoring, true);
  assert.ok(optimized.finalSchedules > 1);
  assert.ok(
    Object.hasOwn(
      optimized.segments[1].actualRowHistogram,
      String(optimized.segments[1].latestRow),
    ),
  );
  const scheduleCsv = lianyingAnchorDriftScheduleToCsv(optimized);
  assert.match(scheduleCsv, /实际坐标分布/);
  assert.match(scheduleCsv, /压缩前可用坐标组合数/);
  assert.match(scheduleCsv, /雷序号/u);
  assert.ok(optimized.state.totalDamage >= baseline.state.totalDamage);
  assert.equal(replay.state.totalDamage, optimized.state.totalDamage);
});
