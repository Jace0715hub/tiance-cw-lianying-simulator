import assert from "node:assert/strict";
import test from "node:test";
import { buildLianyingStanceIntervalMacro } from
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

