import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  LIANYING_POLICY_MODES,
  buildWhitepaperOpener,
  legalMechanicalLianyingPacks,
  legalWhitepaperPacks,
  labelWhitepaperPack,
  optimizeLianyingAxis,
  optimizeLianyingDashOverlay,
  optimizeLianyingNeighborhoodAxis,
  optimizeLianyingReferenceAxis,
  replayWhitepaperLianying,
  searchLianyingAxis,
  searchWhitepaperLianying,
} from "../src/policies/whitepaper-lianying.js";
import { createInitialState } from "../src/engine/state.js";
import { executeActionPack } from "../src/engine/simulator.js";
import { frameToTicks } from "../src/engine/clock.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";
import {
  compareLianyingAxes,
  lianyingConvergenceToCsv,
} from "../src/reports/lianying-convergence.js";

const runtime = loadDefaultGearRuntime({ executePhase: true });
const free65Axis = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/lianying-free-65s-axis.json", import.meta.url),
    "utf8",
  ),
);

test("连营研究模式明确区分严格、引导和自由", () => {
  assert.deepEqual(LIANYING_POLICY_MODES, ["strict", "guided", "free"]);
});

test("5豆橙武连营起手固定为牙灭任驰骋末端雷与橙武", () => {
  const opener = buildWhitepaperOpener();
  assert.deepEqual(opener.map(labelWhitepaperPack), [
    "龙牙",
    "灭",
    "任驰骋→雷+CW",
  ]);
  const replay = replayWhitepaperLianying(
    runtime,
    [...opener, { primary: "dragonFang" }],
    { durationSeconds: 5 },
  );
  const casts = replay.state.timeline.filter((event) => event.type === "cast");
  const offGcd = replay.state.timeline.filter((event) => event.type === "offGcd");
  assert.deepEqual(casts.map((event) => event.action), [
    "dragonFang",
    "destroy",
    "ride",
    "dragonFang",
  ]);
  assert.deepEqual(offGcd.map((event) => event.action), ["thunder", "orange"]);
  assert.equal(offGcd[0].rageBefore, 5);
  assert.ok(offGcd[0].tick > casts[2].tick);
});

test("白皮书约束搜索不产生高豆断魂刺、雷内穿云和错误开雷", () => {
  const result = searchWhitepaperLianying(runtime, {
    durationSeconds: 60,
    mode: "stable",
    beamWidth: 8,
  });
  const audit = auditWhitepaperAxis(result.state, { mode: "stable" });
  assert.equal(audit.passed, true);
  assert.equal(audit.violations.thunderStartsNotFive, 0);
  assert.equal(audit.violations.chargesAtHighRage, 0);
  assert.equal(audit.violations.cloudStrikesUnderThunder, 0);
  assert.equal(audit.violations.stableMountedFangsOutsideThunder, 0);
  assert.ok(audit.thunderPatterns.lowStackChargeFirstWindows > 0);
});

test("低于9层龙驭的马上雷把断魂刺前置为第一次补豆", () => {
  let state = createInitialState(runtime.config, {
    rage: 5,
    dragonRideStacks: 1,
    cooldownReady: { orange: 999 },
    executePhase: true,
  });
  state = executeActionPack(
    state,
    { primary: "ride", tail: [{ id: "thunder", leadFrames: 1 }] },
    runtime.config,
    runtime.oracle,
  );
  for (let index = 0; index < 3; index += 1) {
    state = executeActionPack(
      state,
      { primary: "dragonFang" },
      runtime.config,
      runtime.oracle,
    );
  }
  const packs = legalWhitepaperPacks(state, runtime.config, { mode: "stable" });
  const chargePack = packs.find((pack) =>
    (pack.prefix ?? []).some((action) =>
      (typeof action === "string" ? action : action.id) === "charge"),
  );
  assert.ok(chargePack);
  assert.equal(
    typeof chargePack.primary === "string" ? chargePack.primary : chargePack.primary.id,
    "dragonFang",
  );
});

