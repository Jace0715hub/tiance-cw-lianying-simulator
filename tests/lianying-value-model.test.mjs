import test from "node:test";
import assert from "node:assert/strict";
import {
  crossValidateLianyingRidgeValueModel,
  evaluateLianyingBaselineQuota,
  evaluateLianyingHybridValueQuota,
  evaluateLianyingObservedSelectorShadow,
  evaluateLianyingValueModel,
  fitLianyingRidgeValueModel,
  predictLianyingRidgeValue,
  selectLianyingObservedSelectorPolicyBySourceValidation,
  selectLianyingHybridValueWeight,
  selectLianyingRidgeValueModel,
  selectLianyingRidgeValuePolicyBySourceValidation,
} from "../src/policies/lianying-value-model.js";

function syntheticRows() {
  const rows = [];
  for (const [split, offset] of [["train", 0], ["validation", 20], ["test", 40]]) {
    for (let index = 0; index < 20; index += 1) {
      const rage = (index + offset) % 6;
      const dragonRideStacks = (index * 3 + offset) % 25;
      const residual = 1000 + rage * 200 - dragonRideStacks * 30;
      rows.push({
        datasetSplit: split,
        sourceAxis: `${split}-axis`,
        traceId: `${split}-trace`,
        layer: Math.floor(index / 2),
        nodeId: index,
        rage,
        dragonRideStacks,
        totalDamage: index % 2 === 0 ? 10000 : 9900,
        bestFinalDamage: 100000 + residual,
        remainingDamageResidual: residual,
        centeredRemainingDamageResidual: residual,
      });
    }
  }
  return rows;
}

test("岭回归能学习标准化状态特征并复现线性残差", () => {
  const rows = syntheticRows();
  const model = fitLianyingRidgeValueModel(
    rows.filter((row) => row.datasetSplit === "train"),
    { featureColumns: ["rage", "dragonRideStacks"], alpha: 0.01 },
  );
  const prediction = predictLianyingRidgeValue(model, rows.at(-1));
  assert.ok(Math.abs(prediction - rows.at(-1).remainingDamageResidual) < 2);
  const metrics = evaluateLianyingValueModel(
    rows.filter((row) => row.datasetSplit === "test"),
    model,
  );
  assert.ok(metrics.regression.rSquared > 0.99);
});

test("岭回归超参数只使用训练与验证集选择", () => {
  const rows = syntheticRows();
  const selected = selectLianyingRidgeValueModel(rows, {
    featureColumns: ["rage", "dragonRideStacks"],
    alphas: [0.01, 1, 100],
  });
  assert.ok([0.01, 1, 100].includes(selected.selectedAlpha));
  assert.equal(selected.model.trainingRows, 20);
  assert.equal(selected.candidates.length, 3);
  assert.ok(selected.candidates.every((candidate) =>
    candidate.validationHybrid.onePlusOne.decisionGroupCount > 0));
});

test("混合配额同时保留即时伤害与状态价值候选", () => {
  const rows = syntheticRows();
  const training = rows.filter((row) => row.datasetSplit === "train");
  const testRows = rows.filter((row) => row.datasetSplit === "test");
  const model = fitLianyingRidgeValueModel(training, {
    featureColumns: ["rage", "dragonRideStacks"],
    alpha: 0.01,
  });
  const hybrid = evaluateLianyingHybridValueQuota(testRows, model);
  assert.equal(hybrid.baselineQuota, 1);
  assert.equal(hybrid.valueQuota, 1);
  assert.ok(hybrid.meanUniqueCandidates >= 1);
  assert.ok(hybrid.meanUniqueCandidates <= 2);
});

test("价值权重为零时严格退化为同预算即时伤害基线", () => {
  const rows = syntheticRows().filter((row) => row.datasetSplit === "test");
  const model = fitLianyingRidgeValueModel(
    syntheticRows().filter((row) => row.datasetSplit === "train"),
    { featureColumns: ["rage", "dragonRideStacks"], alpha: 0.01 },
  );
  const baseline = evaluateLianyingValueModel(rows);
  const guarded = evaluateLianyingHybridValueQuota(rows, model, {
    valueWeight: 0,
  });
  assert.equal(guarded.oracleRecall, baseline.ranking.top2Recall);
  assert.equal(guarded.meanRegret, baseline.ranking.meanTop2Regret);
});

