export function calculateNativeDamage(row, combatPanel, damageRules = {}) {
  const tags = String(row.tags ?? "");
  const constantDamage = tags === "恒定伤害";
  const dynamic = tags !== "" && !constantDamage;
  const rules = combatPanel.rules ?? {};
  const baseAttack = Number(combatPanel.damageBaseAttack ?? combatPanel.baseAttack ?? 0);
  const damageAttack = Number(combatPanel.damageAttack ?? combatPanel.attack ?? 0);
  const dynamicAttackBonus =
    (tags.includes("渊") && Number(rules.abyssTalentEnabled ?? 0) > 0
      ? Math.floor((baseAttack * Number(rules.abyssAttackBonus ?? 358)) / 1024)
      : 0) +
    (tags.includes("驰骋")
      ? Math.floor(
          (baseAttack *
            (Number(rules.rideAttackBase ?? 153) +
              Number(rules.rideAttackBonus ?? 154))) /
            1024,
        )
      : 0);
  const attack = dynamic
    ? damageAttack + dynamicAttackBonus
    : Number(combatPanel.attack ?? 0) + Number(row.attackBonus ?? 0);
  const weaponDamage =
    (Number(combatPanel.damageWeaponDamageMin ?? combatPanel.weaponDamageMin ?? 0) +
      Number(combatPanel.damageWeaponDamageMax ?? combatPanel.weaponDamageMax ?? 0)) /
    2;
  const strainDamage = Number(row.strainCoefficient ?? 0) > 0
    ? Math.max(
        1,
        Number(row.strainCoefficient) *
          Number(combatPanel.damageStrain ?? combatPanel.strain ?? 0) *
          Number(row.strainMultiplier ?? 1),
      )
    : 0;
  const rawDamage =
    (Number(row.fixedDamage ?? 0) +
      Number(row.attackCoefficient ?? 0) * attack +
      Number(row.weaponCoefficient ?? 0) * weaponDamage +
      strainDamage) *
    Number(row.stackCount ?? 1);

  const penetrationRate = constantDamage
    ? 0
    : Number(combatPanel.penetrationRate ?? 0) +
      Number(row.penetrationBonus ?? 0) +
      Number(combatPanel.damagePenetrationRateDelta ?? 0);
  const baselineReduction = 4655;
  const defenseRateForReduction = (reduction, percentReduction, ignoreDefense = 0) => {
    const thunderIgnoreDefense = tags.includes("雷")
      ? Number(rules.thunderIgnoreDefense ?? 717)
      : 0;
    const defense =
      ((83679 - reduction) * (1024 - percentReduction)) / 1024 *
      (1024 - ignoreDefense - thunderIgnoreDefense) / 1024;
    return defense / (defense + 155408.88);
  };
  const defenseRate = constantDamage
    ? 0
    : Number(row.defenseRate ?? 0) +
      defenseRateForReduction(
        Number(combatPanel.enemyDefenseReduction ?? baselineReduction),
        Number(combatPanel.enemyDefensePercentReduction ?? 34),
        Number(combatPanel.ignoreDefenseLevel ?? 0),
      ) -
      defenseRateForReduction(baselineReduction, 34, 0);
  const damageAddPercentDelta =
    Number(combatPanel.damageAddPercentDelta ?? 0) -
    (constantDamage ? Number(combatPanel.formationDamageAddPercentDelta ?? 0) : 0);
  const postDefenseDamage =
    rawDamage *
    (1 + Number(row.damageBonus ?? 0) + damageAddPercentDelta / 1024) *
    (1 + penetrationRate) *
    (1 - defenseRate);

  const cloudMatch = tags.match(/牧云([1-4A])/);
  const cloudStacks = cloudMatch ? (cloudMatch[1] === "A" ? 1 : Number(cloudMatch[1])) : 0;
  const usesCloudTalent = combatPanel.rotation !== "连营";
  const damageUnshielded = Number(combatPanel.damageUnshielded ?? combatPanel.unshielded ?? 0);
  const dynamicCloudUnshielded = usesCloudTalent && cloudStacks > 0
    ? Math.floor(
        (cloudStacks * damageUnshielded * Number(rules.cloudUnshieldedPercent ?? 204)) /
          1024,
      ) / Number(rules.unshieldedCoefficient ?? 1)
    : 0;
  const unshieldedRate = constantDamage
    ? 0
    : dynamic
      ? Number(
          combatPanel.damageUnshieldedRateRaw ??
            combatPanel.unshieldedRateRaw ??
            combatPanel.unshieldedRate ??
            0,
        ) + dynamicCloudUnshielded
      : Number(combatPanel.unshieldedRateRaw ?? combatPanel.unshieldedRate ?? 0) +
        Number(row.unshieldedBonus ?? 0);
  const postUnshieldedDamage =
    postDefenseDamage * Number(row.levelMultiplier ?? 1) * (1 + unshieldedRate);
  const forceExecuteCrit = damageRules.forceExecuteCrit &&
    String(row.notes ?? "").includes("斩杀会心");
  const critRate = constantDamage
    ? 0
    : (forceExecuteCrit ? 1 : Number(row.critFloor ?? 0)) +
      (forceExecuteCrit ? 0 : Number(row.critScale ?? 1)) *
        Math.min(
          1,
          Number(combatPanel.damageCritRate ?? combatPanel.critRate ?? 0) +
            Number(row.critChanceBonus ?? 0) +
            Number(combatPanel.skillCritChanceBonuses?.[row.skill] ?? 0) -
            (usesCloudTalent
              ? 0
              : cloudStacks * Number(rules.cloudCritChancePerStack ?? 0.06)),
        );
  const critEffect =
    Number(
      combatPanel.damageCritEffectRaw ??
        combatPanel.critEffectRaw ??
        combatPanel.critEffect ??
        1,
    ) +
    Number(row.critEffectBonus ?? 0) -
    (usesCloudTalent
      ? 0
      : cloudStacks * Number(rules.cloudCritEffectPerStack ?? 0.25));
  const expectedCritMultiplier = 1 + critRate * (critEffect - 1);
  const vulnerability =
    Number(row.vulnerability ?? 0) +
    Number(combatPanel.vulnerabilityLevelDelta ?? 0) / 1024;
  const appliesNonPlayerDamageBonus =
    row.appliesNonPlayerDamageBonus ?? Number(row.nonPlayerBonus ?? 0) !== 0;
  const nonPlayerDamageBonus = appliesNonPlayerDamageBonus
    ? Number(damageRules.nonPlayerDamageBonus ?? row.nonPlayerBonus ?? 0)
    : 0;
  const finalDamage =
    postUnshieldedDamage *
    expectedCritMultiplier *
    (1 + nonPlayerDamageBonus) *
    (1 + vulnerability);

  return {
    attack,
    weaponDamage,
    strainDamage,
    rawDamage,
    penetrationRate,
    defenseRate,
    postDefenseDamage,
    unshieldedRate,
    postUnshieldedDamage,
    critRate,
    critEffect,
    expectedCritMultiplier,
    nonPlayerDamageBonus,
    vulnerability,
    finalDamage,
  };
}
