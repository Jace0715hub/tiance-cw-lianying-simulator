import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import { LIANYING_CURRENT_BEST_AXIS } from
  "../src/config/lianying-research-defaults.js";
import { millisecondsToTicks } from "../src/engine/clock.js";
import { executeActionPack } from "../src/engine/simulator.js";
import { createInitialState } from "../src/engine/state.js";
import { replayWhitepaperLianying } from
  "../src/policies/whitepaper-lianying.js";
import { auditWhitepaperAxis } from "../src/reports/whitepaper-audit.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputStem = path.resolve(
  process.argv[2] ?? path.join(projectRoot, "output/lianying-event-timing-robustness"),
);
const formalPath = path.join(projectRoot, LIANYING_CURRENT_BEST_AXIS);
const previousPath = path.join(
  projectRoot,
  "output/lianying-free-fixed-180s-pair-anchor-wait.json",
);
const formal = JSON.parse(fs.readFileSync(formalPath, "utf8"));
const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));
const durationSeconds = 180;
const targetRows = Object.freeze({ firstThunder: 3, secondThunder: 38 });
const formalLeads = Object.freeze({ firstThunder: 7, secondThunder: 5 });
const latencyValues = [30, 60, 90];
const gridLeads = Array.from({ length: 12 }, (_, index) => index + 1);

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function withThunderLead(packs, rowNumber, leadFrames) {
  const next = structuredClone(packs);
  const pack = next[rowNumber - 1];
  const index = (pack?.tail ?? []).findIndex(
    (action) => actionId(action) === "thunder",
  );
  if (index < 0) throw new Error(`第${rowNumber}行没有GCD末端撼如雷`);
  const source = pack.tail[index];
  pack.tail[index] = {
    ...(typeof source === "string" ? { id: source } : source),
    leadFrames,
  };
  return next;
}

function timingVariant(firstLead, secondLead) {
  return withThunderLead(
    withThunderLead(formal.actionPacks, targetRows.firstThunder, firstLead),
    targetRows.secondThunder,
    secondLead,
  );
}

function diagnoseFailure(runtime, packs) {
  const endTick = millisecondsToTicks(durationSeconds * 1000);
  let state = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  for (let index = 0; index < packs.length; index += 1) {
    try {
      state = executeActionPack(
        state,
        packs[index],
        runtime.config,
        runtime.oracle,
        { endTick },
      );
    } catch (error) {
      return {
        rowNumber: index + 1,
        seconds: state.timeMs / 1000,
        rage: state.rage,
        dragonRideStacks: state.dragonRideStacks,
        message: error.message,
      };
    }
  }
  return null;
}

function evaluate(runtime, packs, id, firstLead, secondLead) {
  try {
    const replay = replayWhitepaperLianying(runtime, packs, { durationSeconds });
    const audit = auditWhitepaperAxis(replay.state, { mode: "fixed" });
    return {
      id,
      firstLead,
      secondLead,
      legal: audit.mechanics.passed,
      mechanicsViolationCount: audit.mechanics.violationCount,
      rotationDamage: replay.state.totalDamage,
      finalRage: replay.state.rage,
      finalDragonRideStacks: replay.state.dragonRideStacks,
      failure: null,
    };
  } catch (error) {
    return {
      id,
      firstLead,
      secondLead,
      legal: false,
      mechanicsViolationCount: null,
      rotationDamage: null,
      finalRage: null,
      finalDragonRideStacks: null,
      failure: diagnoseFailure(runtime, packs) ?? { message: error.message },
    };
  }
}

