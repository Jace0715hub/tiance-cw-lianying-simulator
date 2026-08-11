import fs from "node:fs";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { buildThunderOptimizedOrangeCandidateReport } from "../src/reports/orange-candidates.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const beamWidth = Number(process.argv[2] ?? 128);
const fullEvaluationLimit = Number(process.argv[3] ?? 24);
const runtime = loadDefaultGearRuntime({ rotation: "lianying" });
const report = buildThunderOptimizedOrangeCandidateReport(
  fixture.profiles.lianying.rows,
  runtime,
  {
    durationSeconds: fixture.durationSeconds,
    beamWidth,
    fullEvaluationLimit,
  },
);

console.log("\n=== 5段加速·180秒·完整18秒激雷束搜索 ===");
console.log(`束宽度: ${beamWidth}，每窗口完整轴复评: ${fullEvaluationLimit}`);
console.log(`无橙武主动基准 DPS: ${report.baseline.dps.toFixed(2)}`);
console.table(
  report.candidates.map((candidate) => ({
    策略: candidate.label,
    橙武次数: candidate.orangeUses,
    橙武龙牙: candidate.orangeDragonFangs,
    激雷龙牙: candidate.summary.dragonFang.underThunder,
    龙牙总数: candidate.summary.dragonFang.total,
    候选轴DPS: Number(candidate.dps.toFixed(2)),
    DPS增量: Number(candidate.dpsGain.toFixed(2)),
  })),
);

for (const candidate of report.candidates) {
  console.log(`\n--- ${candidate.label} ---`);
  console.table(
    candidate.thunderSearches.map((search, index) => ({
      激雷窗口: index + 1,
      开启时间秒: search.activationSeconds,
      搜索转移数: search.exploredTransitions,
      终局候选数: search.terminalStates,
      全轴复评数: search.evaluatedByFullReplay,
      采用局部排名: search.acceptedRank ?? "保留原轴",
      全轴伤害增量: Math.round(search.fullDamageGain),
      窗口龙牙: search.dragonFangs,
      其中橙武龙牙: search.orangeDragonFangs,
    })),
  );
}
