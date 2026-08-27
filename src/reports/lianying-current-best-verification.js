import {
  frameToTicks,
  ticksToFrames,
  ticksToMilliseconds,
} from "../engine/clock.js";
import { summarize } from "./summary.js";
import { auditWhitepaperAxis } from "./whitepaper-audit.js";

function almostEqual(left, right, tolerance = 1e-6) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function actionCounts(timeline) {
  const counts = {};
  for (const event of timeline) {
    if (event.type !== "cast" && event.type !== "offGcd") continue;
    counts[event.action] = Number(counts[event.action] ?? 0) + 1;
  }
  return counts;
}

function damageEventCount(timeline, component) {
  return timeline.filter(
    (event) => event.type === "damage" && event.component === component,
  ).length;
}

function analyzeOrangeWindows(timeline, config) {
  const activations = timeline.filter(
    (event) => event.type === "offGcd" && event.action === "orange",
  );
  const fangs = timeline.filter(
    (event) => event.type === "cast" && event.action === "dragonFang",
  );
  return activations.map((activation, index) => {
    const untilTick = activation.tick + frameToTicks(config.durations.orange);
    const covered = fangs.filter(
      (fang) => fang.tick >= activation.tick && fang.tick < untilTick,
    );
    return {
      index: index + 1,
      fromSeconds: activation.timeMs / 1000,
      untilSeconds: ticksToMilliseconds(untilTick) / 1000,
      dragonFangs: covered.length,
      thunderDragonFangs: covered.filter((fang) => fang.thunder).length,
      rideDragonFangs: covered.filter((fang) => fang.ride).length,
      dragonRideEnhanced: covered.filter((fang) => fang.dragonRideBonus).length,
      castSeconds: covered.map((fang) => fang.timeMs / 1000),
    };
  });
}

function analyzeBleed(timeline, config, durationSeconds) {
  const ticks = timeline.filter(
    (event) => event.type === "damage" && event.component === "bleedTick",
  );
  const refreshes = timeline.filter(
    (event) =>
      event.type === "cast" &&
      (event.action === "destroy" || event.action === "dragonRoar"),
  );
  const fangs = timeline.filter(
    (event) => event.type === "cast" && event.action === "dragonFang",
  );
  const gaps = [];
  for (let index = 1; index < ticks.length; index += 1) {
    const previous = ticks[index - 1];
    const current = ticks[index];
    const gapFrames = ticksToFrames(current.tick - previous.tick);
    if (almostEqual(gapFrames, config.dotIntervalFrames)) continue;
    const lastRefresh = refreshes
      .filter((event) => event.tick <= previous.tick)
      .at(-1);
    const expiryTick = lastRefresh
      ? lastRefresh.tick + frameToTicks(config.durations.bleed)
      : null;
    const reapplication = expiryTick === null
      ? null
      : refreshes.find((event) => event.tick > expiryTick);
    gaps.push({
      fromSeconds: previous.timeMs / 1000,
      toSeconds: current.timeMs / 1000,
      gapFrames,
      gapSeconds: (current.timeMs - previous.timeMs) / 1000,
      lastRefreshSeconds: lastRefresh?.timeMs / 1000 ?? null,
      expiredSeconds:
        expiryTick === null ? null : ticksToMilliseconds(expiryTick) / 1000,
      reappliedSeconds: reapplication?.timeMs / 1000 ?? null,
      dragonFangsWhileInactive:
        expiryTick === null || !reapplication
          ? null
          : fangs.filter(
              (fang) => fang.tick >= expiryTick && fang.tick < reapplication.tick,
            ).length,
    });
  }
  const firstRefresh = refreshes[0];
  const continuousUpperBound = firstRefresh
    ? Math.floor(
        (durationSeconds - firstRefresh.timeMs / 1000) /
          (config.dotIntervalFrames / 16),
      )
    : 0;
  return {
    count: ticks.length,
    normalQualityCount: ticks.filter((event) => event.bleedQuality === 1).length,
    warHeartQualityCount: ticks.filter((event) => event.bleedQuality === 2).length,
    intervalFrames: config.dotIntervalFrames,
    continuousUpperBound,
    gaps,
  };
}

function analyzeRideThunder(timeline) {
  const rides = timeline.filter(
    (event) => event.type === "cast" && event.action === "ride",
  );
  const thunders = timeline.filter(
    (event) => event.type === "offGcd" && event.action === "thunder",
  );
  const beforeRideCompletion = thunders.filter((thunder) => {
    const latestRide = rides.filter((ride) => ride.tick <= thunder.tick).at(-1);
    return latestRide && Number(latestRide.completionAtMs) > thunder.timeMs;
  });
  return {
    rideCount: rides.length,
    thunderCount: thunders.length,
    rideBuffThunderCount: thunders.filter((thunder) => thunder.ride).length,
    noRideBuffThunderCount: thunders.filter((thunder) => !thunder.ride).length,
    thunderBeforeRideCompletionCount: beforeRideCompletion.length,
    terminalRideWithoutLaterThunder: rides.filter(
      (ride) => !thunders.some((thunder) => thunder.tick >= ride.tick),
    ).length,
  };
}

