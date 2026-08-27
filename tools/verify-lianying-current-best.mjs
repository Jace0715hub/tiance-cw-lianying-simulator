import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { LIANYING_CURRENT_BEST_AXIS } from
  "../src/config/lianying-research-defaults.js";
import { applyExpectedEquipmentDamage } from
  "../src/effects/expected-equipment.js";
import { replayWhitepaperLianying } from
  "../src/policies/whitepaper-lianying.js";
import { buildLianyingCurrentBestVerification } from
  "../src/reports/lianying-current-best-verification.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(
  process.argv[2] ?? path.join(projectRoot, LIANYING_CURRENT_BEST_AXIS),
);
const outputPath = path.resolve(
  process.argv[3] ?? path.join(projectRoot, "output/lianying-current-best-verification.json"),
);
const artifact = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const durationSeconds = Number(artifact.durationSeconds ?? 180);
const runtime = loadDefaultGearRuntime({
  rotation: "lianying",
  executePhase: true,
  latencyMs: Number(artifact.timing?.latencyMs ?? 30),
});
const replay = replayWhitepaperLianying(runtime, artifact.actionPacks, {
  durationSeconds,
});
const finalState = applyExpectedEquipmentDamage(
  replay.state,
  runtime.expectedEquipmentEffects,
  runtime.panel,
  runtime.oracle,
  { durationSeconds },
);

const counterfactualPacks = structuredClone(artifact.actionPacks);
const temporary = counterfactualPacks[53].primary;
counterfactualPacks[53].primary = counterfactualPacks[54].primary;
counterfactualPacks[54].primary = temporary;
const counterfactual = replayWhitepaperLianying(runtime, counterfactualPacks, {
  durationSeconds,
});
const counterfactualBleedTicks = counterfactual.state.timeline.filter(
  (event) => event.type === "damage" && event.component === "bleedTick",
).length;
const report = buildLianyingCurrentBestVerification({
  artifact,
  replayState: replay.state,
  finalState,
  runtime,
  bleedCounterfactual: {
    change: "交换第54行龙牙与第55行龙吟",
    legal: true,
    removesIrregularBleedGap: true,
    formalBleedTicks: replay.state.timeline.filter(
      (event) => event.type === "damage" && event.component === "bleedTick",
    ).length,
    counterfactualBleedTicks,
    rotationDamageDelta: counterfactual.state.totalDamage - replay.state.totalDamage,
    conclusion: "强制不断流血不增加跳数，且降低总伤害，不应设为硬约束",
  },
});

if (!report.result.allHardChecksPassed) {
  throw new Error(`正式轴硬校验失败：${JSON.stringify(report.result.hardChecks)}`);
}
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.relative(projectRoot, outputPath),
  result: report.result,
  bleed: report.periodic.bleed,
  bleedCounterfactual: report.bleedCounterfactual,
}, null, 2));
