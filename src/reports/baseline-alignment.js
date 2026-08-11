const COMPONENT_TO_SKILL = Object.freeze({
  autoAttack: "梅花枪法",
  dragonRoar: "龙吟",
  dragonFang: "龙牙",
  dragonBlood: "龙血",
  dragonFangStrain: "新破招(牙)",
  breakGang: "破罡",
  breakArmy: "破军",
  dragonFangDivine: "龙牙·神兵",
  charge: "断魂刺",
  orangeExtra: "画角闻龙",
  destroy: "灭",
  cloudStrike: "穿云",
  kunwuBlade: "昆吾·弦刃",
  renling: "刃凌",
  wuxiuHuang: "无修·荒",
  wristEffect: "特效·腕",
  speedShock: "速·震",
});

function skillForEvent(event) {
  if (event.component === "bleedTick") {
    return Number(event.bleedQuality) === 2 ? "流血-战心" : "流血";
  }
  return COMPONENT_TO_SKILL[event.component] ?? null;
}

export function buildBaselineAlignment(state, reference) {
  const simulatedSkills = {};
  for (const event of state.timeline) {
    if (event.type !== "damage") continue;
    const skill = skillForEvent(event);
    if (!skill) continue;
    const current = simulatedSkills[skill] ?? { count: 0, damage: 0 };
    current.count += Number(event.expectedCount ?? 1);
    current.damage += Number(event.amount);
    simulatedSkills[skill] = current;
  }

  const comparableSkills = new Set([
    ...Object.values(COMPONENT_TO_SKILL),
    "流血",
    "流血-战心",
  ]);
  const excelSkills = reference.skills ?? {};
  const rows = [...comparableSkills]
    .filter((skill) => excelSkills[skill] || simulatedSkills[skill])
    .map((skill) => ({
      skill,
      excelCount: Number(excelSkills[skill]?.count ?? 0),
      simulatedCount: Number(simulatedSkills[skill]?.count ?? 0),
      excelDamage: Number(excelSkills[skill]?.damage ?? 0),
      simulatedDamage: Number(simulatedSkills[skill]?.damage ?? 0),
      damageDelta:
        Number(simulatedSkills[skill]?.damage ?? 0) -
        Number(excelSkills[skill]?.damage ?? 0),
    }));
  const unsupported = Object.entries(excelSkills)
    .filter(([skill]) => !comparableSkills.has(skill))
    .map(([skill, value]) => ({
      skill,
      count: Number(value.count),
      damage: Number(value.damage),
    }));
  const comparableExcelDamage = rows.reduce((sum, row) => sum + row.excelDamage, 0);
  const simulatedDamage = rows.reduce((sum, row) => sum + row.simulatedDamage, 0);
  const unsupportedDamage = unsupported.reduce((sum, row) => sum + row.damage, 0);
  const damageDelta = simulatedDamage - comparableExcelDamage;

  return {
    excelTotalDamage: Number(reference.totalDamage),
    simulatedDamage,
    comparableExcelDamage,
    unsupportedDamage,
    damageDelta,
    damageDeltaPercent:
      comparableExcelDamage === 0 ? 0 : damageDelta / comparableExcelDamage,
    rows,
    unsupported,
  };
}

export const BASELINE_COMPONENT_TO_SKILL = COMPONENT_TO_SKILL;
