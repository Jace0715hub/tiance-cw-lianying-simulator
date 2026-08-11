import { ticksToMilliseconds } from "../engine/clock.js";
import { FRAMES_PER_SECOND } from "../config/defaults.js";
import { applyExpectedEquipmentDamage } from "../effects/expected-equipment.js";
import { replayWhitepaperLianying } from "../policies/whitepaper-lianying.js";
import { summarize } from "./summary.js";
import { analyzeLianyingStructure } from "./lianying-structure-analysis.js";
import { auditWhitepaperAxis } from "./whitepaper-audit.js";

function rowDamage(events) {
  const damageEvents = events.filter((event) => event.type === "damage");
  const breakdown = {};
  for (const event of damageEvents) {
    breakdown[event.component] =
      Number(breakdown[event.component] ?? 0) + Number(event.amount);
  }
  return {
    total: damageEvents.reduce((sum, event) => sum + Number(event.amount), 0),
    breakdown,
  };
}

function cleanOffGcd(event) {
  return {
    action: event.action,
    seconds: event.timeMs / 1000,
    rageBefore: event.rageBefore ?? null,
    rageAfter: event.rageAfter ?? null,
    mounted: event.mounted ?? null,
    thunder: event.thunder ?? null,
    orange: event.orange ?? null,
    ride: event.ride ?? null,
    reason: event.reason ?? null,
    dragonRideStacksAtStart: event.dragonRideStacksAtStart ?? null,
    chargeReadyAtStart: event.chargeReadyAtStart ?? null,
    breakArmyWindow: event.breakArmyWindow ?? null,
    activeUntilSeconds:
      event.activeUntilMs === undefined
        ? null
        : Number(event.activeUntilMs) / 1000,
  };
}

function expectedEquipmentAccounting(finalState, rotationDamage, durationSeconds) {
  const effects = finalState.timeline
    .filter((event) => event.type === "damage" && event.trigger === "expectedEquipment")
    .map((event) => ({
      component: event.component,
      skill: event.skill,
      expectedCount: event.expectedCount,
      unitDamage: event.unitDamage,
      damage: event.amount,
      dps: event.amount / durationSeconds,
    }));
  const equipmentDamage = effects.reduce((sum, effect) => sum + effect.damage, 0);
  return {
    attributeEnchants: "alreadyIncludedInPanelAndSkillDamage",
    procCalculation: "expectedValueAddedAfterRotation",
    rotationDamage,
    rotationDps: rotationDamage / durationSeconds,
    equipmentAndDamageEnchantDamage: equipmentDamage,
    equipmentAndDamageEnchantDps: equipmentDamage / durationSeconds,
    combinedDamage: rotationDamage + equipmentDamage,
    combinedDps: (rotationDamage + equipmentDamage) / durationSeconds,
    effects,
  };
}

