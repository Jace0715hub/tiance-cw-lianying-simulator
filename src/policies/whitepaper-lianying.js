import { availableCharges } from "../engine/charge-pool.js";
import {
  frameToTicks,
  gcdLockTicks,
  millisecondsToTicks,
  ticksToFrames,
} from "../engine/clock.js";
import { executeActionPack } from "../engine/simulator.js";
import {
  createInitialState,
  isBuffActiveAtTick,
  isMountedAtTick,
} from "../engine/state.js";

export const LIANYING_POLICY_MODES = Object.freeze([
  "strict",
  "guided",
  "free",
]);

const ACTION_LABELS = Object.freeze({
  dragonFang: "龙牙",
  destroy: "灭",
  dragonRoar: "龙吟",
  cloudStrike: "穿云",
  ride: "任驰骋",
  thunder: "雷",
  orange: "CW",
  charge: "断魂刺",
  dash: "突",
  dismount: "下马",
});

function actionId(action) {
  return typeof action === "string" ? action : action.id;
}

export function labelWhitepaperPack(pack) {
  if (pack.label) return pack.label;
  if (actionId(pack.primary) === "wait") {
    return `等待${Math.floor(Number(pack.primary?.frames ?? 0))}帧`;
  }
  const prefix = (pack.prefix ?? []).map(actionId).map((id) => ACTION_LABELS[id]);
  const primary = ACTION_LABELS[actionId(pack.primary)] ?? actionId(pack.primary);
  const tail = [...(pack.tail ?? [])]
    .map((action, order) => ({
      action,
      order,
      leadFrames: Number(
        typeof action === "string" ? 1 : action?.leadFrames ?? 1,
      ),
    }))
    .sort((left, right) =>
      right.leadFrames - left.leadFrames || left.order - right.order)
    .map(({ action }) => ACTION_LABELS[actionId(action)]);
  return `${prefix.join("+")}${prefix.length ? "→" : ""}${primary}${
    tail.length ? `→${tail.join("+")}` : ""
  }`;
}

export function buildWhitepaperOpener() {
  return [
    { primary: "dragonFang", label: "龙牙" },
    { primary: "destroy", label: "灭" },
    {
      primary: "ride",
      tail: [
        { id: "thunder", leadFrames: 1 },
        { id: "orange", leadFrames: 1 },
      ],
      label: "任驰骋→雷+CW",
    },
  ];
}

function decisionTick(state) {
  return Math.max(state.tick, state.gcdReadyTick);
}

function poolAvailableAt(pool, tick) {
  const copy = structuredClone(pool);
  return availableCharges(copy, tick);
}

function poolNextReadyTick(pool, tick) {
  const copy = structuredClone(pool);
  if (availableCharges(copy, tick) > 0) return tick;
  return Number(copy.rechargeQueue[0] ?? Number.POSITIVE_INFINITY);
}

function cooldownReady(state, name, tick) {
  return Number(state.cooldownReadyTick[name] ?? 0) <= tick;
}

function currentThunderContext(state, tick) {
  const start = [...state.timeline]
    .reverse()
    .find(
      (event) =>
        event.type === "offGcd" &&
        event.action === "thunder" &&
        event.tick <= tick,
    );
  if (!start) {
    return {
      start: null,
      startStacks: state.dragonRideStacks,
      fangCount: 0,
      usedDragonRoar: false,
      usedCharge: false,
    };
  }
  const events = state.timeline.filter((event) => event.sequence > start.sequence);
  return {
    start,
    startStacks: Number(start.dragonRideStacksAtStart ?? state.dragonRideStacks),
    fangCount: events.filter(
      (event) => event.type === "cast" && event.action === "dragonFang",
    ).length,
    usedDragonRoar: events.some(
      (event) => event.type === "cast" && event.action === "dragonRoar",
    ),
    usedCharge: events.some(
      (event) => event.type === "offGcd" && event.action === "charge",
    ),
  };
}

function canDirectChainThunder(state, config, tick) {
  const previousUntil = Number(state.buffTicks.thunderUntil ?? 0);
  if (previousUntil <= 0 || tick < previousUntil) return false;
  const gcdTicks = gcdLockTicks(config.gcdFrames, config.latencyMs);
  return (
    tick - previousUntil <= gcdTicks * 2 &&
    poolAvailableAt(state.chargeTicks.thunder, tick) > 0
  );
}

function primaryId(pack) {
  return actionId(pack.primary);
}

function clonePack(pack) {
  return {
    ...pack,
    prefix: (pack.prefix ?? []).map((action) =>
      typeof action === "string" ? action : { ...action },
    ),
    tail: (pack.tail ?? []).map((action) =>
      typeof action === "string" ? action : { ...action },
    ),
  };
}

function addPrefix(pack, action) {
  const next = clonePack(pack);
  next.prefix.push(action);
  delete next.label;
  return next;
}

function addTail(pack, action) {
  const next = clonePack(pack);
  next.tail.push(action);
  delete next.label;
  return next;
}

function withBasePrefix(pack, basePrefix) {
  const next = clonePack(pack);
  next.prefix = [...basePrefix, ...next.prefix];
  return next;
}

