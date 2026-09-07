import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isLianyingCompanionAnchorPackAllowed } from
  "../src/policies/lianying-multisegment-resynthesis.js";
import { buildLianyingRideThunderUsageTemplates } from
  "../src/policies/lianying-ride-thunder-templates.js";

test("离散任驰骋行表只允许仍匹配至少一条完整调度的动作", () => {
  const template = { allowedRideSchedules: [[1, 3], [2, 4]] };
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { primary: "ride" }, 0, template, [],
  ), true);
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { primary: "dragonFang" }, 0, template, [],
  ), true);
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { primary: "ride" }, 1, template, [{ primary: "ride" }],
  ), false);
  assert.equal(isLianyingCompanionAnchorPackAllowed(
    { primary: "dragonFang" }, 2, template, [
      { primary: "dragonFang" },
      { primary: "dragonFang" },
    ],
  ), false);
});

test("正式轴生成六种不同单雷归属并保留既有任雷相位偏移", () => {
  const source = JSON.parse(fs.readFileSync(new URL(
    "../output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json",
    import.meta.url,
  )));
  const built = buildLianyingRideThunderUsageTemplates(source.actionPacks);
  const soloFour = built.templates.find(
    (template) => template.soloThunderOrdinal === 4,
  );

  assert.equal(built.incumbentSoloThunderOrdinal, 5);
  assert.deepEqual(built.phaseOffsets, [0, 0, 0, 0, -1, -3]);
  assert.deepEqual(
    built.templates.map((template) => template.soloThunderOrdinal),
    [5, 1, 2, 3, 4, 6, 7],
  );
  assert.deepEqual(soloFour.rideRows, [3, 20, 38, 79, 106, 125, 143]);
});
