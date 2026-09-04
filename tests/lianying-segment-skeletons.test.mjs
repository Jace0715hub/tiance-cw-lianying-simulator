import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLianyingActionCountSkeletons,
  buildLianyingAnchorActionCountSkeletons,
  buildLianyingAnchorCountSkeletons,
  buildLianyingDoubleCountSkeletons,
  lianyingActionCountSkeletonSegments,
  lianyingCountSkeletonSegments,
  lianyingSegmentSkeletonDelta,
  moveLianyingThunderAnchor,
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

test("雷锚点移动到任驰骋末端后按新边界重新统计区段", () => {
  const packs = [
    { prefix: ["thunder"], primary: "dragonFang", tail: [] },
    { prefix: [], primary: "ride", tail: [] },
    { prefix: ["thunder"], primary: "dragonFang", tail: [] },
    { prefix: [], primary: "destroy", tail: [] },
    { prefix: ["thunder"], primary: "dragonFang", tail: [] },
  ];
  const moved = moveLianyingThunderAnchor(packs, 2, 2);
  const thunderRows = moved.flatMap((pack, index) =>
    [...pack.prefix, ...pack.tail].some((action) =>
      (typeof action === "string" ? action : action.id) === "thunder")
      ? [index + 1]
      : []);
  const movedSegments = lianyingCountSkeletonSegments(moved, {
    firstAnchorOrdinal: 1,
    lastAnchorOrdinal: 2,
    trackedActionIds: ["dragonFang", "destroy"],
  });

  assert.deepEqual(thunderRows, [1, 2, 5]);
  assert.deepEqual(moved[1].tail, [{ id: "thunder", leadFrames: 1 }]);
  assert.deepEqual(movedSegments, [
    {
      ordinal: 1,
      startRow: 1,
      endRow: 1,
      counts: { dragonFang: 1, destroy: 0 },
    },
    {
      ordinal: 2,
      startRow: 2,
      endRow: 4,
      counts: { dragonFang: 1, destroy: 1 },
    },
  ]);
});

test("雷表联合骨架把正式区段增量映射到目标雷表真实边界", () => {
  const targetSegments = [
    segments[0],
    {
      ordinal: 4,
      startRow: 59,
      endRow: 77,
      counts: { dragonFang: 1, destroy: 1, dragonRoar: 1, cloudStrike: 0 },
    },
  ];
  const templates = buildLianyingAnchorCountSkeletons(
    segments,
    targetSegments,
    [experiment("s4-roar-to-cloud", 59, 78, {
      dragonFang: 2,
      destroy: 1,
      dragonRoar: 0,
      cloudStrike: 1,
    })],
  );

  assert.equal(templates.length, 1);
  assert.deepEqual(templates[0].affectedSegmentOrdinals, [4]);
  assert.deepEqual(templates[0].constraints, [{
    startRow: 59,
    endRow: 77,
    counts: { dragonFang: 1, destroy: 1, dragonRoar: 0, cloudStrike: 1 },
  }]);
});

test("动作区段统计识别前置与末端断魂刺并生成有限转移模板", () => {
  const packs = [
    { prefix: ["thunder", "charge"], primary: "dragonFang", tail: [] },
    {
      prefix: [],
      primary: "ride",
      tail: [{ id: "charge", leadFrames: 1 }],
    },
    { prefix: ["thunder"], primary: "dragonFang", tail: [] },
    { prefix: ["charge"], primary: "destroy", tail: [] },
    { prefix: ["thunder"], primary: "dragonFang", tail: [] },
  ];
  const actionSegments = lianyingActionCountSkeletonSegments(packs, {
    firstAnchorOrdinal: 1,
    lastAnchorOrdinal: 2,
  });
  const templates = buildLianyingActionCountSkeletons(actionSegments, {
    firstSegmentOrdinal: 1,
    lastSegmentOrdinal: 2,
  });

  assert.deepEqual(actionSegments.map((segment) => segment.counts.charge), [2, 1]);
  assert.equal(templates.length, 6);
  assert.deepEqual(
    templates.find((template) => template.id === "transfer-charge-s1-to-s2")
      .constraints.map((constraint) => constraint.counts.charge),
    [1, 2],
  );
});

test("技能与动作计数都可覆盖末雷之后的终局区段", () => {
  const packs = [
    { prefix: ["thunder"], primary: "dragonFang", tail: [] },
    { prefix: [], primary: "destroy", tail: [] },
    { prefix: ["thunder"], primary: "dragonFang", tail: [] },
    { prefix: ["charge"], primary: "dragonRoar", tail: [] },
    { prefix: [], primary: "dragonFang", tail: [] },
  ];
  const primary = lianyingCountSkeletonSegments(packs, {
    firstAnchorOrdinal: 2,
    lastAnchorOrdinal: 2,
    trackedActionIds: ["dragonFang", "dragonRoar"],
  });
  const actions = lianyingActionCountSkeletonSegments(packs, {
    firstAnchorOrdinal: 2,
    lastAnchorOrdinal: 2,
  });

  assert.deepEqual(primary, [{
    ordinal: 2,
    startRow: 3,
    endRow: 5,
    counts: { dragonFang: 2, dragonRoar: 1 },
  }]);
  assert.deepEqual(actions, [{
    ordinal: 2,
    startRow: 3,
    endRow: 5,
    counts: { charge: 1 },
  }]);
});

test("断魂刺计数增量按新雷边界映射到目标区段", () => {
  const sourceSegments = [
    { ordinal: 5, startRow: 79, endRow: 106, counts: { charge: 1 } },
    { ordinal: 6, startRow: 107, endRow: 127, counts: { charge: 2 } },
  ];
  const targetSegments = [
    { ordinal: 5, startRow: 79, endRow: 105, counts: { charge: 1 } },
    { ordinal: 6, startRow: 106, endRow: 127, counts: { charge: 2 } },
  ];
  const templates = buildLianyingAnchorActionCountSkeletons(
    sourceSegments,
    targetSegments,
    [{
      id: "charge-s6-minus1",
      affectedSegmentOrdinals: [6],
      constraints: [{ startRow: 107, endRow: 127, counts: { charge: 1 } }],
      coreDamageLossRatio: 0.0005,
      bestPacks: [{ primary: "dragonFang" }],
    }],
  );

  assert.equal(templates.length, 1);
  assert.deepEqual(templates[0].constraints, [{
    startRow: 106,
    endRow: 127,
    counts: { charge: 1 },
  }]);
  assert.equal(templates[0].sourceExperimentId, "charge-s6-minus1");
});
