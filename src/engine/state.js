import { createChargePool, refreshChargePool } from "./charge-pool.js";
import {
  frameToTicks,
  ticksToFrames,
  ticksToMilliseconds,
} from "./clock.js";

const BUFF_NAMES = [
  "thunder",
  "orange",
  "ride",
  "bleed",
  "breakArmy",
  "poLouLan",
];
const COOLDOWN_NAMES = ["destroy", "dragonRoar", "charge", "dash", "orange"];

function createFrameChargePool(definition, override) {
  return override ? structuredClone(override) : createChargePool(definition);
}

function toTickChargePool(framePool) {
  return {
    ...framePool,
    rechargeFrames: frameToTicks(framePool.rechargeFrames),
    rechargeQueue: framePool.rechargeQueue.map(frameToTicks),
  };
}

function toFrameChargePool(tickPool) {
  return {
    ...tickPool,
    rechargeFrames: ticksToFrames(tickPool.rechargeFrames),
    rechargeQueue: tickPool.rechargeQueue.map(ticksToFrames),
  };
}

export function syncStateTimeMirrors(state) {
  state.frame = ticksToFrames(state.tick);
  state.gcdReadyFrame = ticksToFrames(state.gcdReadyTick);
  state.timeMs = ticksToMilliseconds(state.tick);
  state.gcdReadyMs = ticksToMilliseconds(state.gcdReadyTick);
  state.mountedFrom = ticksToFrames(state.mountedFromTick);
  state.bleedNextFrame = state.bleedNextTick > 0
    ? ticksToFrames(state.bleedNextTick)
    : 0;
  state.bleedNextAtMs = state.bleedNextTick > 0
    ? ticksToMilliseconds(state.bleedNextTick)
    : 0;
  state.autoAttackNextFrame = state.autoAttackNextTick >= 0
    ? ticksToFrames(state.autoAttackNextTick)
    : null;
  state.autoAttackNextAtMs = state.autoAttackNextTick >= 0
    ? ticksToMilliseconds(state.autoAttackNextTick)
    : null;
  for (const name of COOLDOWN_NAMES) {
    state.cooldownReady[name] = ticksToFrames(state.cooldownReadyTick[name]);
  }
  for (const name of BUFF_NAMES) {
    state.buffs[`${name}From`] = ticksToFrames(state.buffTicks[`${name}From`]);
    state.buffs[`${name}Until`] = ticksToFrames(state.buffTicks[`${name}Until`]);
  }
  refreshChargePool(state.chargeTicks.thunder, state.tick);
  refreshChargePool(state.chargeTicks.ride, state.tick);
  state.charges = {
    thunder: toFrameChargePool(state.chargeTicks.thunder),
    ride: toFrameChargePool(state.chargeTicks.ride),
  };
  return state;
}

export function createInitialState(config, overrides = {}) {
  const frame = Number(overrides.frame ?? 0);
  const gcdReadyFrame = Number(overrides.gcdReadyFrame ?? frame);
  const cooldownReady = {
    destroy: 0,
    dragonRoar: 0,
    charge: 0,
    dash: 0,
    orange: 0,
    ...(overrides.cooldownReady ?? {}),
  };
  const buffs = {};
  for (const name of BUFF_NAMES) {
    buffs[`${name}From`] = Number(overrides.buffs?.[`${name}From`] ?? 0);
    buffs[`${name}Until`] = Number(overrides.buffs?.[`${name}Until`] ?? 0);
  }
  const frameCharges = {
    thunder: createFrameChargePool(config.charges.thunder, overrides.charges?.thunder),
    ride: createFrameChargePool(config.charges.ride, overrides.charges?.ride),
  };
  const state = {
    tick: Number(overrides.tick ?? frameToTicks(frame)),
    gcdReadyTick: Number(overrides.gcdReadyTick ?? frameToTicks(gcdReadyFrame)),
    frame,
    gcdReadyFrame,
    timeMs: 0,
    gcdReadyMs: 0,
    rage: Number(overrides.rage ?? config.maxRage),
    bleedStacks: Number(overrides.bleedStacks ?? 0),
    bleedQuality: Number(overrides.bleedQuality ?? 0),
    bleedNextTick: Number(
      overrides.bleedNextTick ?? frameToTicks(overrides.bleedNextFrame ?? 0),
    ),
    bleedNextFrame: Number(overrides.bleedNextFrame ?? 0),
    bleedNextAtMs: 0,
    autoAttackNextTick: Number(
      overrides.autoAttackNextTick ??
        (overrides.autoAttackNextFrame !== undefined
          ? frameToTicks(overrides.autoAttackNextFrame)
          : config.autoAttackEnabled === false
            ? -1
            : 0),
    ),
    autoAttackNextFrame: null,
    autoAttackNextAtMs: null,
    dragonRideStacks: Number(overrides.dragonRideStacks ?? 0),
    mounted: Boolean(overrides.mounted ?? false),
    mountedFromTick: Number(
      overrides.mountedFromTick ?? frameToTicks(overrides.mountedFrom ?? 0),
    ),
    mountedFrom: Number(overrides.mountedFrom ?? 0),
    executePhase: Boolean(overrides.executePhase ?? false),
    executeDestroyToggle: Number(overrides.executeDestroyToggle ?? 0),
    cooldownReady,
    cooldownReadyTick: Object.fromEntries(
      COOLDOWN_NAMES.map((name) => [
        name,
        Number(overrides.cooldownReadyTick?.[name] ?? frameToTicks(cooldownReady[name])),
      ]),
    ),
    charges: frameCharges,
    chargeTicks: overrides.chargeTicks
      ? structuredClone(overrides.chargeTicks)
      : {
          thunder: toTickChargePool(frameCharges.thunder),
          ride: toTickChargePool(frameCharges.ride),
        },
    buffs,
    buffTicks: Object.fromEntries(
      BUFF_NAMES.flatMap((name) => [
        [`${name}From`, frameToTicks(buffs[`${name}From`])],
        [`${name}Until`, frameToTicks(buffs[`${name}Until`])],
      ]),
    ),
    totalDamage: Number(overrides.totalDamage ?? 0),
    damageBreakdown: { ...(overrides.damageBreakdown ?? {}) },
    timeline: structuredClone(overrides.timeline ?? []),
    sequence: Number(overrides.sequence ?? 0),
  };
  if (overrides.buffTicks) Object.assign(state.buffTicks, overrides.buffTicks);
  return syncStateTimeMirrors(state);
}

