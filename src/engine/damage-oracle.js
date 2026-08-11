export function createZeroDamageOracle() {
  return {
    id: "zero-damage",
    evaluateComponent() {
      return 0;
    },
  };
}

export function createIllustrativeDamageOracle() {
  const base = {
    dragonFang: 100,
    dragonBlood: 30,
    dragonFangStrain: 12,
    breakGang: 35,
    breakArmy: 8,
    dragonFangDivine: 4,
    orangeExtra: 70,
    destroy: 45,
    destroyPoLouLan: 40,
    destroyStrain: 12,
    dragonRoar: 55,
    cloudStrike: 25,
    charge: 6,
    bleedTick: 10,
    autoAttack: 8,
    dash: 4,
  };

  return {
    id: "illustrative-relative-damage",
    evaluateComponent(component, snapshot) {
      let value = Number(base[component] ?? 0);
      if (snapshot.thunder) value *= 1.25;
      if (snapshot.ride) value *= 1.08;
      if (component === "dragonFang" && snapshot.dragonRideBonus) value *= 1.45;
      if (component === "bleedTick") {
        value *= Number(snapshot.bleedStacks ?? 1);
        if (snapshot.bleedQuality === 2) value *= 1.2;
      }
      return value;
    },
  };
}
