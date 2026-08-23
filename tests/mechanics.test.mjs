import test from "node:test";
import assert from "node:assert/strict";
import { createConfig } from "../src/config/defaults.js";
import { createZeroDamageOracle } from "../src/engine/damage-oracle.js";
import { executeActionPack } from "../src/engine/simulator.js";
import { createInitialState } from "../src/engine/state.js";

const config = createConfig({ gcdFrames: 20 });
const oracle = createZeroDamageOracle();

function dragonFangCast(state) {
  return state.timeline.findLast(
    (event) => event.type === "cast" && event.action === "dragonFang",
  );
}

test("0豆开启橙武后可以立即施展龙牙并在命中后回满", () => {
  const initial = createInitialState(config, { rage: 0 });
  const result = executeActionPack(
    initial,
    { prefix: ["orange"], primary: "dragonFang" },
    config,
    oracle,
  );
  const cast = dragonFangCast(result);

  assert.equal(cast.rageBeforeCast, 5);
  assert.equal(cast.rageCost, 3);
  assert.equal(cast.rageAfterCost, 2);
  assert.equal(cast.rageAfterResolution, 5);
  assert.equal(result.rage, 5);
});

test("连营雷内龙牙先扣1豆再由橙武回满", () => {
  const initial = createInitialState(config, { rage: 5 });
  const result = executeActionPack(
    initial,
    { prefix: ["thunder", "orange"], primary: "dragonFang" },
    config,
    oracle,
  );
  const cast = dragonFangCast(result);

  assert.equal(cast.rageCost, 1);
  assert.equal(cast.rageAfterCost, 4);
  assert.equal(cast.rageAfterResolution, 5);
});

test("牧云雷内龙牙仍消耗3豆", () => {
  const muyunConfig = createConfig({ gcdFrames: 20, rotation: "muyun" });
  const result = executeActionPack(
    createInitialState(muyunConfig, { rage: 5 }),
    { prefix: ["thunder"], primary: "dragonFang" },
    muyunConfig,
    oracle,
  );
  const cast = dragonFangCast(result);

  assert.equal(cast.thunder, true);
  assert.equal(cast.rageCost, 3);
  assert.equal(result.rage, 2);
});

test("马下龙牙生产龙驭，马上龙牙消费龙驭", () => {
  const initial = createInitialState(config, { rage: 5 });
  const onFoot = executeActionPack(
    initial,
    { primary: "dragonFang" },
    config,
    oracle,
  );
  assert.equal(onFoot.dragonRideStacks, 1);
  assert.equal(dragonFangCast(onFoot).dragonRideBonus, false);

  const mountedInitial = createInitialState(config, {
    rage: 5,
    mounted: true,
    mountedFrom: 0,
    dragonRideStacks: 1,
  });
  const mounted = executeActionPack(
    mountedInitial,
    { primary: "dragonFang" },
    config,
    oracle,
  );
  assert.equal(mounted.dragonRideStacks, 0);
  assert.equal(dragonFangCast(mounted).dragonRideBonus, true);
});

test("马上不能直接施展任驰骋", () => {
  const state = createInitialState(config, {
    mounted: true,
    mountedFrom: 0,
    dragonRideStacks: 3,
  });

  assert.throws(
    () => executeActionPack(state, { primary: "ride" }, config, oracle),
    /需要先下马/,
  );
});

test("任驰骋读条结束前不能释放雷，读条完成后的GCD空挡可以释放", () => {
  const initial = createInitialState(config, {
    rage: 5,
    executePhase: true,
  });
  assert.throws(
    () => executeActionPack(
      initial,
      {
        primary: "ride",
        tail: [{ id: "thunder", leadFrames: 14 }],
      },
      config,
      oracle,
    ),
    /任驰骋读条结束前不能施展撼如雷/,
  );
  const result = executeActionPack(
    initial,
    {
      primary: "ride",
      tail: [{ id: "thunder", leadFrames: 5 }],
    },
    config,
    oracle,
  );
  const ride = result.timeline.find(
    (event) => event.type === "cast" && event.action === "ride",
  );
  const thunder = result.timeline.find(
    (event) => event.type === "offGcd" && event.action === "thunder",
  );
  assert.ok(thunder.tick >= ride.completionFrame * 1000);
});

