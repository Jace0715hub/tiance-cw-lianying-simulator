import { availableCharges, consumeCharge } from "./charge-pool.js";
import {
  frameToTicks,
  gcdLockTicks,
  ticksToFrames,
  ticksToMilliseconds,
} from "./clock.js";
import {
  assertState,
  cloneState,
  isBuffActiveAtTick,
  isMountedAtTick,
  syncStateTimeMirrors,
} from "./state.js";
import { createZeroDamageOracle } from "./damage-oracle.js";

function addEvent(state, event) {
  state.sequence += 1;
  state.timeline.push({
    sequence: state.sequence,
    tick: state.tick,
    frame: ticksToFrames(state.tick),
    timeMs: ticksToMilliseconds(state.tick),
    ...event,
  });
}

function expireBleedIfNeeded(state, tick) {
  if (
    state.bleedStacks > 0 &&
    !isBuffActiveAtTick(state, "bleed", tick)
  ) {
    state.bleedNextTick = 0;
    state.bleedStacks = 0;
    state.bleedQuality = 0;
  }
}

function advanceToTick(state, tick, config, oracle) {
  if (!Number.isSafeInteger(tick) || tick < state.tick) {
    throw new Error(`不能从${state.tick}刻度倒退到${tick}刻度`);
  }
  const autoAttackIntervalTicks = frameToTicks(config.autoAttackIntervalFrames);
  if (state.autoAttackNextTick >= 0 && autoAttackIntervalTicks <= 0) {
    throw new Error("自动攻击间隔必须大于0");
  }
  while (true) {
    const autoAttackTick =
      state.autoAttackNextTick >= 0 && state.autoAttackNextTick <= tick
        ? state.autoAttackNextTick
        : Number.POSITIVE_INFINITY;
    const bleedTick =
      state.bleedNextTick > 0 && state.bleedNextTick <= tick
        ? state.bleedNextTick
        : Number.POSITIVE_INFINITY;
    const scheduledTick = Math.min(autoAttackTick, bleedTick);
    if (!Number.isFinite(scheduledTick)) break;

    state.tick = scheduledTick;
    syncStateTimeMirrors(state);
    // 同刻周期事件采用固定顺序：自动攻击先于流血，再处理玩家动作。
    if (autoAttackTick === scheduledTick) {
      const snapshot = damageSnapshot(state, scheduledTick);
      dealDamage(state, oracle, "autoAttack", snapshot, {
        trigger: "periodic",
        thunder: snapshot.thunder,
        ride: snapshot.ride,
        mounted: snapshot.mounted,
      });
      state.autoAttackNextTick += autoAttackIntervalTicks;
    }
    if (bleedTick === scheduledTick) {
      if (!isBuffActiveAtTick(state, "bleed", scheduledTick)) {
        state.bleedNextTick = 0;
      } else {
        const snapshot = damageSnapshot(state, scheduledTick);
        dealDamage(state, oracle, "bleedTick", snapshot, {
          trigger: "periodic",
          bleedStacks: snapshot.bleedStacks,
          bleedQuality: snapshot.bleedQuality,
        });
        state.bleedNextTick += frameToTicks(config.dotIntervalFrames);
      }
    }
  }
  state.tick = tick;
  expireBleedIfNeeded(state, tick);
  syncStateTimeMirrors(state);
}

function addRage(state, amount, config) {
  const before = state.rage;
  state.rage = Math.min(config.maxRage, state.rage + amount);
  return { before, after: state.rage, overflow: Math.max(0, before + amount - config.maxRage) };
}

function setBuffAtTick(state, name, fromTick, untilTick) {
  state.buffTicks[`${name}From`] = fromTick;
  state.buffTicks[`${name}Until`] = untilTick;
  state.buffs[`${name}From`] = ticksToFrames(fromTick);
  state.buffs[`${name}Until`] = ticksToFrames(untilTick);
}

