import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLianyingDoubleCountSkeletons,
  lianyingSegmentSkeletonDelta,
} from "../src/policies/lianying-segment-skeletons.js";

const segments = [
  {
    ordinal: 3,
    startRow: 38,
    endRow: 58,
    counts: { dragonFang: 2, destroy: 1, dragonRoar: 1, cloudStrike: 0 },
  },
  {
    ordinal: 4,
    startRow: 59,
    endRow: 78,
    counts: { dragonFang: 2, destroy: 1, dragonRoar: 1, cloudStrike: 0 },
  },
];

function experiment(id, startRow, endRow, counts, loss = 0.001) {
  return {
    id,
    constraints: [{ startRow, endRow, counts }],
    coreDamageLossRatio: loss,
    bestPacks: [{ primary: "dragonFang" }],
  };
}

test("单区段计数骨架规范化为相对正式计数的增量", () => {
  const delta = lianyingSegmentSkeletonDelta(
    segments,
    experiment("s3-destroy-to-roar", 38, 58, {
      dragonFang: 2,
      destroy: 0,
      dragonRoar: 2,
      cloudStrike: 0,
    }),
  );

  assert.deepEqual(delta["38-58"], {
    cloudStrike: 0,
    destroy: -1,
    dragonFang: 0,
    dragonRoar: 1,
  });
  assert.deepEqual(delta["59-78"], {
    cloudStrike: 0,
    destroy: 0,
    dragonFang: 0,
    dragonRoar: 0,
  });
});

test("双计数骨架排除退化为已有单骨架的组合并覆盖中间区段", () => {
  const experiments = [
    experiment("s3-destroy-to-roar", 38, 58, {
      dragonFang: 2,
      destroy: 0,
      dragonRoar: 2,
      cloudStrike: 0,
    }),
    experiment("s3-roar-to-cloud", 38, 58, {
      dragonFang: 2,
      destroy: 1,
      dragonRoar: 0,
      cloudStrike: 1,
    }),
    experiment("s3-destroy-to-cloud", 38, 58, {
      dragonFang: 2,
      destroy: 0,
      dragonRoar: 1,
      cloudStrike: 1,
    }),
    experiment("s4-roar-to-cloud", 59, 78, {
      dragonFang: 2,
      destroy: 1,
      dragonRoar: 0,
      cloudStrike: 1,
    }),
    experiment("ignored-high-loss", 59, 78, {
      dragonFang: 2,
      destroy: 0,
      dragonRoar: 2,
      cloudStrike: 0,
    }, 0.02),
  ];
  const built = buildLianyingDoubleCountSkeletons(
    segments,
    experiments,
    { limit: 8 },
  );

  assert.equal(built.eligibleSingleSkeletonCount, 4);
  assert.ok(built.skeletons.length > 0);
  assert.ok(built.skeletons.every((skeleton) =>
    !skeleton.sourceExperimentIds.includes("ignored-high-loss")));
  assert.ok(!built.skeletons.some((skeleton) =>
    skeleton.sourceExperimentIds.includes("s3-destroy-to-roar") &&
    skeleton.sourceExperimentIds.includes("s3-roar-to-cloud")));
  const spanning = built.skeletons.find((skeleton) =>
    skeleton.sourceExperimentIds.includes("s3-destroy-to-cloud") &&
    skeleton.sourceExperimentIds.includes("s4-roar-to-cloud"));
  assert.deepEqual(spanning.affectedSegmentOrdinals, [3, 4]);
  assert.deepEqual(spanning.constraints.map((constraint) => [
    constraint.startRow,
    constraint.endRow,
  ]), [[38, 58], [59, 78]]);
});