export function cloneState(state) {
  return structuredClone(state);
}

export function isBuffActiveAtTick(state, name, tick = state.tick) {
  const from = Number(state.buffTicks?.[`${name}From`] ?? 0);
  const until = Number(state.buffTicks?.[`${name}Until`] ?? 0);
  return tick >= from && tick < until;
}

export function isBuffActive(state, name, frame = state.frame) {
  return isBuffActiveAtTick(state, name, frameToTicks(frame));
}

export function isMountedAtTick(state, tick = state.tick) {
  return state.mounted && tick >= Number(state.mountedFromTick ?? 0);
}

export function isMountedAt(state, frame = state.frame) {
  return isMountedAtTick(state, frameToTicks(frame));
}

export function assertState(state, config) {
  if (!Number.isSafeInteger(state.tick) || state.tick < 0) {
    throw new Error("当前时钟必须是非负整数刻度");
  }
  if (!Number.isSafeInteger(state.gcdReadyTick) || state.gcdReadyTick < 0) {
    throw new Error("GCD结束时钟必须是非负整数刻度");
  }
  if (!Number.isInteger(state.rage) || state.rage < 0 || state.rage > config.maxRage) {
    throw new Error(`非法战意: ${state.rage}`);
  }
  if (
    !Number.isInteger(state.bleedStacks) ||
    state.bleedStacks < 0 ||
    state.bleedStacks > config.maxBleedStacks
  ) {
    throw new Error(`非法流血层数: ${state.bleedStacks}`);
  }
  if (![0, 1, 2].includes(state.bleedQuality)) {
    throw new Error(`非法流血品质: ${state.bleedQuality}`);
  }
  if (!Number.isSafeInteger(state.bleedNextTick) || state.bleedNextTick < 0) {
    throw new Error(`非法流血下一跳时刻: ${state.bleedNextTick}`);
  }
  if (
    !Number.isSafeInteger(state.autoAttackNextTick) ||
    state.autoAttackNextTick < -1
  ) {
    throw new Error(`非法自动攻击下一击时刻: ${state.autoAttackNextTick}`);
  }
  if (
    !Number.isInteger(state.dragonRideStacks) ||
    state.dragonRideStacks < 0 ||
    state.dragonRideStacks > config.maxDragonRideStacks
  ) {
    throw new Error(`非法龙驭层数: ${state.dragonRideStacks}`);
  }
  for (const [name, pool] of Object.entries(state.chargeTicks)) {
    if (pool.ready < 0 || pool.ready > pool.capacity) {
      throw new Error(`${name}充能数量非法`);
    }
    if (pool.rechargeQueue.some((tick) => !Number.isSafeInteger(tick) || tick < 0)) {
      throw new Error(`${name}充能恢复时间非法`);
    }
  }
  return true;
}