test("龙吟补豆且下一雷不能直连时在12牙后等待雷结束", () => {
  const state = createInitialState(runtime.config, {
    frame: 200,
    gcdReadyFrame: 200,
    rage: 1,
    buffs: { thunderFrom: 0, thunderUntil: 288 },
    executePhase: true,
    timeline: [
      {
        sequence: 1,
        tick: 0,
        timeMs: 0,
        type: "offGcd",
        action: "thunder",
        dragonRideStacksAtStart: 0,
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        sequence: index + 2,
        tick: frameToTicks(index + 1),
        type: "cast",
        action: "dragonFang",
        thunder: true,
      })),
      {
        sequence: 14,
        tick: frameToTicks(100),
        type: "cast",
        action: "dragonRoar",
        thunder: true,
      },
    ],
    sequence: 14,
  });
  state.chargeTicks.thunder.ready = 0;
  state.chargeTicks.thunder.rechargeQueue = [frameToTicks(1000), frameToTicks(2000)];
  const packs = legalWhitepaperPacks(state, runtime.config, { mode: "stable" });
  assert.equal(packs.length, 1);
  assert.match(packs[0].label, /12牙保豆/);
});

test("零层龙驭且任雷均可用时选择马下单雷", () => {
  const state = createInitialState(runtime.config, {
    rage: 5,
    dragonRideStacks: 0,
    executePhase: true,
  });
  const packs = legalWhitepaperPacks(state, runtime.config, { mode: "stable" });
  assert.ok(packs.length > 0);
  assert.equal(packs.some((pack) =>
    (typeof pack.primary === "string" ? pack.primary : pack.primary.id) === "ride"), false);
  assert.equal(packs.every((pack) =>
    (pack.prefix ?? []).some((action) =>
      (typeof action === "string" ? action : action.id) === "thunder")), true);
});

test("双雷可直连且前雷剩4豆时允许用龙吟完成灭吟式补豆", () => {
  const state = createInitialState(runtime.config, {
    frame: 300,
    gcdReadyFrame: 300,
    rage: 4,
    dragonRideStacks: 3,
    buffs: { thunderFrom: 0, thunderUntil: 290 },
    executePhase: true,
  });
  const packs = legalWhitepaperPacks(state, runtime.config, { mode: "stable" });
  assert.equal(packs.some((pack) =>
    (typeof pack.primary === "string" ? pack.primary : pack.primary.id) ===
      "dragonRoar"), true);
});

test("自由动作空间允许游戏合法的高豆雷外断魂刺", () => {
  const state = createInitialState(runtime.config, {
    rage: 5,
    mounted: true,
    mountedFrom: 0,
    dragonRideStacks: 5,
    executePhase: true,
  });
  const packs = legalMechanicalLianyingPacks(state, runtime.config);
  const pack = packs.find((candidate) =>
    (candidate.prefix ?? []).some((action) =>
      (typeof action === "string" ? action : action.id) === "charge") &&
    !(candidate.prefix ?? []).some((action) =>
      (typeof action === "string" ? action : action.id) === "thunder"));
  assert.ok(pack);
});

test("资源浪费和白皮书偏离不再被判为游戏机制非法", () => {
  const initial = createInitialState(runtime.config, {
    rage: 5,
    mounted: true,
    mountedFrom: 0,
    dragonRideStacks: 5,
    executePhase: true,
  });
  const state = executeActionPack(
    initial,
    { prefix: ["charge"], primary: "dragonFang" },
    runtime.config,
    runtime.oracle,
  );
  const audit = auditWhitepaperAxis(state, { mode: "fixed" });
  assert.equal(audit.passedMechanics, true);
  assert.equal(audit.hardViolationCount, 0);
  assert.equal(audit.resourceWaste.highRageCharges, 1);
  assert.equal(audit.resourceWaste.rageOverflow, 3);
  assert.equal(audit.whitepaperStrategy.passed, false);
  assert.equal(audit.whitepaperStrategy.deviations.chargesOutsideThunder, 1);
});

test("任驰骋龙驭溢出记录为资源浪费而非机制非法", () => {
  const initial = createInitialState(runtime.config, {
    rage: 5,
    dragonRideStacks: runtime.config.maxDragonRideStacks - 2,
    executePhase: true,
  });
  const state = executeActionPack(
    initial,
    { primary: "ride" },
    runtime.config,
    runtime.oracle,
  );
  const audit = auditWhitepaperAxis(state, { mode: "fixed" });
  assert.equal(audit.passedMechanics, true);
  assert.equal(audit.resourceWaste.dragonRideOverflow, 4);
  assert.equal(audit.violations.rideOverflowEvents, 1);
});

