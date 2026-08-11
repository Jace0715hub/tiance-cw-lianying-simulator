import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import { runRotation } from "../src/engine/simulator.js";
import {
  orangeBurstOnFoot,
  partialOrangeThunderOverlapOnFoot,
  staggeredOrangeAfterThunderOnFoot,
} from "../src/policies/scenarios.js";
import { summarizeOrangeWindow } from "../src/reports/orange-window.js";

const runtime = loadDefaultGearRuntime();
const cases = [
  ["同时开启（6秒重叠）", orangeBurstOnFoot()],
  ["部分重叠（3秒）", partialOrangeThunderOverlapOnFoot()],
  ["完全错开（0秒）", staggeredOrangeAfterThunderOnFoot()],
];

const rows = cases.map(([label, actions]) => {
  const state = runRotation(
    createInitialState(runtime.config, { rage: 0 }),
    actions,
    runtime.config,
    runtime.oracle,
  );
  const window = summarizeOrangeWindow(state, runtime.config);
  return {
    template: label,
    orangeDragonFangs: window.dragonFangs,
    thunderDragonFangs: window.underThunder,
    dragonRideEnhanced: window.dragonRideEnhanced,
    orangeWindowDamage: window.totalDamage,
    castFrames: window.castFrames,
  };
});

console.table(rows);
