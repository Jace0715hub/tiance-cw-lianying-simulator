import fs from "node:fs";
import path from "node:path";
import { addLianyingValueCenteredTargets } from "../src/reports/lianying-value-training.js";
import {
  crossValidateLianyingRidgeValueModel,
  evaluateLianyingBaselineQuota,
  evaluateLianyingHybridValueQuota,
  evaluateLianyingObservedSelectorShadow,
  evaluateLianyingValueModel,
  selectLianyingObservedSelectorPolicyBySourceValidation,
  selectLianyingRidgeValueModel,
  selectLianyingRidgeValuePolicyBySourceValidation,
} from "../src/policies/lianying-value-model.js";

const profileName = process.argv[4] ?? "one-plus-one";
const profiles = {
  "one-plus-one": {
    baselineQuota: 1,
    valueQuota: 1,
    maximumBaselineRanks: [2, 4, 8, Number.POSITIVE_INFINITY],
    applicationStages: ["row", "boundary"],
  },
  "beam-shadow": {
    baselineQuota: 5,
    valueQuota: 1,
    maximumBaselineRanks: [6, 8, 12, Number.POSITIVE_INFINITY],
    applicationStages: ["row", "boundary"],
  },
  "boundary-shadow": {
    baselineQuota: 11,
    valueQuota: 1,
    maximumBaselineRanks: [12, 16, 24, 32],
    applicationStages: ["boundary"],
  },
};
const policyOptions = profiles[profileName];
if (!policyOptions) {
  throw new Error(`未知价值评估配置：${profileName}`);
}