export function buildLianyingCurrentBestVerification({
  artifact,
  replayState,
  finalState,
  runtime,
  bleedCounterfactual = null,
}) {
  const summary = summarize(finalState, runtime.config, runtime.oracle);
  const audit = auditWhitepaperAxis(replayState, { mode: "fixed" });
  const timeline = replayState.timeline ?? [];
  const actions = actionCounts(timeline);
  const orangeWindows = analyzeOrangeWindows(timeline, runtime.config);
  const bleed = analyzeBleed(
    timeline,
    runtime.config,
    Number(artifact.durationSeconds ?? 180),
  );
  const autoAttacks = timeline.filter(
    (event) => event.type === "damage" && event.component === "autoAttack",
  );
  const autoIntervals = autoAttacks.slice(1).map((event, index) =>
    ticksToFrames(event.tick - autoAttacks[index].tick));
  const rotationBreakdownDamage = Object.values(replayState.damageBreakdown ?? {})
    .reduce((sum, value) => sum + Number(value), 0);
  const equipmentDamage = finalState.totalDamage - replayState.totalDamage;
  const artifactEquipmentDamage = Number(
    artifact.summary?.equipmentAndDamageEnchantDamage ?? 0,
  );
  const rideThunder = analyzeRideThunder(timeline);
  const hardChecks = {
    replayRotationDamageMatchesArtifact: almostEqual(
      replayState.totalDamage,
      artifact.summary?.rotationDamage,
    ),
    replayTotalDamageMatchesArtifact: almostEqual(
      finalState.totalDamage,
      artifact.summary?.totalDamage,
    ),
    actionCountsMatchArtifact:
      JSON.stringify(actions) === JSON.stringify(artifact.summary?.actionCounts ?? {}),
    mechanicsPassed: audit.mechanics.passed,
    damageBreakdownReconciles: almostEqual(
      rotationBreakdownDamage,
      replayState.totalDamage,
      0.01,
    ),
    equipmentDamageReconciles: almostEqual(
      equipmentDamage,
      artifactEquipmentDamage,
      0.01,
    ),
    allOrangeWindowsHaveFiveFangs:
      orangeWindows.length === 4 &&
      orangeWindows.every((window) => window.dragonFangs === 5),
    orangeExtraCountMatchesCoveredFangs:
      damageEventCount(timeline, "orangeExtra") ===
      orangeWindows.reduce((sum, window) => sum + window.dragonFangs, 0),
    divineEventCountMatchesDragonFangs:
      damageEventCount(timeline, "dragonFangDivine") ===
      Number(actions.dragonFang ?? 0),
    autoAttackCadenceStable:
      autoIntervals.every((frames) => almostEqual(frames, runtime.config.autoAttackIntervalFrames)),
    thunderNeverPrecedesRideCompletion:
      rideThunder.thunderBeforeRideCompletionCount === 0,
    sequentialChargePools:
      replayState.chargeTicks?.ride?.mode === "sequential" &&
      replayState.chargeTicks?.thunder?.mode === "sequential",
  };

  return {
    schemaVersion: 1,
    kind: "tiance-cw-lianying-current-best-verification",
    sourceArtifact: artifact.kind,
    domain: {
      durationSeconds: artifact.durationSeconds,
      target: artifact.assumptions?.target,
      haste: runtime.panel.haste,
      latencyMs: runtime.config.latencyMs,
      gcdFrames: runtime.config.gcdFrames,
    },
    result: {
      allHardChecksPassed: Object.values(hardChecks).every(Boolean),
      hardChecks,
      rotationDamage: replayState.totalDamage,
      rotationDps: replayState.totalDamage / Number(artifact.durationSeconds),
      totalDamage: finalState.totalDamage,
      totalDps: summary.dps,
      mechanicsViolationCount: audit.mechanics.violationCount,
      finalRage: replayState.rage,
      finalDragonRideStacks: replayState.dragonRideStacks,
    },
    actions,
    resourceDiagnostics: audit.resourceWaste,
    dragonRide: audit.dragonRide,
    orangeWindows,
    rideThunder,
    periodic: {
      bleed,
      autoAttack: {
        count: autoAttacks.length,
        intervalFrames: runtime.config.autoAttackIntervalFrames,
        irregularIntervalCount: autoIntervals.filter(
          (frames) => !almostEqual(frames, runtime.config.autoAttackIntervalFrames),
        ).length,
      },
    },
    bleedCounterfactual,
    damageAccounting: {
      rotationBreakdownDamage,
      rotationDamage: replayState.totalDamage,
      equipmentAndDamageEnchantDamage: equipmentDamage,
      totalDamage: finalState.totalDamage,
    },
    interpretation: {
      resourceWasteIsSoftDiagnostic: true,
      terminalDragonRideMustBeZero: false,
      bleedGapIsHardViolation: false,
      latencyDomainMayNotBeExtrapolated: true,
    },
  };
}
