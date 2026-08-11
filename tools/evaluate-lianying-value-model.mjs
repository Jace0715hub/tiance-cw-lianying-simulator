import fs from "node:fs";
import path from "node:path";
import { addLianyingValueCenteredTargets } from "../src/reports/lianying-value-training.js";
import {
  crossValidateLianyingRidgeValueModel,
  evaluateLianyingHybridValueQuota,
  evaluateLianyingValueModel,
  selectLianyingRidgeValueModel,
} from "../src/policies/lianying-value-model.js";

const inputPath = path.resolve(process.argv[2]);
const rows = addLianyingValueCenteredTargets(fs.readFileSync(inputPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line)));
const selected = selectLianyingRidgeValueModel(rows);
const splitRows = Object.fromEntries(
  ["train", "validation", "test"].map((split) => [
    split,
    rows.filter((row) => row.datasetSplit === split),
  ]),
);
const report = {
  inputPath,
  rowCount: rows.length,
  splitCounts: Object.fromEntries(
    Object.entries(splitRows).map(([split, entries]) => [split, entries.length]),
  ),
  selectedAlpha: selected.selectedAlpha,
  selectedValueWeight: selected.selectedValueWeight,
  selectedMaximumBaselineRank: selected.selectedMaximumBaselineRank,
  validationCandidates: selected.candidates,
  baseline: Object.fromEntries(
    Object.entries(splitRows).map(([split, entries]) => [
      split,
      evaluateLianyingValueModel(entries),
    ]),
  ),
  ridge: Object.fromEntries(
    Object.entries(splitRows).map(([split, entries]) => [
      split,
      evaluateLianyingValueModel(entries, selected.model),
    ]),
  ),
  hybridQuota: Object.fromEntries(
    Object.entries(splitRows).map(([split, entries]) => [
      split,
      {
        onePlusOne: evaluateLianyingHybridValueQuota(entries, selected.model),
        twoPlusTwo: evaluateLianyingHybridValueQuota(entries, selected.model, {
          baselineQuota: 2,
          valueQuota: 2,
        }),
      },
    ]),
  ),
  guardedHybridQuota: Object.fromEntries(
    Object.entries(splitRows).map(([split, entries]) => [
      split,
      evaluateLianyingHybridValueQuota(entries, selected.model, {
        valueWeight: selected.selectedValueWeight,
        maximumBaselineRank: selected.selectedMaximumBaselineRank ??
          Number.POSITIVE_INFINITY,
      }),
    ]),
  ),
};
report.equalBudgetComparison = Object.fromEntries(
  ["train", "validation", "test"].map((split) => [split, {
    onePlusOneVsBaselineTop2: {
      oracleRecallDelta:
        report.hybridQuota[split].onePlusOne.oracleRecall -
        report.baseline[split].ranking.top2Recall,
      meanRegretDelta:
        report.hybridQuota[split].onePlusOne.meanRegret -
        report.baseline[split].ranking.meanTop2Regret,
    },
    guardedOnePlusOneVsBaselineTop2: {
      oracleRecallDelta:
        report.guardedHybridQuota[split].oracleRecall -
        report.baseline[split].ranking.top2Recall,
      meanRegretDelta:
        report.guardedHybridQuota[split].meanRegret -
        report.baseline[split].ranking.meanTop2Regret,
    },
    twoPlusTwoVsBaselineTop4: {
      oracleRecallDelta:
        report.hybridQuota[split].twoPlusTwo.oracleRecall -
        report.baseline[split].ranking.top4Recall,
      meanRegretDelta:
        report.hybridQuota[split].twoPlusTwo.meanRegret -
        report.baseline[split].ranking.meanTop4Regret,
    },
  }]),
);
report.crossValidation = new Set(rows.map((row) => row.sourceAxis).filter(Boolean)).size >= 3
  ? crossValidateLianyingRidgeValueModel(rows)
  : null;
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[3] ?? path.join(parsed.dir, `${parsed.name}-ridge`),
);
fs.writeFileSync(`${outputStem}-model.json`, `${JSON.stringify(selected.model, null, 2)}\n`);
fs.writeFileSync(`${outputStem}-evaluation.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputStem, ...report }, null, 2));
