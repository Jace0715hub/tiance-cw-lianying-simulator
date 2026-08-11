import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  buildOptimizedAxisArtifact,
  optimizedAxisToCsv,
} from "../src/reports/optimized-axis-export.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);

test("收敛轴可导出逐行状态JSON与CSV", () => {
  const runtime = loadDefaultGearRuntime({ rotation: "lianying" });
  const report = {
    durationSeconds: fixture.durationSeconds,
    beamWidth: 8,
    fullEvaluationLimit: 1,
    iterations: 1,
    phases: [],
    checkpointComparison: [],
    cases: [{
      id: "jointOptimized",
      rows: fixture.profiles.lianying.rows,
    }],
  };
  const artifact = buildOptimizedAxisArtifact(report, runtime);
  const csv = optimizedAxisToCsv(artifact);

  assert.equal(artifact.rows.length, 148);
  assert.equal(artifact.rows[0].skill, "任驰骋");
  assert.equal(artifact.rows[0].startSeconds, 0);
  assert.ok(Object.hasOwn(artifact.rows[0], "dragonRideAfter"));
  assert.ok(Object.hasOwn(artifact.rows[0].buffsAtCast, "thunder"));
  assert.equal(csv.split("\n").length, 149);
  assert.match(csv, /行号,技能,开始秒/);
});