test("下马不清除任驰骋增益且技能事件保留完整快照", () => {
  const initial = createInitialState(config, {
    rage: 2,
    mounted: true,
    mountedFrom: 0,
    dragonRideStacks: 3,
    executePhase: true,
    buffs: { rideFrom: 0, rideUntil: 100 },
  });
  const result = executeActionPack(
    initial,
    { prefix: ["dismount"], primary: "destroy" },
    config,
    oracle,
  );
  const dismount = result.timeline.find(
    (event) => event.type === "offGcd" && event.action === "dismount",
  );
  const destroy = result.timeline.find(
    (event) => event.type === "cast" && event.action === "destroy",
  );

  assert.equal(dismount.mounted, true);
  assert.equal(dismount.ride, true);
  assert.equal(dismount.dragonRideStacksAtStart, 3);
  assert.equal(destroy.mounted, false);
  assert.equal(destroy.ride, true);
});

test("反事实配置可以令下马立即清除任驰骋增益", () => {
  const counterfactualConfig = createConfig({
    gcdFrames: 20,
    dismountClearsRideBuff: true,
  });
  const initial = createInitialState(counterfactualConfig, {
    rage: 2,
    mounted: true,
    mountedFrom: 0,
    executePhase: true,
    buffs: { rideFrom: 0, rideUntil: 100 },
  });
  const result = executeActionPack(
    initial,
    { prefix: ["dismount"], primary: "destroy" },
    counterfactualConfig,
    oracle,
  );
  const dismount = result.timeline.find(
    (event) => event.type === "offGcd" && event.action === "dismount",
  );
  const destroy = result.timeline.find(
    (event) => event.type === "cast" && event.action === "destroy",
  );

  assert.equal(dismount.ride, true);
  assert.equal(dismount.rideCleared, true);
  assert.equal(destroy.ride, false);
});

test("任驰骋成功上马时刷新断魂刺调息", () => {
  const initial = createInitialState(config, {
    rage: 0,
    cooldownReady: { charge: 999 },
  });
  const ridden = executeActionPack(
    initial,
    { primary: "ride" },
    config,
    oracle,
  );
  const ride = ridden.timeline.find(
    (event) => event.type === "cast" && event.action === "ride",
  );

  assert.equal(ride.chargeReadyBeforeReset, 999);
  assert.equal(ride.chargeResetAt, config.rideCastFrames);
  assert.equal(ridden.cooldownReady.charge, config.rideCastFrames);
  assert.doesNotThrow(() =>
    executeActionPack(
      ridden,
      { prefix: ["charge"], primary: "dragonFang" },
      config,
      oracle,
    ),
  );
});

test("橙武窗口采用半开区间并按龙牙施展帧判断", () => {
  const beforeExpiry = createInitialState(config, {
    frame: 95,
    gcdReadyFrame: 95,
    rage: 5,
    buffs: { orangeFrom: 0, orangeUntil: 96 },
  });
  const included = executeActionPack(
    beforeExpiry,
    { primary: "dragonFang" },
    config,
    oracle,
  );
  assert.equal(dragonFangCast(included).orange, true);
  assert.equal(included.rage, 5);

  const atExpiry = createInitialState(config, {
    frame: 96,
    gcdReadyFrame: 96,
    rage: 5,
    buffs: { orangeFrom: 0, orangeUntil: 96 },
  });
  const excluded = executeActionPack(
    atExpiry,
    { primary: "dragonFang" },
    config,
    oracle,
  );
  assert.equal(dragonFangCast(excluded).orange, false);
  assert.equal(excluded.rage, 2);
});

