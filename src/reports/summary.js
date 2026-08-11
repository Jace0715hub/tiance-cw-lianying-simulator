export function summarize(state, config, oracle) {
  const actionCounts = {};
  const castEvents = state.timeline.filter(
    (event) => event.type === "cast" || event.type === "offGcd",
  );
  for (const event of castEvents) {
    actionCounts[event.action] = Number(actionCounts[event.action] ?? 0) + 1;
  }

  const dragonFangs = state.timeline.filter(
    (event) => event.type === "cast" && event.action === "dragonFang",
  );
  const destroys = state.timeline.filter(
    (event) => event.type === "cast" && event.action === "destroy",
  );
  return {
    config: config.label,
    damageOracle: oracle.id,
    durationFrames: state.frame,
    durationMs: state.timeMs,
    durationSeconds: state.timeMs / 1000,
    totalDamage: state.totalDamage,
    dps: state.timeMs > 0 ? (state.totalDamage * 1000) / state.timeMs : 0,
    finalRage: state.rage,
    finalDragonRideStacks: state.dragonRideStacks,
    actionCounts,
    dragonFang: {
      total: dragonFangs.length,
      underThunder: dragonFangs.filter((event) => event.thunder).length,
      underOrange: dragonFangs.filter((event) => event.orange).length,
      dragonRideEnhanced: dragonFangs.filter((event) => event.dragonRideBonus).length,
      mounted: dragonFangs.filter((event) => event.mounted).length,
    },
    destroy: {
      total: destroys.length,
      normal: destroys.filter((event) => event.destroySource === "normal").length,
      poLouLanBonus: destroys.filter(
        (event) => event.destroySource === "poLouLanBonus",
      ).length,
    },
    damageBreakdown: { ...state.damageBreakdown },
  };
}

export function timelineRows(state) {
  return state.timeline.map((event) => ({
    ...event,
    seconds: event.timeMs / 1000,
  }));
}
