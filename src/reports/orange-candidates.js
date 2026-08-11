import { applyExpectedEquipmentDamage } from "../effects/expected-equipment.js";
import { frameToTicks, ticksToMilliseconds } from "../engine/clock.js";
import { createInitialState } from "../engine/state.js";
import {
  buildOrangeLianyingCandidates,
  profileRowTiming,
  windowOverlapTicks,
} from "../policies/orange-injection.js";
import { rankOrangeWindowRotations } from "../policies/orange-window-search.js";
import { replayProfileRows } from "../policies/profile-replay.js";
import { beamSearchThunderWindow } from "../policies/thunder-window-search.js";
import { summarizeOrangeWindows } from "./orange-window.js";
import { summarize } from "./summary.js";

function replayRows(rows, runtime, durationSeconds = null) {
  return replayProfileRows(
    createInitialState(runtime.config, {
      rage: 5,
      ...runtime.initialStateOverrides,
    }),
    rows,
    runtime.config,
    runtime.oracle,
    {
      validateResource: false,
      combatEndSeconds: durationSeconds,
    },
  );
}

function finishReplay(rows, runtime, durationSeconds) {
  const replay = replayRows(rows, runtime, durationSeconds);
  const state = applyExpectedEquipmentDamage(
    replay.state,
    runtime.expectedEquipmentEffects,
    runtime.panel,
    runtime.oracle,
    { durationSeconds },
  );
  return {
    state,
    trace: replay.trace,
    summary: summarize(state, runtime.config, runtime.oracle),
  };
}

function windowRowIndices(selection, rowCount, config) {
  const untilTick = selection.orangeTick + frameToTicks(config.durations.orange);
  const indices = [];
  for (let rowIndex = selection.rowIndex + 1; rowIndex < rowCount; rowIndex += 1) {
    const timing = profileRowTiming(rowIndex, config);
    if (timing.startTick >= untilTick) break;
    if (timing.startTick >= selection.orangeTick) indices.push(rowIndex);
  }
  return indices;
}

function actualThunderWindows(state, config) {
  const durationTicks = frameToTicks(config.durations.thunder);
  return state.timeline
    .filter((event) => event.type === "offGcd" && event.action === "thunder")
    .map((event) => ({
      fromTick: event.tick,
      untilTick: event.tick + durationTicks,
    }));
}

function summarizeCandidate(candidate, replay, baseline, runtime) {
  const windows = summarizeOrangeWindows(replay.state, runtime.config);
  const thunderWindows = actualThunderWindows(replay.state, runtime.config);
  const overlapTicks = windows.reduce(
    (total, window) =>
      total + windowOverlapTicks(window.fromTick, window.untilTick, thunderWindows),
    0,
  );
  const totalDamage = replay.summary.totalDamage;
  return {
    id: candidate.id,
    label: candidate.label,
    selectedRows: candidate.selections.map((selection) => ({
      rowIndex: selection.rowIndex,
      rowNumber: selection.rowIndex + 1,
      skill: selection.label,
      activationSeconds: selection.orangeSeconds,
    })),
    orangeUses: windows.length,
    thunderOverlapSeconds: ticksToMilliseconds(overlapTicks) / 1000,
    orangeDragonFangs: replay.summary.dragonFang.underOrange,
    orangeThunderDragonFangs: windows.reduce(
      (sum, window) => sum + window.underThunder,
      0,
    ),
    orangeRideDragonFangs: windows.reduce(
      (sum, window) => sum + window.dragonRideEnhanced,
      0,
    ),
    orangeWindowDamage: windows.reduce(
      (sum, window) => sum + window.totalDamage,
      0,
    ),
    windows,
    totalDamage,
    dps: replay.summary.dps,
    damageGain: totalDamage - baseline.summary.totalDamage,
    dpsGain: replay.summary.dps - baseline.summary.dps,
    summary: replay.summary,
    traceLength: replay.trace.length,
  };
}