const cases = latencyValues.map((latencyMs) => {
  const runtime = loadDefaultGearRuntime({
    rotation: "lianying",
    executePhase: true,
    latencyMs,
  });
  const formalResult = evaluate(
    runtime,
    formal.actionPacks,
    "formal",
    formalLeads.firstThunder,
    formalLeads.secondThunder,
  );
  const previousResult = evaluate(
    runtime,
    previous.actionPacks,
    "previousTiming",
    1,
    1,
  );
  const grid = [];
  for (const firstLead of gridLeads) {
    for (const secondLead of gridLeads) {
      grid.push(evaluate(
        runtime,
        timingVariant(firstLead, secondLead),
        `lead-${firstLead}-${secondLead}`,
        firstLead,
        secondLead,
      ));
    }
  }
  const legalGrid = grid.filter((entry) => entry.legal).sort((left, right) =>
    right.rotationDamage - left.rotationDamage ||
    left.firstLead - right.firstLead ||
    left.secondLead - right.secondLead);
  const best = legalGrid[0] ?? null;
  const local = grid.filter((entry) =>
    Math.abs(entry.firstLead - formalLeads.firstThunder) <= 1 &&
    Math.abs(entry.secondLead - formalLeads.secondThunder) <= 1);
  const localLegal = local.filter((entry) => entry.legal).sort((left, right) =>
    right.rotationDamage - left.rotationDamage);
  return {
    latencyMs,
    formal: formalResult,
    previousTiming: previousResult,
    formalDamageDeltaFromPrevious:
      formalResult.legal && previousResult.legal
        ? formalResult.rotationDamage - previousResult.rotationDamage
        : null,
    boundedGrid: {
      firstLeadRange: [gridLeads[0], gridLeads.at(-1)],
      secondLeadRange: [gridLeads[0], gridLeads.at(-1)],
      explored: grid.length,
      legal: legalGrid.length,
      best,
      bestDamageDeltaFromFormal:
        best && formalResult.legal
          ? best.rotationDamage - formalResult.rotationDamage
          : null,
      bestDamageDeltaFromPrevious:
        best && previousResult.legal
          ? best.rotationDamage - previousResult.rotationDamage
          : null,
    },
    plusMinusOne: {
      explored: local.length,
      legal: localLegal.length,
      best: localLegal[0] ?? null,
      candidates: local,
    },
  };
});

const report = {
  schemaVersion: 1,
  kind: "lianying-event-timing-robustness",
  durationSeconds,
  formalPath: path.relative(projectRoot, formalPath),
  previousPath: path.relative(projectRoot, previousPath),
  targetRows,
  formalLeads,
  interpretation: {
    formalObjective: "五段加速、30ms总延迟下的固定180秒理论最高伤害轴",
    latencyCases: "60/90ms只评估同一主要技能轴的时点迁移，不替代各延迟独立重新搜索",
    acceptance: "30ms正式轴必须合法且在前后1帧及1–12帧有界网格内不低于其他时点",
  },
  cases,
};
fs.writeFileSync(`${outputStem}.json`, `${JSON.stringify(report, null, 2)}\n`);

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

const headers = [
  "总延迟ms",
  "正式轴合法",
  "正式轴伤害",
  "正式轴失败行",
  "上一时点轴伤害",
  "正式轴相对上一轴",
  "网格合法数",
  "最佳第一雷提前帧",
  "最佳第二雷提前帧",
  "网格最佳伤害",
  "网格最佳相对正式轴",
  "网格最佳相对上一轴",
];
const rows = cases.map((entry) => [
  entry.latencyMs,
  entry.formal.legal,
  entry.formal.rotationDamage,
  entry.formal.failure?.rowNumber,
  entry.previousTiming.rotationDamage,
  entry.formalDamageDeltaFromPrevious,
  entry.boundedGrid.legal,
  entry.boundedGrid.best?.firstLead,
  entry.boundedGrid.best?.secondLead,
  entry.boundedGrid.best?.rotationDamage,
  entry.boundedGrid.bestDamageDeltaFromFormal,
  entry.boundedGrid.bestDamageDeltaFromPrevious,
]);
fs.writeFileSync(
  `${outputStem}.csv`,
  `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
);

console.log(JSON.stringify({
  outputStem,
  cases: cases.map((entry) => ({
    latencyMs: entry.latencyMs,
    formalLegal: entry.formal.legal,
    formalFailure: entry.formal.failure,
    formalDamageDeltaFromPrevious: entry.formalDamageDeltaFromPrevious,
    gridLegal: entry.boundedGrid.legal,
    bestFirstLead: entry.boundedGrid.best?.firstLead,
    bestSecondLead: entry.boundedGrid.best?.secondLead,
    bestRotationDamage: entry.boundedGrid.best?.rotationDamage,
    bestDamageDeltaFromFormal: entry.boundedGrid.bestDamageDeltaFromFormal,
    bestDamageDeltaFromPrevious: entry.boundedGrid.bestDamageDeltaFromPrevious,
  })),
}, null, 2));
