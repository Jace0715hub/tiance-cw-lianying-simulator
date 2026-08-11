import { loadDefaultGearRuntime } from "./config/gear-template.js";
import { runRotation } from "./engine/simulator.js";
import { createInitialState } from "./engine/state.js";
import {
  fullMountedOverlap,
  orangeBurstThenRide,
} from "./policies/scenarios.js";
import { summarize } from "./reports/summary.js";
import { applyExpectedEquipmentDamage } from "./effects/expected-equipment.js";

const {
  config,
  panel,
  oracle,
  expectedEquipmentEffects,
  initialStateOverrides,
} = loadDefaultGearRuntime();
const scenarios = {
  "马下橙武后上马": orangeBurstThenRide(),
  "马上完全重叠": fullMountedOverlap(),
};

for (const [name, actions] of Object.entries(scenarios)) {
  const initial = createInitialState(config, { ...initialStateOverrides, rage: 0 });
  const coreResult = runRotation(initial, actions, config, oracle);
  const result = applyExpectedEquipmentDamage(
    coreResult,
    expectedEquipmentEffects,
    panel,
    oracle,
  );
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(summarize(result, config, oracle), null, 2));
}
