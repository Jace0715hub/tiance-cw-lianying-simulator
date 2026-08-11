import { createConfig, FRAMES_PER_SECOND } from "../config/defaults.js";

function excelInt(value) {
  return Math.floor(Number(value));
}

export function calculateFrameTiming({ haste = 0, latencyMs = 30 } = {}) {
  const acceleratedFrames = Math.min(
    256,
    excelInt((Number(haste) / 210078) * 1024),
  );
  const gcdFrames = Math.max(
    excelInt((1.5 * FRAMES_PER_SECOND) / 1.25),
    excelInt(
      (excelInt(1.5 * FRAMES_PER_SECOND) * 1024) /
        (1024 + acceleratedFrames),
    ),
  );
  const rideCastFrames = Math.max(
    excelInt((0.75 * FRAMES_PER_SECOND) / 1.25),
    excelInt(
      (excelInt(0.75 * FRAMES_PER_SECOND) * 1024) /
        (1024 + acceleratedFrames),
    ),
  );
  const wideGcdFrames = Math.max(
    excelInt((1.7 * FRAMES_PER_SECOND + 1) / 1.25),
    excelInt(
      (excelInt(1.7 * FRAMES_PER_SECOND + 1) * 1024) /
        (1024 + acceleratedFrames),
    ),
  );
  const dotIntervalFrames = Math.max(
    excelInt(32 / 1.25),
    excelInt((32 * 1024) / (1024 + acceleratedFrames)),
  );
  const gcdBaseSeconds = gcdFrames / FRAMES_PER_SECOND;
  const latencySeconds = Math.max(0, Number(latencyMs)) / 1000;
  const effectiveGcdSeconds = gcdBaseSeconds === 1.375
    ? Math.max(1.4, gcdBaseSeconds + latencySeconds)
    : gcdBaseSeconds + latencySeconds;
  const thresholds = [1.1875, 1.25, 1.3125, 1.4, 1.4375, 1.5];
  const segment = thresholds.reduce(
    (sum, threshold) => sum + (effectiveGcdSeconds < threshold ? 1 : 0),
    0,
  );

  return {
    acceleratedFrames,
    gcdFrames,
    rideCastFrames,
    wideGcdFrames,
    dotIntervalFrames,
    latencyMs: Math.max(0, Number(latencyMs)),
    effectiveGcdSeconds,
    segment,
  };
}

export function enumerateTimingBands({
  latencyMs = 30,
  minHaste = 0,
  maxHaste = 60000,
} = {}) {
  const first = Math.ceil(Number(minHaste));
  const last = Math.floor(Number(maxHaste));
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) {
    throw new Error("加速枚举范围非法");
  }
  const bands = [];
  for (let haste = first; haste <= last; haste += 1) {
    const timing = calculateFrameTiming({ haste, latencyMs });
    const signature = `${timing.gcdFrames}:${timing.segment}`;
    const current = bands.at(-1);
    if (current?.signature === signature) {
      current.maxHaste = haste;
      continue;
    }
    bands.push({
      signature,
      minHaste: haste,
      maxHaste: haste,
      gcdFrames: timing.gcdFrames,
      baseGcdMs: timing.gcdFrames * (1000 / FRAMES_PER_SECOND),
      effectiveGcdMs: timing.effectiveGcdSeconds * 1000,
      segment: timing.segment,
      latencyMs: timing.latencyMs,
    });
  }
  return bands.map(({ signature: _signature, ...band }) => band);
}

export function createTimedConfig(
  { haste = 0, latencyMs = 30 } = {},
  overrides = {},
) {
  const timing = calculateFrameTiming({ haste, latencyMs });
  return createConfig({
    ...overrides,
    label: overrides.label ?? `native-${haste}-haste-${latencyMs}ms`,
    haste: Number(haste),
    latencyMs: timing.latencyMs,
    gcdFrames: timing.gcdFrames,
    rideCastFrames: timing.rideCastFrames,
    dotIntervalFrames: overrides.dotIntervalFrames ?? timing.dotIntervalFrames,
    autoAttackIntervalFrames:
      overrides.autoAttackIntervalFrames ?? timing.wideGcdFrames,
    timing,
  });
}
