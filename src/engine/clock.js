export const CLOCK_TICKS_PER_FRAME = 1000;
export const CLOCK_TICKS_PER_MS = 16;

export function frameToTicks(frame) {
  const ticks = Math.round(Number(frame) * CLOCK_TICKS_PER_FRAME);
  if (!Number.isSafeInteger(ticks)) throw new Error(`帧数无法转换为时钟刻度: ${frame}`);
  return ticks;
}

export function millisecondsToTicks(milliseconds) {
  const ticks = Math.round(Number(milliseconds) * CLOCK_TICKS_PER_MS);
  if (!Number.isSafeInteger(ticks)) {
    throw new Error(`毫秒数无法转换为时钟刻度: ${milliseconds}`);
  }
  return ticks;
}

export function ticksToFrames(ticks) {
  return Number(ticks) / CLOCK_TICKS_PER_FRAME;
}

export function ticksToMilliseconds(ticks) {
  return Number(ticks) / CLOCK_TICKS_PER_MS;
}

export function gcdLockTicks(lockFrames, latencyMs = 0) {
  return frameToTicks(lockFrames) + millisecondsToTicks(latencyMs);
}
