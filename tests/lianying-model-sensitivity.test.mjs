import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { replayWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  compareDismountRidePersistence,
  lianyingRowsToActionPacks,
} from "../src/reports/lianying-model-sensitivity.js";
import {
  analyzeLianyingDivineStackBoundary,
  analyzeLianyingFormulaUncertainty,
  analyzeLianyingOrangeHitBoundary,
  buildLianyingExcelSkillCalibration,
  compareLianyingRankingSensitivity,
  scoreLianyingStateWithSkillCalibration,
} from "../src/reports/lianying-ranking-sensitivity.js";

test("橙武命中边界取四个窗口最后一牙的最小严格余量", () => {
  const timeline = [0, 10000].flatMap((startTick) => [
    {
      type: "offGcd",
      tick: startTick,
      timeMs: startTick / 16,
      action: "orange",
    },
    ...[100, 200, 300, 400, 500].map((offset) => ({
      type: "cast",
      tick: startTick + offset,
      timeMs: (startTick + offset) / 16,
      action: "dragonFang",
    })),
  ]);
  const report = analyzeLianyingOrangeHitBoundary([
    { id: "formal", state: { timeline } },
    { id: "candidate", state: { timeline: structuredClone(timeline) } },
  ], {
    durationMs: 40,
    representativeHitDelaysMs: [0, 8.75, 9],
  });
  assert.equal(report.globalSafeHitDelayExclusiveMs, 8.75);
  assert.equal(report.candidateBoundariesEquivalent, true);
  assert.deepEqual(
    report.candidates[0].representativeHitDelays.map(
      (row) => row.castAndHitJudgmentEquivalent,
    ),
    [true, false, false],
  );
});

test("橙武命中边界识别候选窗口覆盖差异", () => {
  const state = (lastTick) => ({ timeline: [
    { type: "offGcd", tick: 0, timeMs: 0, action: "orange" },
    ...[10, 20, 30, 40, lastTick].map((tick) => ({
      type: "cast",
      tick,
      timeMs: tick / 16,
      action: "dragonFang",
    })),
  ] });
  const report = analyzeLianyingOrangeHitBoundary([
    { id: "formal", state: state(50) },
    { id: "candidate", state: state(60) },
  ], { durationMs: 4 });
  assert.equal(report.candidateBoundariesEquivalent, false);
  assert.equal(report.candidates[0].safeHitDelayExclusiveMs, 0.875);
  assert.equal(report.candidates[1].safeHitDelayExclusiveMs, 0.25);
});

test("神兵无双边界按玩家命中而不是派生伤害事件计层", () => {
  const hit = (tick, action, extras = {}) => ({
    type: action === "dash" ? "offGcd" : "cast",
    tick,
    timeMs: tick,
    action,
    ...extras,
  });
  const sharedTimeline = [
    { type: "damage", tick: 0, timeMs: 0, component: "autoAttack" },
    hit(0, "destroy"),
    { type: "damage", tick: 0, timeMs: 0, component: "destroyPoLouLan" },
    hit(1000, "dragonFang"),
    hit(1100, "dash"),
    hit(2000, "dragonFang", { thunder: true }),
    hit(3000, "dragonFang", { thunder: true }),
    hit(8000, "dragonFang"),
  ];
  const report = analyzeLianyingDivineStackBoundary([
    { id: "formal", state: { timeline: sharedTimeline } },
    { id: "candidate", state: { timeline: structuredClone(sharedTimeline) } },
  ]);
  assert.equal(report.candidates[0].hitCount, 6);
  assert.equal(report.candidates[0].fullStacksAtMs, 3000);
  assert.equal(report.candidates[0].maxGapAfterFullMs, 5000);
  assert.equal(report.openingPlayerHitStateEquivalent, true);
  assert.equal(report.allReachAndKeepFullStacks, true);
  assert.equal(report.candidateSpecificStackPathRisk, false);
});

test("神兵无双边界识别开场叠层差异和六秒断层", () => {
  const state = (fifthAction, finalTime) => ({ timeline: [
    { type: "cast", tick: 0, timeMs: 0, action: "destroy" },
    { type: "cast", tick: 1000, timeMs: 1000, action: "dragonFang" },
    { type: "offGcd", tick: 1100, timeMs: 1100, action: "dash" },
    { type: "cast", tick: 2000, timeMs: 2000, action: "dragonFang" },
    { type: "cast", tick: 3000, timeMs: 3000, action: fifthAction },
    { type: "cast", tick: finalTime, timeMs: finalTime, action: "dragonFang" },
  ] });
  const report = analyzeLianyingDivineStackBoundary([
    { id: "formal", state: state("dragonFang", 8000) },
    { id: "candidate", state: state("dragonRoar", 9000) },
  ]);
  assert.equal(report.openingPlayerHitStateEquivalent, false);
  assert.equal(report.allReachAndKeepFullStacks, false);
  assert.equal(report.candidateSpecificStackPathRisk, true);
});