export function buildOrangeCandidateReport(
  baselineRows,
  runtime,
  { durationSeconds = 180 } = {},
) {
  const baseline = finishReplay(baselineRows, runtime, durationSeconds);
  const candidates = buildOrangeLianyingCandidates(
    baselineRows,
    runtime.config,
    { durationSeconds },
  ).map((candidate) => {
    const replay = finishReplay(candidate.rows, runtime, durationSeconds);
    return summarizeCandidate(candidate, replay, baseline, runtime);
  });

  return {
    durationSeconds,
    baseline: {
      totalDamage: baseline.summary.totalDamage,
      dps: baseline.summary.dps,
      summary: baseline.summary,
      traceLength: baseline.trace.length,
    },
    candidates,
  };
}

export function buildLocallyOptimizedOrangeCandidateReport(
  baselineRows,
  runtime,
  { durationSeconds = 180 } = {},
) {
  const baseline = finishReplay(baselineRows, runtime, durationSeconds);
  const definitions = buildOrangeLianyingCandidates(
    baselineRows,
    runtime.config,
    { durationSeconds },
  );
  const candidates = definitions.map((candidate) => {
    let rows = candidate.rows.map((row) => ({ ...row }));
    const searches = [];

    for (const selection of candidate.selections) {
      const prefix = replayRows(
        rows.slice(0, selection.rowIndex + 1),
        runtime,
      );
      const rowIndices = windowRowIndices(
        selection,
        rows.length,
        runtime.config,
      );
      const search = rankOrangeWindowRotations(
        prefix.state,
        rowIndices.map((rowIndex) => rows[rowIndex]),
        runtime.config,
        runtime.oracle,
        { orangeFromTick: selection.orangeTick },
      );
      let accepted = null;
      let rejectedByFullReplay = 0;
      for (const rotation of search.ranked) {
        const trialRows = rows.map((row) => ({ ...row }));
        rowIndices.forEach((rowIndex, index) => {
          trialRows[rowIndex] = { ...rotation.rows[index] };
        });
        try {
          replayRows(trialRows, runtime, durationSeconds);
          rows = trialRows;
          accepted = rotation;
          break;
        } catch {
          rejectedByFullReplay += 1;
        }
      }
      if (!accepted) {
        throw new Error(`第${selection.rowIndex + 1}行橙武窗口没有可完整回放的局部技能序列`);
      }
      searches.push({
        activationRowIndex: selection.rowIndex,
        activationSeconds: selection.orangeSeconds,
        rowIndices,
        explored: search.explored,
        locallyLegal: search.legal,
        rejectedByFullReplay,
        skills: accepted.skills,
        windowDamage: accepted.damage,
        dragonFangs: accepted.dragonFangs,
        thunderDragonFangs: accepted.thunderDragonFangs,
        rideDragonFangs: accepted.rideDragonFangs,
      });
    }

    const replay = finishReplay(rows, runtime, durationSeconds);
    return {
      ...summarizeCandidate(candidate, replay, baseline, runtime),
      selections: candidate.selections,
      rows,
      searches,
    };
  });

  return {
    durationSeconds,
    baseline: {
      totalDamage: baseline.summary.totalDamage,
      dps: baseline.summary.dps,
      summary: baseline.summary,
      traceLength: baseline.trace.length,
    },
    candidates,
  };
}

