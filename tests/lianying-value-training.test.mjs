import test from "node:test";
import assert from "node:assert/strict";
import {
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
