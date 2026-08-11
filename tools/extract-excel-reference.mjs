import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceRootInput = process.argv[2] ?? process.env.JX3_TIAN_CE_SOURCE;
if (!sourceRootInput) {
  throw new Error("请传入原配装器目录，或设置JX3_TIAN_CE_SOURCE环境变量");
}
const sourceRoot = path.resolve(sourceRootInput);
const projectRoot = path.resolve(import.meta.dirname, "..");
const dataPath = path.join(sourceRoot, "public/data/jx3-tiance-data.json");
const schemePath = path.resolve(
  process.argv[3] ?? path.join(sourceRoot, "../天策大橙武5速.json"),
);

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(sourceRoot, relativePath)).href;
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const [{ indexData }, { restoreGearStateFile, getGearDataVersion }, { calculatePanel },
  { calculateCombatPanel }, { resolveConditionalSources, applyConditionalDamageRows },
  { calculateDamageRow, calculateHasteTiming }] =
  await Promise.all([
    import(moduleUrl("public/src/data.js")),
    import(moduleUrl("public/src/persistence.js")),
    import(moduleUrl("public/src/calc/panel.js")),
    import(moduleUrl("public/src/calc/combat-panel.js")),
    import(moduleUrl("public/src/calc/conditional-sources.js")),
    import(moduleUrl("public/src/calc/dps.js")),
  ]);

const indexedData = indexData(data);
const state = restoreGearStateFile(
  fs.readFileSync(schemePath, "utf8"),
  indexedData,
  data,
  getGearDataVersion(data),
);
// 原配装器出于产品限制禁止该组合；研究项目必须显式构造它。
state.combat["循环选择"] = "连营";
const weapon = indexedData.equipmentById.get(state.slots["长兵"].itemId);

const rawPanel = calculatePanel(state, indexedData, data);
const combatPanel = calculateCombatPanel(rawPanel, state, indexedData, data);
const conditional = resolveConditionalSources(state, indexedData, data);
const timing = calculateHasteTiming(combatPanel);
const plumBlossomAttackCoefficient = Math.floor(timing.wideGcd * 16 - 1) / 160;
const relevantSkills = new Set([
  "龙牙",
  "龙血",
  "新破招(牙)",
  "破罡",
  "破军",
  "龙牙·神兵",
  "灭",
  "灭-自身",
  "灭-破楼兰",
  "新破招(灭)",
  "龙吟",
  "穿云",
  "流血",
  "流血-战心",
  "梅花枪法",
  "画角闻龙",
  "突",
  "断魂刺",
]);

const phases = Object.fromEntries(
  Object.entries(data.damageModel.phases).map(([phaseName, phase]) => {
    const rows = applyConditionalDamageRows(phase.rows, conditional, combatPanel)
      .filter((row) => relevantSkills.has(row.skill))
      .map((row) => {
        const resolvedRow = row.skill === "梅花枪法"
          ? { ...row, attackCoefficient: plumBlossomAttackCoefficient }
          : row;
        return {
        ...resolvedRow,
        goldenDamage: calculateDamageRow(resolvedRow, combatPanel, {
          nonPlayerDamageBonus: Number(data.damageModel.nonPlayerDamageBonus ?? 0),
          forceExecuteCrit: phaseName === "execute",
        }).finalDamage,
      };
      });
    return [phaseName, { rows }];
  }),
);

const reference = {
  schemaVersion: 1,
  source: {
    workbook: "傲血配装计算器暗影千机测试版ver1.3(202607302030).xlsx",
    extractedData: path.basename(data.source ?? dataPath),
    generatedFrom: path.relative(sourceRoot, dataPath),
    weapon: { id: weapon.id, displayName: weapon.displayName },
    rotation: "连营",
    schemeFile: path.basename(schemePath),
    note: "由用户提供的5段加速大橙武方案生成；循环覆盖为连营，技能次数轴未复用。",
  },
  damageRules: {
    nonPlayerDamageBonus: Number(data.damageModel.nonPlayerDamageBonus ?? 0),
    dragonFangDivineProcChance: 307 / 1024,
  },
  activeConditionalSourceIds: [...conditional.activeSourceIds].sort(),
  combatPanel,
  phases,
};

const outputPath = path.join(projectRoot, "data/excel-v1.3-reference.json");
fs.writeFileSync(outputPath, `${JSON.stringify(reference, null, 2)}\n`);
console.log(`已生成 ${outputPath}`);
console.log(`非斩杀行数: ${phases.nonExecute.rows.length}`);
console.log(`斩杀行数: ${phases.execute.rows.length}`);
console.log(`加速: ${combatPanel.haste}, 延迟: ${combatPanel.latencyMs}ms`);
