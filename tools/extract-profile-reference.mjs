import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(
  process.argv[2] ?? path.join(projectRoot, "../TianCe/public/data/jx3-tiance-data.json"),
);
const outputPath = path.resolve(
  process.argv[3] ?? path.join(projectRoot, "data/excel-v1.3-profile-reference.json"),
);
const sourceRoot = path.resolve(path.dirname(sourcePath), "../..");
const schemePath = path.resolve(sourceRoot, "../天策大橙武5速.json");
const gearTemplate = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "data/default-gear-template.json"), "utf8"),
);
const durationSeconds = Number(gearTemplate.defaultSimulation.durationSeconds);
const gcdSeconds = Number(gearTemplate.timing.gcdSeconds);
// 保留战斗截止前的最后一次起手，即使该技能的GCD结束时刻超过战斗时间。
const rowCount = Math.floor(durationSeconds / gcdSeconds) + 1;

function findSkillCounts(value) {
  if (!value || typeof value !== "object") return null;
  if (value.profileColumns) return value;
  for (const child of Object.values(value)) {
    const found = findSkillCounts(child);
    if (found) return found;
  }
  return null;
}

function extractRows(columns, prefix) {
  const skills = columns[`${prefix}-1`];
  const resources = columns[`${prefix}-2`];
  const resourcesAfter = columns[`${prefix}-3`];
  if (!skills || !resources || !resourcesAfter) {
    throw new Error(`缺少技能表列: ${prefix}`);
  }
  return Array.from({ length: rowCount }, (_, index) => ({
    skill: String(skills[index] ?? ""),
    resourceBefore: Number(resources[index]),
    resourceAfter: Number(resourcesAfter[index]),
  }));
}

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const skillCounts = findSkillCounts(source);
if (!skillCounts) throw new Error("未找到技能表 profileColumns");

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(sourceRoot, relativePath)).href;
}

const [
  { indexData },
  { restoreGearStateFile, getGearDataVersion },
  { calculatePanel },
  { calculateCombatPanel },
  { calculateDamagePhase },
  { resolveConditionalSources, applyConditionalDamageRows },
] = await Promise.all([
  import(moduleUrl("public/src/data.js")),
  import(moduleUrl("public/src/persistence.js")),
  import(moduleUrl("public/src/calc/panel.js")),
  import(moduleUrl("public/src/calc/combat-panel.js")),
  import(moduleUrl("public/src/calc/dps.js")),
  import(moduleUrl("public/src/calc/conditional-sources.js")),
]);
const indexedData = indexData(source);
const schemeContents = fs.readFileSync(schemePath, "utf8");

function calculateReference(rotation) {
  const state = restoreGearStateFile(
    schemeContents,
    indexedData,
    source,
    getGearDataVersion(source),
  );
  state.combat["循环选择"] = rotation;
  state.combat["目标选择"] = "134级木桩";
  const panel = calculateCombatPanel(
    calculatePanel(state, indexedData, source),
    state,
    indexedData,
    source,
  );
  const conditional = resolveConditionalSources(state, indexedData, source);
  const phase = calculateDamagePhase(
    panel,
    {
      ...source.damageModel.phases.nonExecute,
      bloodConsumptionMode: source.damageModel.bloodConsumptionMode,
      rows: applyConditionalDamageRows(
        source.damageModel.phases.nonExecute.rows,
        conditional,
        panel,
      ),
    },
    { nonPlayerDamageBonus: Number(source.damageModel.nonPlayerDamageBonus ?? 0) },
  );
  const skills = {};
  for (const row of phase.rows) {
    if (Number(row.count) === 0) continue;
    const current = skills[row.skill] ?? { count: 0, damage: 0 };
    current.count += Number(row.count);
    current.damage += Number(row.totalDamage);
    skills[row.skill] = current;
  }
  return {
    totalDamage: phase.totalDamage,
    dps: phase.dps,
    durationSeconds: phase.duration,
    skills,
  };
}

const prefixes = {
  lianying: `连营-${gearTemplate.timing.segment}段加速`,
  muyunOrange: `牧云-${gearTemplate.timing.segment}段加速-CW`,
};
const fixture = {
  schemaVersion: 1,
  source: "傲血配装计算器暗影千机测试版ver1.3离线拆解数据",
  validationOnly: true,
  durationSeconds,
  timing: {
    haste: gearTemplate.timing.haste,
    latencyMs: gearTemplate.timing.latencyMs,
    gcdSeconds,
    segment: gearTemplate.timing.segment,
    rowCount,
  },
  profiles: Object.fromEntries(
    Object.entries(prefixes).map(([id, prefix]) => [
      id,
      { prefix, rows: extractRows(skillCounts.profileColumns, prefix) },
    ]),
  ),
  references: {
    lianying: calculateReference("连营"),
    muyunOrange: calculateReference("牧云"),
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`已写入 ${outputPath}`);
