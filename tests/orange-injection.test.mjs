import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  buildOrangeLianyingCandidates,
  injectOrangeIntoRows,
  selectOrangeRowsGapAligned,
  selectOrangeRowsOnCooldown,
  selectOrangeRowsThunderAligned,
} from "../src/policies/orange-injection.js";
import { buildOrangeCandidateReport } from "../src/reports/orange-candidates.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const rows = fixture.profiles.lianying.rows;
const runtime = loadDefaultGearRuntime({ rotation: "lianying" });
const options = { durationSeconds: fixture.durationSeconds };

test("180秒候选轴选出四次到点、三次对齐和两次无重叠橙武", () => {
  assert.deepEqual(
    selectOrangeRowsOnCooldown(rows, runtime.config, options)
      .map((selection) => selection.rowIndex),
    [0, 42, 84, 126],
  );
  assert.deepEqual(
    selectOrangeRowsThunderAligned(rows, runtime.config, options)
      .map((selection) => selection.rowIndex),
    [1, 51, 101],
  );
  assert.deepEqual(
    selectOrangeRowsGapAligned(rows, runtime.config, options)
      .map((selection) => selection.rowIndex),
    [65, 115],
  );
});

test("注入橙武标记不修改原始离线技能表", () => {
  const candidates = buildOrangeLianyingCandidates(rows, runtime.config, options);
  const injected = injectOrangeIntoRows(rows, [0, 42]);

  assert.equal(rows[0].skill, "任驰骋");
  assert.equal(injected[0].skill, "任驰骋-CW");
  assert.equal(injected[42].skill, "龙吟-CW");
  assert.equal(candidates.length, 3);
});

test("三条无等待候选轴均可完成180秒确定性回放", () => {
  const report = buildOrangeCandidateReport(rows, runtime, options);

  assert.equal(report.baseline.traceLength, 148);
  assert.deepEqual(
    report.candidates.map((candidate) => candidate.traceLength),
    [148, 148, 148],
  );
  assert.deepEqual(
    report.candidates.map((candidate) => candidate.orangeUses),
    [4, 3, 2],
  );
  assert.deepEqual(
    report.candidates.map((candidate) => candidate.orangeDragonFangs),
    [16, 13, 2],
  );
  assert.equal(report.candidates[1].thunderOverlapSeconds, 18);
  assert.equal(report.candidates[2].thunderOverlapSeconds, 0);
  assert.ok(report.candidates.every((candidate) => candidate.damageGain > 0));
});
