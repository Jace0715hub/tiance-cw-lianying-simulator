import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLianyingForcedRideCounterfactual,
  buildLianyingForcedRideWarmAxes,
  buildLianyingStanceIntervalMacro,
} from
  "../src/policies/lianying-stance-interval-macros.js";

function pack(primary = "dragonFang", prefix = [], tail = []) {
  return { primary, prefix, tail };
}

test("姿态区间宏只开放选定双雷和区间内的真实下马", () => {
  const packs = Array.from({ length: 50 }, () => pack());
  for (const row of [3, 12, 22, 34, 46]) packs[row - 1].prefix.push("thunder");
  for (const row of [3, 12, 22, 34, 45]) packs[row - 1].primary = "ride";
  packs[12 - 1].prefix.push({ id: "dismount", reason: "refresh-ride" });
  packs[17 - 1].tail.push({ id: "dismount", reason: "free-search" });
  packs[28 - 1].prefix.push({ id: "dismount", reason: "free-search" });
  packs[40 - 1].tail.push({ id: "dismount", reason: "free-search" });
  packs[25 - 1].tail.push("orange");

  const macro = buildLianyingStanceIntervalMacro(packs, {
    fromThunderOrdinal: 2,
    toThunderOrdinal: 3,
    thunderSlackRows: 1,
    rideSlackRows: 2,
    dismountSlackRows: 4,
  });

  assert.equal(macro.macroId, "thunder-2-3");
  assert.deepEqual([macro.blockStartRow, macro.blockEndRow], [12, 34]);
  assert.deepEqual(macro.movableThunderOrdinals, [2, 3]);
  assert.deepEqual(macro.movableRideOrdinals, [2, 3]);
  assert.deepEqual(macro.movableDismountOrdinals, [2, 3]);
  assert.deepEqual(
    macro.companionAnchorTemplate.dismountWindows.map(
      ({ earliestRow, latestRow }) => [earliestRow, latestRow],
    ),
    [[12, 12], [13, 21], [24, 32], [40, 40]],
  );
  assert.ok(macro.allowedAnchorSchedules.some(
    (schedule) => JSON.stringify(schedule) === JSON.stringify([2, 11, 21, 33, 45]),
  ));
  assert.ok(macro.allowedAnchorSchedules.every((schedule) =>
    schedule[0] === 2 && schedule[3] === 33 && schedule[4] === 45));
});

test("末组姿态区间以动作轴终点作为右边界", () => {
  const packs = Array.from({ length: 20 }, () => pack());
  for (const row of [2, 10, 18]) packs[row - 1].prefix.push("thunder");
  for (const row of [2, 10, 18]) packs[row - 1].primary = "ride";
  packs[19 - 1].tail.push({ id: "dismount", reason: "free-search" });
  const macro = buildLianyingStanceIntervalMacro(packs, {
    fromThunderOrdinal: 3,
    toThunderOrdinal: 3,
  });
  assert.equal(macro.blockEndRow, 21);
  assert.deepEqual(macro.movableDismountOrdinals, [1]);
});

test("强制任驰骋反事实排除正式行并只开放配对雷", () => {
  const packs = Array.from({ length: 50 }, () => pack());
  for (const row of [3, 12, 22, 34, 46]) packs[row - 1].prefix.push("thunder");
  for (const row of [3, 12, 22, 34, 45]) packs[row - 1].primary = "ride";
  packs[25 - 1].tail.push("orange");
  const counterfactual = buildLianyingForcedRideCounterfactual(packs, {
    rideOrdinal: 3,
  });

  assert.equal(counterfactual.targetRideRow, 22);
  assert.equal(counterfactual.pairedThunderOrdinal, 3);
  assert.deepEqual(
    counterfactual.allowedRideSchedules.map((schedule) => schedule[2]),
    [20, 21, 23, 24],
  );
  assert.ok(counterfactual.allowedRideSchedules.every(
    (schedule) => schedule[2] !== 22));
  assert.ok(counterfactual.allowedAnchorSchedules.every((schedule) =>
    schedule[0] === 2 && schedule[1] === 11 &&
    schedule[3] === 33 && schedule[4] === 45));
  assert.deepEqual(counterfactual.companionAnchorTemplate.orangeRows, [25]);
  assert.equal(
    Object.hasOwn(counterfactual.companionAnchorTemplate, "dismountRows"),
    false,
  );
});

test("强制任驰骋最小热启动覆盖主技能换位和整包换位", () => {
  const packs = Array.from({ length: 20 }, () => pack());
  packs[5].primary = "destroy";
  packs[7] = pack("ride", [{ id: "dismount" }], [{ id: "thunder" }]);
  const counterfactual = {
    rideOrdinal: 2,
    targetRideRow: 8,
    allowedRideSchedules: [[2, 6, 14], [2, 9, 14]],
  };
  const warmAxes = buildLianyingForcedRideWarmAxes(packs, counterfactual);

  assert.equal(warmAxes.length, 4);
  assert.deepEqual(
    warmAxes.map((candidate) => [candidate.kind, candidate.targetRideRow]),
    [
      ["primary-swap", 6],
      ["pack-swap", 6],
      ["primary-swap", 9],
      ["pack-swap", 9],
    ],
  );
  assert.equal(warmAxes[0].packs[5].primary, "ride");
  assert.equal(warmAxes[0].packs[7].primary, "destroy");
  assert.deepEqual(warmAxes[1].packs[5].tail, [{ id: "thunder" }]);
  assert.deepEqual(warmAxes[1].packs[7].tail, []);
});