function applyBleedAtTick(state, config, tick, quality) {
  const active = isBuffActiveAtTick(state, "bleed", tick);
  const before = active ? state.bleedStacks : 0;
  state.bleedStacks = Math.min(config.maxBleedStacks, before + 1);
  state.bleedQuality = quality;
  setBuffAtTick(state, "bleed", tick, tick + frameToTicks(config.durations.bleed));
  if (!active || state.bleedNextTick <= tick) {
    state.bleedNextTick = tick + frameToTicks(config.dotIntervalFrames);
  }
  return {
    before,
    after: state.bleedStacks,
    quality,
    nextTick: state.bleedNextTick,
  };
}

function damageSnapshot(state, tick, extras = {}) {
  return {
    tick,
    frame: ticksToFrames(tick),
    timeMs: ticksToMilliseconds(tick),
    rageBeforeCast: extras.rageBeforeCast ?? state.rage,
    thunder: isBuffActiveAtTick(state, "thunder", tick),
    orange: isBuffActiveAtTick(state, "orange", tick),
    ride: isBuffActiveAtTick(state, "ride", tick),
    breakArmyWindow: isBuffActiveAtTick(state, "breakArmy", tick),
    bleed: isBuffActiveAtTick(state, "bleed", tick),
    bleedStacks: isBuffActiveAtTick(state, "bleed", tick) ? state.bleedStacks : 0,
    bleedQuality: isBuffActiveAtTick(state, "bleed", tick) ? state.bleedQuality : 0,
    mounted: isMountedAtTick(state, tick),
    dragonRideBonus: Boolean(extras.dragonRideBonus),
    executePhase: state.executePhase,
  };
}

function dealDamage(state, oracle, component, snapshot, metadata = {}) {
  const amount = Number(oracle.evaluateComponent(component, snapshot) ?? 0);
  state.totalDamage += amount;
  state.damageBreakdown[component] =
    Number(state.damageBreakdown[component] ?? 0) + amount;
  addEvent(state, {
    type: "damage",
    component,
    amount,
    totalDamage: state.totalDamage,
    ...metadata,
  });
  return amount;
}

function dealBreakArmy(state, oracle, snapshot, count, trigger) {
  for (let index = 0; index < count; index += 1) {
    dealDamage(state, oracle, "breakArmy", snapshot, {
      trigger,
      triggerIndex: index + 1,
    });
  }
}

function requireCooldown(state, name) {
  const readyTick = Number(state.cooldownReadyTick[name] ?? 0);
  if (readyTick > state.tick) {
    throw new Error(`${name}尚有${ticksToFrames(readyTick - state.tick)}帧冷却`);
  }
}

function setCooldownAtTick(state, name, readyTick) {
  state.cooldownReadyTick[name] = readyTick;
  state.cooldownReady[name] = ticksToFrames(readyTick);
}

function castDragonFang(state, config, oracle) {
  const castTick = state.tick;
  const rageBeforeCast = state.rage;
  const thunder = isBuffActiveAtTick(state, "thunder", castTick);
  const orange = isBuffActiveAtTick(state, "orange", castTick);
  const cost = thunder && config.rotation === "lianying" ? 1 : 3;
  if (state.rage < cost) {
    throw new Error(`龙牙需要${cost}点战意，当前只有${state.rage}点`);
  }
  state.rage -= cost;
  const rageAfterCost = state.rage;

  const mounted = isMountedAtTick(state, castTick);
  const dragonRideBonus = mounted && state.dragonRideStacks > 0;
  const stacksBefore = state.dragonRideStacks;
  if (dragonRideBonus) {
    state.dragonRideStacks -= 1;
  } else if (!mounted) {
    state.dragonRideStacks = Math.min(
      config.maxDragonRideStacks,
      state.dragonRideStacks + 1,
    );
  }

  const snapshot = damageSnapshot(state, castTick, {
    rageBeforeCast,
    dragonRideBonus,
  });
  const rageAfterResolution = orange ? config.maxRage : rageAfterCost;
  addEvent(state, {
    type: "cast",
    action: "dragonFang",
    rageBeforeCast,
    rageCost: cost,
    rageAfterCost,
    rageAfterResolution,
    stacksBefore,
    stacksAfter: state.dragonRideStacks,
    mounted,
    dragonRideBonus,
    thunder,
    ride: snapshot.ride,
    orange,
  });
  dealDamage(state, oracle, "dragonFang", snapshot);
  if (snapshot.bleed) dealDamage(state, oracle, "dragonBlood", snapshot);
  dealDamage(state, oracle, "dragonFangStrain", snapshot);
  dealDamage(state, oracle, "breakGang", snapshot);
  dealBreakArmy(state, oracle, snapshot, 2, "dragonFang");
  dealDamage(state, oracle, "dragonFangDivine", snapshot);
  if (orange) dealDamage(state, oracle, "orangeExtra", snapshot);

  state.rage = rageAfterResolution;
  setBuffAtTick(
    state,
    "breakArmy",
    castTick,
    castTick + frameToTicks(config.durations.breakArmy),
  );
}

