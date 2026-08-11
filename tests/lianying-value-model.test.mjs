import test from "node:test";
import assert from "node:assert/strict";
import {
  crossValidateLianyingRidgeValueModel,
  evaluateLianyingHybridValueQuota,
  evaluateLianyingValueModel,
  fitLianyingRidgeValueModel,
  predictLianyingRidgeValue,
  selectLianyingRidgeValueModel,
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
    assert.ok(!fold.trainingSources.includes(fold.validationSource));
  }
});
