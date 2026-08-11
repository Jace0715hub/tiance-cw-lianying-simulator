export const LIANYING_OPTIMIZATION_PROFILES = Object.freeze([
  "fast",
  "balanced",
  "deep",
]);

const PROFILE_OPTIONS = Object.freeze({
  fast: {
    maxRounds: 1,
    neighborhood: {
      maxPasses: 4,
      maxSwapDistance: 6,
      maxRotationLength: 5,
      localLookaheadRows: [8, 16],
      shortlistPerHorizon: 16,
      shortlistPerKind: 2,
      fullEvaluationLimit: 64,
    },
  },
  balanced: {
    maxRounds: 1,
    neighborhood: {
      maxPasses: 6,
      maxSwapDistance: 8,
      maxRotationLength: 6,
      localLookaheadRows: [8, 16, 32],
      shortlistPerHorizon: 32,
      shortlistPerKind: 4,
      fullEvaluationLimit: 128,
    },
  },
  deep: {
    maxRounds: 2,
    neighborhood: {
      maxPasses: 12,
      maxSwapDistance: 10,
      maxRotationLength: 8,
      localLookaheadRows: [8, 16, 32, 48],
      shortlistPerHorizon: 64,
      shortlistPerKind: 8,
      fullEvaluationLimit: 320,
    },
  },
});

export function createLianyingOptimizationProfile(
  name = "balanced",
  { durationSeconds = 180, onPass } = {},
) {
  if (!LIANYING_OPTIMIZATION_PROFILES.includes(name)) {
    throw new Error(
      `优化档位必须是${LIANYING_OPTIMIZATION_PROFILES.join("、")}`,
    );
  }
  const selected = structuredClone(PROFILE_OPTIONS[name]);
  if (durationSeconds > 180 && name !== "deep") {
    selected.neighborhood.maxPasses = Math.min(
      selected.neighborhood.maxPasses,
      8,
    );
    selected.neighborhood.fullEvaluationLimit = Math.min(
      selected.neighborhood.fullEvaluationLimit,
      64,
    );
  }
  if (onPass) selected.neighborhood.onPass = onPass;
  return selected;
}