function castDestroy(state, config, oracle) {
  requireCooldown(state, "destroy");
  const castTick = state.tick;
  const poLouLanActive = isBuffActiveAtTick(state, "poLouLan", castTick);
  const destroySource = poLouLanActive ? "poLouLanBonus" : "normal";
  const snapshot = damageSnapshot(state, castTick);
  const rage = addRage(state, 3, config);
  const bleed = applyBleedAtTick(state, config, castTick, 2);

  addEvent(state, {
    type: "cast",
    action: "destroy",
    rageBefore: rage.before,
    rageAfter: rage.after,
    rageOverflow: rage.overflow,
    poLouLanActive,
    destroySource,
    bleedStacksBefore: bleed.before,
    bleedStacksAfter: bleed.after,
    bleedQuality: bleed.quality,
    bleedNextFrame: ticksToFrames(bleed.nextTick),
    thunder: snapshot.thunder,
    orange: snapshot.orange,
    ride: snapshot.ride,
    mounted: snapshot.mounted,
  });

  dealDamage(state, oracle, "destroy", snapshot, { destroySource });
  if (snapshot.breakArmyWindow) {
    dealBreakArmy(state, oracle, snapshot, 1, "destroy");
  }
  if (state.executePhase) {
    dealDamage(state, oracle, "destroyPoLouLan", snapshot, { destroySource });
    dealDamage(state, oracle, "destroyStrain", snapshot, { destroySource });
    if (poLouLanActive) {
      setBuffAtTick(state, "poLouLan", 0, 0);
      setCooldownAtTick(
        state,
        "destroy",
        castTick + frameToTicks(config.cooldowns.destroy),
      );
      state.executeDestroyToggle = 0;
    } else {
      setBuffAtTick(
        state,
        "poLouLan",
        castTick,
        castTick + frameToTicks(config.durations.poLouLan),
      );
      state.executeDestroyToggle = 1;
    }
  } else {
    setCooldownAtTick(
      state,
      "destroy",
      castTick + frameToTicks(config.cooldowns.destroy),
    );
  }

}

function castDragonRoar(state, config, oracle) {
  const castTick = state.tick;
  const orange = isBuffActiveAtTick(state, "orange", castTick);
  if (!orange) requireCooldown(state, "dragonRoar");
  const snapshot = damageSnapshot(state, castTick);
  const rage = addRage(state, 2, config);
  const bleed = applyBleedAtTick(state, config, castTick, 1);
  setCooldownAtTick(
    state,
    "dragonRoar",
    orange ? castTick : castTick + frameToTicks(config.cooldowns.dragonRoar),
  );
  addEvent(state, {
    type: "cast",
    action: "dragonRoar",
    rageBefore: rage.before,
    rageAfter: rage.after,
    rageOverflow: rage.overflow,
    orangeNoCooldown: orange,
    bleedStacksBefore: bleed.before,
    bleedStacksAfter: bleed.after,
    bleedQuality: bleed.quality,
    bleedNextFrame: ticksToFrames(bleed.nextTick),
    thunder: snapshot.thunder,
    orange: snapshot.orange,
    ride: snapshot.ride,
    mounted: snapshot.mounted,
  });
  dealDamage(state, oracle, "dragonRoar", snapshot);
  if (snapshot.breakArmyWindow) {
    dealBreakArmy(state, oracle, snapshot, 1, "dragonRoar");
  }
}

