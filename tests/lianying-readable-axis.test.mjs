import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { lianyingAxisToReadableMarkdown } from
  "../src/reports/lianying-readable-axis.js";

const artifact = JSON.parse(fs.readFileSync(new URL(
  "../output/lianying-free-fixed-180s-dismount-triple-transfer.json",
  import.meta.url,
)));

test("正式轴可导出包含全部技能行和七个雷区段的可读Markdown", () => {
  const markdown = lianyingAxisToReadableMarkdown(artifact, {
    sourcePath: "output/formal.json",
  });
  assert.equal((markdown.match(/^## 第\d雷区段$/gm) ?? []).length, 7);
  assert.equal((markdown.match(/^\d+ \|/gm) ?? []).length, artifact.rows.length);
  assert.match(markdown, /第3雷区段/);
  assert.match(markdown, /龙牙→下马\+突/);
  assert.match(markdown, /含装备与附魔总DPS/);
});
