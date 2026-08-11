import { AoxueCatalog, buildAoxueDamageRow } from "./aoxue-catalog.js";
import { calculateNativeDamage } from "./native-formula.js";
import { calculateFrameTiming } from "../mechanics/timing.js";

export function createNativeDamageOracle({ panel, damageRules = {}, componentRows = {} }) {
  if (!panel || typeof panel !== "object") {
    throw new Error("原生伤害引擎需要一个战斗面板对象");
  }
  const timing = calculateFrameTiming(panel);
  const autoAttackCoefficient = (timing.wideGcdFrames - 1) / 160;
  return {
    id: "native-aoxue-damage-v1",
    evaluateComponent(component, snapshot) {
      const row = buildAoxueDamageRow(component, {
        ...snapshot,
        autoAttackCoefficient,
      }) ?? componentRows[component];
      if (!row) return 0;
      const expectedProcMultiplier = component === "dragonFangDivine"
        ? AoxueCatalog.divineProcChance
        : 1;
      return calculateNativeDamage(row, panel, damageRules).finalDamage *
        expectedProcMultiplier;
    },
  };
}