test("状态转移不修改输入状态", () => {
  const initial = createInitialState(config, { rage: 5 });
  executeActionPack(initial, { primary: "dragonFang" }, config, oracle);
  assert.equal(initial.rage, 5);
  assert.equal(initial.dragonRideStacks, 0);
  assert.equal(initial.timeline.length, 0);
});

test("橙武窗口内龙吟没有调息时间", () => {
  const initial = createInitialState(config, { rage: 0 });
  const first = executeActionPack(
    initial,
    { prefix: ["orange"], primary: "dragonRoar" },
    config,
    oracle,
  );
  const second = executeActionPack(
    first,
    { primary: "dragonRoar" },
    config,
    oracle,
  );
  const dragonRoars = second.timeline.filter(
    (event) => event.type === "cast" && event.action === "dragonRoar",
  );

  assert.equal(dragonRoars.length, 2);
  assert.equal(dragonRoars.every((event) => event.orangeNoCooldown), true);
  assert.equal(second.cooldownReady.dragonRoar, 20);
});

test("斩杀阶段两次灭之间不进入CD，第二次灭后开始CD", () => {
  const initial = createInitialState(config, {
    rage: 0,
    executePhase: true,
  });
  const first = executeActionPack(
    initial,
    { primary: "destroy" },
    config,
    oracle,
  );
  assert.equal(
    first.timeline.find((event) => event.action === "destroy").destroySource,
    "normal",
  );
  assert.equal(first.cooldownReady.destroy, 0);
  assert.equal(first.executeDestroyToggle, 1);

  const second = executeActionPack(
    first,
    { primary: "destroy" },
    config,
    oracle,
  );
  assert.equal(
    second.timeline.findLast((event) => event.action === "destroy").destroySource,
    "poLouLanBonus",
  );
  assert.equal(second.executeDestroyToggle, 0);
  assert.equal(second.cooldownReady.destroy, 20 + config.cooldowns.destroy);
});

test("龙吟和灭叠加流血，最新施展技能决定流血品质", () => {
  const initial = createInitialState(config, { rage: 0 });
  const first = executeActionPack(
    initial,
    { prefix: ["orange"], primary: "dragonRoar" },
    config,
    oracle,
  );
  const second = executeActionPack(
    first,
    { primary: "dragonRoar" },
    config,
    oracle,
  );

  assert.equal(first.bleedStacks, 1);
  assert.equal(first.bleedQuality, 1);
  assert.equal(second.bleedStacks, 2);
  assert.equal(second.bleedQuality, 1);

  const destroyed = executeActionPack(
    createInitialState(config, { rage: 2 }),
    { primary: "destroy" },
    config,
    oracle,
  );
  assert.equal(destroyed.bleedStacks, 1);
  assert.equal(destroyed.bleedQuality, 2);
});

test("流血过期后再次施加从一层开始", () => {
  const applied = executeActionPack(
    createInitialState(config, { rage: 2 }),
    { primary: "destroy" },
    config,
    oracle,
  );
  const expired = createInitialState(config, {
    frame: applied.buffs.bleedUntil,
    gcdReadyFrame: applied.buffs.bleedUntil,
    rage: applied.rage,
    bleedStacks: applied.bleedStacks,
    bleedQuality: applied.bleedQuality,
    buffs: applied.buffs,
  });
  const refreshed = executeActionPack(
    expired,
    { primary: "destroy" },
    config,
    oracle,
  );

  assert.equal(refreshed.bleedStacks, 1);
  assert.equal(refreshed.bleedQuality, 2);
});

