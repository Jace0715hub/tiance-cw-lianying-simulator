import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { optimizeLianyingDashOverlay } from "../src/policies/whitepaper-lianying.js";
import {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "../src/reports/whitepaper-axis-export.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(process.argv[2] ?? "");
const templateId = process.argv[3];
if (!process.argv[2] || !templateId) {
  throw new Error("用法：输入协调结果JSON、模板ID、可选输出前缀、可选突搜索束宽");
}
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const optimization = source.search?.axisOptimization ?? source.axisOptimization;
if (!optimization) throw new Error("输入JSON缺少axisOptimization");
const template = optimization.coordination?.proposedTemplates?.find(
  (candidate) => candidate.templateId === templateId,
);
if (!template) throw new Error(`找不到锚点模板：${templateId}`);
const candidate = optimization.coreScheduleCandidates?.find(
  (entry) => JSON.stringify(entry.anchorRows) === JSON.stringify(template.anchorRows),
);
if (!candidate?.packs) {
  throw new Error(`模板${templateId}没有可导出的核心动作包`);
}

const durationSeconds = Number(source.durationSeconds ?? 180);
const dashStates = Math.max(1, Math.floor(Number(process.argv[5] ?? 256)));
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
  durationSeconds,
  maxStatesPerRow: dashStates,
});
const searchResult = {
  durationSeconds,
  mode: source.mode ?? "fixed",
  policyMode: "free",
  beamWidth: null,
  explored: 0,
  legal: 0,
  warmStarted: true,
  warmStartCount: 1,
  warmStartDamages: [candidate.bestCoreDamage],
  warmStartDamage: candidate.bestCoreDamage,
  telemetry: null,
  packs: dash.packs,
  state: dash.state,
  axisOptimization: {
    kind: "exported-anchor-core-candidate",
    sourcePath: path.relative(projectRoot, inputPath),
    templateId,
    anchorRows: template.anchorRows,
    coreDamage: candidate.bestCoreDamage,
    dashStates,
    dashCount: dash.dashCount,
    damageGainFromDash: dash.state.totalDamage - candidate.bestCoreDamage,
  },
};
const artifact = buildWhitepaperAxisArtifact(searchResult, runtime, {
  durationSeconds,
  mode: source.mode ?? "fixed",
});
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[4] ?? path.join(parsed.dir, `${parsed.name}-${templateId}`),
);
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(`${outputStem}.csv`, `\uFEFF${whitepaperAxisToCsv(artifact)}\n`);
fs.writeFileSync(
  `${outputStem}-equipment.csv`,
  `\uFEFF${whitepaperEquipmentToCsv(artifact)}\n`,
);
console.log(JSON.stringify({
  inputPath,
  outputStem,
  templateId,
  anchorRows: template.anchorRows,
  coreDamage: candidate.bestCoreDamage,
  finalRotationDamage: dash.state.totalDamage,
  damageGainFromDash: dash.state.totalDamage - candidate.bestCoreDamage,
  dashCount: dash.dashCount,
  rotationDps: artifact.summary.rotationDps,
  totalDps: artifact.summary.dps,
  mechanics: artifact.audit.mechanics,
}, null, 2));
