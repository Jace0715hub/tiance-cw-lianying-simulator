import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createNativeDamageOracle } from "../src/damage/native-damage-oracle.js";
import { executeActionPack } from "../src/engine/simulator.js";
import { createInitialState } from "../src/engine/state.js";
import { createTimedConfig } from "../src/mechanics/timing.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("../data/excel-v1.3-reference.json", import.meta.url), "utf8"),
);
const oracle = createNativeDamageOracle({
  panel: fixture.combatPanel,
  damageRules: {
    nonPlayerDamageBonus: fixture.damageRules.nonPlayerDamageBonus,
  },
});

test("流血周期事件通过原生oracle进入伤害明细", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const applied = executeActionPack(
    createInitialState(config, { rage: 2 }),
    { primary: "destroy" },
    config,
    oracle,
  );
  const advanced = executeActionPack(
    applied,
    { primary: { id: "wait", frames: 7 } },
    config,
    oracle,
  );
  const golden = fixture.phases.nonExecute.rows.find(
    (row) => row.skill === "流血-战心" && row.tags === "1层牧云A",
  );
  const event = advanced.timeline.find(
    (entry) => entry.type === "damage" && entry.component === "bleedTick",
  );

  assert.ok(event);
  assert.equal(event.frame, 27);
  assert.equal(event.bleedStacks, 1);
  assert.equal(event.bleedQuality, 2);
  assert.ok(
    Math.abs(event.amount - golden.goldenDamage) <=
      Math.max(1, Math.abs(golden.goldenDamage)) * 1e-12,
  );
  assert.equal(advanced.damageBreakdown.bleedTick, event.amount);
});
