import fs from "node:fs";
import { createNativeDamageOracle } from "../damage/native-damage-oracle.js";
import { createTimedConfig } from "../mechanics/timing.js";

export const DEFAULT_GEAR_TEMPLATE_URL = new URL(
  "../../data/default-gear-template.json",
  import.meta.url,
);

export function loadGearTemplate(url = DEFAULT_GEAR_TEMPLATE_URL) {
  const template = JSON.parse(fs.readFileSync(url, "utf8"));
  if (template?.schemaVersion !== 1) throw new Error("默认配装模板结构版本不兼容");
  if (!template.combatPanel || !template.timing) throw new Error("默认配装模板缺少战斗面板");
  return template;
}

export function createGearRuntime(
  template,
  {
    rotation = template?.defaultSimulation?.rotation ?? "lianying",
    latencyMs = template?.timing?.latencyMs,
    executePhase = template?.defaultSimulation?.executePhase ?? false,
    configOverrides = {},
  } = {},
) {
  if (!["lianying", "muyun"].includes(rotation)) {
    throw new Error(`未知输出循环: ${rotation}`);
  }
  const panel = {
    ...template.combatPanel,
    rotation: rotation === "lianying" ? "连营" : "牧云",
    latencyMs: Number(latencyMs),
  };
  const config = createTimedConfig(
    { haste: Number(panel.haste), latencyMs: Number(latencyMs) },
    {
      ...configOverrides,
      rotation,
      label: configOverrides.label ??
        `gear-template-${template.timing.segment}-speed-${rotation}-${latencyMs}ms`,
    },
  );
  const oracle = createNativeDamageOracle({
    panel,
    damageRules: {
      nonPlayerDamageBonus: Number(template.damageRules?.nonPlayerDamageBonus ?? 0),
    },
    componentRows: Object.fromEntries(
      (template.expectedEquipmentEffects ?? []).map((effect) => [
        effect.component,
        effect.damageRow,
      ]),
    ),
  });
  return {
    template,
    panel,
    config,
    oracle,
    expectedEquipmentEffects: template.expectedEquipmentEffects ?? [],
    initialStateOverrides: { executePhase: Boolean(executePhase) },
  };
}

export function loadDefaultGearRuntime(options = {}) {
  return createGearRuntime(loadGearTemplate(), options);
}
