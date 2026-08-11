import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import { frameToTicks } from "../src/engine/clock.js";
import { buildOrangeLianyingCandidates, profileRowTiming } from "../src/policies/orange-injection.js";
import { replayProfileRows } from "../src/policies/profile-replay.js";
import { beamSearchThunderWindow } from "../src/policies/thunder-window-search.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const runtime = loadDefaultGearRuntime({ rotation: "lianying" });
const [candidate] = buildOrangeLianyingCandidates(
  fixture.profiles.lianying.rows,
  runtime.config,
  { durationSeconds: fixture.durationSeconds },
);

test("完整18秒激雷窗口束搜索保留多个状态并输出15个施展位", () => {
  const thunderRowIndex = 1;
  const timing = profileRowTiming(thunderRowIndex, runtime.config);
  const untilTick = timing.startTick + frameToTicks(runtime.config.durations.thunder);
  const windowRows = candidate.rows.slice(thunderRowIndex, thunderRowIndex + 15);
  const prefix = replayProfileRows(
    createInitialState(runtime.config, { rage: 5 }),
    candidate.rows.slice(0, thunderRowIndex),
    runtime.config,
    runtime.oracle,
    { validateResource: false },
  );
  const search = beamSearchThunderWindow(
    prefix.state,
    windowRows,
    runtime.config,
    runtime.oracle,
    {
      windowFromTick: timing.startTick,
      windowUntilTick: untilTick,
      beamWidth: 32,
    },
  );

  assert.equal(search.depthStats.length, 15);
  assert.equal(search.ranked.length, 32);
  assert.equal(search.ranked[0].rows.length, 15);
  assert.ok(search.exploredTransitions > 1000);
  assert.ok(search.legalTransitions < search.exploredTransitions);
  assert.ok(search.ranked[0].damage > 0);
  assert.ok(search.ranked[0].dragonFangs >= 10);
});