function uniquePacks(packs) {
  const seen = new Set();
  return packs.filter((pack) => {
    const key = JSON.stringify({
      prefix: pack.prefix ?? [],
      primary: pack.primary,
      tail: pack.tail ?? [],
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function orangeVariants(packs, state, config, tick, { allowImmediate = true } = {}) {
  if (isBuffActiveAtTick(state, "orange", tick)) return packs;
  const result = [...packs];
  const readyNow = cooldownReady(state, "orange", tick);
  if (allowImmediate && readyNow) {
    const dismountPrefix = (packs[0]?.prefix ?? []).filter(
      (action) => actionId(action) === "dismount",
    );
    result.push({
      prefix: [...dismountPrefix, "orange"],
      primary: "dragonFang",
      label: "CW→龙牙",
    });
  }

  const nextTick = tick + gcdLockTicks(config.gcdFrames, config.latencyMs);
  const tailTick = nextTick - frameToTicks(1);
  if (cooldownReady(state, "orange", tailTick)) {
    for (const pack of packs) {
      if (primaryId(pack) === "ride") continue;
      result.push(addTail(pack, { id: "orange", leadFrames: 1 }));
    }
  }
  return uniquePacks(result);
}

function thunderPacks(state, config, tick, basePrefix, effectiveMounted) {
  const orange = isBuffActiveAtTick(state, "orange", tick);
  const rage = state.rage;
  const remainingThunderTicks = Number(state.buffTicks.thunderUntil) - tick;
  const gcdTicks = gcdLockTicks(config.gcdFrames, config.latencyMs);
  const lateLeak = remainingThunderTicks <= gcdTicks * 2;
  const context = currentThunderContext(state, tick);
  const nextThunderCanDirectlyFollow =
    poolAvailableAt(
      state.chargeTicks.thunder,
      Number(state.buffTicks.thunderUntil),
    ) > 0;
  const shouldStopAtTwelveFangs =
    context.usedDragonRoar &&
    !nextThunderCanDirectlyFollow &&
    context.fangCount >= 12;
  if (shouldStopAtTwelveFangs) {
    const waitFrames = Math.max(
      1,
      Math.ceil(ticksToFrames(Math.max(0, remainingThunderTicks))),
    );
    return [
      withBasePrefix(
        {
          primary: { id: "wait", frames: waitFrames },
          label: "等待雷结束（12牙保豆）",
        },
        basePrefix,
      ),
    ];
  }

  const prioritizeChargeForLowStacks =
    effectiveMounted &&
    context.startStacks < 9 &&
    !context.usedCharge &&
    cooldownReady(state, "charge", tick);
  let packs = [];

  if (orange) {
    packs = [{ primary: "dragonFang" }];
  } else if (prioritizeChargeForLowStacks && rage <= 2) {
    packs = [{ prefix: ["charge"], primary: "dragonFang" }];
  } else if (cooldownReady(state, "destroy", tick)) {
    packs = rage <= 2
      ? [{ primary: "destroy" }]
      : [{ primary: "dragonFang" }];
    if (lateLeak && rage >= 1 && rage <= 2) packs.push({ primary: "dragonFang" });
  } else if (effectiveMounted && cooldownReady(state, "charge", tick)) {
    packs = rage <= 2
      ? [{ prefix: ["charge"], primary: "dragonFang" }]
      : [{ primary: "dragonFang" }];
    if (lateLeak && rage >= 1 && rage <= 2) packs.push({ primary: "dragonFang" });
  } else if (cooldownReady(state, "dragonRoar", tick)) {
    packs = rage <= 3
      ? [{ primary: "dragonRoar" }]
      : [{ primary: "dragonFang" }];
    if (lateLeak && rage >= 1 && rage <= 3) packs.push({ primary: "dragonFang" });
  } else if (rage >= 1) {
    packs = [{ primary: "dragonFang" }];
  }

  packs = packs.map((pack) => withBasePrefix(pack, basePrefix));
  return orangeVariants(packs, state, config, tick);
}

function canPrepositionRide(state, config, tick, effectiveMounted) {
  if (effectiveMounted || isBuffActiveAtTick(state, "orange", tick)) return false;
  if (poolAvailableAt(state.chargeTicks.ride, tick) <= 0) return false;
  const gcdTicks = gcdLockTicks(config.gcdFrames, config.latencyMs);
  if (poolAvailableAt(state.chargeTicks.thunder, tick + gcdTicks * 2) <= 0) {
    return false;
  }
  const nextTick = tick + gcdTicks;
  return (
    (state.rage === 2 && cooldownReady(state, "destroy", nextTick)) ||
    (state.rage === 3 && cooldownReady(state, "dragonRoar", nextTick)) ||
    state.rage === 4
  );
}

function gapPacks(
  state,
  config,
  tick,
  basePrefix,
  effectiveMounted,
  { allowMountedFang = false } = {},
) {
  const rage = state.rage;
  const packs = [];
  if (rage >= 3 && !effectiveMounted) packs.push({ primary: "dragonFang" });
  if (rage >= 3 && effectiveMounted && allowMountedFang) {
    packs.push({ primary: "dragonFang" });
  }
  if (cooldownReady(state, "destroy", tick) && rage <= 2) {
    packs.push({ primary: "destroy" });
  }
  if (cooldownReady(state, "dragonRoar", tick) && rage <= 3) {
    packs.push({ primary: "dragonRoar" });
  }
  if (rage <= 4) packs.push({ primary: "cloudStrike" });
  if (canPrepositionRide(state, config, tick, effectiveMounted)) {
    packs.push({ primary: "ride", label: "任驰骋（前置）" });
  }

  const prefixed = packs.map((pack) => withBasePrefix(pack, basePrefix));
  const thunderReadySoon =
    poolNextReadyTick(state.chargeTicks.thunder, tick) <=
    tick + frameToTicks(config.durations.orange);
  if (thunderReadySoon) return uniquePacks(prefixed);
  return orangeVariants(prefixed, state, config, tick);
}

function prepareThunderPacks(state, config, tick, basePrefix, effectiveMounted) {
  const rage = state.rage;
  const packs = [];
  if (cooldownReady(state, "destroy", tick) && rage <= 2) {
    packs.push({ primary: "destroy" });
  }
  const directDoubleThunderLink = canDirectChainThunder(state, config, tick);
  if (
    cooldownReady(state, "dragonRoar", tick) &&
    (rage <= 3 || (directDoubleThunderLink && rage === 4))
  ) {
    packs.push({ primary: "dragonRoar" });
  }
  if (rage <= 4) packs.push({ primary: "cloudStrike" });
  if (canPrepositionRide(state, config, tick, effectiveMounted)) {
    packs.push({ primary: "ride", label: "任驰骋（前置）" });
  }
  return uniquePacks(packs.map((pack) => withBasePrefix(pack, basePrefix)));
}

function thunderStartPacks(state, config, tick, basePrefix, effectiveMounted) {
  const packs = [];
  const orangeActive = isBuffActiveAtTick(state, "orange", tick);
  const orangeReady = cooldownReady(state, "orange", tick);

  if (effectiveMounted) {
    packs.push(withBasePrefix({ prefix: ["thunder"], primary: "dragonFang" }, basePrefix));
    if (orangeReady && !orangeActive) {
      packs.push(withBasePrefix({
        prefix: ["thunder", "orange"],
        primary: "dragonFang",
      }, basePrefix));
    }
    return uniquePacks(packs);
  }

  const forceSingleThunder = !effectiveMounted && state.dragonRideStacks === 0;
  if (
    !orangeActive &&
    !forceSingleThunder &&
    poolAvailableAt(state.chargeTicks.ride, tick) > 0
  ) {
    const paired = withBasePrefix({
      primary: "ride",
      tail: [{ id: "thunder", leadFrames: 1 }],
    }, basePrefix);
    packs.push(paired);
    const nextTick = tick + gcdLockTicks(config.gcdFrames, config.latencyMs);
    const tailTick = nextTick - frameToTicks(1);
    if (cooldownReady(state, "orange", tailTick)) {
      packs.push(addTail(paired, { id: "orange", leadFrames: 1 }));
    }
    return uniquePacks(packs);
  }

  packs.push(withBasePrefix({ prefix: ["thunder"], primary: "dragonFang" }, basePrefix));
  if (orangeReady && !orangeActive) {
    packs.push(withBasePrefix({
      prefix: ["thunder", "orange"],
      primary: "dragonFang",
    }, basePrefix));
  }
  return uniquePacks(packs);
}

export function legalWhitepaperPacks(
  state,
  config,
  { mode = "stable", endTick = Number.POSITIVE_INFINITY } = {},
) {
  const tick = decisionTick(state);
  const thunder = isBuffActiveAtTick(state, "thunder", tick);
  const rideBuff = isBuffActiveAtTick(state, "ride", tick);
  const remainingTicks = endTick - tick;
  const terminalLiquidation =
    mode === "fixed" &&
    state.mounted &&
    !thunder &&
    !rideBuff &&
    state.dragonRideStacks > 0 &&
    remainingTicks <= frameToTicks(config.durations.thunder);

  const basePrefix = [];
  let effectiveMounted = state.mounted;
  if (state.mounted && !thunder && !rideBuff && !terminalLiquidation) {
    basePrefix.push({ id: "dismount", reason: "thunder-ended" });
    effectiveMounted = false;
  }

  if (thunder) {
    return thunderPacks(state, config, tick, basePrefix, effectiveMounted);
  }

  const thunderReady = poolAvailableAt(state.chargeTicks.thunder, tick) > 0;
  if (state.rage === config.maxRage && thunderReady) {
    const rideReady = poolAvailableAt(state.chargeTicks.ride, tick) > 0;
    const orangeActive = isBuffActiveAtTick(state, "orange", tick);
    if (!effectiveMounted && orangeActive && rideReady) {
      return [withBasePrefix({ primary: "dragonFang" }, basePrefix)];
    }
    const rideReadyTick = poolNextReadyTick(state.chargeTicks.ride, tick);
    const gcdTicks = gcdLockTicks(config.gcdFrames, config.latencyMs);
    if (
      !effectiveMounted &&
      !orangeActive &&
      !rideReady &&
      rideReadyTick - tick <= gcdTicks * 6
    ) {
      return [withBasePrefix({ primary: "dragonFang" }, basePrefix)];
    }
    return thunderStartPacks(state, config, tick, basePrefix, effectiveMounted);
  }
  if (thunderReady) {
    return prepareThunderPacks(state, config, tick, basePrefix, effectiveMounted);
  }
  return gapPacks(state, config, tick, basePrefix, effectiveMounted, {
    allowMountedFang: terminalLiquidation,
  });
}

function addActionPlan(plans, actions) {
  if (actions.every(Boolean)) plans.push(actions);
}

function mechanicalOffGcdPlans(state, tick) {
  const thunderReady = poolAvailableAt(state.chargeTicks.thunder, tick) > 0;
  const orangeReady = cooldownReady(state, "orange", tick);
  const mounted = isMountedAtTick(state, tick);
  const chargeReady = mounted && cooldownReady(state, "charge", tick);
  const plans = [[]];

  if (thunderReady) addActionPlan(plans, ["thunder"]);
  if (orangeReady) addActionPlan(plans, ["orange"]);
  if (thunderReady && orangeReady) {
    addActionPlan(plans, ["thunder", "orange"]);
  }
  if (chargeReady) {
    addActionPlan(plans, ["charge"]);
    if (thunderReady) addActionPlan(plans, ["thunder", "charge"]);
    if (orangeReady) addActionPlan(plans, ["charge", "orange"]);
    if (thunderReady && orangeReady) {
      // 断魂刺先享受激雷，再由橙武把战意补满。
      addActionPlan(plans, ["thunder", "charge", "orange"]);
    }
  }

  if (mounted) {
    for (const plan of [...plans]) {
      addActionPlan(plans, [...plan, { id: "dismount", reason: "free-search" }]);
    }
  }
  return plans;
}

function mechanicalRidePacks(state, tick) {
  if (poolAvailableAt(state.chargeTicks.ride, tick) <= 0) return [];
  const mounted = isMountedAtTick(state, tick);
  const chargeReady = mounted && cooldownReady(state, "charge", tick);
  const prefixes = mounted
    ? [
        [{ id: "dismount", reason: "refresh-ride" }],
        ...(chargeReady
          ? [["charge", { id: "dismount", reason: "charge-before-refresh" }]]
          : []),
      ]
    : [[]];
  const tails = [
    [],
    ["thunder"],
    ["orange"],
    ["thunder", "orange"],
    ["charge"],
    ["thunder", "charge"],
    ["charge", "orange"],
    ["thunder", "charge", "orange"],
  ];
  const packs = [];
  for (const prefix of prefixes) {
    for (const tail of tails) {
      packs.push({
        prefix,
        primary: "ride",
        tail: tail.map((id) => ({ id, leadFrames: 1 })),
      });
    }
  }
  return packs;
}

function mechanicalTailOffGcdVariants(packs, state, config, tick) {
  const tailTick = tick + gcdLockTicks(config.gcdFrames, config.latencyMs) -
    frameToTicks(1);
  const thunderReady = poolAvailableAt(state.chargeTicks.thunder, tailTick) > 0;
  const orangeReady = cooldownReady(state, "orange", tailTick);
  const variants = [];
  for (const pack of packs) {
    const timingVariants = [pack];
    if (primaryId(pack) !== "ride") {
      const existing = new Set([
        ...(pack.prefix ?? []),
        ...(pack.tail ?? []),
      ].map(actionId));
      const plans = [];
      if (thunderReady && !existing.has("thunder")) plans.push(["thunder"]);
      if (orangeReady && !existing.has("orange")) plans.push(["orange"]);
      if (
        thunderReady &&
        orangeReady &&
        !existing.has("thunder") &&
        !existing.has("orange")
      ) plans.push(["thunder", "orange"]);
      for (const plan of plans) {
        const variant = clonePack(pack);
        variant.tail.push(...plan.map((id) => ({ id, leadFrames: 1 })));
        timingVariants.push(variant);
      }
    }

    for (const variant of timingVariants) {
      variants.push(variant);
      const prefixDismount = (variant.prefix ?? []).some(
        (action) => actionId(action) === "dismount",
      );
      const tailDismount = (variant.tail ?? []).some(
        (action) => actionId(action) === "dismount",
      );
      const mountedAtTail = primaryId(variant) === "ride" ||
        (isMountedAtTick(state, tick) && !prefixDismount);
      if (!mountedAtTail || tailDismount) continue;
      const dismountVariant = clonePack(variant);
      dismountVariant.tail.push({
        id: "dismount",
        reason: primaryId(variant) === "ride"
          ? "ride-tail-free-search"
          : "gcd-tail-free-search",
        leadFrames: 1,
      });
      variants.push(dismountVariant);
    }
  }
  return uniquePacks(variants);
}

export function legalMechanicalLianyingPacks(state, config) {
  const tick = decisionTick(state);
  const packs = [];
  const primaryActions = ["dragonFang", "destroy", "dragonRoar", "cloudStrike"];
  for (const prefix of mechanicalOffGcdPlans(state, tick)) {
    for (const primary of primaryActions) {
      packs.push({ prefix, primary });
    }
  }
  packs.push(...mechanicalRidePacks(state, tick));
  return mechanicalTailOffGcdVariants(uniquePacks(packs), state, config, tick);
}

export function legalLianyingPacks(
  state,
  config,
  {
    policyMode = "free",
    horizonMode = "fixed",
    endTick = Number.POSITIVE_INFINITY,
  } = {},
) {
  if (!LIANYING_POLICY_MODES.includes(policyMode)) {
    throw new Error(`未知连营策略模式: ${policyMode}`);
  }
  if (policyMode === "strict") {
    return legalWhitepaperPacks(state, config, {
      mode: horizonMode,
      endTick,
    });
  }
  // 引导与自由模式共享完整的机制合法动作空间，差异只发生在束搜索剪枝排序。
  return legalMechanicalLianyingPacks(state, config);
}

function stateSignature(state) {
  const tick = decisionTick(state);
  const thunderContext = isBuffActiveAtTick(state, "thunder", tick)
    ? currentThunderContext(state, tick)
    : null;
  return JSON.stringify([
    state.tick,
    state.gcdReadyTick,
    state.rage,
    state.bleedStacks,
    state.bleedQuality,
    state.bleedNextTick,
    state.autoAttackNextTick,
    state.dragonRideStacks,
    state.mounted,
    state.mountedFromTick,
    state.executeDestroyToggle,
    state.cooldownReadyTick,
    state.buffTicks,
    state.chargeTicks,
    thunderContext
      ? [
          thunderContext.startStacks,
          thunderContext.fangCount,
          thunderContext.usedDragonRoar,
          thunderContext.usedCharge,
        ]
      : null,
  ]);
}

function nodeMetrics(node) {
  let cloudStrikes = 0;
  let thunderFangs = 0;
  let guideDeviations = 0;
  let resourceWaste = 0;
  for (const event of node.state.timeline) {
    if (event.type === "cast") {
      if (event.action === "cloudStrike") {
        cloudStrikes += 1;
        if (event.thunder) guideDeviations += 1;
      }
      if (event.action === "dragonFang" && event.thunder) thunderFangs += 1;
      if (event.action === "ride") {
        resourceWaste += Number(event.stackOverflow ?? 0);
        if (event.orange) guideDeviations += 1;
      }
      if (event.orange && event.action !== "dragonFang") guideDeviations += 1;
      resourceWaste += Number(event.rageOverflow ?? 0);
    }
    if (event.type === "offGcd") {
      if (event.action === "thunder" && event.rageBefore !== 5) {
        guideDeviations += 1;
      }
      if (event.action === "charge") {
        if (event.rageBefore > 2) guideDeviations += 1;
        if (!event.thunder) guideDeviations += 1;
        resourceWaste += Number(event.rageOverflow ?? 0);
      }
    }
  }
  return { cloudStrikes, thunderFangs, guideDeviations, resourceWaste };
}

function rankNodes(left, right, policyMode = "strict") {
  const leftMetrics = nodeMetrics(left);
  const rightMetrics = nodeMetrics(right);
  const damageDelta = right.state.totalDamage - left.state.totalDamage;
  if (policyMode === "guided") {
    const tolerance = Math.max(
      Math.abs(left.state.totalDamage),
      Math.abs(right.state.totalDamage),
      1,
    ) * 0.0005;
    if (Math.abs(damageDelta) <= tolerance) {
      const guided =
        leftMetrics.guideDeviations - rightMetrics.guideDeviations ||
        leftMetrics.resourceWaste - rightMetrics.resourceWaste;
      if (guided !== 0) return guided;
    }
  }
  if (damageDelta !== 0) return damageDelta;
  if (policyMode === "free") {
    return (
      right.state.rage - left.state.rage ||
      right.state.dragonRideStacks - left.state.dragonRideStacks ||
      left.packs.length - right.packs.length
    );
  }
  return (
    rightMetrics.thunderFangs - leftMetrics.thunderFangs ||
    leftMetrics.cloudStrikes - rightMetrics.cloudStrikes ||
    left.packs.length - right.packs.length
  );
}

function diversityBucket(node, config) {
  const tick = decisionTick(node.state);
  const dragonRideBand = Math.floor(node.state.dragonRideStacks / 6);
  return JSON.stringify([
    isBuffActiveAtTick(node.state, "thunder", tick),
    isBuffActiveAtTick(node.state, "orange", tick),
    isMountedAtTick(node.state, tick),
    node.state.rage,
    dragonRideBand,
    poolAvailableAt(node.state.chargeTicks.thunder, tick),
    poolAvailableAt(node.state.chargeTicks.ride, tick),
    cooldownReady(node.state, "orange", tick),
    config.rotation,
  ]);
}

function incrementCounter(counter, key) {
  counter[key] = Number(counter[key] ?? 0) + 1;
}

function illegalReason(error) {
  const message = String(error?.message ?? error ?? "未知非法动作");
  return message.replace(/\d+(?:\.\d+)?/g, "#").slice(0, 160);
}

function selectBeam(
  candidates,
  beamWidth,
  policyMode,
  config,
  pinnedSignatures = new Set(),
  ranker = (left, right) => rankNodes(left, right, policyMode),
) {
  const sorted = [...candidates].sort(ranker);
  const effectiveBeamWidth = Math.max(beamWidth, pinnedSignatures.size);
  if (policyMode === "strict" || sorted.length <= beamWidth) {
    const selected = sorted.slice(0, effectiveBeamWidth);
    const selectedSignatures = new Set(
      selected.map((node) => stateSignature(node.state)),
    );
    for (const pinnedSignature of pinnedSignatures) {
      if (selectedSignatures.has(pinnedSignature)) continue;
      const pinned = sorted.find(
        (node) => stateSignature(node.state) === pinnedSignature,
      );
      if (!pinned) continue;
      const replaceIndex = selected.findLastIndex(
        (node) => !pinnedSignatures.has(stateSignature(node.state)),
      );
      if (replaceIndex >= 0) selected[replaceIndex] = pinned;
      else selected.push(pinned);
      selectedSignatures.add(pinnedSignature);
    }
    return selected;
  }
  const perBucket = Math.max(1, Math.ceil(effectiveBeamWidth / 8));
  const bucketCounts = new Map();
  const selected = [];
  const selectedSet = new Set();
  for (const node of sorted) {
    const bucket = diversityBucket(node, config);
    const count = Number(bucketCounts.get(bucket) ?? 0);
    if (count >= perBucket) continue;
    bucketCounts.set(bucket, count + 1);
    selected.push(node);
    selectedSet.add(node);
    if (selected.length >= effectiveBeamWidth) break;
  }
  for (const node of sorted) {
    if (selected.length >= effectiveBeamWidth) break;
    if (selectedSet.has(node)) continue;
    selected.push(node);
  }
  const selectedSignatures = new Set(
    selected.map((node) => stateSignature(node.state)),
  );
  for (const pinnedSignature of pinnedSignatures) {
    if (selectedSignatures.has(pinnedSignature)) continue;
    const pinned = sorted.find(
      (node) => stateSignature(node.state) === pinnedSignature,
    );
    if (!pinned) continue;
    const replaceIndex = selected.findLastIndex(
      (node) => !pinnedSignatures.has(stateSignature(node.state)),
    );
    if (replaceIndex >= 0) selected[replaceIndex] = pinned;
    else selected.push(pinned);
    selectedSignatures.add(pinnedSignature);
  }
  return selected;
}

function selectPrunedArchive(
  candidates,
  selectedNodes,
  limit,
  policyMode,
  config,
  ranker = (left, right) => rankNodes(left, right, policyMode),
) {
  const selectedSignatures = new Set(
    selectedNodes.map((node) => stateSignature(node.state)),
  );
  const ranked = [...candidates]
    .filter((node) => !selectedSignatures.has(stateSignature(node.state)))
    .sort(ranker);
  const archived = [];
  const resourcePhases = new Set();
  for (const node of ranked) {
    const phase = diversityBucket(node, config);
    if (resourcePhases.has(phase)) continue;
    resourcePhases.add(phase);
    archived.push(node);
    if (archived.length >= limit) break;
  }
  return archived;
}

function executePacks(initialState, packs, config, oracle, endTick) {
  let state = initialState;
  for (const pack of packs) {
    if (decisionTick(state) >= endTick) break;
    state = executeActionPack(state, pack, config, oracle, { endTick });
  }
  return state;
}

export function searchLianyingAxis(
  runtime,
  {
    durationSeconds = 180,
    mode = "fixed",
    beamWidth = 48,
    policyMode = "free",
    initialPacks,
    warmStartPacks = [],
    warmStartAxes = [],
    fixedPacksByDepth = new Map(),
    prunedArchiveRows = [],
    prunedArchivePerRow = 0,
    prunedArchiveRanker = null,
    nodeScore = null,
  } = {},
) {
  if (!['fixed', 'stable'].includes(mode)) throw new Error(`未知搜索模式: ${mode}`);
  if (!LIANYING_POLICY_MODES.includes(policyMode)) {
    throw new Error(`未知连营策略模式: ${policyMode}`);
  }
  if (!Number.isInteger(beamWidth) || beamWidth <= 0) {
    throw new Error("束宽度必须为正整数");
  }
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  const fixedPackEntries = fixedPacksByDepth instanceof Map
    ? [...fixedPacksByDepth.entries()]
    : Object.entries(fixedPacksByDepth ?? {});
  const normalizedFixedPacksByDepth = new Map(fixedPackEntries.map(
    ([depth, pack]) => [Math.floor(Number(depth)), clonePack(pack)],
  ));
  const archiveRows = new Set(
    (prunedArchiveRows ?? []).map((row) => Math.floor(Number(row))),
  );
  const archiveLimit = Math.max(0, Math.floor(Number(prunedArchivePerRow)));
  const initialState = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  const seedPacks = initialPacks ??
    (policyMode === "strict" ? buildWhitepaperOpener() : []);
  const openedState = executePacks(
    initialState,
    seedPacks,
    runtime.config,
    runtime.oracle,
    endTick,
  );
  const makeNode = (state, packs) => {
    const node = { state, packs };
    if (typeof nodeScore === "function") {
      const score = Number(nodeScore(node));
      if (Number.isFinite(score)) node.searchScore = score;
    }
    return node;
  };
  const searchRanker = typeof nodeScore === "function"
    ? (left, right) =>
        Number(right.searchScore ?? Number.NEGATIVE_INFINITY) -
          Number(left.searchScore ?? Number.NEGATIVE_INFINITY) ||
        rankNodes(left, right, policyMode)
    : (left, right) => rankNodes(left, right, policyMode);
  let beam = [makeNode(openedState, seedPacks.map(clonePack))];
  const warmStartByLength = new Map();
  const warmStartDamages = [];
  if (seedPacks.length === 0) {
    const axes = [
      ...(warmStartPacks.length > 0 ? [warmStartPacks] : []),
      ...warmStartAxes,
    ];
    const seenAxes = new Set();
    for (const axis of axes) {
      const axisKey = JSON.stringify(axis);
      if (seenAxes.has(axisKey)) continue;
      seenAxes.add(axisKey);
      let warmState = initialState;
      const warmPacks = [];
      for (const pack of axis) {
        if (decisionTick(warmState) >= endTick) break;
        warmState = executeActionPack(
          warmState,
          pack,
          runtime.config,
          runtime.oracle,
          { endTick },
        );
        warmPacks.push(clonePack(pack));
        const signature = stateSignature(warmState);
        const nodes = warmStartByLength.get(warmPacks.length) ?? new Map();
        const previous = nodes.get(signature);
        const node = makeNode(warmState, warmPacks.map(clonePack));
        if (!previous || rankNodes(node, previous, "free") < 0) {
          nodes.set(signature, node);
        }
        warmStartByLength.set(warmPacks.length, nodes);
      }
      warmStartDamages.push(warmState.totalDamage);
    }
  }
  let explored = 0;
  let legal = 0;
  const telemetry = {
    layers: [],
    illegalReasons: {},
    exactStateCollisions: 0,
    exactStateReplacements: 0,
    exactStateDominated: 0,
    beamPruned: 0,
    peakUniqueCandidates: 0,
    peakBeamSize: beam.length,
    prunedArchive: [],
  };
  const prunedArchive = [];

  while (beam.some((node) => decisionTick(node.state) < endTick)) {
    const candidates = new Map();
    const nextPathLength = Number(beam[0]?.packs.length ?? 0) + 1;
    const layer = {
      depth: nextPathLength,
      inputNodes: beam.length,
      completedInputNodes: 0,
      exploredTransitions: 0,
      legalTransitions: 0,
      illegalTransitions: 0,
      exactStateCollisions: 0,
      exactStateReplacements: 0,
      exactStateDominated: 0,
      uniqueCandidates: 0,
      selectedNodes: 0,
      beamPruned: 0,
      diversityBucketsSelected: 0,
      pinnedWarmStarts: 0,
    };
    for (const node of beam) {
      if (decisionTick(node.state) >= endTick) {
        layer.completedInputNodes += 1;
        const signature = stateSignature(node.state);
        const previous = candidates.get(signature);
        if (!previous || rankNodes(node, previous, "free") < 0) {
          if (previous) {
            layer.exactStateCollisions += 1;
            layer.exactStateReplacements += 1;
          }
          candidates.set(signature, node);
        } else {
          layer.exactStateCollisions += 1;
          layer.exactStateDominated += 1;
        }
        continue;
      }
      const fixedPack = normalizedFixedPacksByDepth.get(nextPathLength);
      const packs = fixedPack
        ? [fixedPack]
        : legalLianyingPacks(node.state, runtime.config, {
            policyMode,
            horizonMode: mode,
            endTick,
          });
      for (const pack of packs) {
        explored += 1;
        layer.exploredTransitions += 1;
        try {
          const state = executeActionPack(
            node.state,
            pack,
            runtime.config,
            runtime.oracle,
            { endTick },
          );
          legal += 1;
          layer.legalTransitions += 1;
          const candidate = makeNode(
            state,
            [...node.packs, clonePack(pack)],
          );
          const signature = stateSignature(state);
          const previous = candidates.get(signature);
          if (!previous || rankNodes(candidate, previous, "free") < 0) {
            if (previous) {
              layer.exactStateCollisions += 1;
              layer.exactStateReplacements += 1;
            }
            candidates.set(signature, candidate);
          } else {
            layer.exactStateCollisions += 1;
            layer.exactStateDominated += 1;
          }
        } catch (error) {
          // 冷却、战意、充能和马上状态不合法的候选不进入下一层。
          layer.illegalTransitions += 1;
          incrementCounter(telemetry.illegalReasons, illegalReason(error));
        }
      }
    }
    const warmNodes = warmStartByLength.get(nextPathLength) ?? new Map();
    const pinnedSignatures = new Set();
    for (const [pinnedSignature, warmNode] of warmNodes) {
      pinnedSignatures.add(pinnedSignature);
      const previous = candidates.get(pinnedSignature);
      if (!previous || rankNodes(warmNode, previous, "free") < 0) {
        if (previous) {
          layer.exactStateCollisions += 1;
          layer.exactStateReplacements += 1;
        }
        candidates.set(pinnedSignature, warmNode);
      } else {
        layer.exactStateCollisions += 1;
        layer.exactStateDominated += 1;
      }
    }
    layer.pinnedWarmStarts = pinnedSignatures.size;
    layer.uniqueCandidates = candidates.size;
    beam = selectBeam(
      candidates.values(),
      beamWidth,
      policyMode,
      runtime.config,
      pinnedSignatures,
      searchRanker,
    );
    if (archiveLimit > 0 && archiveRows.has(nextPathLength)) {
      const archived = selectPrunedArchive(
        candidates.values(),
        beam,
        archiveLimit,
        policyMode,
        runtime.config,
        typeof prunedArchiveRanker === "function"
          ? prunedArchiveRanker
          : searchRanker,
      );
      prunedArchive.push(...archived.map((node) => ({
        depth: nextPathLength,
        state: node.state,
        packs: node.packs,
      })));
      telemetry.prunedArchive.push({
        depth: nextPathLength,
        count: archived.length,
        resourcePhases: archived.map((node) =>
          diversityBucket(node, runtime.config)),
      });
    }
    if (beam.length === 0) throw new Error("白皮书约束下没有可继续执行的技能轴");
    layer.selectedNodes = beam.length;
    layer.beamPruned = Math.max(0, layer.uniqueCandidates - layer.selectedNodes);
    layer.diversityBucketsSelected = new Set(
      beam.map((node) => diversityBucket(node, runtime.config)),
    ).size;
    telemetry.layers.push(layer);
    telemetry.exactStateCollisions += layer.exactStateCollisions;
    telemetry.exactStateReplacements += layer.exactStateReplacements;
    telemetry.exactStateDominated += layer.exactStateDominated;
    telemetry.beamPruned += layer.beamPruned;
    telemetry.peakUniqueCandidates = Math.max(
      telemetry.peakUniqueCandidates,
      layer.uniqueCandidates,
    );
    telemetry.peakBeamSize = Math.max(telemetry.peakBeamSize, beam.length);
  }

  // 引导只影响中途剪枝；最终答案始终按完整技能轴实际伤害选择。
  const best = [...beam].sort((left, right) =>
    rankNodes(left, right, "free"))[0];
  return {
    mode,
    policyMode,
    durationSeconds: Number(durationSeconds),
    beamWidth,
    explored,
    legal,
    warmStarted: warmStartByLength.size > 0,
    warmStartCount: warmStartDamages.length,
    warmStartDamages,
    warmStartDamage: warmStartDamages.length > 0
      ? Math.max(...warmStartDamages)
      : null,
    telemetry,
    prunedArchive,
    packs: best.packs,
    state: best.state,
  };
}

export function searchWhitepaperLianying(runtime, options = {}) {
  return searchLianyingAxis(runtime, {
    ...options,
    policyMode: "strict",
    initialPacks: options.initialPacks ?? buildWhitepaperOpener(),
  });
}

export function replayWhitepaperLianying(
  runtime,
  packs,
  { durationSeconds = 180 } = {},
) {
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  let state = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  const trace = [];
  for (let index = 0; index < packs.length; index += 1) {
    if (decisionTick(state) >= endTick) break;
    const pack = packs[index];
    const before = state;
    const sequenceBefore = state.sequence;
    state = executeActionPack(state, pack, runtime.config, runtime.oracle, { endTick });
    const events = state.timeline.filter((event) => event.sequence > sequenceBefore);
    const cast = events.find((event) => event.type === "cast");
    let label = labelWhitepaperPack(pack);
    if (cast?.action === "destroy") {
      label = label.replace(
        "灭",
        cast.destroySource === "poLouLanBonus" ? "灭·破楼兰" : "灭·正常",
      );
    }
    trace.push({
      index,
      label,
      pack: clonePack(pack),
      startTick: before.tick,
      castTick: cast?.tick ?? before.tick,
      endTick: state.tick,
      sequenceFrom: sequenceBefore + 1,
      sequenceUntil: state.sequence,
      rageAtRowStart: before.rage,
      rageBefore: cast?.rageBeforeCast ?? cast?.rageBefore ?? before.rage,
      rageAfter:
        cast?.rageAfterResolution ?? cast?.rageAfter ?? state.rage,
      dragonRideBefore: before.dragonRideStacks,
      dragonRideAfter: state.dragonRideStacks,
      mountedBefore: before.mounted,
      mountedAfter: state.mounted,
      bleedStacksAfter: state.bleedStacks,
      bleedQualityAfter: state.bleedQuality,
      destroySource: cast?.destroySource ?? null,
    });
  }
  return { state, trace };
}

function withoutDash(pack) {
  const next = clonePack(pack);
  next.prefix = (next.prefix ?? []).filter((action) => actionId(action) !== "dash");
  next.tail = (next.tail ?? []).filter((action) => actionId(action) !== "dash");
  delete next.label;
  return next;
}

function dashPlacementVariants(pack, state, config) {
  const base = withoutDash(pack);
  const tick = decisionTick(state);
  const nextTick = tick + gcdLockTicks(config.gcdFrames, config.latencyMs);
  const frameTicks = frameToTicks(1);
  const readyTick = Number(state.cooldownReadyTick.dash ?? 0);
  const firstReadyLead = Math.min(
    Number(config.gcdFrames) - 1,
    Math.floor((nextTick - readyTick) / frameTicks),
  );
  const tailLeads = new Set([
    1,
    Number(config.gcdFrames) - 1,
    firstReadyLead,
  ]);
  return [
    base,
    {
      ...clonePack(base),
      prefix: [...(base.prefix ?? []), "dash"],
    },
    ...[...tailLeads]
      .filter(
        (leadFrames) =>
          Number.isInteger(leadFrames) &&
          leadFrames >= 1 &&
          leadFrames < Number(config.gcdFrames),
      )
      .map((leadFrames) => ({
        ...clonePack(base),
        tail: [
          ...(base.tail ?? []),
          { id: "dash", leadFrames },
        ],
      })),
  ];
}

/**
 * “突”不改变战意、增益或主要技能时间，只改变自身CD与伤害，因此可在固定
 * 主要技能轴上独立做精确状态搜索，避免把主束搜索动作空间扩大三倍。
 */
export function optimizeLianyingDashOverlay(
  runtime,
  packs,
  { durationSeconds = 180, maxStatesPerRow = 256 } = {},
) {
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  const initialState = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  let nodes = [{ state: initialState, packs: [] }];
  let generatedCandidates = 0;
  let legalCandidates = 0;
  let peakStates = 1;

  for (let index = 0; index < packs.length; index += 1) {
    const candidates = new Map();
    for (const node of nodes) {
      if (decisionTick(node.state) >= endTick) {
        const key = stateSignature(node.state);
        const current = candidates.get(key);
        if (!current || node.state.totalDamage > current.state.totalDamage) {
          candidates.set(key, node);
        }
        continue;
      }
      for (const variant of dashPlacementVariants(
        packs[index],
        node.state,
        runtime.config,
      )) {
        generatedCandidates += 1;
        try {
          const state = executeActionPack(
            node.state,
            variant,
            runtime.config,
            runtime.oracle,
            { endTick },
          );
          legalCandidates += 1;
          const candidate = {
            state,
            packs: [...node.packs, variant],
          };
          const key = stateSignature(state);
          const current = candidates.get(key);
          if (!current || state.totalDamage > current.state.totalDamage) {
            candidates.set(key, candidate);
          }
        } catch {
          // 马上施展、CD未好或GCD末端越界的突候选由状态机自然淘汰。
        }
      }
    }
    nodes = [...candidates.values()]
      .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
      .slice(0, maxStatesPerRow);
    peakStates = Math.max(peakStates, nodes.length);
    if (nodes.length === 0) throw new Error(`突覆盖搜索在第${index + 1}行无合法状态`);
  }

  const best = [...nodes].sort(
    (left, right) => right.state.totalDamage - left.state.totalDamage,
  )[0];
  const baseline = replayWhitepaperLianying(runtime, packs, { durationSeconds });
  const replay = replayWhitepaperLianying(runtime, best.packs, { durationSeconds });
  return {
    packs: best.packs,
    state: replay.state,
    trace: replay.trace,
    baselineDamage: baseline.state.totalDamage,
    damageGain: replay.state.totalDamage - baseline.state.totalDamage,
    dashCount: replay.state.timeline.filter(
      (event) => event.type === "offGcd" && event.action === "dash",
    ).length,
    generatedCandidates,
    legalCandidates,
    peakStates,
    maxStatesPerRow,
  };
}

function packIncludes(pack, location, id) {
  return (pack[location] ?? []).some((action) => actionId(action) === id);
}

function withoutPackActions(pack, location, ids) {
  const next = clonePack(pack);
  next[location] = (next[location] ?? []).filter(
    (action) => !ids.has(actionId(action)),
  );
  delete next.label;
  return next;
}

function moveThunderStartToRide(ridePack, thunderPack) {
  const movable = (thunderPack.prefix ?? []).filter((action) =>
    ["thunder", "orange"].includes(actionId(action)));
  const ride = clonePack(ridePack);
  const tailIds = new Set((ride.tail ?? []).map(actionId));
  for (const action of movable) {
    const id = actionId(action);
    if (tailIds.has(id)) continue;
    ride.tail.push({ id, leadFrames: 1 });
    tailIds.add(id);
  }
  delete ride.label;
  return {
    ride,
    fang: withoutPackActions(
      thunderPack,
      "prefix",
      new Set(["thunder", "orange"]),
    ),
  };
}

function whitepaperReferenceReorders(packs) {
  const candidates = [];
  for (let index = 0; index < packs.length; index += 1) {
    const three = packs.slice(index, index + 3);
    if (
      three.length === 3 &&
      primaryId(three[0]) === "ride" &&
      packIncludes(three[0], "prefix", "dismount") &&
      primaryId(three[1]) === "destroy" &&
      primaryId(three[2]) === "dragonFang" &&
      packIncludes(three[2], "prefix", "thunder")
    ) {
      const moved = moveThunderStartToRide(three[0], three[2]);
      candidates.push({
        rule: "灭前置后任雷（五段加速龙驭连营参考）",
        startRow: index + 1,
        packs: [
          ...packs.slice(0, index).map(clonePack),
          clonePack(three[1]),
          moved.ride,
          moved.fang,
          ...packs.slice(index + 3).map(clonePack),
        ],
      });
    }

    const four = packs.slice(index, index + 4);
    if (
      four.length === 4 &&
      primaryId(four[0]) === "cloudStrike" &&
      packIncludes(four[0], "prefix", "dismount") &&
      primaryId(four[1]) === "ride" &&
      primaryId(four[2]) === "destroy" &&
      primaryId(four[3]) === "dragonFang" &&
      packIncludes(four[3], "prefix", "thunder")
    ) {
      for (const filler of ["cloudStrike", "dragonRoar"]) {
        const moved = moveThunderStartToRide(four[1], four[3]);
        const first = clonePack(four[0]);
        first.primary = filler;
        delete first.label;
        candidates.push({
          rule: filler === "dragonRoar"
            ? "龙吟灭任雷（五段加速龙驭连营参考）"
            : "填充灭任雷（五段加速龙驭连营参考）",
          startRow: index + 1,
          packs: [
            ...packs.slice(0, index).map(clonePack),
            first,
            clonePack(four[2]),
            moved.ride,
            moved.fang,
            ...packs.slice(index + 4).map(clonePack),
          ],
        });
      }
    }
  }
  return candidates;
}

// 白皮书只负责提出局部候选；是否采用完全由机制重放与整段总伤害决定。
export function optimizeLianyingReferenceAxis(
  runtime,
  packs,
  { durationSeconds = 180, maxPasses = 8 } = {},
) {
  let incumbentPacks = packs.map(clonePack);
  let incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const baselineDamage = incumbent.state.totalDamage;
  const improvements = [];
  let candidatesEvaluated = 0;
  let illegalCandidates = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let best = null;
    for (const candidate of whitepaperReferenceReorders(incumbentPacks)) {
      candidatesEvaluated += 1;
      try {
        const replay = replayWhitepaperLianying(runtime, candidate.packs, {
          durationSeconds,
        });
        if (replay.state.totalDamage <= incumbent.state.totalDamage) continue;
        if (!best || replay.state.totalDamage > best.replay.state.totalDamage) {
          best = { ...candidate, replay };
        }
      } catch {
        illegalCandidates += 1;
      }
    }
    if (!best) break;
    const damageBefore = incumbent.state.totalDamage;
    incumbentPacks = best.packs;
    incumbent = best.replay;
    improvements.push({
      pass: pass + 1,
      rule: best.rule,
      startRow: best.startRow,
      damageGain: incumbent.state.totalDamage - damageBefore,
      cumulativeDamageGain:
        incumbent.state.totalDamage - baselineDamage,
    });
  }

  return {
    packs: incumbentPacks,
    state: incumbent.state,
    trace: incumbent.trace,
    baselineDamage,
    damageGain: incumbent.state.totalDamage - baselineDamage,
    improvements,
    candidatesEvaluated,
    illegalCandidates,
  };
}

function isNeighborhoodKeyPack(pack) {
  return (
    primaryId(pack) !== "dragonFang" ||
    (pack.prefix ?? []).length > 0 ||
    (pack.tail ?? []).length > 0
  );
}

function canonicalActionPack(pack) {
  return JSON.stringify({
    prefix: (pack.prefix ?? []).map(actionId),
    primary: primaryId(pack),
    tail: (pack.tail ?? []).map(actionId),
  });
}

function swappedPacks(packs, leftIndex, rightIndex) {
  const candidate = packs.map(clonePack);
  const left = clonePack(candidate[leftIndex]);
  const right = clonePack(candidate[rightIndex]);
  delete left.label;
  delete right.label;
  candidate[leftIndex] = right;
  candidate[rightIndex] = left;
  return candidate;
}

function unlabeledPack(pack) {
  const next = clonePack(pack);
  delete next.label;
  return next;
}

function createMutation(kind, changes, details = {}) {
  const entries = [...changes.entries()].sort((left, right) => left[0] - right[0]);
  return {
    kind,
    changes: new Map(entries),
    startIndex: entries[0][0],
    endIndex: entries.at(-1)[0],
    ...details,
  };
}

function mutationKey(mutation) {
  return JSON.stringify([
    mutation.kind,
    [...mutation.changes].map(([index, pack]) => [index, canonicalActionPack(pack)]),
  ]);
}

function applyMutation(packs, mutation) {
  const candidate = packs.map(clonePack);
  for (const [index, pack] of mutation.changes) {
    candidate[index] = unlabeledPack(pack);
  }
  return candidate;
}

function actionLocationPack(pack, location, actions) {
  const next = unlabeledPack(pack);
  next[location] = actions.map((action) =>
    typeof action === "string" ? action : { ...action });
  return next;
}

function packHasOffGcd(pack, id) {
  return [...(pack.prefix ?? []), ...(pack.tail ?? [])]
    .some((action) => actionId(action) === id);
}

export function detectLianyingResourceBalanceSignals(replay) {
  const signals = [];
  const seen = new Set();
  const add = (signal) => {
    const key = `${signal.kind}|${signal.rowIndex}|${signal.action ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push(signal);
  };
  for (const row of replay.trace ?? []) {
    const events = (replay.state?.timeline ?? []).filter(
      (event) =>
        event.sequence >= row.sequenceFrom &&
        event.sequence <= row.sequenceUntil,
    );
    for (const event of events) {
      if (event.type === "offGcd" && event.action === "charge" && event.rageBefore > 2) {
        add({
          kind: "high-rage-charge",
          rowIndex: row.index,
          action: event.action,
          rageBefore: event.rageBefore,
          rageOverflow: Number(event.rageOverflow ?? 0),
        });
      }
      if (event.type === "offGcd" && event.action === "thunder" && event.rageBefore < 5) {
        add({
          kind: "low-rage-thunder",
          rowIndex: row.index,
          action: event.action,
          rageBefore: event.rageBefore,
        });
      }
      if (event.type === "cast" && event.action === "ride" && event.stackOverflow > 0) {
        add({
          kind: "dragon-ride-overflow",
          rowIndex: row.index,
          action: event.action,
          dragonRideBefore: event.stacksBefore,
          stackOverflow: event.stackOverflow,
        });
      }
      if (Number(event.rageOverflow ?? 0) > 0 && event.action !== "charge") {
        add({
          kind: "rage-overflow",
          rowIndex: row.index,
          action: event.action,
          rageBefore: event.rageBeforeCast ?? event.rageBefore,
          rageOverflow: Number(event.rageOverflow),
        });
      }
    }
  }
  return signals;
}

function primaryOnlySwapChanges(packs, leftIndex, rightIndex) {
  const left = unlabeledPack(packs[leftIndex]);
  const right = unlabeledPack(packs[rightIndex]);
  const leftPrimary = left.primary;
  left.primary = right.primary;
  right.primary = leftPrimary;
  return new Map([
    [leftIndex, left],
    [rightIndex, right],
  ]);
}

function moveOffGcdActionChanges(
  packs,
  sourceIndex,
  sourceLocation,
  actionIndex,
  targetIndex,
  targetLocation,
) {
  const sourceActions = packs[sourceIndex][sourceLocation] ?? [];
  const id = actionId(sourceActions[actionIndex]);
  const nextSourceActions = sourceActions.filter((_, index) => index !== actionIndex);
  const nextTargetActions = [
    ...(packs[targetIndex][targetLocation] ?? []),
    targetLocation === "tail" ? { id, leadFrames: 1 } : id,
  ];
  if (sourceIndex === targetIndex) {
    const next = actionLocationPack(
      packs[sourceIndex],
      sourceLocation,
      nextSourceActions,
    );
    return new Map([[
      sourceIndex,
      actionLocationPack(next, targetLocation, nextTargetActions),
    ]]);
  }
  return new Map([
    [sourceIndex, actionLocationPack(
      packs[sourceIndex],
      sourceLocation,
      nextSourceActions,
    )],
    [targetIndex, actionLocationPack(
      packs[targetIndex],
      targetLocation,
      nextTargetActions,
    )],
  ]);
}

export function lianyingResourceBalanceMutations(
  packs,
  signals,
  { maxDistance = 6 } = {},
) {
  const mutations = [];
  const seen = new Set();
  const add = (mutation) => {
    const key = mutationKey(mutation);
    if (seen.has(key)) return;
    seen.add(key);
    mutations.push(mutation);
  };
  const distance = Math.max(1, Math.floor(Number(maxDistance)));
  const refillPrimaries = new Set(["destroy", "dragonRoar", "cloudStrike"]);

  for (const signal of signals) {
    const rowIndex = Number(signal.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= packs.length) continue;

    if (signal.kind === "high-rage-charge") {
      for (const sourceLocation of ["prefix", "tail"]) {
        const sourceActions = packs[rowIndex][sourceLocation] ?? [];
        for (let actionIndex = 0; actionIndex < sourceActions.length; actionIndex += 1) {
          if (actionId(sourceActions[actionIndex]) !== "charge") continue;
          if (sourceLocation === "prefix" && primaryId(packs[rowIndex]) === "dragonFang") {
            add(createMutation("resourceBalance", moveOffGcdActionChanges(
              packs,
              rowIndex,
              sourceLocation,
              actionIndex,
              rowIndex,
              "tail",
            ), {
              signalKind: signal.kind,
              signalRow: rowIndex + 1,
              description: `${rowIndex + 1}行断魂刺移至龙牙后`,
            }));
          }
          const until = Math.min(packs.length - 1, rowIndex + distance);
          for (let targetIndex = rowIndex + 1; targetIndex <= until; targetIndex += 1) {
            if (
              primaryId(packs[targetIndex]) !== "dragonFang" ||
              packHasOffGcd(packs[targetIndex], "charge")
            ) continue;
            add(createMutation("resourceBalance", moveOffGcdActionChanges(
              packs,
              rowIndex,
              sourceLocation,
              actionIndex,
              targetIndex,
              "tail",
            ), {
              signalKind: signal.kind,
              signalRow: rowIndex + 1,
              description: `高豆断魂刺 ${rowIndex + 1}→${targetIndex + 1}行龙牙后`,
            }));
          }
        }
      }
    }

    if (signal.kind === "low-rage-thunder") {
      const targetFrom = Math.max(0, rowIndex - 2);
      const sourceUntil = Math.min(packs.length - 1, rowIndex + distance);
      const sourceFrom = Math.max(0, rowIndex - distance);
      for (let sourceIndex = sourceFrom; sourceIndex < rowIndex; sourceIndex += 1) {
        if (!refillPrimaries.has(primaryId(packs[sourceIndex]))) continue;
        for (let targetIndex = sourceIndex + 1; targetIndex <= rowIndex; targetIndex += 1) {
          if (primaryId(packs[targetIndex]) !== "dragonFang") continue;
          add(createMutation("resourceBalancePair", primaryOnlySwapChanges(
            packs,
            sourceIndex,
            targetIndex,
          ), {
            signalKind: signal.kind,
            signalRow: rowIndex + 1,
            coordinationKind: "consume-before-refill",
            description: `低豆雷前先消耗后补豆 ${sourceIndex + 1}↔${targetIndex + 1}行`,
          }));
        }
      }
      for (let targetIndex = targetFrom; targetIndex <= rowIndex; targetIndex += 1) {
        if (primaryId(packs[targetIndex]) !== "dragonFang") continue;
        for (let sourceIndex = rowIndex + 1; sourceIndex <= sourceUntil; sourceIndex += 1) {
          if (!refillPrimaries.has(primaryId(packs[sourceIndex]))) continue;
          add(createMutation("resourceBalancePair", primaryOnlySwapChanges(
            packs,
            targetIndex,
            sourceIndex,
          ), {
            signalKind: signal.kind,
            signalRow: rowIndex + 1,
            description: `低豆雷前补豆 ${sourceIndex + 1}→${targetIndex + 1}行`,
          }));
        }
      }
    }

    if (signal.kind === "rage-overflow" && refillPrimaries.has(primaryId(packs[rowIndex]))) {
      const until = Math.min(packs.length - 1, rowIndex + distance);
      for (let targetIndex = rowIndex + 1; targetIndex <= until; targetIndex += 1) {
        if (primaryId(packs[targetIndex]) !== "dragonFang") continue;
        add(createMutation("resourceBalancePair", primaryOnlySwapChanges(
          packs,
          rowIndex,
          targetIndex,
        ), {
          signalKind: signal.kind,
          signalRow: rowIndex + 1,
          coordinationKind: "consume-before-refill",
          description: `溢出补豆技能延后 ${rowIndex + 1}↔${targetIndex + 1}行`,
        }));
      }
    }

    if (signal.kind === "dragon-ride-overflow" && primaryId(packs[rowIndex]) === "ride") {
      const until = Math.min(packs.length - 1, rowIndex + distance);
      for (let targetIndex = rowIndex + 1; targetIndex <= until; targetIndex += 1) {
        if (primaryId(packs[targetIndex]) !== "dragonFang") continue;
        add(createMutation("resourceBalancePair", new Map([
          [rowIndex, packs[targetIndex]],
          [targetIndex, packs[rowIndex]],
        ]), {
          signalKind: signal.kind,
          signalRow: rowIndex + 1,
          coordinationKind: "consume-before-ride",
          description: `延后任驰骋 ${rowIndex + 1}→${targetIndex + 1}行消耗龙驭`,
        }));
      }
    }
  }
  return mutations;
}

export function lianyingResourceBalanceCompoundMutations(
  baseMutations,
  {
    maxGapRows = 8,
    maxCandidates = 192,
  } = {},
) {
  const maximumGap = Math.max(0, Math.floor(Number(maxGapRows)));
  const compounds = [];
  for (let leftIndex = 0; leftIndex < baseMutations.length; leftIndex += 1) {
    const left = baseMutations[leftIndex];
    const leftRows = [...left.changes.keys()];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < baseMutations.length;
      rightIndex += 1
    ) {
      const right = baseMutations[rightIndex];
      const rightRows = [...right.changes.keys()];
      if (leftRows.some((row) => right.changes.has(row))) continue;
      const gap = Math.max(
        0,
        Math.min(...rightRows) - Math.max(...leftRows),
        Math.min(...leftRows) - Math.max(...rightRows),
      );
      if (gap > maximumGap) continue;
      const rows = [...leftRows, ...rightRows];
      compounds.push(createMutation(
        "resourceBalanceCompound",
        new Map([...left.changes, ...right.changes]),
        {
          signalKind: [left.signalKind, right.signalKind].sort().join("+"),
          signalRow: Math.min(left.signalRow, right.signalRow),
          coordinationKind: "two-resource-repairs",
          componentKinds: [left.kind, right.kind],
          componentDescriptions: [left.description, right.description],
          gapRows: gap,
          spanRows: Math.max(...rows) - Math.min(...rows) + 1,
          description: `${left.description}；${right.description}`,
        },
      ));
    }
  }
  return compounds
    .sort((left, right) =>
      left.gapRows - right.gapRows ||
      left.spanRows - right.spanRows ||
      left.startIndex - right.startIndex)
    .slice(0, Math.max(0, Math.floor(Number(maxCandidates))));
}

export function lianyingGenericCompoundMutations(
  localCandidates,
  {
    sourceLimit = 24,
    maxGapRows = 12,
    maxCandidates = 192,
  } = {},
) {
  const maximumSources = Math.max(2, Math.floor(Number(sourceLimit)));
  const maximumGap = Math.max(0, Math.floor(Number(maxGapRows)));
  const maximumCandidates = Math.max(0, Math.floor(Number(maxCandidates)));
  if (maximumCandidates === 0) return [];
  const eligible = (localCandidates ?? [])
    .filter((candidate) =>
      candidate?.mutation?.changes instanceof Map &&
      candidate.mutation.kind !== "genericCompound" &&
      candidate.mutation.kind !== "resourceBalanceCompound")
    .map((candidate) => ({
      ...candidate,
      bestLocalScore: Math.max(...candidate.localScores.map(Number)),
    }))
    .sort((left, right) => right.bestLocalScore - left.bestLocalScore);
  const sources = [];
  const sourceKeys = new Set();
  const addSource = (candidate) => {
    if (!candidate || sources.length >= maximumSources) return;
    const key = mutationKey(candidate.mutation);
    if (sourceKeys.has(key)) return;
    sourceKeys.add(key);
    sources.push(candidate);
  };
  for (const candidate of eligible.slice(0, Math.ceil(maximumSources / 2))) {
    addSource(candidate);
  }
  for (const kind of [...new Set(eligible.map(
    (candidate) => candidate.mutation.kind,
  ))]) {
    for (const candidate of eligible.filter(
      (entry) => entry.mutation.kind === kind,
    ).slice(0, 4)) addSource(candidate);
  }
  for (const candidate of eligible) addSource(candidate);

  const compounds = [];
  const seen = new Set();
  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    const left = sources[leftIndex];
    const leftRows = [...left.mutation.changes.keys()];
    for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
      const right = sources[rightIndex];
      const rightRows = [...right.mutation.changes.keys()];
      if (leftRows.some((row) => right.mutation.changes.has(row))) continue;
      const gapRows = Math.max(
        0,
        Math.min(...rightRows) - Math.max(...leftRows) - 1,
        Math.min(...leftRows) - Math.max(...rightRows) - 1,
      );
      if (gapRows > maximumGap) continue;
      const rows = [...leftRows, ...rightRows];
      const mutation = createMutation(
        "genericCompound",
        new Map([
          ...left.mutation.changes,
          ...right.mutation.changes,
        ]),
        {
          componentKinds: [left.mutation.kind, right.mutation.kind],
          componentDescriptions: [
            left.mutation.description,
            right.mutation.description,
          ],
          estimatedLocalScore:
            left.bestLocalScore + right.bestLocalScore,
          gapRows,
          spanRows: Math.max(...rows) - Math.min(...rows) + 1,
          description:
            `${left.mutation.description}；${right.mutation.description}`,
        },
      );
      const key = mutationKey(mutation);
      if (seen.has(key)) continue;
      seen.add(key);
      compounds.push(mutation);
    }
  }
  return compounds
    .sort((left, right) =>
      right.estimatedLocalScore - left.estimatedLocalScore ||
      left.gapRows - right.gapRows ||
      left.spanRows - right.spanRows)
    .slice(0, maximumCandidates);
}

function neighborhoodMutations(
  packs,
  {
    maxSwapDistance,
    maxRotationLength,
    mutationKinds,
    resourceSignals = [],
  },
) {
  const enabled = new Set(mutationKinds);
  const mutations = [];
  const seen = new Set();
  const add = (mutation) => {
    const key = mutationKey(mutation);
    if (seen.has(key)) return;
    seen.add(key);
    mutations.push(mutation);
  };
  const keyFlags = packs.map(isNeighborhoodKeyPack);
  const canonicalPacks = packs.map(canonicalActionPack);

  if (
    enabled.has("resourceBalance") ||
    enabled.has("resourceBalancePair") ||
    enabled.has("resourceBalanceCompound")
  ) {
    const resourceMutations = lianyingResourceBalanceMutations(
      packs,
      resourceSignals,
      { maxDistance: maxSwapDistance },
    );
    for (const mutation of resourceMutations) {
      if (enabled.has(mutation.kind)) add(mutation);
    }
    if (enabled.has("resourceBalanceCompound")) {
      for (const mutation of lianyingResourceBalanceCompoundMutations(
        resourceMutations,
        {
          maxGapRows: maxSwapDistance + 2,
          maxCandidates: 192,
        },
      )) add(mutation);
    }
  }

  if (enabled.has("swap")) {
    for (let leftIndex = 0; leftIndex < packs.length; leftIndex += 1) {
      const rightUntil = Math.min(packs.length - 1, leftIndex + maxSwapDistance);
      for (let rightIndex = leftIndex + 1; rightIndex <= rightUntil; rightIndex += 1) {
        if (!keyFlags[leftIndex] && !keyFlags[rightIndex]) continue;
        if (canonicalPacks[leftIndex] === canonicalPacks[rightIndex]) continue;
        add(createMutation("swap", new Map([
          [leftIndex, packs[rightIndex]],
          [rightIndex, packs[leftIndex]],
        ]), {
          leftIndex,
          rightIndex,
          description: `${labelWhitepaperPack(packs[leftIndex])} ↔ ${labelWhitepaperPack(packs[rightIndex])}`,
        }));
      }
    }
  }

  if (enabled.has("rotate")) {
    for (let length = 3; length <= maxRotationLength; length += 1) {
      for (let startIndex = 0; startIndex + length <= packs.length; startIndex += 1) {
        const window = packs.slice(startIndex, startIndex + length);
        if (!window.some((_, offset) => keyFlags[startIndex + offset])) continue;
        for (const direction of [-1, 1]) {
          const changes = new Map();
          for (let offset = 0; offset < length; offset += 1) {
            const sourceOffset = (offset - direction + length) % length;
            changes.set(startIndex + offset, window[sourceOffset]);
          }
          add(createMutation("rotate", changes, {
            startIndex,
            length,
            direction,
            description: `${startIndex + 1}-${startIndex + length}行${direction > 0 ? "右" : "左"}旋`,
          }));
        }
      }
    }
  }

  if (enabled.has("primaryReplace")) {
    const primaries = ["dragonFang", "destroy", "dragonRoar", "cloudStrike", "ride"];
    for (let index = 0; index < packs.length; index += 1) {
      for (const primary of primaries) {
        if (primaryId(packs[index]) === primary) continue;
        const replacement = unlabeledPack(packs[index]);
        replacement.primary = primary;
        add(createMutation("primaryReplace", new Map([[index, replacement]]), {
          row: index + 1,
          fromPrimary: primaryId(packs[index]),
          toPrimary: primary,
          description: `${index + 1}行${ACTION_LABELS[primaryId(packs[index])]}→${ACTION_LABELS[primary]}`,
        }));
      }
    }
  }

  if (enabled.has("offGcdMove")) {
    for (let sourceIndex = 0; sourceIndex < packs.length; sourceIndex += 1) {
      for (const sourceLocation of ["prefix", "tail"]) {
        const sourceActions = packs[sourceIndex][sourceLocation] ?? [];
        for (let actionIndex = 0; actionIndex < sourceActions.length; actionIndex += 1) {
          const id = actionId(sourceActions[actionIndex]);
          if (!["thunder", "orange", "charge", "dash"].includes(id)) continue;
          const left = Math.max(0, sourceIndex - maxSwapDistance);
          const right = Math.min(packs.length - 1, sourceIndex + maxSwapDistance);
          for (let targetIndex = left; targetIndex <= right; targetIndex += 1) {
            if (targetIndex === sourceIndex || packHasOffGcd(packs[targetIndex], id)) continue;
            const targetLocations = primaryId(packs[targetIndex]) === "ride"
              ? ["tail"]
              : ["prefix", "tail"];
            for (const targetLocation of targetLocations) {
              const nextSourceActions = sourceActions.filter((_, index) => index !== actionIndex);
              const targetAction = targetLocation === "tail"
                ? { id, leadFrames: 1 }
                : id;
              const nextTargetActions = [
                ...(packs[targetIndex][targetLocation] ?? []),
                targetAction,
              ];
              add(createMutation("offGcdMove", new Map([
                [sourceIndex, actionLocationPack(
                  packs[sourceIndex],
                  sourceLocation,
                  nextSourceActions,
                )],
                [targetIndex, actionLocationPack(
                  packs[targetIndex],
                  targetLocation,
                  nextTargetActions,
                )],
              ]), {
                sourceIndex,
                targetIndex,
                action: id,
                description: `${ACTION_LABELS[id]} ${sourceIndex + 1}→${targetIndex + 1}行`,
              }));
            }
          }
        }
      }
    }
  }
  return mutations;
}

function neighborhoodPrefixStates(runtime, packs, endTick) {
  let state = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  const states = [state];
  for (const pack of packs) {
    if (decisionTick(state) < endTick) {
      state = executeActionPack(
        state,
        pack,
        runtime.config,
        runtime.oracle,
        { endTick },
      );
    }
    states.push(state);
  }
  return states;
}

function executeMutationRange(
  runtime,
  packs,
  prefixState,
  mutation,
  endTick,
  untilIndex = packs.length,
) {
  let state = prefixState;
  for (let index = mutation.startIndex; index < untilIndex; index += 1) {
    if (decisionTick(state) >= endTick) break;
    const pack = mutation.changes.get(index) ?? packs[index];
    state = executeActionPack(
      state,
      pack,
      runtime.config,
      runtime.oracle,
      { endTick },
    );
  }
  return state;
}

// 通用邻域不理解“第几行应该打什么”。候选经过多尺度局部试演形成分层短名单，
// 最终仍以完整战斗时长重放的实际伤害决定是否接受。
export function optimizeLianyingNeighborhoodAxis(
  runtime,
  packs,
  {
    durationSeconds = 180,
    maxPasses = 12,
    maxSwapDistance = 6,
    maxRotationLength = 6,
    localLookaheadRows = [8, 16, 32],
    shortlistPerHorizon = 64,
    shortlistPerKind = 8,
    shortlistPerResourceSignal = 2,
    fullEvaluationLimit = 256,
    mutationKinds = [
      "swap",
      "rotate",
      "offGcdMove",
      "primaryReplace",
      "resourceBalance",
      "resourceBalancePair",
      "resourceBalanceCompound",
    ],
    requiredThunderRows = null,
    mutableRowRanges = null,
    genericCompoundCandidateLimit = 0,
    genericCompoundSourceLimit = 24,
    genericCompoundMaxGapRows = 12,
    minimumDamageGain = 1e-6,
    onPass = null,
  } = {},
) {
  const requiredThunderSchedule = Array.isArray(requiredThunderRows)
    ? requiredThunderRows.map(Number)
    : null;
  const thunderSchedule = (candidatePacks) => candidatePacks.flatMap(
    (pack, index) => packHasOffGcd(pack, "thunder") ? [index + 1] : [],
  );
  const preservesRequiredThunderSchedule = (candidatePacks) =>
    requiredThunderSchedule === null ||
    JSON.stringify(thunderSchedule(candidatePacks)) ===
      JSON.stringify(requiredThunderSchedule);
  if (!preservesRequiredThunderSchedule(packs)) {
    throw new Error("邻域搜索的输入轴不符合指定雷表");
  }
  const normalizedMutableRowRanges = Array.isArray(mutableRowRanges)
    ? mutableRowRanges.map((range) => ({
        startIndex: Math.max(0, Math.floor(Number(range.startRow)) - 1),
        endIndex: Math.min(
          packs.length,
          Math.max(0, Math.floor(Number(range.endRow))),
        ),
      })).filter((range) => range.endIndex > range.startIndex)
    : null;
  if (Array.isArray(mutableRowRanges) && normalizedMutableRowRanges.length === 0) {
    throw new Error("邻域可变行区间至少需要一个有效的闭区间");
  }
  const mutationIsWithinMutableRows = (mutation) =>
    normalizedMutableRowRanges === null ||
    [...mutation.changes.keys()].every((index) =>
      normalizedMutableRowRanges.some((range) =>
        index >= range.startIndex && index < range.endIndex));
  let incumbentPacks = packs.map(clonePack);
  let incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const baselineDamage = incumbent.state.totalDamage;
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  const improvements = [];
  let candidatesEvaluated = 0;
  let illegalCandidates = 0;
  let fullCandidatesEvaluated = 0;
  let shortlistedCandidates = 0;
  const candidateKinds = {};
  const resourceSignalKinds = {};
  const resourceCandidateDiagnostics = [];
  const lookaheadHorizons = [
    ...new Set(
      (Array.isArray(localLookaheadRows)
        ? localLookaheadRows
        : [localLookaheadRows])
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ].sort((left, right) => left - right);
  if (lookaheadHorizons.length === 0) {
    throw new Error("邻域局部前瞻至少需要一个正整数行数");
  }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let best = null;
    const localCandidates = [];
    const prefixStates = neighborhoodPrefixStates(
      runtime,
      incumbentPacks,
      endTick,
    );
    const resourceSignals = detectLianyingResourceBalanceSignals(incumbent);
    for (const signal of resourceSignals) {
      incrementCounter(resourceSignalKinds, signal.kind);
    }
    const mutations = neighborhoodMutations(incumbentPacks, {
      maxSwapDistance,
      maxRotationLength,
      mutationKinds,
      resourceSignals,
    }).filter(mutationIsWithinMutableRows)
      .filter((mutation) => preservesRequiredThunderSchedule(
        applyMutation(incumbentPacks, mutation),
      ));
    const resourceDiagnostics = new Map();
    const diagnosticFor = (mutation) => {
      if (!mutation.kind.startsWith("resourceBalance")) return null;
      const key = `${mutation.kind}|${mutation.signalKind}`;
      if (!resourceDiagnostics.has(key)) {
        resourceDiagnostics.set(key, {
          kind: mutation.kind,
          signalKind: mutation.signalKind,
          generated: 0,
          legalLocal: 0,
          illegalLocal: 0,
          shortlisted: 0,
          legalFull: 0,
          illegalFull: 0,
          bestLocalGain: null,
          bestFullDamageGain: null,
        });
      }
      return resourceDiagnostics.get(key);
    };
    for (const mutation of mutations) {
      const diagnostic = diagnosticFor(mutation);
      if (diagnostic) diagnostic.generated += 1;
    }
    const evaluateLocalMutation = (mutation) => {
      if (decisionTick(prefixStates[mutation.startIndex]) >= endTick) return;
      candidatesEvaluated += 1;
      try {
        const localScores = [];
        for (const horizon of lookaheadHorizons) {
          const localUntilIndex = Math.min(
            incumbentPacks.length,
            mutation.endIndex + 1 + horizon,
          );
          const localState = executeMutationRange(
            runtime,
            incumbentPacks,
            prefixStates[mutation.startIndex],
            mutation,
            endTick,
            localUntilIndex,
          );
          localScores.push(
            localState.totalDamage - prefixStates[localUntilIndex].totalDamage,
          );
        }
        localCandidates.push({ mutation, localScores });
        const diagnostic = diagnosticFor(mutation);
        if (diagnostic) {
          diagnostic.legalLocal += 1;
          const bestLocalGain = Math.max(...localScores);
          diagnostic.bestLocalGain = diagnostic.bestLocalGain === null
            ? bestLocalGain
            : Math.max(diagnostic.bestLocalGain, bestLocalGain);
        }
      } catch {
        illegalCandidates += 1;
        const diagnostic = diagnosticFor(mutation);
        if (diagnostic) diagnostic.illegalLocal += 1;
      }
    };
    for (const mutation of mutations) incrementCounter(candidateKinds, mutation.kind);
    for (const mutation of mutations) {
      evaluateLocalMutation(mutation);
    }
    const genericCompounds = lianyingGenericCompoundMutations(
      localCandidates,
      {
        sourceLimit: genericCompoundSourceLimit,
        maxGapRows: genericCompoundMaxGapRows,
        maxCandidates: genericCompoundCandidateLimit,
      },
    ).filter(mutationIsWithinMutableRows)
      .filter((mutation) => preservesRequiredThunderSchedule(
        applyMutation(incumbentPacks, mutation),
      ));
    for (const mutation of genericCompounds) {
      incrementCounter(candidateKinds, mutation.kind);
      evaluateLocalMutation(mutation);
    }
    const shortlist = [];
    const shortlistedKeys = new Set();
    const addShortlist = (candidate) => {
      if (!candidate || shortlist.length >= fullEvaluationLimit) return;
      const key = mutationKey(candidate.mutation);
      if (shortlistedKeys.has(key)) return;
      shortlistedKeys.add(key);
      shortlist.push(candidate);
    };
    const sortedByHorizon = lookaheadHorizons.map((_, horizonIndex) =>
      [...localCandidates].sort(
        (left, right) =>
          right.localScores[horizonIndex] - left.localScores[horizonIndex],
      ));
    for (let rank = 0; rank < shortlistPerHorizon; rank += 1) {
      for (const sorted of sortedByHorizon) addShortlist(sorted[rank]);
    }
    const shortlistKinds = genericCompounds.length > 0
      ? [...mutationKinds, "genericCompound"]
      : mutationKinds;
    for (const kind of shortlistKinds) {
      const sameKind = localCandidates
        .filter((candidate) => candidate.mutation.kind === kind)
        .sort((left, right) =>
          Math.max(...right.localScores) - Math.max(...left.localScores));
      for (let rank = 0; rank < shortlistPerKind; rank += 1) {
        addShortlist(sameKind[rank]);
      }
    }
    const resourceSignalMutationKinds = [
      ...new Set(
        localCandidates
          .filter((candidate) => candidate.mutation.kind.startsWith("resourceBalance"))
          .map((candidate) => candidate.mutation.signalKind),
      ),
    ];
    for (const signalKind of resourceSignalMutationKinds) {
      const sameSignal = localCandidates
        .filter((candidate) =>
          candidate.mutation.kind.startsWith("resourceBalance") &&
          candidate.mutation.signalKind === signalKind)
        .sort((left, right) =>
          Math.max(...right.localScores) - Math.max(...left.localScores));
      for (let rank = 0; rank < shortlistPerResourceSignal; rank += 1) {
        addShortlist(sameSignal[rank]);
      }
    }
    const representedBlocks = new Set(
      shortlist.map((candidate) => Math.floor(candidate.mutation.startIndex / 16)),
    );
    const aggregateSorted = [...localCandidates].sort((left, right) =>
      Math.max(...right.localScores) - Math.max(...left.localScores));
    for (const candidate of aggregateSorted) {
      const block = Math.floor(candidate.mutation.startIndex / 16);
      if (representedBlocks.has(block)) continue;
      addShortlist(candidate);
      representedBlocks.add(block);
    }
    shortlistedCandidates += shortlist.length;
    for (const candidate of shortlist) {
      const diagnostic = diagnosticFor(candidate.mutation);
      if (diagnostic) diagnostic.shortlisted += 1;
    }
    if (typeof onPass === "function") {
      onPass({
        stage: "shortlist",
        pass: pass + 1,
        generatedCandidates: mutations.length + genericCompounds.length,
        genericCompoundCandidates: genericCompounds.length,
        legalLocalCandidates: localCandidates.length,
        shortlistedCandidates: shortlist.length,
        resourceSignals: resourceSignals.length,
        resourceSignalKinds: Object.fromEntries(
          [...new Set(resourceSignals.map((signal) => signal.kind))]
            .map((kind) => [kind, resourceSignals.filter((signal) => signal.kind === kind).length]),
        ),
        resourceBalanceShortlisted: shortlist.filter(
          (candidate) => candidate.mutation.kind.startsWith("resourceBalance"),
        ).length,
      });
    }
    for (const candidate of shortlist) {
      fullCandidatesEvaluated += 1;
      try {
        const state = executeMutationRange(
          runtime,
          incumbentPacks,
          prefixStates[candidate.mutation.startIndex],
          candidate.mutation,
          endTick,
        );
        const damageGain = state.totalDamage - incumbent.state.totalDamage;
        const diagnostic = diagnosticFor(candidate.mutation);
        if (diagnostic) {
          diagnostic.legalFull += 1;
          diagnostic.bestFullDamageGain = diagnostic.bestFullDamageGain === null
            ? damageGain
            : Math.max(diagnostic.bestFullDamageGain, damageGain);
        }
        if (damageGain <= minimumDamageGain) continue;
        if (!best || state.totalDamage > best.state.totalDamage) {
          best = { ...candidate, state, damageGain };
        }
      } catch {
        illegalCandidates += 1;
        const diagnostic = diagnosticFor(candidate.mutation);
        if (diagnostic) diagnostic.illegalFull += 1;
      }
    }
    const passResourceDiagnostics = [...resourceDiagnostics.values()]
      .sort((left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.signalKind.localeCompare(right.signalKind));
    resourceCandidateDiagnostics.push({
      pass: pass + 1,
      groups: passResourceDiagnostics,
    });
    if (typeof onPass === "function") {
      onPass({
        stage: "full-evaluation",
        pass: pass + 1,
        resourceCandidateDiagnostics: passResourceDiagnostics,
      });
    }
    if (!best) break;
    incumbentPacks = applyMutation(incumbentPacks, best.mutation);
    incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
      durationSeconds,
    });
    const improvement = {
      pass: pass + 1,
      kind: best.mutation.kind,
      startRow: best.mutation.startIndex + 1,
      endRow: best.mutation.endIndex + 1,
      description: best.mutation.description,
      damageGain: best.damageGain,
      cumulativeDamageGain: incumbent.state.totalDamage - baselineDamage,
    };
    if (best.mutation.kind === "swap") {
      improvement.leftRow = best.mutation.leftIndex + 1;
      improvement.rightRow = best.mutation.rightIndex + 1;
    }
    improvements.push(improvement);
    if (typeof onPass === "function") {
      onPass({
        stage: "accepted",
        pass: pass + 1,
        improvement,
      });
    }
  }

  return {
    packs: incumbentPacks,
    state: incumbent.state,
    trace: incumbent.trace,
    baselineDamage,
    damageGain: incumbent.state.totalDamage - baselineDamage,
    improvements,
    candidatesEvaluated,
    illegalCandidates,
    fullCandidatesEvaluated,
    shortlistedCandidates,
    maxSwapDistance,
    maxRotationLength,
    localLookaheadRows: lookaheadHorizons,
    shortlistPerHorizon,
    shortlistPerKind,
    shortlistPerResourceSignal,
    fullEvaluationLimit,
    mutationKinds,
    genericCompoundCandidateLimit,
    genericCompoundSourceLimit,
    genericCompoundMaxGapRows,
    requiredThunderRows: requiredThunderSchedule,
    mutableRowRanges: normalizedMutableRowRanges?.map((range) => ({
      startRow: range.startIndex + 1,
      endRow: range.endIndex,
    })) ?? null,
    candidateKinds,
    resourceSignalKinds,
    resourceCandidateDiagnostics,
  };
}

export function optimizeLianyingAxis(
  runtime,
  packs,
  {
    durationSeconds = 180,
    maxRounds = 4,
    reference = {},
    neighborhood = {},
  } = {},
) {
  const baseline = replayWhitepaperLianying(runtime, packs, {
    durationSeconds,
  });
  let incumbentPacks = packs.map(clonePack);
  let incumbentState = baseline.state;
  const phases = [];
  const roundReports = [];

  const initialDash = optimizeLianyingDashOverlay(runtime, incumbentPacks, {
    durationSeconds,
  });
  if (initialDash.damageGain > 0) {
    incumbentPacks = initialDash.packs;
    incumbentState = initialDash.state;
    phases.push({
      round: 0,
      kind: "dash-overlay",
      damageGain: initialDash.damageGain,
      dashCount: initialDash.dashCount,
      generatedCandidates: initialDash.generatedCandidates,
      legalCandidates: initialDash.legalCandidates,
      peakStates: initialDash.peakStates,
    });
  }

  for (let round = 0; round < maxRounds; round += 1) {
    let roundGain = 0;
    let axisChanged = false;
    const referenceResult = optimizeLianyingReferenceAxis(
      runtime,
      incumbentPacks,
      { durationSeconds, ...reference },
    );
    if (referenceResult.damageGain > 0) {
      incumbentPacks = referenceResult.packs;
      incumbentState = referenceResult.state;
      roundGain += referenceResult.damageGain;
      axisChanged = true;
      phases.push({
        round: round + 1,
        kind: "whitepaper-reference",
        damageGain: referenceResult.damageGain,
        improvements: referenceResult.improvements,
        candidatesEvaluated: referenceResult.candidatesEvaluated,
        illegalCandidates: referenceResult.illegalCandidates,
      });
    }

    const neighborhoodResult = optimizeLianyingNeighborhoodAxis(
      runtime,
      incumbentPacks,
      { durationSeconds, ...neighborhood },
    );
    roundReports.push({
      round: round + 1,
      reference: {
        damageGain: referenceResult.damageGain,
        candidatesEvaluated: referenceResult.candidatesEvaluated,
        illegalCandidates: referenceResult.illegalCandidates,
      },
      neighborhood: {
        damageGain: neighborhoodResult.damageGain,
        candidatesEvaluated: neighborhoodResult.candidatesEvaluated,
        illegalCandidates: neighborhoodResult.illegalCandidates,
        fullCandidatesEvaluated: neighborhoodResult.fullCandidatesEvaluated,
        shortlistedCandidates: neighborhoodResult.shortlistedCandidates,
        mutationKinds: neighborhoodResult.mutationKinds,
        candidateKinds: neighborhoodResult.candidateKinds,
        resourceSignalKinds: neighborhoodResult.resourceSignalKinds,
        resourceCandidateDiagnostics:
          neighborhoodResult.resourceCandidateDiagnostics,
        shortlistPerResourceSignal:
          neighborhoodResult.shortlistPerResourceSignal,
      },
    });
    if (neighborhoodResult.damageGain > 0) {
      incumbentPacks = neighborhoodResult.packs;
      incumbentState = neighborhoodResult.state;
      roundGain += neighborhoodResult.damageGain;
      axisChanged = true;
      phases.push({
        round: round + 1,
        kind: "mechanical-neighborhood",
        damageGain: neighborhoodResult.damageGain,
        improvements: neighborhoodResult.improvements,
        candidatesEvaluated: neighborhoodResult.candidatesEvaluated,
        illegalCandidates: neighborhoodResult.illegalCandidates,
        fullCandidatesEvaluated:
          neighborhoodResult.fullCandidatesEvaluated,
        shortlistedCandidates: neighborhoodResult.shortlistedCandidates,
        maxSwapDistance: neighborhoodResult.maxSwapDistance,
        maxRotationLength: neighborhoodResult.maxRotationLength,
        localLookaheadRows: neighborhoodResult.localLookaheadRows,
        shortlistPerHorizon: neighborhoodResult.shortlistPerHorizon,
        shortlistPerKind: neighborhoodResult.shortlistPerKind,
        fullEvaluationLimit: neighborhoodResult.fullEvaluationLimit,
        mutationKinds: neighborhoodResult.mutationKinds,
        candidateKinds: neighborhoodResult.candidateKinds,
        resourceSignalKinds: neighborhoodResult.resourceSignalKinds,
        resourceCandidateDiagnostics:
          neighborhoodResult.resourceCandidateDiagnostics,
        shortlistPerResourceSignal:
          neighborhoodResult.shortlistPerResourceSignal,
      });
    }
    if (axisChanged) {
      const dashResult = optimizeLianyingDashOverlay(runtime, incumbentPacks, {
        durationSeconds,
      });
      if (dashResult.damageGain > 0) {
        incumbentPacks = dashResult.packs;
        incumbentState = dashResult.state;
        roundGain += dashResult.damageGain;
        phases.push({
          round: round + 1,
          kind: "dash-overlay",
          damageGain: dashResult.damageGain,
          dashCount: dashResult.dashCount,
          generatedCandidates: dashResult.generatedCandidates,
          legalCandidates: dashResult.legalCandidates,
          peakStates: dashResult.peakStates,
        });
      }
    }
    if (roundGain <= 0) break;
  }

  return {
    packs: incumbentPacks,
    state: incumbentState,
    baselineDamage: baseline.state.totalDamage,
    damageGain: incumbentState.totalDamage - baseline.state.totalDamage,
    phases,
    roundReports,
  };
}