function castCloudStrike(state, config, oracle) {
  const snapshot = damageSnapshot(state, state.tick);
  const rage = addRage(state, 1, config);
  addEvent(state, {
    type: "cast",
    action: "cloudStrike",
    rageBefore: rage.before,
    rageAfter: rage.after,
    rageOverflow: rage.overflow,
    thunder: snapshot.thunder,
    orange: snapshot.orange,
    ride: snapshot.ride,
    mounted: snapshot.mounted,
  });
  dealDamage(state, oracle, "cloudStrike", snapshot);
  if (snapshot.breakArmyWindow) {
    dealBreakArmy(state, oracle, snapshot, 1, "cloudStrike");
  }
}

function castRide(state, config) {
  const mountedBefore = isMountedAtTick(state, state.tick);
  if (mountedBefore) {
    throw new Error("马上无法施展任驰骋，需要先下马");
  }
  const completionTick = state.tick + frameToTicks(config.rideCastFrames);
  const pool = state.chargeTicks.ride;
  if (availableCharges(pool, state.tick) <= 0) {
    throw new Error("任驰骋充能不足");
  }
  const rechargeAtTick = consumeCharge(pool, state.tick);
  state.mounted = true;
  state.mountedFromTick = completionTick;
  state.mountedFrom = ticksToFrames(completionTick);
  const stacksBefore = state.dragonRideStacks;
  const stackOverflow = Math.max(
    0,
    stacksBefore + config.dragonRideGrantedByRide - config.maxDragonRideStacks,
  );
  state.dragonRideStacks = Math.min(
    config.maxDragonRideStacks,
    state.dragonRideStacks + config.dragonRideGrantedByRide,
  );
  setBuffAtTick(
    state,
    "ride",
    completionTick,
    completionTick + frameToTicks(config.durations.ride),
  );
  const chargeReadyBeforeReset = Number(state.cooldownReadyTick.charge ?? 0);
  // 任驰骋成功上马时重置断魂刺调息；刷新发生在读条完成时。
  setCooldownAtTick(state, "charge", completionTick);
  syncStateTimeMirrors(state);
  addEvent(state, {
    type: "cast",
    action: "ride",
    mountedBefore,
    completionFrame: ticksToFrames(completionTick),
    completionAtMs: ticksToMilliseconds(completionTick),
    rechargeAt: ticksToFrames(rechargeAtTick),
    rechargeAtMs: ticksToMilliseconds(rechargeAtTick),
    stacksBefore,
    stacksAfter: state.dragonRideStacks,
    stackOverflow,
    chargeReadyBeforeReset: ticksToFrames(chargeReadyBeforeReset),
    chargeReadyBeforeResetMs: ticksToMilliseconds(chargeReadyBeforeReset),
    chargeResetAt: ticksToFrames(completionTick),
    chargeResetAtMs: ticksToMilliseconds(completionTick),
    orange: isBuffActiveAtTick(state, "orange", state.tick),
  });
}

