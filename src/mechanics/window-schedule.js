import { FRAMES_PER_SECOND } from "../config/defaults.js";
import { calculateFrameTiming } from "./timing.js";

const FRAME_MS = 1000 / FRAMES_PER_SECOND;

function requireNonNegative(name, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name}必须是非负数`);
  }
  return number;
}

export function buildWindowCastSchedule({
  haste = 0,
  latencyMs = 30,
  windowSeconds = 6,
  activationLeadFrames = 1,
  firstCastDelayMs = 0,
  maximumCasts = 100,
} = {}) {
  const timing = calculateFrameTiming({ haste, latencyMs });
  const windowMs = requireNonNegative("窗口时长", windowSeconds) * 1000;
  const leadMs = requireNonNegative("提前帧数", activationLeadFrames) * FRAME_MS;
  const delayMs = requireNonNegative("首个技能额外延迟", firstCastDelayMs);
  const limit = Math.floor(requireNonNegative("最大施展次数", maximumCasts));
  const intervalMs = timing.effectiveGcdSeconds * 1000;
  const activationAtMs = 0;
  const windowUntilMs = activationAtMs + windowMs;
  const firstCastAtMs = leadMs + delayMs;
  const casts = [];

  if (intervalMs <= 0) throw new Error("GCD间隔必须大于0");
  for (let index = 0; index < limit; index += 1) {
    const castAtMs = firstCastAtMs + index * intervalMs;
    if (castAtMs >= windowUntilMs) break;
    casts.push({
      index: index + 1,
      castAtMs,
      castAtFrames: castAtMs / FRAME_MS,
      insideWindow: castAtMs >= activationAtMs && castAtMs < windowUntilMs,
    });
  }

  return {
    haste: Number(haste),
    latencyMs: Number(latencyMs),
    gcdFrames: timing.gcdFrames,
    baseGcdMs: timing.gcdFrames * FRAME_MS,
    intervalMs,
    activationLeadFrames: Number(activationLeadFrames),
    activationAtMs,
    firstCastAtMs,
    windowUntilMs,
    count: casts.length,
    casts,
  };
}

export function compareWindowCoverage({
  hasteValues,
  latencyValues = [30, 60, 90],
  ...options
}) {
  if (!Array.isArray(hasteValues) || hasteValues.length === 0) {
    throw new Error("至少需要一个加速值");
  }
  return hasteValues.flatMap((haste) =>
    latencyValues.map((latencyMs) =>
      buildWindowCastSchedule({
        ...options,
        haste,
        latencyMs,
      }),
    ),
  );
}
