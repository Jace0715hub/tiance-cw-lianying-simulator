import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { buildJointCoordinationReport } from "../src/reports/ride-thunder-binding.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const beamWidth = Number(process.argv[2] ?? 128);
const fullEvaluationLimit = Number(process.argv[3] ?? 24);
const iterations = Number(process.argv[4] ?? 4);
const runtime = loadDefaultGearRuntime({ rotation: "lianying" });
const report = buildJointCoordinationReport(
  fixture.profiles.lianying.rows,
  runtime,
  {
    durationSeconds: fixture.durationSeconds,
    beamWidth,
    fullEvaluationLimit,
    iterations,
  },
);

console.log("\n=== 任驰骋·激雷·橙武联合坐标迭代 ===");
console.log(`基础轴束宽度: ${beamWidth}，全轴复评: ${fullEvaluationLimit}，最多迭代: ${iterations}`);
console.table(
  report.cases.map((candidate) => ({
    方案: candidate.label,
    DPS: Number(candidate.dps.toFixed(2)),
    相对基准DPS: Number(candidate.dpsDelta.toFixed(2)),
    橙武次数: candidate.orangeUses,
    激雷龙牙: candidate.thunderDragonFangs,
    任雷龙牙: candidate.rideThunderDragonFangs,
    任雷橙三重龙牙: candidate.tripleDragonFangs,
    任雷重叠秒: Number(candidate.rideThunderOverlapSeconds.toFixed(4)),
    下马次数: candidate.dismounts,
  })),
);

console.log("\n--- 各轮阶段收益 ---");
console.table(
  report.phases.map((phase) => ({
    迭代: phase.iteration,
    阶段: phase.phase,
    完整轴伤害增量: Math.round(phase.damageGain),
    接受更新数: phase.moves.length,
  })),
);

for (const phase of report.phases.filter((item) => item.moves.length > 0)) {
  console.log(`\n--- 第${phase.iteration}轮 ${phase.phase} 更新 ---`);
  console.table(
    phase.moves.map((move) => ({
      编号: Number(move.pairIndex ?? move.eventIndex ?? 0) + 1,
      原行: move.sourceRowIndex + 1,
      新行: move.targetRowIndex + 1,
      伤害增量: Math.round(move.damageGain),
    })),
  );
}

console.log("\n--- 截止时间敏感性 ---");
console.table(
  report.checkpointComparison.map((checkpoint) => ({
    截止秒数: checkpoint.seconds,
    累计伤害差: Math.round(checkpoint.damageDelta),
    DPS差: Number(checkpoint.dpsDelta.toFixed(2)),
  })),
);
