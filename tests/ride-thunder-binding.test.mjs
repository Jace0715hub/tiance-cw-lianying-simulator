import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  identifyRideThunderPairs,
  moveOrangeSuffix,
  moveRidePrimary,
  moveThunderPrefix,
  thunderRowIndices,
} from "../src/policies/ride-thunder-binding.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const rows = fixture.profiles.lianying.rows;

test("原5段连营轴识别为6组任雷与1次单雷", () => {
  const structure = identifyRideThunderPairs(rows);

  assert.equal(structure.pairs.length, 6);
  assert.deepEqual(
    structure.pairs.map((pair) => pair.rowOffset),
    [1, 1, 1, 1, 1, 1],
  );
  assert.deepEqual(structure.soloThunderRows, [51]);
});

test("激雷标记可移到任驰骋同行且不修改原轴", () => {
  const moved = moveThunderPrefix(rows, 1, 0);

  assert.equal(moved[0].skill, "雷任驰骋");
  assert.equal(moved[1].skill, "龙吟");
  assert.equal(rows[0].skill, "任驰骋");
  assert.deepEqual(thunderRowIndices(moved).length, thunderRowIndices(rows).length);
});

test("激雷不能移入另一个已有激雷的行", () => {
  assert.throws(() => moveThunderPrefix(rows, 1, 18), /已有激雷/);
});

test("移动任驰骋时交换主要技能并保留激雷前缀", () => {
  const moved = moveRidePrimary(rows, 0, 1);

  assert.equal(moved[0].skill, "龙吟");
  assert.equal(moved[1].skill, "雷任驰骋");
  assert.equal(rows[0].skill, "任驰骋");
});

test("移动橙武时只改变CW后缀且保留主要技能", () => {
  const source = rows.map((row) => ({ ...row }));
  source[0].skill = "任驰骋-CW";
  const moved = moveOrangeSuffix(source, 0, 1);

  assert.equal(moved[0].skill, "任驰骋");
  assert.equal(moved[1].skill, "雷龙吟-CW");
  assert.equal(source[0].skill, "任驰骋-CW");
});