test("自由搜索从完整机制动作空间生成并返回可审计技能轴", () => {
  const result = searchLianyingAxis(runtime, {
    durationSeconds: 12,
    mode: "fixed",
    policyMode: "free",
    beamWidth: 2,
  });
  const replay = replayWhitepaperLianying(runtime, result.packs, {
    durationSeconds: 12,
  });
  const audit = auditWhitepaperAxis(replay.state, { mode: "fixed" });
  assert.equal(result.policyMode, "free");
  assert.equal(audit.mechanics.passed, true);
  assert.ok(result.explored > result.legal);
});

test("自由搜索可钉住严格模式热启动轴并保证最终结果不降级", () => {
  const strict = searchWhitepaperLianying(runtime, {
    durationSeconds: 12,
    mode: "fixed",
    beamWidth: 2,
  });
  const free = searchLianyingAxis(runtime, {
    durationSeconds: 12,
    mode: "fixed",
    policyMode: "free",
    beamWidth: 2,
    warmStartPacks: strict.packs,
  });
  assert.equal(free.warmStarted, true);
  assert.ok(free.state.totalDamage >= strict.state.totalDamage);
  assert.ok(free.telemetry.layers.length > 0);
  assert.equal(
    free.telemetry.layers.reduce(
      (total, layer) => total + layer.exploredTransitions,
      0,
    ),
    free.explored,
  );
  assert.equal(
    free.telemetry.layers.reduce(
      (total, layer) => total + layer.legalTransitions,
      0,
    ),
    free.legal,
  );
});

test("自由搜索可同时钉住多条热启动轴", () => {
  const strict = searchWhitepaperLianying(runtime, {
    durationSeconds: 12,
    mode: "fixed",
    beamWidth: 2,
  });
  const alternative = searchLianyingAxis(runtime, {
    durationSeconds: 12,
    mode: "fixed",
    policyMode: "free",
    beamWidth: 2,
  });
  const free = searchLianyingAxis(runtime, {
    durationSeconds: 12,
    mode: "fixed",
    policyMode: "free",
    beamWidth: 1,
    warmStartAxes: [strict.packs, alternative.packs],
  });
  assert.equal(free.warmStartCount, 2);
  assert.equal(free.warmStartDamages.length, 2);
  assert.ok(
    free.state.totalDamage >= Math.max(...free.warmStartDamages),
  );
  assert.ok(free.telemetry.peakBeamSize >= 2);
});

test("突覆盖搜索在固定主要技能轴上自动选择马下破军窗口", () => {
  const packs = [
    { primary: "dragonFang" },
    { primary: "cloudStrike" },
    { primary: "cloudStrike" },
    { primary: "cloudStrike" },
  ];
  const optimized = optimizeLianyingDashOverlay(runtime, packs, {
    durationSeconds: 5,
  });
  const dashes = optimized.state.timeline.filter(
    (event) => event.type === "offGcd" && event.action === "dash",
  );
  const dashBreakArmy = optimized.state.timeline.filter(
    (event) =>
      event.type === "damage" &&
      event.component === "breakArmy" &&
      event.trigger === "dash",
  );
  assert.equal(optimized.dashCount, 1);
  assert.equal(dashes[0].mounted, false);
  assert.equal(dashes[0].breakArmyWindow, true);
  assert.equal(dashBreakArmy.length, 1);
  assert.ok(optimized.damageGain > 0);
});

test("五段加速参考重排只接受合法且提高整段伤害的候选", () => {
  const optimized = optimizeLianyingReferenceAxis(runtime, free65Axis, {
    durationSeconds: 65,
  });
  assert.equal(optimized.illegalCandidates, 0);
  assert.deepEqual(
    optimized.improvements.map((item) => item.startRow).sort((a, b) => a - b),
    [19, 36],
  );
  assert.ok(Math.abs(optimized.damageGain - 6_777_671.43371737) < 1e-6);
  const replay = replayWhitepaperLianying(runtime, optimized.packs, {
    durationSeconds: 65,
  });
  assert.equal(replay.state.totalDamage, optimized.state.totalDamage);
});

