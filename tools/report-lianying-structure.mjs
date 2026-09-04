import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLianyingResearchPath } from "../src/config/lianying-research-defaults.js";
import { analyzeLianyingStructure } from "../src/reports/lianying-structure-analysis.js";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  compareDismountRidePersistence,
  lianyingRowsToActionPacks,
} from "../src/reports/lianying-model-sensitivity.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const parsed = path.parse(inputPath);
const outputPath = path.resolve(
  process.argv[3] ?? path.join(parsed.dir, `${parsed.name}-structure.json`),
);
const artifact = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (!Array.isArray(artifact.rows)) {
  throw new Error(`输入文件没有rows技能轴: ${inputPath}`);
}
const actionPacks = artifact.actionPacks ?? lianyingRowsToActionPacks(artifact.rows);
const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
const sensitivity = compareDismountRidePersistence(runtime, actionPacks, {
  durationSeconds: artifact.durationSeconds ?? 180,
});
const expectedRotationDamage = artifact.damageAccounting?.rotationDamage ?? null;
const recoveredReplayDamageDelta = expectedRotationDamage === null
  ? null
  : sensitivity.baseline.rotationDamage - expectedRotationDamage;
if (
  recoveredReplayDamageDelta !== null &&
  Math.abs(recoveredReplayDamageDelta) > 1e-6
) {
  throw new Error(
    `动作包恢复后伤害不一致: delta=${recoveredReplayDamageDelta}`,
  );
}
const report = {
  kind: "tiance-cw-lianying-structure-analysis",
  source: path.relative(projectRoot, inputPath),
  durationSeconds: artifact.durationSeconds ?? null,
  rotationDps: artifact.damageAccounting?.rotationDps ?? null,
  totalDps: artifact.damageAccounting?.combinedDps ?? artifact.summary?.dps ?? null,
  actionPackSource: artifact.actionPacks ? "artifact" : "recovered-from-rows",
  recoveredReplayDamageDelta,
  actionPacks,
  // 始终从逐行轴重新计算，避免旧artifact内嵌的结构报告版本过期。
  analysis: analyzeLianyingStructure(artifact.rows),
  sensitivity,
};

fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  actionPackSource: report.actionPackSource,
  recoveredReplayDamageDelta,
  summary: report.analysis.summary,
  ridePersistenceDependency: sensitivity.dependency,
}, null, 2));
