function buildThunderWindows(state) {
  const starts = state.timeline.filter(
    (event) => event.type === "offGcd" && event.action === "thunder",
  );
  return starts.map((start, index) => {
    const untilTick = Number(start.activeUntilTick ?? Number.POSITIVE_INFINITY);
    const events = state.timeline.filter(
      (event) => event.sequence > start.sequence && event.tick < untilTick,
    );
    const casts = events.filter((event) => event.type === "cast" && event.thunder);
    const refills = events.filter(
      (event) =>
        (event.type === "cast" && ["destroy", "dragonRoar"].includes(event.action)) ||
        (event.type === "offGcd" && event.action === "charge"),
    );
    const next = starts[index + 1] ?? null;
    const directFollow = Boolean(
      next && Number(next.timeMs) - Number(start.activeUntilMs) <= 4000,
    );
    return {
      index: index + 1,
      startSeconds: Number(start.timeMs) / 1000,
      mountedAtStart: Boolean(start.mounted),
      dragonRideStacksAtStart: Number(start.dragonRideStacksAtStart ?? 0),
      chargeReadyAtStart: Boolean(start.chargeReadyAtStart),
      dragonFangs: casts.filter((event) => event.action === "dragonFang").length,
      usedDragonRoar: casts.some((event) => event.action === "dragonRoar"),
      usedCharge: events.some(
        (event) => event.type === "offGcd" && event.action === "charge",
      ),
      refillOrder: refills.map((event) => {
        if (event.action === "charge") return "断魂刺";
        if (event.action === "dragonRoar") return "龙吟";
        return event.destroySource === "poLouLanBonus" ? "灭·破楼兰" : "灭·正常";
      }),
      directFollow,
    };
  });
}

