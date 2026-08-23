import path from "node:path";

export const LIANYING_CURRENT_BEST_AXIS =
  "output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json";

export const LIANYING_FIXED_DURATION_BASELINES = Object.freeze({
  180: LIANYING_CURRENT_BEST_AXIS,
  240: "output/lianying-free-fixed-240s-screen.json",
});

export const LIANYING_DEFAULT_RESEARCH_SEEDS = Object.freeze([
  LIANYING_CURRENT_BEST_AXIS,
  "output/lianying-free-fixed-180s-adaptive-suffix-screen-segments-fast-segments-balanced.json",
  "output/lianying-free-fixed-180s-adaptive-suffix-screen.json",
  "output/lianying-free-fixed-180s-crossover-bridge-portfolio-joint-target-best-alternative.json",
]);

export const LIANYING_DEFAULT_VALUE_TRAINING_SEEDS = Object.freeze([
  LIANYING_CURRENT_BEST_AXIS,
  "output/lianying-free-fixed-180s-adaptive-suffix-screen-segments-fast-segments-balanced.json",
  "output/lianying-free-fixed-180s-adaptive-suffix-screen.json",
  "output/lianying-free-fixed-180s-crossover-bridge-portfolio-joint-target-best-alternative.json",
  "output/lianying-free-fixed-180s-best-continued-fast.json",
  "output/lianying-free-fixed-180s.json",
  "output/whitepaper-fixed-180s.json",
  "output/whitepaper-stable-180s.json",
]);

export function resolveLianyingResearchPath(
  projectRoot,
  inputPath = LIANYING_CURRENT_BEST_AXIS,
) {
  const resolvedInput = inputPath === "-" ? LIANYING_CURRENT_BEST_AXIS : inputPath;
  return path.resolve(projectRoot, resolvedInput);
}

export function resolveLianyingDurationBaseline(
  projectRoot,
  durationSeconds = 180,
) {
  const baseline = LIANYING_FIXED_DURATION_BASELINES[Number(durationSeconds)];
  if (!baseline) throw new Error(`尚无${durationSeconds}秒固定时长基线`);
  return path.resolve(projectRoot, baseline);
}

export function resolveLianyingResearchPaths(
  projectRoot,
  inputArgument,
  defaults = LIANYING_DEFAULT_RESEARCH_SEEDS,
) {
  const entries = inputArgument && inputArgument !== "-"
    ? inputArgument.split(",")
    : defaults;
  return [...new Set(
    entries
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => resolveLianyingResearchPath(projectRoot, entry)),
  )];
}
