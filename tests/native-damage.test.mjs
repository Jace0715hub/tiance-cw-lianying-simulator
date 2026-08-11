import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildAoxueDamageRow } from "../src/damage/aoxue-catalog.js";
import { createNativeDamageOracle } from "../src/damage/native-damage-oracle.js";
import { calculateNativeDamage } from "../src/damage/native-formula.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("../data/excel-v1.3-reference.json", import.meta.url), "utf8"),
);
const panel = fixture.combatPanel;
const damageRules = {
  nonPlayerDamageBonus: fixture.damageRules.nonPlayerDamageBonus,
};

function referenceRow(skill, tags, vulnerability = 0.0205078125) {
  return fixture.phases.nonExecute.rows.find(
    (row) =>
      row.skill === skill &&
      row.tags === tags &&
      row.vulnerability === vulnerability,
  );
}

function closeTo(actual, expected, relativeTolerance = 1e-12) {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= scale * relativeTolerance,
    `expected ${actual} to be within ${relativeTolerance} of ${expected}`,
  );
}

test("原生公式复现雷驰骋龙驭五豆龙牙金标准", () => {
  const snapshot = {
    rageBeforeCast: 5,
    thunder: true,
    ride: true,
    dragonRideBonus: true,
  };
  const nativeRow = buildAoxueDamageRow("dragonFang", snapshot);
  const golden = referenceRow("龙牙", "5豆雷驰骋龙驭牧云1", 0.470703125);
  assert.ok(golden);
  const result = calculateNativeDamage(nativeRow, panel, damageRules);
  const oracle = createNativeDamageOracle({ panel, damageRules });
  const dragonBlood = referenceRow("龙血", "5豆雷驰骋牧云1");

  closeTo(result.finalDamage, golden.goldenDamage);
  closeTo(oracle.evaluateComponent("dragonBlood", snapshot), dragonBlood.goldenDamage);
});

test("画角闻龙享受雷与驰骋，但不读取龙驭快照", () => {
  const oracle = createNativeDamageOracle({ panel, damageRules });
  const base = {
    rageBeforeCast: 5,
    thunder: true,
    ride: true,
    dragonRideBonus: false,
  };
  const withoutDragonRide = oracle.evaluateComponent("orangeExtra", base);
  const withDragonRide = oracle.evaluateComponent("orangeExtra", {
    ...base,
    dragonRideBonus: true,
  });
  const golden = referenceRow("画角闻龙", "雷驰骋牧云1");

  closeTo(withoutDragonRide, golden.goldenDamage);
  closeTo(withDragonRide, withoutDragonRide);
  assert.ok(
    withoutDragonRide >
      oracle.evaluateComponent("orangeExtra", { ...base, thunder: false }),
  );
  assert.ok(
    withoutDragonRide >
      oracle.evaluateComponent("orangeExtra", { ...base, ride: false }),
  );
});

test("龙牙神兵按每次龙牙307/1024期望触发计入", () => {
  const oracle = createNativeDamageOracle({ panel, damageRules });
  const snapshot = {
    rageBeforeCast: 5,
    thunder: true,
    ride: true,
    dragonRideBonus: true,
  };
  const golden = referenceRow("龙牙·神兵", "雷驰骋牧云1");
  const actual = oracle.evaluateComponent("dragonFangDivine", snapshot);

  closeTo(actual, golden.goldenDamage * (307 / 1024));
});

