import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceRootInput = process.argv[2] ?? process.env.JX3_TIAN_CE_SOURCE;
if (!sourceRootInput) {
  throw new Error("请传入原配装器目录，或设置JX3_TIAN_CE_SOURCE环境变量");
}
const sourceRoot = path.resolve(sourceRootInput);
const schemePath = path.resolve(
  process.argv[3] ?? path.join(sourceRoot, "../天策大橙武5速.json"),
);
const projectRoot = path.resolve(import.meta.dirname, "..");
const dataPath = path.join(sourceRoot, "public/data/jx3-tiance-data.json");
const outputPath = path.join(projectRoot, "data/default-gear-template.json");

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(sourceRoot, relativePath)).href;
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const schemeContents = fs.readFileSync(schemePath, "utf8");
const [
  { indexData },
  { getGearDataVersion, restoreGearStateFile },
  { calculatePanel },
  { calculateCombatPanel },
  { calculateHasteTiming },
  { resolveConditionalSources, applyConditionalDamageRows },
] = await Promise.all([
  import(moduleUrl("public/src/data.js")),
  import(moduleUrl("public/src/persistence.js")),
  import(moduleUrl("public/src/calc/panel.js")),
  import(moduleUrl("public/src/calc/combat-panel.js")),
  import(moduleUrl("public/src/calc/dps.js")),
  import(moduleUrl("public/src/calc/conditional-sources.js")),
]);

const indexedData = indexData(data);
const dataVersion = getGearDataVersion(data);
const restored = restoreGearStateFile(
  schemeContents,
  indexedData,
  data,
  dataVersion,
);
const sourceCombatSettings = structuredClone(restored.combat);
// 原配装器产品层禁止大橙武与连营组合；研究模板需要显式覆盖循环。
restored.combat["循环选择"] = "连营";
const combatPanel = calculateCombatPanel(
  calculatePanel(restored, indexedData, data),
  restored,
  indexedData,
  data,
);
const timing = calculateHasteTiming(combatPanel);
const conditional = resolveConditionalSources(restored, indexedData, data);
const effectComponents = new Map([
  ["昆吾·弦刃", "kunwuBlade"],
  ["刃凌", "renling"],
  ["无修·荒", "wuxiuHuang"],
  ["特效·腕", "wristEffect"],
  ["速·震", "speedShock"],
]);
const expectedEquipmentEffects = applyConditionalDamageRows(
  data.damageModel.phases.nonExecute.rows,
  conditional,
  combatPanel,
)
  .filter((row) => effectComponents.has(row.skill))
  .map((row) => {
    const source = conditional.sourceById.get(row.conditionalSourceId);
    const { count: _count, finalDamage: _finalDamage, ...damageRow } = row;
    return {
      component: effectComponents.get(row.skill),
      skill: row.skill,
      damageRow,
      countRule: structuredClone(source.rowScaling.count),
    };
  });

const template = {
  schemaVersion: 1,
  source: {
    schemeFile: path.basename(schemePath),
    schemeFormat: "jx3-tiance-gear-scheme",
    dataVersion: String(dataVersion).replace(/^.*[\\/]/, ""),
    extractedData: path.basename(data.source ?? dataPath),
    note: "装备、增益和阵法来自保存方案；循环由牧云覆盖为连营用于研究。",
  },
  sourceCombatSettings,
  defaultSimulation: {
    rotation: "lianying",
    executePhase: false,
    durationSeconds: Number(combatPanel.durationSeconds),
  },
  timing: {
    haste: Number(combatPanel.haste),
    latencyMs: Number(combatPanel.latencyMs),
    gcdSeconds: Number(timing.gcd),
    rideGcdSeconds: Number(timing.rideGcd),
    wideGcdSeconds: Number(timing.wideGcd),
    dotIntervalSeconds: Number(timing.dotInterval),
    segment: Number(timing.segment),
  },
  damageRules: {
    nonPlayerDamageBonus: Number(data.damageModel.nonPlayerDamageBonus ?? 0),
    dragonFangDivineProcChance: 307 / 1024,
  },
  expectedEquipmentEffects,
  state: restored,
  combatPanel,
};

fs.writeFileSync(outputPath, `${JSON.stringify(template, null, 2)}\n`);
console.log(`已生成 ${outputPath}`);
console.log(
  `加速 ${combatPanel.haste}，${timing.segment}段，GCD ${timing.gcd}s，延迟 ${combatPanel.latencyMs}ms`,
);
