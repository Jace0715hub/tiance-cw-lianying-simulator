import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  compareDismountRidePersistence,
  lianyingRowsToActionPacks,
} from "../src/reports/lianying-model-sensitivity.js";
import {
  buildLianyingExcelSkillCalibration,
  compareLianyingRankingSensitivity,
  scoreLianyingStateWithSkillCalibration,
} from "../src/reports/lianying-ranking-sensitivity.js";

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

test("Excel技能分项校准按基准伤害比缩放同技能候选伤害", () => {
  const calibration = buildLianyingExcelSkillCalibration({
    rows: [{
      skill: "龙牙",
      excelDamage: 200,
      simulatedDamage: 100,
      excelCount: 1,
      simulatedCount: 1,
    }],
  });
  const scored = scoreLianyingStateWithSkillCalibration({
    timeline: [
      { type: "damage", component: "dragonFang", amount: 50 },
      { type: "damage", component: "cloudStrike", amount: 25 },
    ],
  }, calibration);
  assert.equal(scored.eventDamage, 75);
  assert.equal(scored.calibratedDamage, 125);
  assert.equal(scored.rows.find((row) => row.skill === "龙牙").factor, 2);
  assert.equal(scored.rows.find((row) => row.skill === "穿云").factor, 1);
});

test("排序敏感性同时报告名次翻转与开场事件是否一致", () => {
  const packs = [{ primary: "dragonFang" }];
  const candidates = [
    {
      id: "formal",
      packs,
      state: {
        totalDamage: 200,
        timeline: [
          { type: "damage", tick: 0, component: "dragonFang", amount: 100 },
          { type: "damage", tick: 1, component: "cloudStrike", amount: 100 },
        ],
      },
    },
    {
      id: "candidate",
      packs: [{ primary: "cloudStrike" }],
      state: {
        totalDamage: 202,
        timeline: [
          { type: "damage", tick: 0, component: "dragonFang", amount: 90 },
          { type: "damage", tick: 1, component: "cloudStrike", amount: 112 },
        ],
      },
    },
  ];
  const report = compareLianyingRankingSensitivity(candidates, {
    龙牙: { factor: 2 },
  }, { openingDamageEventCount: 1 });
  assert.deepEqual(report.eventRanking, ["candidate", "formal"]);
  assert.deepEqual(report.calibratedRanking, ["formal", "candidate"]);
  assert.equal(report.rankingStable, false);
  assert.equal(report.winnerStable, false);
  assert.equal(report.openingBoundaryEquivalent, false);
  assert.equal(report.candidates[1].firstDifferenceRow, 1);
});
