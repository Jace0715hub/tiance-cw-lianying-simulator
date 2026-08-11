import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  compareDismountRidePersistence,
  lianyingRowsToActionPacks,
} from "../src/reports/lianying-model-sensitivity.js";

test("旧版逐行JSON可以恢复前置和GCD末端非GCD动作", () => {
  const packs = lianyingRowsToActionPacks([
    {
      rowNumber: 1,
      skill: "任驰骋→雷+CW",
      castSeconds: 2,
      endSeconds: 3.2175,
      offGcdActions: [
        { action: "dismount", seconds: 2, reason: "refresh-ride" },
        { action: "thunder", seconds: 3.155 },
        { action: "orange", seconds: 3.155 },
      ],
    },
  ]);
  assert.deepEqual(packs, [{
    prefix: [{ id: "dismount", reason: "refresh-ride" }],
    primary: "ride",
    tail: [
      { id: "thunder", leadFrames: 1 },
      { id: "orange", leadFrames: 1 },
    ],
  }]);
});

test("固定轴反事实报告量化下马清除驰骋增益的伤害差", () => {
  const runtime = loadDefaultGearRuntime({ executePhase: true });
  const packs = [
    { primary: "ride", tail: [{ id: "thunder", leadFrames: 1 }] },
    { prefix: ["dismount"], primary: "dragonFang" },
    { primary: "dragonFang" },
  ];
  const replay = replayWhitepaperLianying(runtime, packs, {
    durationSeconds: 5,
  });
  assert.ok(replay.state.totalDamage > 0);
  const report = compareDismountRidePersistence(runtime, packs, {
    durationSeconds: 5,
  });
  assert.ok(report.dependency.damageDelta > 0);
  assert.ok(report.dependency.affectedComponents.length > 0);
});