export function buildWhitepaperAxisArtifact(
  searchResult,
  runtime,
  { durationSeconds = 180, mode = searchResult.mode } = {},
) {
  const replay = replayWhitepaperLianying(runtime, searchResult.packs, {
    durationSeconds,
  });
  const audit = auditWhitepaperAxis(replay.state, { mode });
  if (!audit.mechanics.passed) {
    throw new Error(
      `技能轴存在${audit.mechanics.violationCount}项游戏机制非法行为，拒绝导出`,
    );
  }
  const finalState = applyExpectedEquipmentDamage(
    replay.state,
    runtime.expectedEquipmentEffects,
    runtime.panel,
    runtime.oracle,
    { durationSeconds },
  );
  const summary = summarize(finalState, runtime.config, runtime.oracle);
  const damageAccounting = expectedEquipmentAccounting(
    finalState,
    replay.state.totalDamage,
    durationSeconds,
  );
  Object.assign(summary, {
    rotationDamage: damageAccounting.rotationDamage,
    rotationDps: damageAccounting.rotationDps,
    equipmentAndDamageEnchantDamage:
      damageAccounting.equipmentAndDamageEnchantDamage,
    equipmentAndDamageEnchantDps:
      damageAccounting.equipmentAndDamageEnchantDps,
  });
  const rows = replay.trace.map((trace) => {
    const events = replay.state.timeline.filter(
      (event) =>
        event.sequence >= trace.sequenceFrom &&
        event.sequence <= trace.sequenceUntil,
    );
    const cast = events.find((event) => event.type === "cast");
    const damage = rowDamage(events);
    return {
      rowNumber: trace.index + 1,
      skill: trace.label,
      primaryAction: cast?.action ?? null,
      startSeconds: ticksToMilliseconds(trace.startTick) / 1000,
      castSeconds: ticksToMilliseconds(trace.castTick) / 1000,
      endSeconds: ticksToMilliseconds(trace.endTick) / 1000,
      rageAtRowStart: trace.rageAtRowStart,
      rageBeforePrimary: trace.rageBefore,
      rageAfterPrimary: trace.rageAfter,
      dragonRideBefore: trace.dragonRideBefore,
      dragonRideAfter: trace.dragonRideAfter,
      mountedBefore: trace.mountedBefore,
      mountedAfter: trace.mountedAfter,
      mountedAtCast: Boolean(cast?.mounted),
      thunderAtCast: Boolean(cast?.thunder),
      orangeAtCast: Boolean(cast?.orange),
      rideAtCast: Boolean(cast?.ride),
      bleedStacksAfter: trace.bleedStacksAfter,
      bleedQualityAfter: trace.bleedQualityAfter,
      destroySource: trace.destroySource,
      offGcdActions: events
        .filter((event) => event.type === "offGcd")
        .map(cleanOffGcd),
      rowDamage: damage.total,
      damageBreakdown: damage.breakdown,
    };
  });
  const structureAnalysis = analyzeLianyingStructure(rows, {
    thunderDurationSeconds:
      runtime.config.durations.thunder / FRAMES_PER_SECOND,
  });

  return {
    schemaVersion: 1,
    kind: "tiance-cw-lianying-whitepaper-axis",
    mode,
    policyMode: searchResult.policyMode ?? "strict",
    durationSeconds,
    trainingDurationSeconds: searchResult.durationSeconds,
    actionPacks: searchResult.packs,
    search: {
      beamWidth: searchResult.beamWidth,
      policyMode: searchResult.policyMode ?? "strict",
      exploredTransitions: searchResult.explored,
      legalTransitions: searchResult.legal,
      warmStarted: Boolean(searchResult.warmStarted),
      warmStartCount: searchResult.warmStartCount ?? 0,
      warmStartDamages: searchResult.warmStartDamages ?? [],
      warmStartDamage: searchResult.warmStartDamage ?? null,
      damageGainOverWarmStart:
        searchResult.warmStartDamage === null ||
        searchResult.warmStartDamage === undefined
          ? null
          : replay.state.totalDamage - searchResult.warmStartDamage,
      telemetry: searchResult.telemetry
        ? {
            layerCount: searchResult.telemetry.layers.length,
            exactStateCollisions:
              searchResult.telemetry.exactStateCollisions,
            exactStateReplacements:
              searchResult.telemetry.exactStateReplacements,
            exactStateDominated:
              searchResult.telemetry.exactStateDominated,
            beamPruned: searchResult.telemetry.beamPruned,
            peakUniqueCandidates:
              searchResult.telemetry.peakUniqueCandidates,
            peakBeamSize: searchResult.telemetry.peakBeamSize,
            illegalReasons: searchResult.telemetry.illegalReasons,
          }
        : null,
      referenceOptimization: searchResult.referenceOptimization ?? null,
      axisOptimization: searchResult.axisOptimization ?? null,
    },
    assumptions: {
      target: "134级木桩·斩",
      executeFromCombatStart: true,
      initialRage: 5,
      initialBleedStacks: 0,
      fixedTerminalLiquidation: mode === "fixed",
      attributeEnchantsIncludedInPanel: true,
      equipmentProcsAddedAfterRotationAsExpectedValues: true,
    },
    timing: {
      haste: runtime.panel.haste,
      latencyMs: runtime.config.latencyMs,
      gcdFrames: runtime.config.gcdFrames,
      rideCastFrames: runtime.config.rideCastFrames,
      dotIntervalFrames: runtime.config.dotIntervalFrames,
      autoAttackIntervalFrames: runtime.config.autoAttackIntervalFrames,
    },
    panel: { ...runtime.panel },
    audit,
    structureAnalysis,
    damageAccounting,
    summary,
    rows,
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function whitepaperAxisToCsv(artifact) {
  const headers = [
    "行号",
    "技能",
    "主要技能ID",
    "开始秒",
    "施展秒",
    "结束秒",
    "本行起始战意",
    "主要技能前战意",
    "主要技能后战意",
    "龙驭前",
    "龙驭后",
    "施展前马上",
    "结算后马上",
    "激雷",
    "橙武",
    "驰骋",
    "流血层数",
    "流血品质",
    "灭来源",
    "非GCD动作JSON",
    "本行伤害",
    "伤害明细JSON",
  ];
  const rows = artifact.rows.map((row) => [
    row.rowNumber,
    row.skill,
    row.primaryAction,
    row.startSeconds,
    row.castSeconds,
    row.endSeconds,
    row.rageAtRowStart,
    row.rageBeforePrimary,
    row.rageAfterPrimary,
    row.dragonRideBefore,
    row.dragonRideAfter,
    Number(row.mountedBefore),
    Number(row.mountedAfter),
    Number(row.thunderAtCast),
    Number(row.orangeAtCast),
    Number(row.rideAtCast),
    row.bleedStacksAfter,
    row.bleedQualityAfter,
    row.destroySource ?? "",
    JSON.stringify(row.offGcdActions),
    row.rowDamage,
    JSON.stringify(row.damageBreakdown),
  ]);
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}


export function whitepaperEquipmentToCsv(artifact) {
  const headers = ["类别", "组件", "名称", "期望次数", "单次伤害", "总伤害", "DPS"];
  const rows = artifact.damageAccounting.effects.map((effect) => [
    "附魔/装备特效期望伤害",
    effect.component,
    effect.skill,
    effect.expectedCount,
    effect.unitDamage,
    effect.damage,
    effect.dps,
  ]);
  rows.push([
    "合计",
    "",
    "技能轴伤害",
    "",
    "",
    artifact.damageAccounting.rotationDamage,
    artifact.damageAccounting.rotationDps,
  ]);
  rows.push([
    "合计",
    "",
    "附魔/装备特效",
    "",
    "",
    artifact.damageAccounting.equipmentAndDamageEnchantDamage,
    artifact.damageAccounting.equipmentAndDamageEnchantDps,
  ]);
  rows.push([
    "总计",
    "",
    "技能轴+附魔/装备特效",
    "",
    "",
    artifact.damageAccounting.combinedDamage,
    artifact.damageAccounting.combinedDps,
  ]);
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}
