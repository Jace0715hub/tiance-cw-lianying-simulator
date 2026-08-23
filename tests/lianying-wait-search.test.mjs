import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  insertLianyingWaitBeforeRow,
  lianyingWaitAnchorRows,
  searchLianyingWaitAnchors,
} from "../src/policies/lianying-wait-search.js";

const actionId = (action) =>
  typeof action === "string" ? action : action?.id;

test("短等待搜索以雷橙武与任驰骋为高层锚点", () => {
  const packs = [
    { primary: "destroy" },
    { primary: "ride", tail: [{ id: "thunder", leadFrames: 1 }] },
    { prefix: ["orange"], primary: "dragonFang" },
    { primary: "dragonFang" },
  ];
  assert.deepEqual(lianyingWaitAnchorRows(packs), [2, 3]);
  const inserted = insertLianyingWaitBeforeRow(packs, 2, 6);
  assert.equal(inserted.length, packs.length + 1);
  assert.equal(actionId(inserted[1].primary), "wait");
  assert.equal(inserted[1].primary.frames, 6);
  assert.equal(actionId(packs[1].primary), "ride");
});

test("180秒正式轴在末次雷前等待6帧可多一跳流血且不少主要技能", () => {
  const source = JSON.parse(fs.readFileSync(new URL(
    "../output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json",
    import.meta.url,
  )));
  const runtime = loadDefaultGearRuntime({
    rotation: "lianying",
    executePhase: true,
  });
  const result = searchLianyingWaitAnchors(runtime, source.actionPacks, {
    durationSeconds: 180,
    candidateRows: [128],
    maxWaitFrames: 6,
    preserveCastCount: true,
  });
  assert.equal(result.explored, 6);
  assert.equal(result.best.rowNumber, 128);
  assert.equal(result.best.waitFrames, 6);
  assert.equal(result.best.castCount, result.baselineCastCount);
  assert.ok(Math.abs(result.best.damageGain - 699_221.6229863167) < 1e-6);
  const bleedGain =
    result.best.state.damageBreakdown.bleedTick -
    result.baseline.state.damageBreakdown.bleedTick;
  assert.ok(Math.abs(bleedGain - result.best.damageGain) < 1e-6);
});
