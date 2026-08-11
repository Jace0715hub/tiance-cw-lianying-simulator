export const FRAMES_PER_SECOND = 16;

export function seconds(value) {
  return Math.round(Number(value) * FRAMES_PER_SECOND);
}

export const DEFAULT_CONFIG = Object.freeze({
  label: "illustrative-5-speed-fixture",
  rotation: "lianying",
  gcdFrames: 20,
  latencyMs: 0,
  rideCastFrames: 9,
  dotIntervalFrames: 32,
  autoAttackEnabled: true,
  autoAttackIntervalFrames: 28,
  maxRage: 5,
  maxBleedStacks: 2,
  maxDragonRideStacks: 25,
  dragonRideGrantedByRide: 6,
  // 已确认机制：任驰骋攻击增益与马上状态独立，下马不清除增益。
  dismountClearsRideBuff: false,
  durations: Object.freeze({
    thunder: seconds(18),
    orange: seconds(6),
    ride: seconds(15),
    bleed: seconds(14),
    breakArmy: seconds(4),
    poLouLan: seconds(8),
  }),
  cooldowns: Object.freeze({
    destroy: seconds(7),
    dragonRoar: seconds(7),
    charge: seconds(23),
    dash: seconds(18),
    orange: seconds(50),
  }),
  charges: Object.freeze({
    thunder: Object.freeze({ capacity: 2, rechargeFrames: seconds(30), mode: "sequential" }),
    ride: Object.freeze({ capacity: 2, rechargeFrames: seconds(34), mode: "sequential" }),
  }),
});

export function createConfig(overrides = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...overrides,
    durations: { ...DEFAULT_CONFIG.durations, ...(overrides.durations ?? {}) },
    cooldowns: { ...DEFAULT_CONFIG.cooldowns, ...(overrides.cooldowns ?? {}) },
    charges: {
      thunder: { ...DEFAULT_CONFIG.charges.thunder, ...(overrides.charges?.thunder ?? {}) },
      ride: { ...DEFAULT_CONFIG.charges.ride, ...(overrides.charges?.ride ?? {}) },
    },
  };
  if (!["lianying", "muyun"].includes(config.rotation)) {
    throw new Error(`未知输出循环: ${config.rotation}`);
  }
  return config;
}
