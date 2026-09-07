import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  extractLianyingAnchorTemplate,
  lianyingAnchorTemplateToCsv,
} from "../src/reports/lianying-anchor-template.js";
import { lianyingRowsToActionPacks } from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[3] ?? path.join(parsed.dir, `${parsed.name}-anchor-template`),
);
const artifact = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (!artifact.actionPacks && !Array.isArray(artifact.rows)) {
  throw new Error(`输入文件没有actionPacks或rows技能轴: ${inputPath}`);
}
const actionPacks = artifact.actionPacks ?? lianyingRowsToActionPacks(artifact.rows);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const report = extractLianyingAnchorTemplate(runtime, actionPacks, {
  durationSeconds: artifact.durationSeconds ?? 180,
});
const output = {
  ...report,
  source: path.relative(projectRoot, inputPath),
  sourceDamage: artifact.damageAccounting?.combinedDamage ??
    artifact.summary?.totalDamage ?? null,
};

fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(`${outputStem}.csv`, lianyingAnchorTemplateToCsv(output));
console.log(JSON.stringify({
  json: `${outputStem}.json`,
  csv: `${outputStem}.csv`,
  summary: output.summary,
  compactTemplate: output.compactTemplate,
}, null, 2));