function castPrimaryMutable(state, action, config, oracle) {
  if (state.tick < state.gcdReadyTick) {
    throw new Error(`GCD尚有${ticksToFrames(state.gcdReadyTick - state.tick)}帧`);
  }
  const castTick = state.tick;
  switch (action.id) {
    case "dragonFang":
      castDragonFang(state, config, oracle);
      break;
    case "destroy":
      castDestroy(state, config, oracle);
      break;
    case "dragonRoar":
      castDragonRoar(state, config, oracle);
      break;
    case "cloudStrike":
      castCloudStrike(state, config, oracle);
      break;
    case "ride":
      castRide(state, config);
      break;
    case "wait": {
      const waitFrames = Number(action.frames ?? 1);
      if (!Number.isInteger(waitFrames) || waitFrames <= 0) {
        throw new Error("等待帧数必须是正整数");
      }
      addEvent(state, { type: "wait", action: "wait", waitFrames });
      state.gcdReadyTick = castTick + frameToTicks(waitFrames);
      syncStateTimeMirrors(state);
      return;
    }
    default:
      throw new Error(`未知主要动作: ${action.id}`);
  }
  state.gcdReadyTick = castTick + gcdLockTicks(
    Number(action.lockFrames ?? config.gcdFrames),
    Number(action.latencyMs ?? config.latencyMs ?? 0),
  );
  syncStateTimeMirrors(state);
}

function activateOffGcdMutable(state, action, config, oracle) {
  const tick = state.tick;
  switch (action.id) {
    case "thunder": {
      const pendingRideCompletion = Number(state.buffTicks.rideFrom ?? 0);
      if (pendingRideCompletion > tick) {
        throw new Error("任驰骋读条结束前不能施展撼如雷");
      }
      const pool = state.chargeTicks.thunder;
      if (availableCharges(pool, tick) <= 0) throw new Error("撼如雷充能不足");
      const rechargeAtTick = consumeCharge(pool, tick);
      setBuffAtTick(
        state,
        "thunder",
        tick,
        tick + frameToTicks(config.durations.thunder),
      );
      syncStateTimeMirrors(state);
      addEvent(state, {
        type: "offGcd",
        action: "thunder",
        rechargeAt: ticksToFrames(rechargeAtTick),
        rechargeAtMs: ticksToMilliseconds(rechargeAtTick),
        activeUntilTick: tick + frameToTicks(config.durations.thunder),
        activeUntilMs: ticksToMilliseconds(
          tick + frameToTicks(config.durations.thunder),
        ),
        rageBefore: state.rage,
        mounted: isMountedAtTick(state, tick),
        ride: isBuffActiveAtTick(state, "ride", tick),
        dragonRideStacksAtStart: state.dragonRideStacks,
        chargeReadyAtStart: Number(state.cooldownReadyTick.charge ?? 0) <= tick,
        chargeReadyAtMs: ticksToMilliseconds(
          Number(state.cooldownReadyTick.charge ?? 0),
        ),
      });
      break;
    }
    case "orange":
      requireCooldown(state, "orange");
      state.rage = config.maxRage;
      setCooldownAtTick(
        state,
        "orange",
        tick + frameToTicks(config.cooldowns.orange),
      );
      setBuffAtTick(state, "orange", tick, tick + frameToTicks(config.durations.orange));
      addEvent(state, {
        type: "offGcd",
        action: "orange",
        rageAfter: state.rage,
        activeUntil: state.buffs.orangeUntil,
      });
      break;
    case "charge": {
      requireCooldown(state, "charge");
      if (!isMountedAtTick(state, tick)) throw new Error("断魂刺只能在马上施展");
      const snapshot = damageSnapshot(state, tick);
      const rage = addRage(state, 3, config);
      setCooldownAtTick(
        state,
        "charge",
        tick + frameToTicks(config.cooldowns.charge),
      );
      addEvent(state, {
        type: "offGcd",
        action: "charge",
        rageBefore: rage.before,
        rageAfter: rage.after,
        rageOverflow: rage.overflow,
        thunder: snapshot.thunder,
        orange: snapshot.orange,
        ride: snapshot.ride,
        mounted: snapshot.mounted,
      });
      dealDamage(state, oracle, "charge", snapshot);
      dealBreakArmy(
        state,
        oracle,
        snapshot,
        snapshot.breakArmyWindow ? 2 : 1,
        "charge",
      );
      break;
    }
    case "dash": {
      requireCooldown(state, "dash");
      if (isMountedAtTick(state, tick)) throw new Error("突只能在马下施展");
      const snapshot = damageSnapshot(state, tick);
      setCooldownAtTick(
        state,
        "dash",
        tick + frameToTicks(config.cooldowns.dash),
      );
      addEvent(state, {
        type: "offGcd",
        action: "dash",
        thunder: snapshot.thunder,
        orange: snapshot.orange,
        ride: snapshot.ride,
        mounted: snapshot.mounted,
        breakArmyWindow: snapshot.breakArmyWindow,
        cooldownReadyAt: ticksToFrames(
          tick + frameToTicks(config.cooldowns.dash),
        ),
        cooldownReadyAtMs: ticksToMilliseconds(
          tick + frameToTicks(config.cooldowns.dash),
        ),
      });
      dealDamage(state, oracle, "dash", snapshot);
      if (snapshot.breakArmyWindow) {
        dealBreakArmy(state, oracle, snapshot, 1, "dash");
      }
      break;
    }
    case "dismount": {
      const snapshot = damageSnapshot(state, tick);
      state.mounted = false;
      state.mountedFromTick = tick;
      state.mountedFrom = ticksToFrames(tick);
      if (config.dismountClearsRideBuff) {
        setBuffAtTick(state, "ride", 0, 0);
      }
      addEvent(state, {
        type: "offGcd",
        action: "dismount",
        reason: action.reason ?? "policy",
        mounted: snapshot.mounted,
        thunder: snapshot.thunder,
        orange: snapshot.orange,
        ride: snapshot.ride,
        rideCleared: Boolean(config.dismountClearsRideBuff && snapshot.ride),
        dragonRideStacksAtStart: state.dragonRideStacks,
      });
      break;
    }
    default:
      throw new Error(`未知非GCD动作: ${action.id}`);
  }
}