test("通用关键行邻域无需行号规则即可自动换位且不降级", () => {
  const reference = optimizeLianyingReferenceAxis(runtime, free65Axis, {
    durationSeconds: 65,
  });
  const optimized = optimizeLianyingNeighborhoodAxis(
    runtime,
    reference.packs,
    {
      durationSeconds: 65,
      maxPasses: 2,
      localLookaheadRows: 8,
      fullEvaluationLimit: 32,
    },
  );
  assert.ok(optimized.damageGain > 0);
  assert.equal(optimized.improvements[0].leftRow, 12);
  assert.equal(optimized.improvements[0].rightRow, 15);
  assert.ok(optimized.fullCandidatesEvaluated <= 64);
  for (const kind of ["swap", "rotate", "offGcdMove", "primaryReplace"]) {
    assert.ok(optimized.candidateKinds[kind] > 0);
  }
  const replay = replayWhitepaperLianying(runtime, optimized.packs, {
    durationSeconds: 65,
  });
  assert.equal(replay.state.totalDamage, optimized.state.totalDamage);
});

test("组合优化交替运行经验候选和通用机械邻域", () => {
  const optimized = optimizeLianyingAxis(runtime, free65Axis, {
    durationSeconds: 65,
    maxRounds: 1,
    neighborhood: {
      maxPasses: 1,
      localLookaheadRows: 8,
      fullEvaluationLimit: 16,
    },
  });
  assert.ok(optimized.damageGain > 0);
  assert.deepEqual(
    optimized.phases.map((phase) => phase.kind),
    ["dash-overlay", "whitepaper-reference", "mechanical-neighborhood"],
  );
});

test("收敛比较忽略动作标签但能定位真正的技能轴分歧", () => {
  const baseline = [
    { primary: "dragonFang", label: "白皮书龙牙" },
    { prefix: ["charge"], primary: "dragonFang" },
  ];
  const candidate = [
    { primary: "dragonFang", label: "自由龙牙" },
    { primary: "cloudStrike" },
  ];
  const comparison = compareLianyingAxes(baseline, candidate, {
    candidateRows: [{ castSeconds: 0 }, { castSeconds: 1.2175 }],
  });
  assert.equal(comparison.identical, false);
  assert.equal(comparison.firstDivergenceRow, 2);
  assert.equal(comparison.firstDivergenceSeconds, 1.2175);
  assert.deepEqual(comparison.actionCountDelta, {
    charge: -1,
    cloudStrike: 1,
    dragonFang: -1,
  });
  assert.match(
    lianyingConvergenceToCsv({
      runs: [{ beamWidth: 2, mechanicsPassed: true }],
    }),
    /beamWidth[\s\S]*2/,
  );
});

test("新导出区分本行起始战意和主要技能前战意", () => {
  const result = searchWhitepaperLianying(runtime, {
    durationSeconds: 45,
    mode: "fixed",
    beamWidth: 8,
  });
  const artifact = buildWhitepaperAxisArtifact(result, runtime, {
    durationSeconds: 45,
    mode: "fixed",
  });
  assert.equal(artifact.actionPacks.length, result.packs.length);
  assert.equal(artifact.structureAnalysis.schemaVersion, 1);
  assert.ok(artifact.structureAnalysis.summary.thunderWindows > 0);
  const chargeRow = artifact.rows.find((row) =>
    row.offGcdActions.some((action) => action.action === "charge"),
  );
  assert.ok(chargeRow);
  assert.equal(chargeRow.rageAtRowStart, 2);
  assert.equal(chargeRow.rageBeforePrimary, 5);
  assert.equal(artifact.assumptions.executeFromCombatStart, true);
  assert.equal(artifact.search.telemetry.layerCount, result.telemetry.layers.length);
  assert.ok(artifact.search.telemetry.peakUniqueCandidates > 0);
  assert.ok(artifact.summary.destroy.normal > 0);
  assert.ok(artifact.summary.destroy.poLouLanBonus > 0);
  assert.equal(
    artifact.summary.totalDamage,
    artifact.damageAccounting.combinedDamage,
  );
  assert.ok(artifact.damageAccounting.equipmentAndDamageEnchantDamage > 0);
  assert.equal(whitepaperAxisToCsv(artifact).split("\n").length, artifact.rows.length + 1);
  assert.match(whitepaperEquipmentToCsv(artifact), /昆吾·弦刃/);
});
