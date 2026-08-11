import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { buildRideThunderBindingReport } from "../src/reports/ride-thunder-binding.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const beamWidth = Number(process.argv[2] ?? 128);
const fullEvaluationLimit = Number(process.argv[3] ?? 24);
const runtime = loadDefaultGearRuntime({ rotation: "lianying" });
const report = buildRideThunderBindingReport(
  fixture.profiles.lianying.rows,
  runtime,
  {
    durationSeconds: fixture.durationSeconds,
    beamWidth,
    fullEvaluationLimit,
  },
);

console.log("\n=== 任驰骋与激雷绑定假设对照 ===");
console.log(`基础轴束宽度: ${beamWidth}，每激雷窗口全轴复评: ${fullEvaluationLimit}`);
console.log("软绑定每个偏移会使用64宽束重排对应18秒窗口，并复评前8条。");
console.log("自由组先对全行位置粗筛，再使用32宽束重排候选位的18秒窗口。");
console.table(
  report.cases.map((candidate) => ({
    方案: candidate.label,
    DPS: Number(candidate.dps.toFixed(2)),
    相对原绑定DPS: Number(candidate.dpsDelta.toFixed(2)),
    有任驰骋的激雷: candidate.pairedThunderCount,
    任雷重叠总秒: Number(candidate.rideThunderOverlapSeconds.toFixed(4)),
    激雷龙牙: candidate.thunderDragonFangs,
    任雷龙牙: candidate.rideThunderDragonFangs,
    任雷橙三重龙牙: candidate.tripleDragonFangs,
  })),
);

for (const candidate of report.cases) {
  console.log(`\n--- ${candidate.label} ---`);
  console.table(candidate.thunderWindows);
  if (candidate.search) {
    console.table(
      candidate.search.steps
        .filter((step) => step.damageGain > 0)
        .map((step) => ({
          轮次: step.pass,
          激雷编号: step.eventIndex + 1,
          原行: step.sourceRowIndex + 1,
          新行: step.targetRowIndex + 1,
          合法位置: step.legal,
          全轴伤害增量: Math.round(step.damageGain),
        })),
    );
  }
}

console.log("\n--- 固定轴与软绑定轴的截止时间敏感性 ---");
console.table(
  report.checkpointComparison.map((checkpoint) => ({
    截止秒数: checkpoint.seconds,
    累计伤害差: Math.round(checkpoint.damageDelta),
    DPS差: Number(checkpoint.dpsDelta.toFixed(2)),
  })),
);
