import assert from "node:assert/strict";
import test from "node:test";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  extractLianyingAnchorTemplate,
  lianyingAnchorTemplateToCsv,
} from "../src/reports/lianying-anchor-template.js";

test("锚点模板只读抽取雷、橙武、任驰骋和下马及其资源快照", () => {
  const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
  const packs = [
    { primary: "destroy" },
    {
      primary: "ride",
      tail: [
        { id: "thunder", leadFrames: 1 },
        { id: "orange", leadFrames: 1 },
      ],
    },
    { primary: "dragonFang" },
    { prefix: [{ id: "dismount", reason: "audit" }], primary: "dragonFang" },
  ];
  const original = structuredClone(packs);
  const report = extractLianyingAnchorTemplate(runtime, packs, {
    durationSeconds: 10,
  });

  assert.deepEqual(packs, original);
  assert.deepEqual(report.compactTemplate, {
    thunderRows: [2],
    orangeRows: [2],
    rideRows: [2],
    dismountRows: [4],
  });
  assert.equal(report.summary.totalAnchors, 4);
  assert.equal(report.summary.sameRowRideThunder, 1);
  assert.equal(report.summary.thunderWithoutRideOverlap, 0);
  assert.equal(report.byType.ride[0].placement, "primary");
  assert.equal(report.byType.thunder[0].placement, "tail");
  assert.equal(report.byType.dismount[0].placement, "prefix");
  assert.equal(report.byType.thunder[0].eventState.rideActive, true);
  assert.equal(report.byType.dismount[0].reason, "audit");
  assert.ok(report.byType.thunder[0].rowStart.charges.thunder.ready > 0);
  assert.ok(report.thunderSegments[0].rideThunderOverlapSeconds > 0);

  const csv = lianyingAnchorTemplateToCsv(report);
  assert.match(csv, /thunder-\d+,thunder,1,2,tail/);
  assert.match(csv, /dismount-\d+,dismount,1,4,prefix/);
});