test("广义即时伤害配额与既有 top-k 排名指标一致", () => {
  const rows = syntheticRows().filter((row) => row.datasetSplit === "test");
  const ranking = evaluateLianyingValueModel(rows).ranking;
  const baseline = evaluateLianyingBaselineQuota(rows, { quota: 2 });
  assert.equal(baseline.oracleRecall, ranking.top2Recall);
  assert.equal(baseline.meanRegret, ranking.meanTop2Regret);
});

test("观测边界选择器评估只追加价值槽且不替换既有候选", () => {
  const rows = [
    {
      totalDamage: 100,
      bestFinalDamage: 1000,
      rage: 0,
      selectedByBaselineBeam: 1,
    },
    {
      totalDamage: 99,
      bestFinalDamage: 1200,
      rage: 1,
      selectedByBaselineBeam: 0,
    },
    {
      totalDamage: 98,
      bestFinalDamage: 900,
      rage: 0,
      selectedByBaselineBeam: 1,
    },
  ].map((row, nodeId) => ({
    ...row,
    sourceAxis: "axis",
    traceId: "boundary",
    layer: 1,
    nodeId,
  }));
  const model = {
    targetMean: 0,
    featureColumns: ["rage"],
    featureMeans: [0],
    featureScales: [1],
    coefficients: [1000],
  };
  const metrics = evaluateLianyingObservedSelectorShadow(rows, model, {
    valueQuota: 1,
    maximumBaselineRank: 3,
  });

  assert.equal(metrics.meanBaselineCandidates, 2);
  assert.equal(metrics.meanAdditiveCandidates, 3);
  assert.equal(metrics.baselineOracleRecall, 0);
  assert.equal(metrics.damageShadowOracleRecall, 1);
  assert.equal(metrics.additiveOracleRecall, 1);
  assert.equal(metrics.baselineMeanRegret, 200);
  assert.equal(metrics.additiveMeanRegret, 0);
  assert.equal(metrics.improvedGroups, 1);
  assert.equal(metrics.valueImprovedGroups, 0);
});

test("观测边界策略按来源嵌套验证且完全隔离外层测试轴", () => {
  const rows = ["axis-0", "axis-1", "axis-2", "axis-3"].flatMap(
    (sourceAxis, sourceIndex) => [0, 1].flatMap((layer) => [
      { totalDamage: 100, bestFinalDamage: 1000, rage: 0, selectedByBaselineBeam: 1 },
      { totalDamage: 99, bestFinalDamage: 1200, rage: 1, selectedByBaselineBeam: 0 },
      { totalDamage: 98, bestFinalDamage: 900, rage: 0, selectedByBaselineBeam: 0 },
    ].map((row, nodeIndex) => ({
      ...row,
      sourceAxis,
      traceId: `${sourceIndex}-${layer}`,
      layer,
      nodeId: nodeIndex,
      centeredRemainingDamageResidual: row.rage * 200,
    }))),
  );
  const selected = selectLianyingObservedSelectorPolicyBySourceValidation(rows, {
    testSource: "axis-0",
    featureColumns: ["rage"],
    alphas: [0.01, 1],
    valueWeights: [0, 1],
    maximumBaselineRanks: [2, 3],
  });

  assert.ok(!selected.validationSources.includes("axis-0"));
  assert.equal(selected.model.trainingRows, 18);
  assert.equal(selected.strictNonDegrading, true);
  assert.ok([0, 1].includes(selected.selectedValueWeight));
  assert.equal(selected.selectedMaximumBaselineRank, 2);
});

