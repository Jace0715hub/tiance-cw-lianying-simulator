import { cloneState } from "../engine/state.js";
import { ticksToFrames, ticksToMilliseconds } from "../engine/clock.js";

function hasteDotTicks(rawHaste, maximumTicks = 22) {
  const haste = Math.floor(Number(rawHaste ?? 0));
  let ticks;
  if (haste <= 9232) {
    ticks = Math.floor(12 + 3.24956672443674e-4 * haste);
  } else if (haste <= 19285) {
    ticks = Math.floor(15 + 1.98945588381577e-4 * (haste - 9232));
  } else if (haste <= 30158) {
    ticks = Math.floor(17 + 2.75912811551549e-4 * (haste - 19285));
  } else {
    ticks = Math.floor(20 + 1.68081351374065e-4 * (haste - 30158));
  }
  return Math.min(Number(maximumTicks), ticks);
}

export function expectedEquipmentProcCount(rule, { durationSeconds, panel }) {
  switch (rule?.type) {
    case "intervalExpectedProcs": {
      const frequency =
        Number(rule.attackFrequencyNumerator ?? 0) /
        Number(rule.attackFrequencyDenominator ?? 1) *
        Number(rule.procChance ?? 1);
      const interval = frequency > 0
        ? 1 / frequency + Number(rule.internalCooldownSeconds ?? 0)
        : 0;
      return interval > 0 ? Number(durationSeconds) / interval : 0;
    }
    case "renlingExpectedProcs": {
      const frequency =
        Number(rule.attackFrequencyNumerator ?? 0) /
        Number(rule.attackFrequencyDenominator ?? 1) *
        (Number(panel?.critRate ?? 0) +
          Number(rule.baseCritChance ?? 0) +
          Number(rule.extraCritChance ?? 0));
      const interval = frequency > 0
        ? 1 / frequency + Number(rule.internalCooldownSeconds ?? 0)
        : 0;
      return interval > 0 ? Number(durationSeconds) / interval : 0;
    }
    case "hasteDotTicks": {
      const ticks = hasteDotTicks(panel?.haste, rule.maximumTicks);
      return Number(durationSeconds) * ticks / Number(rule.intervalSeconds ?? 1);
    }
    default:
      throw new Error(`未知装备期望触发模型: ${rule?.type}`);
  }
}

export function applyExpectedEquipmentDamage(
  inputState,
  effects,
  panel,
  oracle,
  { durationSeconds = inputState.timeMs / 1000 } = {},
) {
  const state = cloneState(inputState);
  for (const effect of effects ?? []) {
    if (Object.hasOwn(state.damageBreakdown, effect.component)) {
      throw new Error(`装备期望伤害已经结算: ${effect.component}`);
    }
    const expectedCount = expectedEquipmentProcCount(effect.countRule, {
      durationSeconds,
      panel,
    });
    const unitDamage = Number(oracle.evaluateComponent(effect.component, {}) ?? 0);
    const amount = unitDamage * expectedCount;
    state.totalDamage += amount;
    state.damageBreakdown[effect.component] = amount;
    state.sequence += 1;
    state.timeline.push({
      sequence: state.sequence,
      tick: state.tick,
      frame: ticksToFrames(state.tick),
      timeMs: ticksToMilliseconds(state.tick),
      type: "damage",
      trigger: "expectedEquipment",
      component: effect.component,
      skill: effect.skill,
      expectedCount,
      unitDamage,
      amount,
      totalDamage: state.totalDamage,
    });
  }
  return state;
}
