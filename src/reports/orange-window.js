import { frameToTicks } from "../engine/clock.js";

export function summarizeOrangeWindows(state, config) {
  const activations = state.timeline.filter(
    (event) => event.type === "offGcd" && event.action === "orange",
  );
  return activations.map((activation) => {
    const fromTick = activation.tick;
    const untilTick = fromTick + frameToTicks(config.durations.orange);
    const damageEvents = state.timeline.filter(
      (event) =>
        event.type === "damage" &&
        event.trigger !== "expectedEquipment" &&
        event.tick >= fromTick &&
        event.tick < untilTick,
    );
    const dragonFangs = state.timeline.filter(
      (event) =>
        event.type === "cast" &&
        event.action === "dragonFang" &&
        event.tick >= fromTick &&
        event.tick < untilTick,
    );
    const damageBreakdown = {};
    for (const event of damageEvents) {
      damageBreakdown[event.component] =
        Number(damageBreakdown[event.component] ?? 0) + Number(event.amount);
    }
    return {
      fromTick,
      untilTick,
      fromFrame: activation.frame,
      untilFrame: activation.frame + config.durations.orange,
      fromSeconds: activation.timeMs / 1000,
      totalDamage: damageEvents.reduce((sum, event) => sum + Number(event.amount), 0),
      dragonFangs: dragonFangs.length,
      underThunder: dragonFangs.filter((event) => event.thunder).length,
      dragonRideEnhanced: dragonFangs.filter((event) => event.dragonRideBonus).length,
      castFrames: dragonFangs.map((event) => event.frame),
      damageBreakdown,
    };
  });
}

export function summarizeOrangeWindow(state, config) {
  const [window] = summarizeOrangeWindows(state, config);
  if (!window) throw new Error("时间线中没有橙武主动事件");
  return window;
}