test("验证集会在价值排序有害时选择零权重回退", () => {
  const rows = [
    { totalDamage: 100, bestFinalDamage: 1000, rage: 0 },
    { totalDamage: 99, bestFinalDamage: 1100, rage: 0 },
    { totalDamage: 98, bestFinalDamage: 900, rage: 1 },
  ].map((row, nodeId) => ({
    ...row,
    sourceAxis: "validation-axis",
    traceId: "trace",
    layer: 0,
    nodeId,
  }));
  const harmfulModel = {
    targetMean: 0,
    featureColumns: ["rage"],
    featureMeans: [0],
    featureScales: [1],
    coefficients: [1000],
  };
  const selected = selectLianyingHybridValueWeight(rows, harmfulModel, {
    weights: [0, 0.5, 1],
  });
  assert.equal(selected.selectedValueWeight, 0);
  assert.equal(selected.metrics.meanRegret, 0);
});

test("基线名次门控阻止价值槽跳到过远候选", () => {
  const rows = [
    { totalDamage: 100, bestFinalDamage: 1000, rage: 0 },
    { totalDamage: 99, bestFinalDamage: 1100, rage: 0 },
    { totalDamage: 98, bestFinalDamage: 900, rage: 1 },
  ].map((row, nodeId) => ({
    ...row,
    sourceAxis: "test-axis",
    traceId: "trace",
    layer: 0,
    nodeId,
  }));
  const model = {
    targetMean: 0,
    featureColumns: ["rage"],
    featureMeans: [0],
    featureScales: [1],
    coefficients: [1000],
  };
  const open = evaluateLianyingHybridValueQuota(rows, model);
  const guarded = evaluateLianyingHybridValueQuota(rows, model, {
    maximumBaselineRank: 2,
  });
  assert.equal(open.meanRegret, 100);
  assert.equal(guarded.meanRegret, 0);
});

test("逐轴留出交叉验证轮流隔离测试轴和验证轴", () => {
  const rows = syntheticRows().flatMap((row, index) => [
    { ...row, sourceAxis: `axis-${index % 4}` },
  ]);
  const report = crossValidateLianyingRidgeValueModel(rows, {
    featureColumns: ["rage", "dragonRideStacks"],
    alphas: [0.01, 1],
  });
  assert.equal(report.foldCount, 4);
  assert.equal(new Set(report.folds.map((fold) => fold.testSource)).size, 4);
  for (const fold of report.folds) {
    assert.notEqual(fold.testSource, fold.validationSource);
    assert.ok(!fold.trainingSources.includes(fold.testSource));
    assert.equal(fold.selectionMode, "nested-source-validation");
    assert.ok(fold.validationSources.includes(fold.validationSource));
    assert.equal(fold.strictNonDegradingValidation, true);
  }
});

test("嵌套来源验证完全隔离外层测试轴", () => {
  const rows = syntheticRows().flatMap((row, index) => [
    { ...row, sourceAxis: `axis-${index % 4}` },
  ]);
  const selected = selectLianyingRidgeValuePolicyBySourceValidation(rows, {
    testSource: "axis-0",
    featureColumns: ["rage", "dragonRideStacks"],
    alphas: [0.01, 1],
    valueWeights: [0, 1],
    maximumBaselineRanks: [2, 4],
  });
  assert.ok(!selected.validationSources.includes("axis-0"));
  assert.equal(selected.model.trainingRows, rows.filter(
    (row) => row.sourceAxis !== "axis-0").length);
  assert.equal(selected.strictNonDegrading, true);
});

test("嵌套验证按五加一实际束配额与六槽基线比较", () => {
  const rows = syntheticRows().flatMap((row, index) => [
    { ...row, sourceAxis: `axis-${index % 4}` },
  ]);
  const report = crossValidateLianyingRidgeValueModel(rows, {
    featureColumns: ["rage", "dragonRideStacks"],
    alphas: [0.01, 1],
    valueWeights: [0, 1],
    maximumBaselineRanks: [6, 8],
    baselineQuota: 5,
    valueQuota: 1,
  });
  assert.equal(report.aggregate.baselineEqualBudgetQuota, 6);
  assert.ok(report.folds.every((fold) =>
    fold.baselineEqualBudget.quota === 6 &&
    fold.hybridOnePlusOne.baselineQuota === 5 &&
    fold.hybridOnePlusOne.valueQuota === 1));
});
