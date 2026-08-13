import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  optimizeLianyingTwoSegmentBlockRecombination,
  selectLianyingTwoSegmentBlockCandidates,
} from "../src/policies/lianying-block-recombination.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";

const runtime = loadDefaultGearRuntime({ executePhase: true });
const fixture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/lianying-free-65s-axis.json", import.meta.url),
  "utf8",
));

test("两雷块选择器排除单技能退化并保留合法多技能资源轨迹", () => {
  const donor = structuredClone(fixture);
  [donor[35].primary, donor[36].primary] = [
    donor[36].primary,
    donor[35].primary,
  ];
  replayWhitepaperLianying(runtime, donor, { durationSeconds: 65 });
  const selected = selectLianyingTwoSegmentBlockCandidates(
    runtime,
    fixture,
    [{ sourceId: "swap-36-37", packs: donor }],
    {
      durationSeconds: 65,
      minimumPrimaryDifferences: 2,
      maximumCoreDamageLossRatio: 0.2,
      candidateLimit: 2,
    },
  );
  assert.equal(selected.thunderRows.join("/"), "3/21/39/54");
  assert.equal(selected.selected.length, 1);
  assert.equal(selected.selected[0].blockNumber, 1);
  assert.deepEqual(selected.selected[0].primaryDifferenceRows, [36, 37]);

  const rejected = selectLianyingTwoSegmentBlockCandidates(
    runtime,
    fixture,
    [{ sourceId: "swap-36-37", packs: donor }],
    {
      durationSeconds: 65,
      minimumPrimaryDifferences: 3,
      maximumCoreDamageLossRatio: 0.2,
    },
  );
  assert.equal(rejected.selected.length, 0);
});

test("两雷块邻域只在块内修复并报告是否回归正式结构", () => {
  const donor = structuredClone(fixture);
  [donor[35].primary, donor[36].primary] = [
    donor[36].primary,
    donor[35].primary,
  ];
  const optimized = optimizeLianyingTwoSegmentBlockRecombination(
    runtime,
    fixture,
    [{ sourceId: "swap-36-37", packs: donor }],
    {
      durationSeconds: 65,
      minimumPrimaryDifferences: 2,
      maximumCoreDamageLossRatio: 0.2,
      candidateLimit: 1,
      neighborhood: {
        maxPasses: 1,
        localLookaheadRows: 8,
        shortlistPerHorizon: 32,
        shortlistPerKind: 8,
        fullEvaluationLimit: 64,
      },
      coarseDashStates: 4,
      fullDashStates: 4,
    },
  );
  assert.equal(optimized.optimizedBlocks.length, 1);
  assert.equal(
    typeof optimized.optimizedBlocks[0].convergedToIncumbent,
    "boolean",
  );
  assert.ok(optimized.optimizedBlocks[0].improvements.every((item) =>
    item.startRow >= 3 && item.endRow <= 38));
  assert.ok(optimized.state.totalDamage >= optimized.baselineDamage);
});
