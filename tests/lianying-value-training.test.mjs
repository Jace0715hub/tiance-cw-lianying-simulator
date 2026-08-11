import test from "node:test";
import assert from "node:assert/strict";
import {
  addLianyingValueCenteredTargets,
  lianyingValueDatasetSplit,
  lianyingValueTrainingToCsv,
  lianyingValueTrainingToJsonl,
  prepareLianyingValueTrainingRows,
  summarizeLianyingValueTrainingRows,
} from "../src/reports/lianying-value-training.js";

const rows = [{
  traceId: "p1:thunder-1-to-2:a0",
  nodeId: 2,
  parentNodeId: 1,
  thunderLineage: [20],
  actionPrimary: "dragonFang",
  remainingDamageResidual: 123.5,
  rage: 4,
}];

test("状态价值数据按整条轨迹稳定划分，避免父子节点泄漏", () => {
  const split = lianyingValueDatasetSplit(rows[0].traceId);
  assert.equal(lianyingValueDatasetSplit(rows[0].traceId), split);
  assert.ok(["train", "validation", "test"].includes(split));
  const grouped = prepareLianyingValueTrainingRows([
    ...rows,
    { ...rows[0], nodeId: 3 },
    { ...rows[0], traceId: "trace-b", nodeId: 4 },
    { ...rows[0], traceId: "trace-c", nodeId: 5 },
  ]);
  assert.equal(grouped[0].datasetSplit, grouped[1].datasetSplit);
  assert.deepEqual(
    new Set(grouped.map((row) => row.datasetSplit)),
    new Set(["train", "validation", "test"]),
  );
});

test("多种子数据可以按完整来源轴隔离划分", () => {
  const sourceRows = ["axis-a", "axis-b", "axis-c"].flatMap((sourceAxis) => [
    { ...rows[0], sourceAxis, traceId: "trace-1" },
    { ...rows[0], sourceAxis, traceId: "trace-2", nodeId: 3 },
  ]);
  const grouped = prepareLianyingValueTrainingRows(sourceRows, {
    splitGroup: "source-axis",
  });
  for (const sourceAxis of ["axis-a", "axis-b", "axis-c"]) {
    assert.equal(
      new Set(grouped
        .filter((row) => row.sourceAxis === sourceAxis)
        .map((row) => row.datasetSplit)).size,
      1,
    );
  }
  assert.deepEqual(
    new Set(grouped.map((row) => row.datasetSplit)),
    new Set(["train", "validation", "test"]),
  );
});

test("状态价值数据可导出CSV和JSONL并汇总残差", () => {
  const csv = lianyingValueTrainingToCsv(rows);
  const jsonl = lianyingValueTrainingToJsonl(rows);
  const summary = summarizeLianyingValueTrainingRows(rows);

  assert.match(csv, /datasetSplit,traceId/);
  assert.match(csv, /,\[20\],/);
  assert.equal(JSON.parse(jsonl).rage, 4);
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.traceCount, 1);
  assert.equal(summary.residual.mean, 123.5);
});

test("同一决策层中心化残差保持相对排序并消除组均值", () => {
  const centered = addLianyingValueCenteredTargets([
    { ...rows[0], nodeId: 1, remainingDamageResidual: 10 },
    { ...rows[0], nodeId: 2, remainingDamageResidual: 30 },
  ]);
  assert.deepEqual(
    centered.map((row) => row.centeredRemainingDamageResidual),
    [-10, 10],
  );
});
