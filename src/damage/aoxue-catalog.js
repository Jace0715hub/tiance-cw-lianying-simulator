const COMMON = Object.freeze({
  strainMultiplier: 1,
  stackCount: 1,
  penetrationBonus: 0.015872446866137757,
  levelMultiplier: 0.8,
  unshieldedBonus: 0.7518283444463698,
  critScale: 1,
  critFloor: 0,
  critEffectBonus: 0.25,
  vulnerability: 0.0205078125,
  appliesNonPlayerDamageBonus: true,
});

const BASE_RAGE_DAMAGE_BONUS = Object.freeze({
  0: 0.09874314692978516,
  1: 0.14854783442978514,
  2: 0.19835252192978514,
  3: 0.24913377192978514,
  4: 0.29893845942978514,
  5: 0.34874314692978514,
});

const COMPONENTS = Object.freeze({
  dragonFang: {
    skill: "龙牙",
    fixedDamage: 229.5,
    attackCoefficient: 5.31875,
    weaponCoefficient: 1,
    resourceScaled: true,
    rageDamageBonusOffset: 0.0498046875,
    manualCritChance: 0.04,
  },
  dragonBlood: {
    skill: "龙血",
    fixedDamage: 22.5,
    attackCoefficient: 1.59375,
    weaponCoefficient: 1,
    resourceScaled: true,
    rageDamageBonusOffset: 0.0498046875,
    manualCritChance: 0.04,
  },
  dragonFangStrain: {
    skill: "新破招(牙)",
    fixedDamage: 0,
    attackCoefficient: 0,
    weaponCoefficient: 0,
    strainCoefficient: 0.5791492462158203,
    strainMultiplier: 8.534,
    damageBonus: 0.028430646929785156,
  },
  breakGang: {
    skill: "破罡",
    fixedDamage: 318.5,
    attackCoefficient: 1.875,
    weaponCoefficient: 0,
    damageBonus: 0.6280400219297851,
  },
  breakArmy: {
    skill: "破军",
    fixedDamage: 318.5,
    attackCoefficient: 0.525,
    weaponCoefficient: 1,
    damageBonus: 0.6280400219297851,
  },
  dragonFangDivine: {
    skill: "龙牙·神兵",
    fixedDamage: 1,
    attackCoefficient: 0.3125,
    weaponCoefficient: 0,
    damageBonus: 0.028430646929785156,
  },
  orangeExtra: {
    skill: "画角闻龙",
    fixedDamage: 522,
    attackCoefficient: 3.84375,
    weaponCoefficient: 0,
    damageBonus: 0.5284306469297851,
  },
  destroy: {
    skill: "灭",
    fixedDamage: 213,
    attackCoefficient: 2.6125,
    weaponCoefficient: 1,
    resourceScaled: true,
    manualCritChance: 0.03,
  },
  destroyPoLouLan: {
    skill: "灭-破楼兰",
    fixedDamage: 60,
    attackCoefficient: 2.6125,
    weaponCoefficient: 0.25,
    resourceScaled: true,
    manualCritChance: 0.03,
  },
  destroyStrain: {
    skill: "新破招(灭)",
    fixedDamage: 0,
    attackCoefficient: 0,
    weaponCoefficient: 0,
    strainCoefficient: 0.5791492462158203,
    strainMultiplier: 8.534,
    damageBonus: 0.028430646929785156,
    ignoresRideTag: true,
  },
  dragonRoar: {
    skill: "龙吟",
    fixedDamage: 200.5,
    attackCoefficient: 3.99375,
    weaponCoefficient: 1,
    resourceScaled: true,
    rageDamageBonusOffset: 0.099609375,
  },
  cloudStrike: {
    skill: "穿云",
    fixedDamage: 167.5,
    attackCoefficient: 2.66875,
    weaponCoefficient: 1,
    resourceScaled: true,
    rageDamageBonusOffset: 0.0498046875,
    manualCritChance: 0.05,
  },
  charge: {
    skill: "断魂刺",
    fixedDamage: 40.5,
    attackCoefficient: 0.1,
    weaponCoefficient: 1,
    damageBonus: 0.09874314692978516,
  },
  bleedTick: {
    skill: "流血",
    fixedDamage: 60,
    attackCoefficient: 0.8055803571428573,
    weaponCoefficient: 0,
    damageBonus: 0.028430646929785156,
    bleedScaled: true,
  },
  autoAttack: {
    skill: "梅花枪法",
    fixedDamage: 0,
    attackCoefficient: 0,
    weaponCoefficient: 1,
    damageBonus: 0.22862595942978514,
    autoAttackScaled: true,
  },
  dash: {
    skill: "突",
    fixedDamage: 38.5,
    attackCoefficient: 0.1,
    weaponCoefficient: 0,
    damageBonus: 0.09874314692978516,
  },
});

function tagsFor(component, definition, snapshot) {
  const resource = definition.bleedScaled
    ? `${snapshot.bleedStacks}层`
    : definition.resourceScaled
    ? `${snapshot.rageBeforeCast}豆`
    : "";
  const thunder = snapshot.thunder ? "雷" : "";
  const ride = snapshot.ride && !definition.ignoresRideTag ? "驰骋" : "";
  const dragonRide = component === "dragonFang" && snapshot.dragonRideBonus
    ? "龙驭"
    : "";
  return `${resource}${thunder}${ride}${dragonRide}${definition.bleedScaled ? "牧云A" : "牧云1"}`;
}

export function buildAoxueDamageRow(component, snapshot) {
  const baseDefinition = COMPONENTS[component];
  const definition = component === "bleedTick" && Number(snapshot.bleedQuality) === 2
    ? {
        ...baseDefinition,
        skill: "流血-战心",
        attackCoefficient: 0.966294642857143,
      }
    : baseDefinition;
  if (!definition) return null;
  if (
    definition.bleedScaled &&
    (!Number.isInteger(snapshot.bleedStacks) || snapshot.bleedStacks < 1 || snapshot.bleedStacks > 3)
  ) {
    throw new Error(`尚未标定${snapshot.bleedStacks}层${definition.skill}伤害参数`);
  }
  const rageDamageBonus = definition.resourceScaled
    ? BASE_RAGE_DAMAGE_BONUS[snapshot.rageBeforeCast]
    : undefined;
  if (definition.resourceScaled && rageDamageBonus === undefined) {
    throw new Error(`尚未标定${snapshot.rageBeforeCast}豆${definition.skill}伤害参数`);
  }
  const dragonRideVulnerability =
    component === "dragonFang" && snapshot.dragonRideBonus ? 0.4501953125 : 0;
  return {
    ...COMMON,
    ...definition,
    attackCoefficient: definition.autoAttackScaled
      ? Number(snapshot.autoAttackCoefficient)
      : definition.attackCoefficient,
    stackCount: definition.bleedScaled
      ? Number(snapshot.bleedStacks)
      : Number(definition.stackCount ?? COMMON.stackCount),
    tags: tagsFor(component, definition, snapshot),
    defenseRate: snapshot.thunder ? 0.12845387536106612 : 0.32958230397716,
    critChanceBonus:
      (snapshot.thunder ? 0.36 : 0.06) + Number(definition.manualCritChance ?? 0),
    damageBonus: rageDamageBonus === undefined
      ? definition.damageBonus
      : rageDamageBonus + Number(definition.rageDamageBonusOffset ?? 0),
    vulnerability: COMMON.vulnerability + dragonRideVulnerability,
  };
}

export const AoxueCatalog = Object.freeze({
  components: Object.freeze(Object.keys(COMPONENTS)),
  divineProcChance: 307 / 1024,
});
