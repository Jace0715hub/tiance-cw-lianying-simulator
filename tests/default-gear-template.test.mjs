import test from "node:test";
import assert from "node:assert/strict";
import {
  createGearRuntime,
  loadGearTemplate,
} from "../src/config/gear-template.js";

test("用户提供的大橙武方案生成5段加速默认运行配置", () => {
  const template = loadGearTemplate();
  const runtime = createGearRuntime(template);

  assert.equal(template.source.schemeFile, "天策大橙武5速.json");
  assert.equal(template.sourceCombatSettings["循环选择"], "牧云");
  assert.equal(template.timing.haste, 43002);
  assert.equal(template.timing.segment, 5);
  assert.equal(runtime.config.rotation, "lianying");
  assert.equal(runtime.config.gcdFrames, 19);
  assert.equal(runtime.config.rideCastFrames, 9);
  assert.equal(runtime.config.autoAttackIntervalFrames, 23);
  assert.equal(runtime.config.dotIntervalFrames, 26);
  assert.equal(runtime.panel.rotation, "连营");
  assert.equal(runtime.initialStateOverrides.executePhase, true);
});

test("同一装备模板可以切换为牧云对照而不重算装备面板", () => {
  const template = loadGearTemplate();
  const runtime = createGearRuntime(template, { rotation: "muyun", latencyMs: 60 });

  assert.equal(runtime.config.rotation, "muyun");
  assert.equal(runtime.config.latencyMs, 60);
  assert.equal(runtime.panel.rotation, "牧云");
  assert.equal(runtime.panel.haste, 43002);
});
