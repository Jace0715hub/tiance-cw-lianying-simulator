import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  insertLianyingWaitBeforeRow,
  lianyingWaitAnchorRows,
  searchLianyingWaitAnchors,
  selectLianyingNonPositivePairWaitSeeds,
  selectLianyingPairWaitSeeds,
} from "../src/policies/lianying-wait-search.js";
import { isLianyingFixedAnchorPackAllowed } from
  "../src/policies/lianying-best-first-resynthesis.js";

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

test("双等待种子保留同锚点不同收益平台的最短等待", () => {
  const candidate = (rowNumber, waitFrames, totalDamage, damageGain) => ({
    rowNumber,
    waitFrames,
    state: { totalDamage },
    damageGain,
  });
  const seeds = selectLianyingPairWaitSeeds([
    candidate(128, 6, 300, 30),
    candidate(128, 7, 300, 30),
    candidate(125, 6, 290, 20),
    candidate(125, 4, 280, 10),
    candidate(125, 5, 280, 10),
    candidate(100, 2, 269, -1),
  ]);
  assert.deepEqual(
    seeds.map(({ rowNumber, waitFrames }) => [rowNumber, waitFrames]),
    [[128, 6], [125, 6], [125, 4]],
  );
});

test("无单点收益双等待种子按锚点保留最接近零的最短代表", () => {
  const candidate = (rowNumber, waitFrames, damageGain) => ({
    rowNumber,
    waitFrames,
    state: { totalDamage: 100 + damageGain },
    damageGain,
  });
  const seeds = selectLianyingNonPositivePairWaitSeeds([
    candidate(20, 1, 0),
    candidate(20, 2, 0),
    candidate(20, 3, -10),
    candidate(38, 1, 2),
    candidate(38, 2, -3),
    candidate(38, 3, -1),
  ]);
  assert.deepEqual(
    seeds.map(({ rowNumber, waitFrames, damageGain }) =>
      [rowNumber, waitFrames, damageGain]),
    [[20, 1, 0], [38, 3, -1]],
  );
});

test("局部重合成把等待视为与雷和任驰骋相同的固定锚点", () => {
  const wait = { primary: { id: "wait", frames: 4 } };
  assert.equal(isLianyingFixedAnchorPackAllowed(wait, wait), true);
  assert.equal(
    isLianyingFixedAnchorPackAllowed({ primary: "dragonFang" }, wait),
    false,
  );
  assert.equal(
    isLianyingFixedAnchorPackAllowed(wait, { primary: "dragonFang" }),
    false,
  );
});

test("两处共6帧等待比单等待正式轴更高且保持主要技能数", () => {
  const source = JSON.parse(fs.readFileSync(new URL(
    "../output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json",
    import.meta.url,
  )));
  const current = JSON.parse(fs.readFileSync(new URL(
    "../output/lianying-free-fixed-180s-anchor-wait.json",
    import.meta.url,
  )));
  const runtime = loadDefaultGearRuntime({
    rotation: "lianying",
    executePhase: true,
  });
  const first = insertLianyingWaitBeforeRow(source.actionPacks, 125, 4);
  const pair = insertLianyingWaitBeforeRow(first, 129, 2);
  const result = searchLianyingWaitAnchors(runtime, first, {
    durationSeconds: 180,
    candidateRows: [129],
    maxWaitFrames: 2,
    preserveCastCount: true,
  });
  assert.equal(result.best.waitFrames, 2);
  assert.equal(result.best.castCount, result.baselineCastCount);
  assert.deepEqual(result.best.packs, pair);
  assert.ok(
    Math.abs(
      result.best.state.totalDamage - current.summary.rotationDamage - 34_450.553824424744,
    ) < 1e-6,
  );
});
