import test from "node:test";
import assert from "node:assert/strict";
import { createConfig } from "../src/config/defaults.js";
import { createZeroDamageOracle } from "../src/engine/damage-oracle.js";
import { runRotation } from "../src/engine/simulator.js";
import { createInitialState } from "../src/engine/state.js";
import { orangeBurstOnFoot } from "../src/policies/scenarios.js";
import { timelineToCsv } from "../src/reports/export.js";
import { summarize, timelineRows } from "../src/reports/summary.js";

test("时间线可以导出CSV且汇总保留橙武覆盖信息", () => {
  const config = createConfig({ gcdFrames: 20 });
  const oracle = createZeroDamageOracle();
  const result = runRotation(
    createInitialState(config, { rage: 0 }),
    orangeBurstOnFoot(),
    config,
    oracle,
  );
  const rows = timelineRows(result);
  const csv = timelineToCsv(rows);
  const summary = summarize(result, config, oracle);

  assert.match(csv, /^sequence,tick,frame,timeMs,seconds,type/);
  assert.match(csv, /dragonFang/);
  assert.equal(summary.dragonFang.total, 5);
  assert.equal(summary.dragonFang.underOrange, 5);
});
