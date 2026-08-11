import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { buildJointCoordinationReport } from "../src/reports/ride-thunder-binding.js";
import {
  buildOptimizedAxisArtifact,
  optimizedAxisToCsv,
} from "../src/reports/optimized-axis-export.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../data/excel-v1.3-profile-reference.json", import.meta.url),
    "utf8",
  ),
);
const beamWidth = Number(process.argv[2] ?? 128);
const fullEvaluationLimit = Number(process.argv[3] ?? 24);
const iterations = Number(process.argv[4] ?? 4);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.resolve(process.argv[5] ?? path.join(projectRoot, "output"));
const runtime = loadDefaultGearRuntime({ rotation: "lianying" });
const report = buildJointCoordinationReport(
  fixture.profiles.lianying.rows,
  runtime,
  {
    durationSeconds: fixture.durationSeconds,
    beamWidth,
    fullEvaluationLimit,
    iterations,
  },
);
const artifact = buildOptimizedAxisArtifact(report, runtime, {
  durationSeconds: fixture.durationSeconds,
});

fs.mkdirSync(outputDirectory, { recursive: true });
const jsonPath = path.join(outputDirectory, "joint-optimized-180s.json");
const csvPath = path.join(outputDirectory, "joint-optimized-180s.csv");
fs.writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
fs.writeFileSync(csvPath, `\uFEFF${optimizedAxisToCsv(artifact)}\n`, "utf8");

console.log(JSON.stringify({
  jsonPath,
  csvPath,
  rows: artifact.rows.length,
  dps: artifact.summary.dps,
  totalDamage: artifact.summary.totalDamage,
}, null, 2));
