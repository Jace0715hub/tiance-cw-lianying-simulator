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

test("入战首发梅花枪法通过原生oracle进入伤害明细", () => {
  const config = createTimedConfig({ haste: 31326, latencyMs: 30 });
  const result = executeActionPack(
    createInitialState(config, {
      buffs: {
        thunderFrom: 0,
        thunderUntil: 10,
        rideFrom: 0,
        rideUntil: 10,
      },
    }),
    { primary: { id: "wait", frames: 1 } },
    config,
    oracle,
  );
  const golden = fixture.phases.nonExecute.rows.find(
    (row) => row.skill === "梅花枪法" && row.tags === "雷驰骋牧云1",
  );
  const event = result.timeline.find(
    (entry) => entry.type === "damage" && entry.component === "autoAttack",
  );

  assert.ok(event);
  assert.equal(event.frame, 0);
  assert.equal(event.thunder, true);
  assert.equal(event.ride, true);
  assert.ok(
    Math.abs(event.amount - golden.goldenDamage) <=
      Math.max(1, Math.abs(golden.goldenDamage)) * 1e-12,
  );
  assert.equal(result.damageBreakdown.autoAttack, event.amount);
});
