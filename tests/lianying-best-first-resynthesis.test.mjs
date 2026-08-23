import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  isLianyingFixedAnchorPackAllowed,
  searchLianyingBoundedLocalBlock,
} from "../src/policies/lianying-best-first-resynthesis.js";
import {
  stripLianyingDashPacks,
} from "../src/policies/lianying-segment-resynthesis.js";
import {
  replayWhitepaperLianying,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";

test("固定锚点比较同时覆盖前置、主要技能和末端动作", () => {
  const reference = {
    prefix: ["dismount", "orange"],
    primary: "ride",
    tail: [{ id: "thunder", leadFrames: 1 }],
  };
  assert.equal(isLianyingFixedAnchorPackAllowed({
    prefix: ["orange", "dismount"],
    primary: "ride",
    tail: [{ id: "thunder", leadFrames: 1 }],
  }, reference), true);
  assert.equal(isLianyingFixedAnchorPackAllowed({
    prefix: ["dismount"],
    primary: "dragonRoar",
    tail: ["thunder", "orange"],
  }, reference), false);
});

test("最佳优先局部块与束搜索使用相同节点展开预算并完整复演", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const seed = searchWhitepaperLianying(runtime, {
    durationSeconds: 30,
    mode: "fixed",
    beamWidth: 4,
  });
  const core = stripLianyingDashPacks(seed.packs);
  const common = {
    durationSeconds: 30,
    startRow: 3,
    endRow: 10,
    beamWidth: 6,
    queueLimit: 16,
    candidateLimit: 12,
  };
  const beam = searchLianyingBoundedLocalBlock(runtime, core, {
    ...common,
    strategy: "beam",
  });
  const bestFirst = searchLianyingBoundedLocalBlock(runtime, core, {
    ...common,
    strategy: "best-first",
    expansionBudget: beam.expandedNodes,
  });

  assert.equal(bestFirst.expandedNodes, beam.expandedNodes);
  assert.ok(bestFirst.trimmedNodes > 0);
  assert.equal(bestFirst.stoppedByWallClock, false);
  assert.ok(bestFirst.completeCandidateCount > 0);
  assert.ok(bestFirst.candidates.some((candidate) => candidate.isIncumbent));
  assert.ok(bestFirst.state.totalDamage >= bestFirst.baselineDamage);
  for (const candidate of bestFirst.candidates) {
    assert.doesNotThrow(() => replayWhitepaperLianying(
      runtime,
      candidate.packs,
      { durationSeconds: 30 },
    ));
    for (let index = common.startRow - 1; index < common.endRow; index += 1) {
      assert.equal(isLianyingFixedAnchorPackAllowed(
        candidate.packs[index],
        core[index],
      ), true);
    }
  }
});

test("最佳优先队列耗尽时按需从下一层正式热启动继续", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const source = JSON.parse(fs.readFileSync(new URL(
    "../output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json",
    import.meta.url,
  )));
  const result = searchLianyingBoundedLocalBlock(
    runtime,
    source.actionPacks,
    {
      startRow: 20,
      endRow: 24,
      strategy: "best-first",
      expansionBudget: 12,
      queueLimit: 2,
      candidateLimit: 4,
    },
  );

  assert.equal(result.warmRestarts, 1);
  assert.equal(result.expandedNodes, 12);
  assert.ok(result.completeCandidateCount > 1);
  assert.ok(result.candidates.some((candidate) => candidate.isIncumbent));
});