test("灭、龙吟和穿云按施展前战意选择原生参数", () => {
  const oracle = createNativeDamageOracle({ panel, damageRules });
  const cases = [
    {
      component: "destroy",
      skill: "灭",
      tags: "2豆雷驰骋牧云1",
      snapshot: { rageBeforeCast: 2, thunder: true, ride: true },
    },
    {
      component: "dragonRoar",
      skill: "龙吟",
      tags: "2豆雷驰骋牧云1",
      snapshot: { rageBeforeCast: 2, thunder: true, ride: true },
    },
    {
      component: "cloudStrike",
      skill: "穿云",
      tags: "4豆雷驰骋牧云1",
      snapshot: { rageBeforeCast: 4, thunder: true, ride: true },
    },
  ];

  for (const entry of cases) {
    const golden = referenceRow(entry.skill, entry.tags);
    assert.ok(golden, `missing golden row ${entry.skill}:${entry.tags}`);
    closeTo(
      oracle.evaluateComponent(entry.component, entry.snapshot),
      golden.goldenDamage,
    );
  }
});

test("断魂刺及斩杀灭附伤复现离线金标准", () => {
  const oracle = createNativeDamageOracle({ panel, damageRules });
  const charge = referenceRow("断魂刺", "雷驰骋牧云1");
  const poLouLan = fixture.phases.execute.rows.find(
    (row) => row.skill === "灭-破楼兰" && row.tags === "0豆雷驰骋牧云1",
  );
  const destroyStrain = fixture.phases.execute.rows.find(
    (row) => row.skill === "新破招(灭)" && row.tags === "雷牧云1",
  );

  closeTo(
    oracle.evaluateComponent("charge", {
      rageBeforeCast: 2,
      thunder: true,
      ride: true,
    }),
    charge.goldenDamage,
  );
  closeTo(
    oracle.evaluateComponent("destroyPoLouLan", {
      rageBeforeCast: 0,
      thunder: true,
      ride: true,
      executePhase: true,
    }),
    poLouLan.goldenDamage,
  );
  closeTo(
    oracle.evaluateComponent("destroyStrain", {
      rageBeforeCast: 0,
      thunder: true,
      ride: true,
      executePhase: true,
    }),
    destroyStrain.goldenDamage,
  );
});

test("普通流血与战心流血的单跳伤害按当前层数快照", () => {
  const oracle = createNativeDamageOracle({ panel, damageRules });
  const normal = referenceRow("流血", "2层雷驰骋牧云A");
  const warheart = referenceRow("流血-战心", "2层雷驰骋牧云A");
  const common = {
    rageBeforeCast: 0,
    thunder: true,
    ride: true,
    bleedStacks: 2,
  };

  closeTo(
    oracle.evaluateComponent("bleedTick", { ...common, bleedQuality: 1 }),
    normal.goldenDamage,
  );
  closeTo(
    oracle.evaluateComponent("bleedTick", { ...common, bleedQuality: 2 }),
    warheart.goldenDamage,
  );
  assert.ok(warheart.goldenDamage > normal.goldenDamage);
});

test("自动攻击系数由加速后的宽GCD帧档生成", () => {
  const oracle = createNativeDamageOracle({ panel, damageRules });
  const golden = referenceRow("梅花枪法", "雷驰骋牧云1");
  const actual = oracle.evaluateComponent("autoAttack", {
    rageBeforeCast: 0,
    thunder: true,
    ride: true,
  });

  assert.equal(golden.attackCoefficient, 0.1375);
  closeTo(actual, golden.goldenDamage);
});

test("突的4%+3%秘籍伤害参数复现原配装器", () => {
  const oracle = createNativeDamageOracle({ panel, damageRules });
  const golden = referenceRow("突", "雷牧云1");
  const actual = oracle.evaluateComponent("dash", {
    rageBeforeCast: 0,
    thunder: true,
    ride: false,
  });

  closeTo(actual, golden.goldenDamage);
  closeTo(
    buildAoxueDamageRow("dash", {
      rageBeforeCast: 0,
      thunder: true,
      ride: false,
    }).damageBonus,
    golden.damageBonus,
  );
});

test("原生伤害运行时模块不依赖Excel参考JSON", () => {
  const source = fs.readFileSync(
    new URL("../src/damage/native-damage-oracle.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /excel-v1\.3-reference|\.xlsx/i);
});