export function buildThunderOptimizedOrangeCandidateReport(
  baselineRows,
  runtime,
  {
    durationSeconds = 180,
    beamWidth = 256,
    fullEvaluationLimit = 32,
  } = {},
) {
  if (!Number.isInteger(fullEvaluationLimit) || fullEvaluationLimit <= 0) {
    throw new Error("完整轴复评数量必须是正整数");
  }
  const local = buildLocallyOptimizedOrangeCandidateReport(
    baselineRows,
    runtime,
    { durationSeconds },
  );
  const baseline = { summary: local.baseline.summary };
  const thunderDurationTicks = frameToTicks(runtime.config.durations.thunder);
  const candidates = local.candidates.map((candidate) => {
    let rows = candidate.rows.map((row) => ({ ...row }));
    let currentFullReplay = replayRows(rows, runtime, durationSeconds);
    const thunderRows = rows
      .map((row, rowIndex) => ({ rowIndex, label: String(row.skill ?? row.label ?? "") }))
      .filter((row) => row.label.includes("雷"));
    const thunderSearches = [];

    for (const thunder of thunderRows) {
      const timing = profileRowTiming(thunder.rowIndex, runtime.config);
      const windowUntilTick = timing.startTick + thunderDurationTicks;
      const rowIndices = [];
      for (let rowIndex = thunder.rowIndex; rowIndex < rows.length; rowIndex += 1) {
        const rowTiming = profileRowTiming(rowIndex, runtime.config);
        if (rowTiming.startTick >= windowUntilTick) break;
        rowIndices.push(rowIndex);
      }
      const prefix = replayRows(rows.slice(0, thunder.rowIndex), runtime);
      const search = beamSearchThunderWindow(
        prefix.state,
        rowIndices.map((rowIndex) => rows[rowIndex]),
        runtime.config,
        runtime.oracle,
        {
          windowFromTick: timing.startTick,
          windowUntilTick,
          beamWidth,
        },
      );
      const damageBefore = currentFullReplay.state.totalDamage;
      let accepted = null;
      let acceptedRank = null;
      let bestRows = rows;
      let bestFullReplay = currentFullReplay;
      let bestDamage = damageBefore;
      let rejectedByFullReplay = 0;
      let evaluatedByFullReplay = 0;
      const finalists = search.ranked.slice(0, fullEvaluationLimit);
      for (let rank = 0; rank < finalists.length; rank += 1) {
        const rotation = finalists[rank];
        const trialRows = rows.map((row) => ({ ...row }));
        rowIndices.forEach((rowIndex, index) => {
          trialRows[rowIndex] = { ...rotation.rows[index] };
        });
        try {
          const trialReplay = replayRows(trialRows, runtime, durationSeconds);
          evaluatedByFullReplay += 1;
          if (trialReplay.state.totalDamage > bestDamage) {
            bestRows = trialRows;
            bestFullReplay = trialReplay;
            bestDamage = trialReplay.state.totalDamage;
            accepted = rotation;
            acceptedRank = rank + 1;
          }
        } catch {
          rejectedByFullReplay += 1;
        }
      }
      rows = bestRows;
      currentFullReplay = bestFullReplay;
      const selectedSkills = accepted
        ? accepted.skills
        : rowIndices.map((rowIndex) => String(rows[rowIndex].skill ?? rows[rowIndex].label));
      const selectedWindowEvents = currentFullReplay.state.timeline.filter(
        (event) => event.tick >= timing.startTick && event.tick < windowUntilTick,
      );
      const selectedFangs = selectedWindowEvents.filter(
        (event) => event.type === "cast" && event.action === "dragonFang",
      );
      thunderSearches.push({
        activationRowIndex: thunder.rowIndex,
        activationSeconds: timing.startSeconds,
        rowIndices,
        beamWidth: search.beamWidth,
        exploredTransitions: search.exploredTransitions,
        legalTransitions: search.legalTransitions,
        terminalStates: search.ranked.length,
        fullEvaluationLimit,
        evaluatedByFullReplay,
        rejectedByFullReplay,
        acceptedRank,
        retainedPreviousAxis: accepted === null,
        fullDamageGain: bestDamage - damageBefore,
        skills: selectedSkills,
        windowDamage: selectedWindowEvents
          .filter((event) => event.type === "damage")
          .reduce((sum, event) => sum + Number(event.amount), 0),
        dragonFangs: selectedFangs.length,
        orangeDragonFangs: selectedFangs.filter((event) => event.orange).length,
        rideDragonFangs: selectedFangs.filter((event) => event.dragonRideBonus).length,
        depthStats: search.depthStats,
      });
    }

    const replay = finishReplay(rows, runtime, durationSeconds);
    return {
      ...summarizeCandidate(candidate, replay, baseline, runtime),
      selections: candidate.selections,
      rows,
      orangeSearches: candidate.searches,
      thunderSearches,
    };
  });

  return {
    durationSeconds,
    beamWidth,
    fullEvaluationLimit,
    baseline: local.baseline,
    candidates,
  };
}
