export const LIANYING_VALUE_FEATURE_COLUMNS = Object.freeze([
  "elapsedSeconds",
  "remainingSeconds",
  "gcdWaitSeconds",
  "rage",
  "dragonRideStacks",
  "mounted",
  "bleedStacks",
  "bleedQuality",
  "bleedNextSeconds",
  "autoAttackNextSeconds",
  "executeDestroyToggle",
  "thunderCharges",
  "thunderRecharge1Seconds",
  "thunderRecharge2Seconds",
  "rideCharges",
  "rideRecharge1Seconds",
  "rideRecharge2Seconds",
  "thunderStartDragonRideStacks",
  "thunderDragonFangCount",
  "thunderUsedDragonRoar",
  "thunderUsedCharge",
  "destroyCooldownSeconds",
  "dragonRoarCooldownSeconds",
  "chargeCooldownSeconds",
  "dashCooldownSeconds",
  "orangeCooldownSeconds",
  "thunderRemainingSeconds",
  "orangeRemainingSeconds",
  "rideRemainingSeconds",
  "bleedRemainingSeconds",
  "breakArmyRemainingSeconds",
  "poLouLanRemainingSeconds",
]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) {
      augmented[pivot][column] = 1e-12;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      augmented[column][entry] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function fitLianyingRidgeValueModel(
  inputRows,
  {
    featureColumns = LIANYING_VALUE_FEATURE_COLUMNS,
    targetColumn = "centeredRemainingDamageResidual",
    alpha = 10,
  } = {},
) {
  const rows = inputRows.filter((row) =>
    Number.isFinite(Number(row[targetColumn])));
  if (rows.length === 0) throw new Error("岭回归至少需要一条有限标签记录");
  const means = featureColumns.map((column) =>
    rows.reduce((sum, row) => sum + finiteNumber(row[column]), 0) / rows.length);
  const scales = featureColumns.map((column, index) => {
    const variance = rows.reduce((sum, row) => {
      const difference = finiteNumber(row[column]) - means[index];
      return sum + difference * difference;
    }, 0) / rows.length;
    const scale = Math.sqrt(variance);
    return scale > 1e-12 ? scale : 1;
  });
  const targetMean = rows.reduce(
    (sum, row) => sum + Number(row[targetColumn]),
    0,
  ) / rows.length;
  const size = featureColumns.length;
  const normal = Array.from({ length: size }, () => Array(size).fill(0));
  const target = Array(size).fill(0);
  for (const row of rows) {
    const values = featureColumns.map((column, index) =>
      (finiteNumber(row[column]) - means[index]) / scales[index]);
    const centeredTarget = Number(row[targetColumn]) - targetMean;
    for (let left = 0; left < size; left += 1) {
      target[left] += values[left] * centeredTarget;
      for (let right = 0; right <= left; right += 1) {
        normal[left][right] += values[left] * values[right];
      }
    }
  }
  for (let left = 0; left < size; left += 1) {
    for (let right = 0; right < left; right += 1) {
      normal[right][left] = normal[left][right];
    }
    normal[left][left] += Math.max(0, Number(alpha));
  }
  const coefficients = solveLinearSystem(normal, target);
  return {
    kind: "ridge-residual",
    targetColumn,
    alpha: Number(alpha),
    trainingRows: rows.length,
    featureColumns: [...featureColumns],
    featureMeans: means,
    featureScales: scales,
    targetMean,
    coefficients,
  };
}

export function predictLianyingRidgeValue(model, row) {
  return model.targetMean + model.featureColumns.reduce((sum, column, index) =>
    sum + model.coefficients[index] *
      ((finiteNumber(row[column]) - model.featureMeans[index]) /
        model.featureScales[index]), 0);
}

function regressionMetrics(rows, predictions, targetColumn) {
  if (rows.length === 0) return null;
  const actual = rows.map((row) => Number(row[targetColumn]));
  const mean = actual.reduce((sum, value) => sum + value, 0) / actual.length;
  let absolute = 0;
  let squared = 0;
  let baselineSquared = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const error = predictions[index] - actual[index];
    absolute += Math.abs(error);
    squared += error * error;
    const baselineError = actual[index] - mean;
    baselineSquared += baselineError * baselineError;
  }
  return {
    rowCount: rows.length,
    mae: absolute / rows.length,
    rmse: Math.sqrt(squared / rows.length),
    rSquared: baselineSquared > 0 ? 1 - squared / baselineSquared : null,
  };
}

