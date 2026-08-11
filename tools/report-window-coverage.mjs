import { compareWindowCoverage } from "../src/mechanics/window-schedule.js";
import { loadGearTemplate } from "../src/config/gear-template.js";

const defaultHaste = loadGearTemplate().timing.haste;
const hasteValues = (process.argv[2] ?? String(defaultHaste))
  .split(",")
  .map(Number);
const latencyValues = (process.argv[3] ?? "30,60,90")
  .split(",")
  .map(Number);

const rows = compareWindowCoverage({ hasteValues, latencyValues }).map((result) => ({
  haste: result.haste,
  latencyMs: result.latencyMs,
  gcdFrames: result.gcdFrames,
  intervalMs: result.intervalMs,
  orangeDragonFangs: result.count,
  castAtMs: result.casts.map((cast) => cast.castAtMs),
}));

console.table(rows);