const inputPath = path.resolve(process.argv[2]);
const rows = addLianyingValueCenteredTargets(fs.readFileSync(inputPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line)));
const selected = selectLianyingRidgeValueModel(rows, policyOptions);
const splitRows = Object.fromEntries(
  ["train", "validation", "test"].map((split) => [
    split,
    rows.filter((row) => row.datasetSplit === split),
  ]),
);
const report = {
  inputPath,
  profileName,
  policyOptions,
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
        baselineQuota: policyOptions.baselineQuota,
        valueQuota: policyOptions.valueQuota,
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
report.equalBudgetBaseline = Object.fromEntries(
  Object.entries(splitRows).map(([split, entries]) => [
    split,
    evaluateLianyingBaselineQuota(entries, {
      quota: policyOptions.baselineQuota + policyOptions.valueQuota,
    }),
  ]),
);
report.crossValidation = new Set(rows.map((row) => row.sourceAxis).filter(Boolean)).size >= 3
  ? crossValidateLianyingRidgeValueModel(rows, policyOptions)
  : null;
report.observedSelector = Object.fromEntries(
  Object.entries(splitRows).map(([split, entries]) => [
    split,
    evaluateLianyingObservedSelectorShadow(entries, selected.model, {
      valueQuota: policyOptions.valueQuota,
      valueWeight: selected.selectedValueWeight,
      maximumBaselineRank: selected.selectedMaximumBaselineRank ??
        Number.POSITIVE_INFINITY,
    }),
  ]),
);
const observedSources = [...new Set(rows
  .map((row) => row.sourceAxis)
  .filter(Boolean))].sort();
report.observedSelectorCrossValidation = observedSources.length >= 3
  ? {
      folds: observedSources.map((testSource) => {
        const selectedFold = selectLianyingObservedSelectorPolicyBySourceValidation(
          rows,
          { ...policyOptions, testSource },
        );
        return {
          testSource,
          selectedAlpha: selectedFold.selectedAlpha,
          selectedValueWeight: selectedFold.selectedValueWeight,
          selectedMaximumBaselineRank:
            selectedFold.selectedMaximumBaselineRank,
          strictNonDegradingValidation: selectedFold.strictNonDegrading,
          metrics: evaluateLianyingObservedSelectorShadow(
            rows.filter((row) => row.sourceAxis === testSource),
            selectedFold.model,
            {
              valueQuota: policyOptions.valueQuota,
              valueWeight: selectedFold.selectedValueWeight,
              maximumBaselineRank:
                selectedFold.selectedMaximumBaselineRank ??
                Number.POSITIVE_INFINITY,
            },
          ),
        };
      }),
    }
  : null;
if (report.observedSelectorCrossValidation) {
  const folds = report.observedSelectorCrossValidation.folds;
  const average = (column) => folds.reduce(
    (sum, fold) => sum + fold.metrics[column], 0) / folds.length;
  report.observedSelectorCrossValidation.aggregate = {
    baselineOracleRecall: average("baselineOracleRecall"),
    damageShadowOracleRecall: average("damageShadowOracleRecall"),
    additiveOracleRecall: average("additiveOracleRecall"),
    baselineMeanRegret: average("baselineMeanRegret"),
    damageShadowMeanRegret: average("damageShadowMeanRegret"),
    additiveMeanRegret: average("additiveMeanRegret"),
    improvedGroups: folds.reduce(
      (sum, fold) => sum + fold.metrics.improvedGroups, 0),
    unchangedGroups: folds.reduce(
      (sum, fold) => sum + fold.metrics.unchangedGroups, 0),
    valueImprovedGroups: folds.reduce(
      (sum, fold) => sum + fold.metrics.valueImprovedGroups, 0),
    valueUnchangedGroups: folds.reduce(
      (sum, fold) => sum + fold.metrics.valueUnchangedGroups, 0),
    improvedFolds: folds.filter((fold) =>
      fold.metrics.additiveMeanRegret < fold.metrics.damageShadowMeanRegret - 1e-6)
      .length,
  };
}
const parsed = path.parse(inputPath);
const outputStem = path.resolve(
  process.argv[3] ?? path.join(parsed.dir, `${parsed.name}-ridge`),
);
fs.writeFileSync(`${outputStem}-model.json`, `${JSON.stringify(selected.model, null, 2)}\n`);
const crossValidationGate = report.crossValidation
  ? report.crossValidation.folds.every((fold) =>
    fold.strictNonDegradingValidation === true) &&
    report.crossValidation.aggregate.baselineFallbackFolds === 0 &&
    report.crossValidation.aggregate.improvedEqualBudgetFolds ===
      report.crossValidation.foldCount &&
    report.crossValidation.aggregate.equalBudgetRecallDelta >= -1e-12 &&
    report.crossValidation.aggregate.equalBudgetMeanRegretDelta <= 1e-6
  : false;
const usesObservedSelector = profileName === "boundary-shadow";
const observedSelectorGate = report.observedSelectorCrossValidation
  ? report.observedSelectorCrossValidation.folds.every((fold) =>
    fold.strictNonDegradingValidation === true &&
    fold.metrics.additiveOracleRecall >= fold.metrics.damageShadowOracleRecall - 1e-12 &&
    fold.metrics.additiveMeanRegret <= fold.metrics.damageShadowMeanRegret + 1e-6 &&
    fold.metrics.valueImprovedGroups > 0) &&
    report.observedSelectorCrossValidation.aggregate.improvedFolds ===
      report.observedSelectorCrossValidation.folds.length
  : false;
const validationGate = usesObservedSelector
  ? observedSelectorGate
  : crossValidationGate;
const deploymentSelection = report.crossValidation
  ? usesObservedSelector
    ? selectLianyingObservedSelectorPolicyBySourceValidation(rows, policyOptions)
    : selectLianyingRidgeValuePolicyBySourceValidation(rows, policyOptions)
  : null;
const deploymentPolicy = {
  kind: "lianying-ridge-value-shadow-policy",
  enabled: validationGate &&
    deploymentSelection?.strictNonDegrading === true,
  profileName,
  baselineQuota: policyOptions.baselineQuota,
  valueQuota: policyOptions.valueQuota,
  valueWeight: deploymentSelection?.selectedValueWeight ?? 0,
  maximumBaselineRank: deploymentSelection?.selectedMaximumBaselineRank ?? null,
  applicationStages: policyOptions.applicationStages,
  validationComparator: usesObservedSelector
    ? "observed-baseline-selector-plus-shadow"
    : "equal-budget-damage-quota",
  validationGatePassed: validationGate &&
    deploymentSelection?.strictNonDegrading === true,
  crossValidationAggregate: report.crossValidation?.aggregate ?? null,
  observedSelectorCrossValidationAggregate:
    report.observedSelectorCrossValidation?.aggregate ?? null,
  deploymentValidation: deploymentSelection?.selectedValidation ?? null,
  model: deploymentSelection?.model ?? selected.model,
};
fs.writeFileSync(
  `${outputStem}-policy.json`,
  `${JSON.stringify(deploymentPolicy, null, 2)}\n`,
);
fs.writeFileSync(`${outputStem}-evaluation.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputStem, ...report }, null, 2));