function rankingMetrics(rows, residualPredictions) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = [
      row.sourceAxis ?? "",
      row.traceId ?? "",
      row.layer ?? "",
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      row,
      score: finiteNumber(row.totalDamage) + residualPredictions[index],
    });
  });
  const usefulGroups = [...groups.values()].filter((group) => group.length > 1);
  const metrics = {
    decisionGroupCount: usefulGroups.length,
    top1Recall: 0,
    top2Recall: 0,
    top4Recall: 0,
    meanTop1Regret: 0,
    meanTop2Regret: 0,
    meanTop4Regret: 0,
    maximumTop1Regret: 0,
  };
  if (usefulGroups.length === 0) return metrics;
  for (const group of usefulGroups) {
    const oracle = Math.max(...group.map(({ row }) => Number(row.bestFinalDamage)));
    const ranked = [...group].sort((left, right) => right.score - left.score);
    const regrets = [1, 2, 4].map((limit) => {
      const achieved = Math.max(...ranked
        .slice(0, limit)
        .map(({ row }) => Number(row.bestFinalDamage)));
      return Math.max(0, oracle - achieved);
    });
    metrics.top1Recall += Number(regrets[0] <= 1e-6);
    metrics.top2Recall += Number(regrets[1] <= 1e-6);
    metrics.top4Recall += Number(regrets[2] <= 1e-6);
    metrics.meanTop1Regret += regrets[0];
    metrics.meanTop2Regret += regrets[1];
    metrics.meanTop4Regret += regrets[2];
    metrics.maximumTop1Regret = Math.max(metrics.maximumTop1Regret, regrets[0]);
  }
  metrics.top1Recall /= usefulGroups.length;
  metrics.top2Recall /= usefulGroups.length;
  metrics.top4Recall /= usefulGroups.length;
  metrics.meanTop1Regret /= usefulGroups.length;
  metrics.meanTop2Regret /= usefulGroups.length;
  metrics.meanTop4Regret /= usefulGroups.length;
  return metrics;
}

export function evaluateLianyingHybridValueQuota(
  rows,
  model,
  { baselineQuota = 1, valueQuota = 1 } = {},
) {
  const groups = new Map();
  for (const row of rows) {
    const key = [
      row.sourceAxis ?? "",
      row.traceId ?? "",
      row.layer ?? "",
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      row,
      baselineScore: finiteNumber(row.totalDamage),
      valueScore: finiteNumber(row.totalDamage) +
        predictLianyingRidgeValue(model, row),
    });
  }
  const usefulGroups = [...groups.values()].filter((group) => group.length > 1);
  const metrics = {
    baselineQuota: Math.max(0, Math.floor(Number(baselineQuota))),
    valueQuota: Math.max(0, Math.floor(Number(valueQuota))),
    decisionGroupCount: usefulGroups.length,
    oracleRecall: 0,
    meanRegret: 0,
    maximumRegret: 0,
    meanUniqueCandidates: 0,
  };
  if (usefulGroups.length === 0) return metrics;
  for (const group of usefulGroups) {
    const oracle = Math.max(...group.map(({ row }) => Number(row.bestFinalDamage)));
    const baseline = [...group]
      .sort((left, right) => right.baselineScore - left.baselineScore)
      .slice(0, metrics.baselineQuota);
    const baselineSet = new Set(baseline);
    const value = [...group]
      .sort((left, right) => right.valueScore - left.valueScore)
      .filter((candidate) => !baselineSet.has(candidate))
      .slice(0, metrics.valueQuota);
    const selected = [...new Set([...baseline, ...value])];
    const achieved = selected.length > 0
      ? Math.max(...selected.map(({ row }) => Number(row.bestFinalDamage)))
      : Number.NEGATIVE_INFINITY;
    const regret = Math.max(0, oracle - achieved);
    metrics.oracleRecall += Number(regret <= 1e-6);
    metrics.meanRegret += regret;
    metrics.maximumRegret = Math.max(metrics.maximumRegret, regret);
    metrics.meanUniqueCandidates += selected.length;
  }
  metrics.oracleRecall /= usefulGroups.length;
  metrics.meanRegret /= usefulGroups.length;
  metrics.meanUniqueCandidates /= usefulGroups.length;
  return metrics;
}

export function evaluateLianyingValueModel(rows, model = null) {
  const targetColumn = model?.targetColumn ?? "centeredRemainingDamageResidual";
  const predictions = rows.map((row) =>
    model ? predictLianyingRidgeValue(model, row) : 0);
  return {
    regression: regressionMetrics(rows, predictions, targetColumn),
    ranking: rankingMetrics(rows, predictions),
  };
}

