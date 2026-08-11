import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { createInitialState } from "../src/engine/state.js";
import {
  applyExpectedEquipmentDamage,
  expectedEquipmentProcCount,
} from "../src/effects/expected-equipment.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);

test("五类装备效果的180秒期望次数与原配装器一致", () => {
  const runtime = loadDefaultGearRuntime();
  const reference = fixture.references.lianying.skills;

  for (const effect of runtime.expectedEquipmentEffects) {
    const count = expectedEquipmentProcCount(effect.countRule, {
      durationSeconds: 180,
      panel: runtime.panel,
    });
    assert.ok(Math.abs(count - reference[effect.skill].count) < 1e-12);
  }
});

test("五类装备期望伤害通过原生公式进入伤害明细", () => {
  const runtime = loadDefaultGearRuntime();
  const reference = fixture.references.lianying.skills;
  const initial = createInitialState(runtime.config, {
    frame: 2880,
    gcdReadyFrame: 2880,
  });
  const result = applyExpectedEquipmentDamage(
    initial,
    runtime.expectedEquipmentEffects,
    runtime.panel,
    runtime.oracle,
    { durationSeconds: 180 },
  );

  for (const effect of runtime.expectedEquipmentEffects) {
    const event = result.timeline.find(
      (entry) => entry.component === effect.component,
    );
    assert.ok(event);
    assert.equal(event.trigger, "expectedEquipment");
    assert.ok(
      Math.abs(event.amount - reference[effect.skill].damage) <=
        Math.max(1, reference[effect.skill].damage) * 1e-12,
    );
  }
  assert.throws(
    () => applyExpectedEquipmentDamage(
      result,
      runtime.expectedEquipmentEffects,
      runtime.panel,
      runtime.oracle,
      { durationSeconds: 180 },
    ),
    /已经结算/,
  );
});
