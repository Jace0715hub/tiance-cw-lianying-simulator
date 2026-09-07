import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLianyingResearchPath } from
  "../src/config/lianying-research-defaults.js";
import { lianyingAxisToReadableMarkdown } from
  "../src/reports/lianying-readable-axis.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolveLianyingResearchPath(projectRoot, process.argv[2]);
const outputPath = path.resolve(
  process.argv[3] ?? inputPath.replace(/\.json$/i, "-readable.md"),
);
const artifact = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const markdown = lianyingAxisToReadableMarkdown(artifact, {
  sourcePath: path.relative(projectRoot, inputPath),
});
fs.writeFileSync(outputPath, `${markdown}\n`);
console.log(JSON.stringify({ inputPath, outputPath, rows: artifact.rows.length }, null, 2));
