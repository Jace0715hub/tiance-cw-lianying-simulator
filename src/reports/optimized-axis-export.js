import { applyExpectedEquipmentDamage } from "../effects/expected-equipment.js";
import { createInitialState } from "../engine/state.js";
import { replayProfileRows } from "../policies/profile-replay.js";
import { summarize } from "./summary.js";

function rowDamage(events) {
  const damageEvents = events.filter((event) => event.type === "damage");
  const breakdown = {};
  for (const event of damageEvents) {
    breakdown[event.component] =
      Number(breakdown[event.component] ?? 0) + Number(event.amount);
  }
  return {
    total: damageEvents.reduce((sum, event) => sum + Number(event.amount), 0),
    breakdown,
  };
}

function cleanPhase(phase) {
  return {
    iteration: phase.iteration,
    phase: phase.phase,
    damageGain: phase.damageGain,
    moves: phase.moves.map((move) => ({ ...move })),
  };
}

export function buildOptimizedAxisArtifact(
  jointReport,
  runtime,
  { durationSeconds = jointReport.durationSeconds ?? 180 } = {},
) {
  const optimized = jointReport.cases.find((candidate) => candidate.id === "jointOptimized");
  if (!optimized) throw new Error("联合搜索报告缺少收敛轴");
  const replay = replayProfileRows(
    createInitialState(runtime.config, {
      rage: 5,
      ...runtime.initialStateOverrides,
    }),
    optimized.rows,
    runtime.config,
    runtime.oracle,
    { validateResource: false, combatEndSeconds: durationSeconds },
  );
  const finalState = applyExpectedEquipmentDamage(
    replay.state,
    runtime.expectedEquipmentEffects,
    runtime.panel,
    runtime.oracle,
    { durationSeconds },
  );
  const summary = summarize(finalState, runtime.config, runtime.oracle);
  const axisRows = replay.trace.map((trace) => {
    const events = replay.state.timeline.filter(
      (event) =>
        event.sequence >= trace.sequenceFrom &&
        event.sequence <= trace.sequenceUntil,
    );
    const damage = rowDamage(events);
    return {
      rowNumber: trace.index + 1,
      rowIndex: trace.index,
      skill: trace.label,
      startSeconds: trace.startTimeMs / 1000,
      castSeconds: trace.castTimeMs / 1000,
      endSeconds: trace.endTimeMs / 1000,
      rageBefore: trace.actualBefore,
      rageAfter: trace.actualAfter,
      dragonRideBefore: trace.dragonRideStacksBefore,
      dragonRideAfter: trace.dragonRideStacksAfter,
      mountedBefore: trace.mountedBefore,
      mountedAfter: trace.mountedAfter,
      autoDismounted: trace.autoDismounted,
      bleedStacksAfter: trace.bleedStacksAfter,
      bleedQualityAfter: trace.bleedQualityAfter,
      buffsAtCast: { ...trace.buffsAtCast },
      rowDamage: damage.total,
      damageBreakdown: damage.breakdown,
    };
  });

  return {
    schemaVersion: 1,
    kind: "tiance-cw-lianying-optimized-axis",
    durationSeconds,
    search: {
      baseBeamWidth: jointReport.beamWidth,
      baseFullEvaluationLimit: jointReport.fullEvaluationLimit,
      requestedIterations: jointReport.iterations,
      completedIterations: Math.max(
        0,
        ...jointReport.phases.map((phase) => Number(phase.iteration)),
      ),
      phases: jointReport.phases.map(cleanPhase),
      checkpointComparison: jointReport.checkpointComparison.map((checkpoint) => ({
        ...checkpoint,
      })),
    },
    timing: {
      haste: runtime.panel.haste,
      latencyMs: runtime.config.latencyMs,
      gcdFrames: runtime.config.gcdFrames,
      rideCastFrames: runtime.config.rideCastFrames,
      dotIntervalFrames: runtime.config.dotIntervalFrames,
      autoAttackIntervalFrames: runtime.config.autoAttackIntervalFrames,
    },
    panel: { ...runtime.panel },
    summary,
    rows: axisRows,
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function optimizedAxisToCsv(artifact) {
  const headers = [
    "行号",
    "技能",
    "开始秒",
    "施展秒",
    "结束秒",
    "战意前",
    "战意后",
    "龙驭前",
    "龙驭后",
    "施展前马上",
    "结算后马上",
    "自动下马",
    "激雷",
    "橙武",
    "驰骋",
    "流血",
    "破军窗口",
    "流血层数",
    "流血品质",
    "本行伤害",
    "伤害明细JSON",
  ];
  const rows = artifact.rows.map((row) => [
    row.rowNumber,
    row.skill,
    row.startSeconds,
    row.castSeconds,
    row.endSeconds,
    row.rageBefore,
    row.rageAfter,
    row.dragonRideBefore,
    row.dragonRideAfter,
    Number(row.mountedBefore),
    Number(row.mountedAfter),
    Number(row.autoDismounted),
    Number(row.buffsAtCast.thunder),
    Number(row.buffsAtCast.orange),
    Number(row.buffsAtCast.ride),
    Number(row.buffsAtCast.bleed),
    Number(row.buffsAtCast.breakArmy),
    row.bleedStacksAfter,
    row.bleedQualityAfter,
    row.rowDamage,
    JSON.stringify(row.damageBreakdown),
  ]);
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}
