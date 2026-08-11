import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { searchWhitepaperLianying } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";

const fixedBeamWidth = Number(process.argv[2] ?? 48);
const stableBeamWidth = Number(process.argv[3] ?? 16);
const durationSeconds = Number(process.argv[4] ?? 180);
const trainingDurationSeconds = Number(process.argv[5] ?? 600);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.resolve(process.argv[6] ?? path.join(projectRoot, "output"));
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });

const fixedSearch = searchWhitepaperLianying(runtime, {
  durationSeconds,
  mode: "fixed",
  beamWidth: fixedBeamWidth,
});
const stableSearch = searchWhitepaperLianying(runtime, {
  durationSeconds: trainingDurationSeconds,
  mode: "stable",
  beamWidth: stableBeamWidth,
});
const fixed = buildWhitepaperAxisArtifact(fixedSearch, runtime, {
  durationSeconds,
  mode: "fixed",
});
const stable = buildWhitepaperAxisArtifact(stableSearch, runtime, {
  durationSeconds,
  mode: "stable",
});
const comparison = {
  schemaVersion: 1,
  durationSeconds,
  fixed: {
    dps: fixed.summary.dps,
    totalDamage: fixed.summary.totalDamage,
    finalDragonRideStacks: fixed.audit.dragonRide.finalStacks,
    terminalLiquidationFangs: fixed.audit.dragonRide.terminalLiquidationFangs,
    rotationDps: fixed.summary.rotationDps,
    equipmentAndDamageEnchantDps: fixed.summary.equipmentAndDamageEnchantDps,
  },
  stable: {
    dps: stable.summary.dps,
    totalDamage: stable.summary.totalDamage,
    finalDragonRideStacks: stable.audit.dragonRide.finalStacks,
    rotationDps: stable.summary.rotationDps,
    equipmentAndDamageEnchantDps: stable.summary.equipmentAndDamageEnchantDps,
  },
  fixedAdvantage: {
    damage: fixed.summary.totalDamage - stable.summary.totalDamage,
    dps: fixed.summary.dps - stable.summary.dps,
    relative: fixed.summary.totalDamage / stable.summary.totalDamage - 1,
  },
};

fs.mkdirSync(outputDirectory, { recursive: true });
for (const [name, artifact] of [["fixed", fixed], ["stable", stable]]) {
  fs.writeFileSync(
    path.join(outputDirectory, `whitepaper-${name}-${durationSeconds}s.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDirectory, `whitepaper-${name}-${durationSeconds}s.csv`),
    `\uFEFF${whitepaperAxisToCsv(artifact)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDirectory, `whitepaper-${name}-${durationSeconds}s-equipment.csv`),
    `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
    "utf8",
  );
}
fs.writeFileSync(
  path.join(outputDirectory, `whitepaper-comparison-${durationSeconds}s.json`),
  `${JSON.stringify(comparison, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  outputDirectory,
  fixed: {
    rows: fixed.rows.length,
    dps: fixed.summary.dps,
    audit: fixed.audit,
  },
  stable: {
    rows: stable.rows.length,
    dps: stable.summary.dps,
    audit: stable.audit,
  },
  comparison: comparison.fixedAdvantage,
}, null, 2));
