import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LIANYING_CURRENT_BEST_AXIS,
  LIANYING_FIXED_DURATION_BASELINES,
  LIANYING_DEFAULT_RESEARCH_SEEDS,
  LIANYING_DEFAULT_VALUE_TRAINING_SEEDS,
  resolveLianyingResearchPath,
  resolveLianyingResearchPaths,
  resolveLianyingDurationBaseline,
} from "../src/config/lianying-research-defaults.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("current-best research default points to the promoted anchor-wait axis", () => {
  assert.equal(
    LIANYING_CURRENT_BEST_AXIS,
    "output/lianying-free-fixed-180s-anchor-wait.json",
  );
  assert.equal(LIANYING_DEFAULT_RESEARCH_SEEDS[0], LIANYING_CURRENT_BEST_AXIS);
  assert.equal(
    resolveLianyingResearchPath(projectRoot),
    path.join(projectRoot, LIANYING_CURRENT_BEST_AXIS),
  );
  assert.equal(
    resolveLianyingResearchPath(projectRoot, "-"),
    path.join(projectRoot, LIANYING_CURRENT_BEST_AXIS),
  );
});

test("固定时长基线分别解析180秒正式轴与240秒screen轴", () => {
  assert.equal(
    LIANYING_FIXED_DURATION_BASELINES[180],
    LIANYING_CURRENT_BEST_AXIS,
  );
  assert.equal(
    resolveLianyingDurationBaseline(projectRoot, 240),
    path.join(projectRoot, "output/lianying-free-fixed-240s-screen.json"),
  );
  assert.equal(
    fs.existsSync(resolveLianyingDurationBaseline(projectRoot, 240)),
    true,
  );
  assert.throws(
    () => resolveLianyingDurationBaseline(projectRoot, 300),
    /尚无300秒固定时长基线/,
  );
});

test("default research seed portfolio is deduplicated and available", () => {
  const resolved = resolveLianyingResearchPaths(projectRoot);
  assert.equal(resolved.length, LIANYING_DEFAULT_RESEARCH_SEEDS.length);
  assert.equal(new Set(resolved).size, resolved.length);
  for (const seedPath of resolved) assert.equal(fs.existsSync(seedPath), true, seedPath);
});

test("状态价值默认组合覆盖八条可用且互异的来源轴", () => {
  const resolved = resolveLianyingResearchPaths(
    projectRoot,
    undefined,
    LIANYING_DEFAULT_VALUE_TRAINING_SEEDS,
  );
  assert.equal(resolved.length, 8);
  assert.equal(new Set(resolved).size, resolved.length);
  assert.equal(
    LIANYING_DEFAULT_VALUE_TRAINING_SEEDS[0],
    LIANYING_CURRENT_BEST_AXIS,
  );
  for (const seedPath of resolved) assert.equal(fs.existsSync(seedPath), true, seedPath);
});

test("explicit research seed list overrides defaults and removes duplicates", () => {
  const resolved = resolveLianyingResearchPaths(
    projectRoot,
    "output/lianying-free-fixed-180s-best.json,output/lianying-free-fixed-180s-best.json",
  );
  assert.deepEqual(resolved, [
    path.join(projectRoot, "output/lianying-free-fixed-180s-best.json"),
  ]);
});