test("公式误差分析给出可验证的单组翻盘阈值", () => {
  const candidates = [
    {
      id: "formal",
      eventDamage: 100,
      calibratedDamage: 100,
      skillRows: [
        { skill: "甲", eventDamage: 80, calibratedDamage: 80 },
      ],
    },
    {
      id: "candidate",
      eventDamage: 95,
      calibratedDamage: 95,
      skillRows: [
        { skill: "甲", eventDamage: 90, calibratedDamage: 90 },
      ],
    },
  ];
  const report = analyzeLianyingFormulaUncertainty(candidates, {
    groups: [{ id: "a", label: "甲", skills: ["甲"] }],
    grids: [{ id: "test", levels: [1, 1.5, 2] }],
  });
  const threshold = report.native.singleGroupBreakEvens[0].groups[0];
  assert.equal(threshold.breakEvenMultiplier, 1.5);
  assert.equal(threshold.requiredRelativeChange, 0.5);
  assert.equal(threshold.crossingDirection, "increase");
  assert.equal(report.native.grids[0].scenarioCount, 3);
  assert.equal(report.native.grids[0].winnerCounts.formal, 2);
  assert.equal(report.native.grids[0].winnerCounts.candidate, 1);
});

test("公式误差联合网格保留中期资源候选但只按完整伤害判胜", () => {
  const candidates = [
    {
      id: "formal",
      eventDamage: 100,
      calibratedDamage: 100,
      skillRows: [
        { skill: "甲", eventDamage: 60, calibratedDamage: 60 },
        { skill: "乙", eventDamage: 40, calibratedDamage: 40 },
      ],
    },
    {
      id: "candidate",
      eventDamage: 90,
      calibratedDamage: 90,
      skillRows: [
        { skill: "甲", eventDamage: 65, calibratedDamage: 65 },
        { skill: "乙", eventDamage: 25, calibratedDamage: 25 },
      ],
    },
  ];
  const report = analyzeLianyingFormulaUncertainty(candidates, {
    groups: [
      { id: "a", label: "甲", skills: ["甲"] },
      { id: "b", label: "乙", skills: ["乙"] },
      { id: "unused", label: "未使用", skills: ["丙"] },
    ],
    grids: [{ id: "stable", levels: [0.9, 1, 1.1] }],
  });
  const basis = report.native;
  assert.equal(basis.grids[0].scenarioCount, 27);
  assert.equal(basis.grids[0].baselineWinsAllScenarios, true);
  assert.equal(
    basis.singleGroupBreakEvens[0].groups.find(
      (group) => group.groupId === "unused",
    ).breakEvenMultiplier,
    null,
  );
});

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

test("流血校准按普通流血与战心品质分别映射", () => {
  const scored = scoreLianyingStateWithSkillCalibration({
    timeline: [
      {
        type: "damage",
        component: "bleedTick",
        bleedQuality: 1,
        amount: 100,
      },
      {
        type: "damage",
        component: "bleedTick",
        bleedQuality: 2,
        amount: 200,
      },
    ],
  }, {
    流血: { factor: 2 },
    "流血-战心": { factor: 3 },
  });
  assert.equal(scored.calibratedDamage, 800);
  assert.equal(scored.rows.find((row) => row.skill === "流血").count, 1);
  assert.equal(scored.rows.find((row) => row.skill === "流血-战心").count, 1);
});

test("动作差异包含同一技能的GCD内提前帧", () => {
  const candidates = [
    {
      id: "formal",
      packs: [{
        primary: "ride",
        tail: [{ id: "thunder", leadFrames: 7 }],
      }],
      state: { totalDamage: 100, timeline: [] },
    },
    {
      id: "timing",
      packs: [{
        primary: "ride",
        tail: [{ id: "thunder", leadFrames: 1 }],
      }],
      state: { totalDamage: 99, timeline: [] },
    },
  ];
  const report = compareLianyingRankingSensitivity(candidates, {});
  assert.equal(report.candidates[1].firstDifferenceRow, 1);
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