function normalizeAction(action) {
  return typeof action === "string" ? { id: action } : action;
}

export function executeActionPack(
  state,
  pack,
  config,
  oracle = createZeroDamageOracle(),
  { endTick = Number.POSITIVE_INFINITY } = {},
) {
  const next = cloneState(state);
  const decisionTick = Math.max(next.tick, next.gcdReadyTick);
  if (decisionTick > endTick) {
    throw new Error(`下一次可执行时刻${decisionTick}超过战斗截止时刻${endTick}`);
  }
  advanceToTick(next, decisionTick, config, oracle);

  for (const rawAction of pack.prefix ?? []) {
    activateOffGcdMutable(next, normalizeAction(rawAction), config, oracle);
  }

  castPrimaryMutable(next, normalizeAction(pack.primary), config, oracle);
  const nextDecisionTick = next.gcdReadyTick;
  const tail = [...(pack.tail ?? [])]
    .map((rawAction, index) => ({
      ...normalizeAction(rawAction),
      order: index,
      leadFrames: Number(normalizeAction(rawAction).leadFrames ?? 1),
    }))
    .sort(
      (left, right) =>
        right.leadFrames - left.leadFrames || left.order - right.order,
    );

  for (const action of tail) {
    const activationTick = nextDecisionTick - frameToTicks(action.leadFrames);
    if (activationTick < decisionTick) {
      throw new Error(`${action.id}的GCD末端提前量超出当前动作区间`);
    }
    if (activationTick > endTick) continue;
    advanceToTick(next, activationTick, config, oracle);
    activateOffGcdMutable(next, action, config, oracle);
  }

  advanceToTick(next, Math.min(nextDecisionTick, endTick), config, oracle);
  syncStateTimeMirrors(next);
  assertState(next, config);
  return next;
}

export function runRotation(
  initialState,
  actionPacks,
  config,
  oracle = createZeroDamageOracle(),
) {
  let state = cloneState(initialState);
  for (const pack of actionPacks) {
    state = executeActionPack(state, pack, config, oracle);
  }
  return state;
}
