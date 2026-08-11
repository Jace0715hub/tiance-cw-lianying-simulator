import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { buildRidePlacementReport } from "../src/reports/ride-thunder-binding.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const beamWidth = Number(process.argv[2] ?? 128);
const fullEvaluationLimit = Number(process.argv[3] ?? 24);
const runtime = loadDefaultGearRuntime({ rotation: "lianying" });
const report = buildRidePlacementReport(
  fixture.profiles.lianying.rows,
  runtime,
  {
    durationSeconds: fixture.durationSeconds,
    beamWidth,
    fullEvaluationLimit,
  },
);

console.log("\n=== 任驰骋相对激雷的位置搜索 ===");
console.log(`基础轴束宽度: ${beamWidth}，每激雷窗口全轴复评: ${fullEvaluationLimit}`);
console.log("每组测试任驰骋在激雷前2行、前1行、同行和后1行，并重排联合窗口。");
console.table(
  report.cases.map((candidate) => ({
    方案: candidate.label,
    DPS: Number(candidate.dps.toFixed(2)),
    相对原位DPS: Number(candidate.dpsDelta.toFixed(2)),
    任雷重叠总秒: Number(candidate.rideThunderOverlapSeconds.toFixed(4)),
    任雷龙牙: candidate.rideThunderDragonFangs,
    任雷橙三重龙牙: candidate.tripleDragonFangs,
    下马次数: candidate.dismounts,
  })),
);

const moved = report.cases.find((candidate) => candidate.id === "softRide");
console.log("\n--- 被接受的任驰骋偏移 ---");
console.table(
  moved.search.steps
    .filter((step) => step.damageGain > 0)
    .map((step) => ({
      任雷组: step.pairIndex + 1,
      激雷行: step.thunderRowIndex + 1,
      原任驰骋行: step.sourceRowIndex + 1,
      新任驰骋行: step.targetRowIndex + 1,
      原相对偏移: step.oldOffset,
      新相对偏移: step.newOffset,
      合法候选: step.legal,
      全轴伤害增量: Math.round(step.damageGain),
    })),
);

console.log("\n--- 截止时间敏感性 ---");
console.table(
  report.checkpointComparison.map((checkpoint) => ({
    截止秒数: checkpoint.seconds,
    累计伤害差: Math.round(checkpoint.damageDelta),
    DPS差: Number(checkpoint.dpsDelta.toFixed(2)),
  })),
);
