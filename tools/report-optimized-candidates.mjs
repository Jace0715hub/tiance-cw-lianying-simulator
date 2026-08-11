import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { buildLocallyOptimizedOrangeCandidateReport } from "../src/reports/orange-candidates.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const runtime = loadDefaultGearRuntime({ rotation: "lianying" });
const report = buildLocallyOptimizedOrangeCandidateReport(
  fixture.profiles.lianying.rows,
  runtime,
  { durationSeconds: fixture.durationSeconds },
);

console.log("\n=== 5段加速·180秒·橙武6秒局部穷举 ===");
console.log(`无橙武主动基准 DPS: ${report.baseline.dps.toFixed(2)}`);
console.table(
  report.candidates.map((candidate) => ({
    策略: candidate.label,
    橙武次数: candidate.orangeUses,
    激雷重叠秒: candidate.thunderOverlapSeconds,
    橙武龙牙: candidate.orangeDragonFangs,
    其中激雷龙牙: candidate.orangeThunderDragonFangs,
    其中龙驭龙牙: candidate.orangeRideDragonFangs,
    候选轴DPS: Number(candidate.dps.toFixed(2)),
    DPS增量: Number(candidate.dpsGain.toFixed(2)),
  })),
);

for (const candidate of report.candidates) {
  console.log(`\n--- ${candidate.label} ---`);
  console.table(
    candidate.searches.map((search, index) => ({
      窗口: index + 1,
      开启时间秒: search.activationSeconds,
      枚举数: search.explored,
      局部合法数: search.locallyLegal,
      全轴淘汰数: search.rejectedByFullReplay,
      局部技能: search.skills.join(" "),
      龙牙: search.dragonFangs,
      激雷龙牙: search.thunderDragonFangs,
      窗口伤害: Math.round(search.windowDamage),
    })),
  );
}