test("龙牙开启四秒破军窗口，后续技能每次触发一次破军", () => {
  const initial = createInitialState(config, { rage: 5 });
  let state = executeActionPack(
    initial,
    { primary: "dragonFang" },
    config,
    oracle,
  );
  state = executeActionPack(state, { primary: "cloudStrike" }, config, oracle);
  state = executeActionPack(state, { primary: "cloudStrike" }, config, oracle);
  state = executeActionPack(state, { primary: "cloudStrike" }, config, oracle);
  state = executeActionPack(state, { primary: "cloudStrike" }, config, oracle);
  const triggers = state.timeline.filter(
    (event) => event.type === "damage" && event.component === "breakArmy",
  );

  assert.equal(triggers.filter((event) => event.trigger === "dragonFang").length, 2);
  assert.equal(triggers.filter((event) => event.trigger === "cloudStrike").length, 3);
});

test("灭和龙吟不会自行开启破军窗口", () => {
  const destroyed = executeActionPack(
    createInitialState(config, { rage: 2 }),
    { primary: "destroy" },
    config,
    oracle,
  );
  const roared = executeActionPack(
    createInitialState(config, { rage: 2 }),
    { primary: "dragonRoar" },
    config,
    oracle,
  );

  assert.equal(destroyed.buffs.breakArmyUntil, 0);
  assert.equal(roared.buffs.breakArmyUntil, 0);
  assert.equal(
    [...destroyed.timeline, ...roared.timeline].some(
      (event) => event.type === "damage" && event.component === "breakArmy",
    ),
    false,
  );
});

test("断魂刺自身触发一次破军，龙牙窗口内额外触发一次", () => {
  const mounted = {
    mounted: true,
    mountedFrom: 0,
    rage: 0,
    buffs: { rideFrom: 0, rideUntil: 200 },
  };
  const withoutWindow = executeActionPack(
    createInitialState(config, mounted),
    { prefix: ["charge"], primary: "cloudStrike" },
    config,
    oracle,
  );
  const withWindow = executeActionPack(
    createInitialState(config, {
      ...mounted,
      buffs: {
        ...mounted.buffs,
        breakArmyFrom: 0,
        breakArmyUntil: 64,
      },
    }),
    { prefix: ["charge"], primary: "cloudStrike" },
    config,
    oracle,
  );
  const chargeTriggers = (state) => state.timeline.filter(
    (event) =>
      event.type === "damage" &&
      event.component === "breakArmy" &&
      event.trigger === "charge",
  ).length;

  assert.equal(chargeTriggers(withoutWindow), 1);
  assert.equal(chargeTriggers(withWindow), 2);
});

test("突只能马下施展且进入18秒调息", () => {
  const onFoot = executeActionPack(
    createInitialState(config, { rage: 5 }),
    { prefix: ["dash"], primary: "dragonFang" },
    config,
    oracle,
  );
  const dash = onFoot.timeline.find(
    (event) => event.type === "offGcd" && event.action === "dash",
  );
  assert.equal(dash.mounted, false);
  assert.equal(onFoot.cooldownReady.dash, config.cooldowns.dash);
  assert.throws(
    () => executeActionPack(
      createInitialState(config, { mounted: true, mountedFrom: 0 }),
      { prefix: ["dash"], primary: "cloudStrike" },
      config,
      oracle,
    ),
    /突只能在马下施展/,
  );
});

test("突命中破军目标时额外触发一次破军伤害", () => {
  const withoutWindow = executeActionPack(
    createInitialState(config, { rage: 5 }),
    { prefix: ["dash"], primary: "dragonFang" },
    config,
    oracle,
  );
  const withWindow = executeActionPack(
    createInitialState(config, { rage: 5 }),
    {
      primary: "dragonFang",
      tail: [{ id: "dash", leadFrames: 1 }],
    },
    config,
    oracle,
  );
  const dashBreakArmy = (state) => state.timeline.filter(
    (event) =>
      event.type === "damage" &&
      event.component === "breakArmy" &&
      event.trigger === "dash",
  ).length;
  assert.equal(dashBreakArmy(withoutWindow), 0);
  assert.equal(dashBreakArmy(withWindow), 1);
  assert.equal(
    withWindow.timeline.filter(
      (event) => event.type === "damage" && event.component === "dash",
    ).length,
    1,
  );
});
