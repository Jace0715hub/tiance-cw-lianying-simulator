import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import { buildOrangeLianyingCandidates } from "../src/policies/orange-injection.js";
import {
  rankOrangeWindowRotations,
  replaceProfilePrimary,
} from "../src/policies/orange-window-search.js";
import { replayProfileRows } from "../src/policies/profile-replay.js";
import { buildLocallyOptimizedOrangeCandidateReport } from "../src/reports/orange-candidates.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const baselineRows = fixture.profiles.lianying.rows;
const runtime = loadDefaultGearRuntime({ rotation: "lianying" });

test("替换主要技能时保留激雷和断魂刺前缀", () => {
  assert.equal(
    replaceProfilePrimary({ skill: "雷断魂刺龙牙" }, "灭").skill,
    "雷断魂刺灭",
  );
});

test("橙武首窗口穷举1024种并找到5发龙牙局部最优解", () => {
  const [candidate] = buildOrangeLianyingCandidates(
    baselineRows,
    runtime.config,
    { durationSeconds: fixture.durationSeconds },
  );
  const prefix = replayProfileRows(
    createInitialState(runtime.config, { rage: 5 }),
    candidate.rows.slice(0, 1),
    runtime.config,
    runtime.oracle,
    { validateResource: false },
  );
  const search = rankOrangeWindowRotations(
    prefix.state,
    candidate.rows.slice(1, 6),
    runtime.config,
    runtime.oracle,
    { orangeFromTick: candidate.selections[0].orangeTick },
  );

  assert.equal(search.explored, 1024);
  assert.ok(search.legal > 0 && search.legal < search.explored);
  assert.equal(search.ranked[0].dragonFangs, 5);
  assert.deepEqual(search.ranked[0].skills, [
    "雷龙牙",
    "龙牙",
    "龙牙",
    "龙牙",
    "断魂刺龙牙",
  ]);
});

test("局部优化后三条候选轴每个橙武窗口均有5发龙牙", () => {
  const report = buildLocallyOptimizedOrangeCandidateReport(
    baselineRows,
    runtime,
    { durationSeconds: fixture.durationSeconds },
  );

  assert.deepEqual(
    report.candidates.map((candidate) => candidate.orangeDragonFangs),
    [20, 15, 10],
  );
  assert.ok(
    report.candidates.every((candidate) =>
      candidate.searches.every((search) => search.dragonFangs === 5),
    ),
  );
  assert.ok(
    report.candidates[0].dps > report.candidates[1].dps &&
      report.candidates[1].dps > report.candidates[2].dps,
  );
});
