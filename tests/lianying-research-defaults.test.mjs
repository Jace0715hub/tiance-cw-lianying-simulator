import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LIANYING_CURRENT_BEST_AXIS,
  LIANYING_DEFAULT_RESEARCH_SEEDS,
  resolveLianyingResearchPath,
  resolveLianyingResearchPaths,
} from "../src/config/lianying-research-defaults.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("current-best research default points to the promoted joint segment axis", () => {
  assert.equal(
    LIANYING_CURRENT_BEST_AXIS,
    "output/lianying-free-fixed-180s-crossover-bridge-portfolio-joint-fast-segments-fast.json",
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

test("default research seed portfolio is deduplicated and available", () => {
  const resolved = resolveLianyingResearchPaths(projectRoot);
  assert.equal(resolved.length, LIANYING_DEFAULT_RESEARCH_SEEDS.length);
  assert.equal(new Set(resolved).size, resolved.length);
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