export function auditWhitepaperAxis(state, { mode = "stable" } = {}) {
  const casts = state.timeline.filter((event) => event.type === "cast");
  const offGcd = state.timeline.filter((event) => event.type === "offGcd");
  const thunderStartsNotFive = offGcd.filter(
    (event) => event.action === "thunder" && event.rageBefore !== 5,
  );
  const chargesAtHighRage = offGcd.filter(
    (event) => event.action === "charge" && event.rageBefore > 2,
  );
  const chargesOutsideThunder = offGcd.filter(
    (event) => event.action === "charge" && !event.thunder,
  );
  const chargesDuringOrange = offGcd.filter(
    (event) => event.action === "charge" && event.orange,
  );
  const cloudStrikesUnderThunder = casts.filter(
    (event) => event.action === "cloudStrike" && event.thunder,
  );
  const rideOverflowEvents = casts.filter(
    (event) => event.action === "ride" && event.stackOverflow > 0,
  );
  const ridesDuringOrange = casts.filter(
    (event) => event.action === "ride" && event.orange,
  );
  const mountedFangsOutsideThunder = casts.filter(
    (event) =>
      event.action === "dragonFang" && event.mounted && !event.thunder,
  );
  const orangeNonFangCasts = casts.filter(
    (event) => event.orange && event.action !== "dragonFang",
  );
  const dragonFangs = casts.filter((event) => event.action === "dragonFang");
  const rideEvents = casts.filter((event) => event.action === "ride");
  const dragonRideFromFangs = dragonFangs.filter(
    (event) => !event.mounted && event.stacksAfter > event.stacksBefore,
  ).length;
  const dragonRideFromRides = rideEvents.reduce(
    (sum, event) => sum + Math.max(0, event.stacksAfter - event.stacksBefore),
    0,
  );
  const dragonRideConsumedUnderThunder = dragonFangs.filter(
    (event) => event.dragonRideBonus && event.thunder,
  ).length;
  const dragonRideConsumedOutsideThunder = dragonFangs.filter(
    (event) => event.dragonRideBonus && !event.thunder,
  ).length;
  const thunderWindows = buildThunderWindows(state);
  const lowStackChargePriorityViolations = thunderWindows.filter(
    (window) =>
      window.mountedAtStart &&
      window.dragonRideStacksAtStart < 9 &&
      window.chargeReadyAtStart &&
      window.refillOrder.length > 0 &&
      window.refillOrder[0] !== "断魂刺",
  );
  const nonDirectRoarThirteenFangWindows = thunderWindows.filter(
    (window) =>
      window.usedDragonRoar && !window.directFollow && window.dragonFangs > 12,
  );
  // 机制非法只描述游戏状态机本身不允许发生的行为。正常通过
  // executeActionPack 生成的状态通常应全部为0；保留这些检查用于导入
  // 外部技能轴或未来求解器结果时做最终验证。
  const insufficientRageDragonFangs = dragonFangs.filter(
    (event) => Number(event.rageBeforeCast) < Number(event.rageCost),
  );
  const chargesWhileDismounted = offGcd.filter(
    (event) => event.action === "charge" && !event.mounted,
  );
  const dashesWhileMounted = offGcd.filter(
    (event) => event.action === "dash" && event.mounted,
  );
  const ridesWhileMounted = rideEvents.filter((event) => event.mountedBefore);
  const mechanicsViolationCount =
    insufficientRageDragonFangs.length +
    chargesWhileDismounted.length +
    dashesWhileMounted.length +
    ridesWhileMounted.length;

  const rageOverflow = [...casts, ...offGcd].reduce(
    (sum, event) => sum + Number(event.rageOverflow ?? 0),
    0,
  );
  const dragonRideOverflow = rideEvents.reduce(
    (sum, event) => sum + Number(event.stackOverflow ?? 0),
    0,
  );
  const strategyDeviationCount =
    thunderStartsNotFive.length +
    chargesAtHighRage.length +
    chargesOutsideThunder.length +
    chargesDuringOrange.length +
    cloudStrikesUnderThunder.length +
    ridesDuringOrange.length +
    orangeNonFangCasts.length +
    lowStackChargePriorityViolations.length +
    nonDirectRoarThirteenFangWindows.length +
    (mode === "stable" ? mountedFangsOutsideThunder.length : 0);

  return {
    mode,
    classificationVersion: 2,
    passed: mechanicsViolationCount === 0,
    passedMechanics: mechanicsViolationCount === 0,
    passedWhitepaperStrategy: strategyDeviationCount === 0,
    hardViolationCount: mechanicsViolationCount,
    mechanics: {
      passed: mechanicsViolationCount === 0,
      violationCount: mechanicsViolationCount,
      violations: {
        insufficientRageDragonFangs: insufficientRageDragonFangs.length,
        chargesWhileDismounted: chargesWhileDismounted.length,
        dashesWhileMounted: dashesWhileMounted.length,
        ridesWhileMounted: ridesWhileMounted.length,
      },
    },
    resourceWaste: {
      rageOverflow,
      dragonRideOverflow,
      highRageCharges: chargesAtHighRage.length,
      thunderStartsBelowFive: thunderStartsNotFive.length,
    },
    whitepaperStrategy: {
      passed: strategyDeviationCount === 0,
      deviationCount: strategyDeviationCount,
      deviations: {
        thunderStartsNotFive: thunderStartsNotFive.length,
        chargesAtHighRage: chargesAtHighRage.length,
        chargesOutsideThunder: chargesOutsideThunder.length,
        chargesDuringOrange: chargesDuringOrange.length,
        cloudStrikesUnderThunder: cloudStrikesUnderThunder.length,
        ridesDuringOrange: ridesDuringOrange.length,
        orangeNonFangCasts: orangeNonFangCasts.length,
        lowStackChargePriorityViolations: lowStackChargePriorityViolations.length,
        nonDirectRoarThirteenFangWindows: nonDirectRoarThirteenFangWindows.length,
        stableMountedFangsOutsideThunder:
          mode === "stable" ? mountedFangsOutsideThunder.length : 0,
      },
    },
    // 兼容旧报告字段：以下项目现在表示白皮书策略偏离，而非机制非法。
    violations: {
      thunderStartsNotFive: thunderStartsNotFive.length,
      chargesAtHighRage: chargesAtHighRage.length,
      chargesOutsideThunder: chargesOutsideThunder.length,
      chargesDuringOrange: chargesDuringOrange.length,
      cloudStrikesUnderThunder: cloudStrikesUnderThunder.length,
      rideOverflowEvents: rideOverflowEvents.length,
      ridesDuringOrange: ridesDuringOrange.length,
      orangeNonFangCasts: orangeNonFangCasts.length,
      lowStackChargePriorityViolations: lowStackChargePriorityViolations.length,
      nonDirectRoarThirteenFangWindows: nonDirectRoarThirteenFangWindows.length,
      stableMountedFangsOutsideThunder:
        mode === "stable" ? mountedFangsOutsideThunder.length : 0,
    },
    dragonRide: {
      gainedFromOnFootFangs: dragonRideFromFangs,
      gainedFromRide: dragonRideFromRides,
      consumedUnderThunder: dragonRideConsumedUnderThunder,
      consumedOutsideThunder: dragonRideConsumedOutsideThunder,
      overflow: rideEvents.reduce(
        (sum, event) => sum + Number(event.stackOverflow ?? 0),
        0,
      ),
      terminalLiquidationFangs:
        mode === "fixed" ? mountedFangsOutsideThunder.length : 0,
      finalStacks: state.dragonRideStacks,
    },
    thunderWindows,
    thunderPatterns: {
      singleThunderWindows: thunderWindows.filter(
        (window) => !window.mountedAtStart,
      ).length,
      twelveFangWindows: thunderWindows.filter(
        (window) => window.dragonFangs === 12,
      ).length,
      thirteenFangWindows: thunderWindows.filter(
        (window) => window.dragonFangs === 13,
      ).length,
      directDoubleThunderLinks: thunderWindows.filter(
        (window) => window.directFollow,
      ).length,
      lowStackChargeFirstWindows: thunderWindows.filter(
        (window) =>
          window.mountedAtStart &&
          window.dragonRideStacksAtStart < 9 &&
          window.refillOrder[0] === "断魂刺",
      ).length,
    },
  };
}