export function selectLianyingRidgeValueModel(
  rows,
  {
    alphas = [0.01, 0.1, 1, 10, 100, 1000, 10000],
    featureColumns = LIANYING_VALUE_FEATURE_COLUMNS,
    targetColumn = "centeredRemainingDamageResidual",
  } = {},
) {
  const trainingRows = rows.filter((row) => row.datasetSplit === "train");
  const validationRows = rows.filter((row) => row.datasetSplit === "validation");
  if (trainingRows.length === 0 || validationRows.length === 0) {
    throw new Error("岭回归选择需要非空训练集和验证集");
  }
  const candidates = alphas.map((alpha) => {
    const model = fitLianyingRidgeValueModel(trainingRows, {
      alpha,
      featureColumns,
      targetColumn,
    });
    return {
      alpha: Number(alpha),
      model,
      validation: evaluateLianyingValueModel(validationRows, model),
      validationHybrid: {
        onePlusOne: evaluateLianyingHybridValueQuota(validationRows, model),
        twoPlusTwo: evaluateLianyingHybridValueQuota(validationRows, model, {
          baselineQuota: 2,
          valueQuota: 2,
        }),
      },
    };
  }).sort((left, right) => {
    const regret = left.validationHybrid.onePlusOne.meanRegret -
      right.validationHybrid.onePlusOne.meanRegret;
    if (regret !== 0) return regret;
    return left.validation.regression.rmse - right.validation.regression.rmse;
  });
  return {
    model: candidates[0].model,
    selectedAlpha: candidates[0].alpha,
    candidates: candidates.map(({ alpha, validation, validationHybrid }) => ({
      alpha,
      validation,
      validationHybrid,
    })),
  };
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

export function crossValidateLianyingRidgeValueModel(
  rows,
  options = {},
) {
  const sources = [...new Set(rows.map((row) => row.sourceAxis).filter(Boolean))]
    .sort();
  if (sources.length < 3) {
    throw new Error("逐轴留出交叉验证至少需要三条来源轴");
  }
  const folds = sources.map((testSource, index) => {
    const validationSource = sources[(index + 1) % sources.length];
    const foldRows = rows.map((row) => ({
      ...row,
      datasetSplit: row.sourceAxis === testSource
        ? "test"
        : row.sourceAxis === validationSource
          ? "validation"
          : "train",
    }));
    const selected = selectLianyingRidgeValueModel(foldRows, options);
    const testRows = foldRows.filter((row) => row.datasetSplit === "test");
    const baseline = evaluateLianyingValueModel(testRows);
    const ridge = evaluateLianyingValueModel(testRows, selected.model);
    const hybrid = evaluateLianyingHybridValueQuota(testRows, selected.model);
    return {
      testSource,
      validationSource,
      trainingSources: sources.filter(
        (source) => source !== testSource && source !== validationSource,
      ),
      selectedAlpha: selected.selectedAlpha,
      testRows: testRows.length,
      baseline,
      ridge,
      hybridOnePlusOne: hybrid,
      equalBudget: {
        oracleRecallDelta: hybrid.oracleRecall - baseline.ranking.top2Recall,
        meanRegretDelta: hybrid.meanRegret - baseline.ranking.meanTop2Regret,
      },
    };
  });
  return {
    sourceCount: sources.length,
    foldCount: folds.length,
    folds,
    aggregate: {
      baselineTop1Recall: average(folds.map(
        (fold) => fold.baseline.ranking.top1Recall)),
      ridgeTop1Recall: average(folds.map(
        (fold) => fold.ridge.ranking.top1Recall)),
      baselineTop2Recall: average(folds.map(
        (fold) => fold.baseline.ranking.top2Recall)),
      hybridOnePlusOneRecall: average(folds.map(
        (fold) => fold.hybridOnePlusOne.oracleRecall)),
      baselineTop2MeanRegret: average(folds.map(
        (fold) => fold.baseline.ranking.meanTop2Regret)),
      hybridOnePlusOneMeanRegret: average(folds.map(
        (fold) => fold.hybridOnePlusOne.meanRegret)),
      equalBudgetRecallDelta: average(folds.map(
        (fold) => fold.equalBudget.oracleRecallDelta)),
      equalBudgetMeanRegretDelta: average(folds.map(
        (fold) => fold.equalBudget.meanRegretDelta)),
      improvedEqualBudgetFolds: folds.filter((fold) =>
        fold.equalBudget.oracleRecallDelta > 0 ||
        (fold.equalBudget.oracleRecallDelta === 0 &&
          fold.equalBudget.meanRegretDelta < 0)).length,
    },
  };
}
