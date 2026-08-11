import { applyExpectedEquipmentDamage } from "../effects/expected-equipment.js";
import { frameToTicks, millisecondsToTicks, ticksToMilliseconds } from "../engine/clock.js";
import { createInitialState } from "../engine/state.js";
import {
  identifyRideThunderPairs,
  moveRidePrimary,
  moveOrangeSuffix,
  moveThunderPrefix,
  orangeRowIndices,
  rideRowIndices,
  thunderRowIndices,
} from "../policies/ride-thunder-binding.js";
import { profileRowTiming } from "../policies/orange-injection.js";
import { rankOrangeWindowRotations } from "../policies/orange-window-search.js";
import { replayProfileRows } from "../policies/profile-replay.js";
import { beamSearchThunderWindow } from "../policies/thunder-window-search.js";
import { buildThunderOptimizedOrangeCandidateReport } from "./orange-candidates.js";
import { summarize } from "./summary.js";

function replayRows(rows, runtime, durationSeconds) {
  return replayProfileRows(
    createInitialState(runtime.config, {
      rage: 5,
      ...runtime.initialStateOverrides,
    }),
    rows,
    runtime.config,
    runtime.oracle,
    { validateResource: false, combatEndSeconds: durationSeconds },
  );
}

function optimizeThunderCoordinates(
  initialRows,
  eventRows,
  targetRowsForEvent,
  runtime,
  durationSeconds,
  { passes = 1, refineCandidate = null } = {},
) {
  let rows = initialRows.map((row) => ({ ...row }));
  const positions = [...eventRows];
  let replay = replayRows(rows, runtime, durationSeconds);
  const initialDamage = replay.state.totalDamage;
  const steps = [];

  for (let pass = 0; pass < passes; pass += 1) {
    let passGain = 0;
    for (let eventIndex = 0; eventIndex < positions.length; eventIndex += 1) {
      const sourceIndex = positions[eventIndex];
      const damageBefore = replay.state.totalDamage;
      let bestRows = rows;
      let bestReplay = replay;
      let bestTarget = sourceIndex;
      let evaluated = 0;
      let legal = 0;
      const occupied = new Set(thunderRowIndices(rows));
      for (const targetIndex of targetRowsForEvent({
        eventIndex,
        sourceIndex,
        positions: [...positions],
        rows,
      })) {
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= rows.length) {
          continue;
        }
        if (targetIndex !== sourceIndex && occupied.has(targetIndex)) continue;
        evaluated += 1;
        try {
          const trialRows = moveThunderPrefix(rows, sourceIndex, targetIndex);
          const refined = refineCandidate
            ? refineCandidate(trialRows, targetIndex)
            : {
                rows: trialRows,
                replay: replayRows(trialRows, runtime, durationSeconds),
              };
          const trialReplay = refined.replay;
          legal += 1;
          if (trialReplay.state.totalDamage > bestReplay.state.totalDamage) {
            bestRows = refined.rows;
            bestReplay = trialReplay;
            bestTarget = targetIndex;
          }
        } catch {
          // 顺序充能、战意或后续技能不合法时淘汰该位置。
        }
      }
      rows = bestRows;
      replay = bestReplay;
      positions[eventIndex] = bestTarget;
      const damageGain = replay.state.totalDamage - damageBefore;
      passGain += damageGain;
      steps.push({
        pass: pass + 1,
        eventIndex,
        sourceRowIndex: sourceIndex,
        targetRowIndex: bestTarget,
        evaluated,
        legal,
        damageGain,
      });
    }
    if (passGain <= 0) break;
  }

  return {
    rows,
    replay,
    positions,
    steps,
    damageGain: replay.state.totalDamage - initialDamage,
  };
}

function optimizeThunderCoordinatesTwoStage(
  initialRows,
  eventRows,
  runtime,
  durationSeconds,
  {
    shortlistSize,
    nearbyRadius,
    refineCandidate,
  },
) {
  let rows = initialRows.map((row) => ({ ...row }));
  const positions = [...eventRows];
  let replay = replayRows(rows, runtime, durationSeconds);
  const initialDamage = replay.state.totalDamage;
  const steps = [];

  for (let eventIndex = 0; eventIndex < positions.length; eventIndex += 1) {
    const sourceIndex = positions[eventIndex];
    const damageBefore = replay.state.totalDamage;
    const occupied = new Set(thunderRowIndices(rows));
    const coarse = [];
    let coarseEvaluated = 0;
    for (let targetIndex = 0; targetIndex < rows.length; targetIndex += 1) {
      if (targetIndex !== sourceIndex && occupied.has(targetIndex)) continue;
      coarseEvaluated += 1;
      try {
        const trialRows = moveThunderPrefix(rows, sourceIndex, targetIndex);
        const trialReplay = replayRows(trialRows, runtime, durationSeconds);
        coarse.push({
          targetIndex,
          damage: trialReplay.state.totalDamage,
        });
      } catch {
        // 粗筛阶段不合法的原技能轴仍可由下方的近邻强制复评补充。
      }
    }
    coarse.sort((left, right) => right.damage - left.damage);
    const finalistTargets = new Set(
      coarse.slice(0, shortlistSize).map((candidate) => candidate.targetIndex),
    );
    finalistTargets.add(sourceIndex);
    for (let offset = -nearbyRadius; offset <= nearbyRadius; offset += 1) {
      const targetIndex = sourceIndex + offset;
      if (
        targetIndex >= 0 &&
        targetIndex < rows.length &&
        (targetIndex === sourceIndex || !occupied.has(targetIndex))
      ) {
        finalistTargets.add(targetIndex);
      }
    }

    let bestRows = rows;
    let bestReplay = replay;
    let bestTarget = sourceIndex;
    let refinedLegal = 0;
    for (const targetIndex of finalistTargets) {
      try {
        const movedRows = moveThunderPrefix(rows, sourceIndex, targetIndex);
        const refined = refineCandidate(movedRows, targetIndex);
        refinedLegal += 1;
        if (refined.replay.state.totalDamage > bestReplay.state.totalDamage) {
          bestRows = refined.rows;
          bestReplay = refined.replay;
          bestTarget = targetIndex;
        }
      } catch {
        // 偏移前缀或重排后无法完成全轴时淘汰。
      }
    }
    rows = bestRows;
    replay = bestReplay;
    positions[eventIndex] = bestTarget;
    steps.push({
      pass: 1,
      eventIndex,
      sourceRowIndex: sourceIndex,
      targetRowIndex: bestTarget,
      evaluated: coarseEvaluated,
      legal: coarse.length,
      shortlisted: finalistTargets.size,
      refinedLegal,
      damageGain: replay.state.totalDamage - damageBefore,
    });
  }

  return {
    rows,
    replay,
    positions,
    steps,
    damageGain: replay.state.totalDamage - initialDamage,
  };
}

function reoptimizeThunderWindow(
  rows,
  thunderRowIndex,
  runtime,
  durationSeconds,
  {
    beamWidth,
    fullEvaluationLimit,
    searchStartRowIndex = thunderRowIndex,
  },
) {
  const timing = profileRowTiming(thunderRowIndex, runtime.config);
  const untilTick = timing.startTick + frameToTicks(runtime.config.durations.thunder);
  const searchFromTick = profileRowTiming(searchStartRowIndex, runtime.config).startTick;
  const rowIndices = [];
  for (let rowIndex = searchStartRowIndex; rowIndex < rows.length; rowIndex += 1) {
    if (profileRowTiming(rowIndex, runtime.config).startTick >= untilTick) break;
    rowIndices.push(rowIndex);
  }
  const prefix = replayRows(rows.slice(0, searchStartRowIndex), runtime, null);
  const search = beamSearchThunderWindow(
    prefix.state,
    rowIndices.map((rowIndex) => rows[rowIndex]),
    runtime.config,
    runtime.oracle,
    {
      windowFromTick: searchFromTick,
      windowUntilTick: untilTick,
      beamWidth,
    },
  );
  let bestRows = null;
  let bestReplay = null;
  for (const rotation of search.ranked.slice(0, fullEvaluationLimit)) {
    const trialRows = rows.map((row) => ({ ...row }));
    rowIndices.forEach((rowIndex, index) => {
      trialRows[rowIndex] = { ...rotation.rows[index] };
    });
    try {
      const replay = replayRows(trialRows, runtime, durationSeconds);
      if (!bestReplay || replay.state.totalDamage > bestReplay.state.totalDamage) {
        bestRows = trialRows;
        bestReplay = replay;
      }
    } catch {
      // 局部合法但无法完成全轴回放的候选不采用。
    }
  }
  if (!bestReplay) {
    throw new Error(`第${thunderRowIndex + 1}行偏移后没有可完整回放的激雷窗口`);
  }
  return { rows: bestRows, replay: bestReplay };
}

function optimizeRideOffsets(
  initialRows,
  pairs,
  rideOffsets,
  runtime,
  durationSeconds,
  { beamWidth, fullEvaluationLimit },
) {
  let rows = initialRows.map((row) => ({ ...row }));
  const ridePositions = pairs.map((pair) => pair.rideRowIndex);
  let replay = replayRows(rows, runtime, durationSeconds);
  const initialDamage = replay.state.totalDamage;
  const steps = [];

  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    const sourceIndex = ridePositions[pairIndex];
    const thunderRowIndex = pairs[pairIndex].thunderRowIndex;
    const occupied = new Set(rideRowIndices(rows));
    const damageBefore = replay.state.totalDamage;
    let bestRows = rows;
    let bestReplay = replay;
    let bestTarget = sourceIndex;
    let evaluated = 0;
    let legal = 0;

    for (const offset of rideOffsets) {
      const targetIndex = thunderRowIndex + offset;
      if (targetIndex < 0 || targetIndex >= rows.length) continue;
      if (targetIndex !== sourceIndex && occupied.has(targetIndex)) continue;
      evaluated += 1;
      try {
        const movedRows = moveRidePrimary(rows, sourceIndex, targetIndex);
        const refined = reoptimizeThunderWindow(
          movedRows,
          thunderRowIndex,
          runtime,
          durationSeconds,
          {
            beamWidth,
            fullEvaluationLimit,
            searchStartRowIndex: Math.min(sourceIndex, targetIndex, thunderRowIndex),
          },
        );
        legal += 1;
        if (refined.replay.state.totalDamage > bestReplay.state.totalDamage) {
          bestRows = refined.rows;
          bestReplay = refined.replay;
          bestTarget = targetIndex;
        }
      } catch {
        // 移动任驰骋后若下马、充能或后续轴不合法，则淘汰该偏移。
      }
    }
    rows = bestRows;
    replay = bestReplay;
    ridePositions[pairIndex] = bestTarget;
    steps.push({
      pairIndex,
      thunderRowIndex,
      sourceRowIndex: sourceIndex,
      targetRowIndex: bestTarget,
      oldOffset: sourceIndex - thunderRowIndex,
      newOffset: bestTarget - thunderRowIndex,
      evaluated,
      legal,
      damageGain: replay.state.totalDamage - damageBefore,
    });
  }

  return {
    rows,
    replay,
    positions: ridePositions,
    steps,
    damageGain: replay.state.totalDamage - initialDamage,
  };
}

function reoptimizeOrangeWindow(
  rows,
  orangeRowIndex,
  runtime,
  durationSeconds,
  { fullEvaluationLimit },
) {
  const activationTick = profileRowTiming(orangeRowIndex, runtime.config).orangeTick;
  const untilTick = activationTick + frameToTicks(runtime.config.durations.orange);
  const rowIndices = [];
  for (let rowIndex = orangeRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const startTick = profileRowTiming(rowIndex, runtime.config).startTick;
    if (startTick >= untilTick) break;
    if (startTick >= activationTick) rowIndices.push(rowIndex);
  }
  const prefix = replayRows(rows.slice(0, orangeRowIndex + 1), runtime, null);
  const search = rankOrangeWindowRotations(
    prefix.state,
    rowIndices.map((rowIndex) => rows[rowIndex]),
    runtime.config,
    runtime.oracle,
    { orangeFromTick: activationTick },
  );
  let bestRows = null;
  let bestReplay = null;
  for (const rotation of search.ranked.slice(0, fullEvaluationLimit)) {
    const trialRows = rows.map((row) => ({ ...row }));
    rowIndices.forEach((rowIndex, index) => {
      trialRows[rowIndex] = { ...rotation.rows[index] };
    });
    try {
      const replay = replayRows(trialRows, runtime, durationSeconds);
      if (!bestReplay || replay.state.totalDamage > bestReplay.state.totalDamage) {
        bestRows = trialRows;
        bestReplay = replay;
      }
    } catch {
      // 橙武局部解无法完成全轴回放时淘汰。
    }
  }
  if (!bestReplay) {
    throw new Error(`第${orangeRowIndex + 1}行橙武偏移后没有可完整回放的窗口`);
  }
  return { rows: bestRows, replay: bestReplay };
}

function optimizeOrangeCoordinatesTwoStage(
  initialRows,
  runtime,
  durationSeconds,
  {
    shortlistSize,
    nearbyRadius,
    fullEvaluationLimit,
  },
) {
  let rows = initialRows.map((row) => ({ ...row }));
  const positions = orangeRowIndices(rows);
  let replay = replayRows(rows, runtime, durationSeconds);
  const initialDamage = replay.state.totalDamage;
  const steps = [];
  const combatEndTick = millisecondsToTicks(durationSeconds * 1000);
  const orangeDurationTicks = frameToTicks(runtime.config.durations.orange);

  for (let eventIndex = 0; eventIndex < positions.length; eventIndex += 1) {
    const sourceIndex = positions[eventIndex];
    const damageBefore = replay.state.totalDamage;
    const occupied = new Set(orangeRowIndices(rows));
    const coarse = [];
    for (let targetIndex = 0; targetIndex < rows.length; targetIndex += 1) {
      if (targetIndex !== sourceIndex && occupied.has(targetIndex)) continue;
      const activationTick = profileRowTiming(targetIndex, runtime.config).orangeTick;
      if (activationTick + orangeDurationTicks > combatEndTick) continue;
      try {
        const movedRows = moveOrangeSuffix(rows, sourceIndex, targetIndex);
        const trialReplay = replayRows(movedRows, runtime, durationSeconds);
        coarse.push({ targetIndex, damage: trialReplay.state.totalDamage });
      } catch {
        // 原主要技能序列不合法的橙武位置不进入粗筛排名。
      }
    }
    coarse.sort((left, right) => right.damage - left.damage);
    const finalists = new Set(
      coarse.slice(0, shortlistSize).map((candidate) => candidate.targetIndex),
    );
    finalists.add(sourceIndex);
    for (let offset = -nearbyRadius; offset <= nearbyRadius; offset += 1) {
      const targetIndex = sourceIndex + offset;
      if (targetIndex < 0 || targetIndex >= rows.length) continue;
      if (targetIndex !== sourceIndex && occupied.has(targetIndex)) continue;
      const activationTick = profileRowTiming(targetIndex, runtime.config).orangeTick;
      if (activationTick + orangeDurationTicks <= combatEndTick) finalists.add(targetIndex);
    }

    let bestRows = rows;
    let bestReplay = replay;
    let bestTarget = sourceIndex;
    let refinedLegal = 0;
    for (const targetIndex of finalists) {
      try {
        const movedRows = moveOrangeSuffix(rows, sourceIndex, targetIndex);
        const refined = reoptimizeOrangeWindow(
          movedRows,
          targetIndex,
          runtime,
          durationSeconds,
          { fullEvaluationLimit },
        );
        refinedLegal += 1;
        if (refined.replay.state.totalDamage > bestReplay.state.totalDamage) {
          bestRows = refined.rows;
          bestReplay = refined.replay;
          bestTarget = targetIndex;
        }
      } catch {
        // 冷却或完整轴不合法的候选不采用。
      }
    }
    rows = bestRows;
    replay = bestReplay;
    positions[eventIndex] = bestTarget;
    steps.push({
      eventIndex,
      sourceRowIndex: sourceIndex,
      targetRowIndex: bestTarget,
      coarseLegal: coarse.length,
      shortlisted: finalists.size,
      refinedLegal,
      damageGain: replay.state.totalDamage - damageBefore,
    });
  }
  return {
    rows,
    replay,
    positions,
    steps,
    damageGain: replay.state.totalDamage - initialDamage,
  };
}

function rideThunderCoverage(state, config) {
  const rideDurationTicks = frameToTicks(config.durations.ride);
  const thunderDurationTicks = frameToTicks(config.durations.thunder);
  const rideWindows = state.timeline
    .filter((event) => event.type === "cast" && event.action === "ride")
    .map((event) => {
      const fromTick = millisecondsToTicks(event.completionAtMs);
      return { fromTick, untilTick: fromTick + rideDurationTicks };
    });
  const thunderWindows = state.timeline
    .filter((event) => event.type === "offGcd" && event.action === "thunder")
    .map((event, index) => {
      const fromTick = event.tick;
      const untilTick = fromTick + thunderDurationTicks;
      const overlapTicks = rideWindows.reduce(
        (sum, ride) =>
          sum + Math.max(
            0,
            Math.min(untilTick, ride.untilTick) - Math.max(fromTick, ride.fromTick),
          ),
        0,
      );
      return {
        thunder: index + 1,
        fromSeconds: event.timeMs / 1000,
        rideOverlapSeconds: ticksToMilliseconds(overlapTicks) / 1000,
      };
    });
  return {
    rideWindows,
    thunderWindows,
    pairedThunderCount: thunderWindows.filter((window) => window.rideOverlapSeconds > 0).length,
    totalOverlapSeconds: thunderWindows.reduce(
      (sum, window) => sum + window.rideOverlapSeconds,
      0,
    ),
  };
}

function finishCase(id, label, rows, rawReplay, runtime, durationSeconds, search = null) {
  const state = applyExpectedEquipmentDamage(
    rawReplay.state,
    runtime.expectedEquipmentEffects,
    runtime.panel,
    runtime.oracle,
    { durationSeconds },
  );
  const summary = summarize(state, runtime.config, runtime.oracle);
  const coverage = rideThunderCoverage(rawReplay.state, runtime.config);
  const fangs = rawReplay.state.timeline.filter(
    (event) => event.type === "cast" && event.action === "dragonFang",
  );
  return {
    id,
    label,
    rows,
    summary,
    totalDamage: summary.totalDamage,
    dps: summary.dps,
    pairedThunderCount: coverage.pairedThunderCount,
    rideThunderOverlapSeconds: coverage.totalOverlapSeconds,
    thunderWindows: coverage.thunderWindows,
    thunderDragonFangs: fangs.filter((event) => event.thunder).length,
    rideThunderDragonFangs: fangs.filter((event) => event.thunder && event.ride).length,
    tripleDragonFangs: fangs.filter(
      (event) => event.thunder && event.ride && event.orange,
    ).length,
    search,
  };
}

export function buildRideThunderBindingReport(
  baselineRows,
  runtime,
  {
    durationSeconds = 180,
    beamWidth = 128,
    fullEvaluationLimit = 24,
    softOffsets = [-1, 0, 1, 2],
    softReoptimizeBeamWidth = 64,
    softReoptimizeFullLimit = 8,
    freeShortlistSize = 6,
    freeNearbyRadius = 2,
    freeReoptimizeBeamWidth = 32,
    freeReoptimizeFullLimit = 4,
    checkpointsSeconds = [150, 155, 160, 165, 170, 175, 180],
  } = {},
) {
  const optimized = buildThunderOptimizedOrangeCandidateReport(
    baselineRows,
    runtime,
    { durationSeconds, beamWidth, fullEvaluationLimit },
  );
  const leading = optimized.candidates.find((candidate) => candidate.id === "onCooldown");
  if (!leading) throw new Error("缺少冷却到点橙武候选轴");
  const baseRows = leading.rows.map((row) => ({ ...row }));
  const baseReplay = replayRows(baseRows, runtime, durationSeconds);
  const structure = identifyRideThunderPairs(baseRows);

  const soft = optimizeThunderCoordinates(
    baseRows,
    structure.pairs.map((pair) => pair.thunderRowIndex),
    ({ eventIndex }) => {
      const rideRowIndex = structure.pairs[eventIndex].rideRowIndex;
      return softOffsets.map((offset) => rideRowIndex + offset);
    },
    runtime,
    durationSeconds,
    {
      refineCandidate: (rows, thunderRowIndex) =>
        reoptimizeThunderWindow(
          rows,
          thunderRowIndex,
          runtime,
          durationSeconds,
          {
            beamWidth: softReoptimizeBeamWidth,
            fullEvaluationLimit: softReoptimizeFullLimit,
          },
        ),
    },
  );
  const free = optimizeThunderCoordinatesTwoStage(
    baseRows,
    thunderRowIndices(baseRows),
    runtime,
    durationSeconds,
    {
      shortlistSize: freeShortlistSize,
      nearbyRadius: freeNearbyRadius,
      refineCandidate: (rows, thunderRowIndex) =>
        reoptimizeThunderWindow(
          rows,
          thunderRowIndex,
          runtime,
          durationSeconds,
          {
            beamWidth: freeReoptimizeBeamWidth,
            fullEvaluationLimit: freeReoptimizeFullLimit,
          },
        ),
    },
  );

  const cases = [
    finishCase(
      "fixedBinding",
      "原6组任雷+1次单雷",
      baseRows,
      baseReplay,
      runtime,
      durationSeconds,
    ),
    finishCase(
      "softBinding",
      "任驰骋附近软绑定+重排18秒轴",
      soft.rows,
      soft.replay,
      runtime,
      durationSeconds,
      soft,
    ),
    finishCase(
      "freeThunder",
      "激雷全行粗筛+候选位重排18秒轴",
      free.rows,
      free.replay,
      runtime,
      durationSeconds,
      free,
    ),
  ];
  const baseDamage = cases[0].totalDamage;
  for (const candidate of cases) {
    candidate.damageDelta = candidate.totalDamage - baseDamage;
    candidate.dpsDelta = candidate.dps - cases[0].dps;
  }
  const checkpointComparison = checkpointsSeconds.map((seconds) => {
    const fixed = replayRows(cases[0].rows, runtime, seconds);
    const softReplay = replayRows(cases[1].rows, runtime, seconds);
    const damageDelta = softReplay.state.totalDamage - fixed.state.totalDamage;
    return {
      seconds,
      fixedDamage: fixed.state.totalDamage,
      softDamage: softReplay.state.totalDamage,
      damageDelta,
      dpsDelta: damageDelta / seconds,
    };
  });

  return {
    durationSeconds,
    beamWidth,
    fullEvaluationLimit,
    softOffsets,
    softReoptimizeBeamWidth,
    softReoptimizeFullLimit,
    freeShortlistSize,
    freeNearbyRadius,
    freeReoptimizeBeamWidth,
    freeReoptimizeFullLimit,
    checkpointsSeconds,
    checkpointComparison,
    sourceStructure: structure,
    cases,
  };
}

export function buildRidePlacementReport(
  baselineRows,
  runtime,
  {
    durationSeconds = 180,
    beamWidth = 128,
    fullEvaluationLimit = 24,
    rideOffsets = [-2, -1, 0, 1],
    rideReoptimizeBeamWidth = 64,
    rideReoptimizeFullLimit = 8,
    checkpointsSeconds = [150, 155, 160, 165, 170, 175, 180],
  } = {},
) {
  const optimized = buildThunderOptimizedOrangeCandidateReport(
    baselineRows,
    runtime,
    { durationSeconds, beamWidth, fullEvaluationLimit },
  );
  const leading = optimized.candidates.find((candidate) => candidate.id === "onCooldown");
  if (!leading) throw new Error("缺少冷却到点橙武候选轴");
  const baseRows = leading.rows.map((row) => ({ ...row }));
  const baseReplay = replayRows(baseRows, runtime, durationSeconds);
  const structure = identifyRideThunderPairs(baseRows);
  const moved = optimizeRideOffsets(
    baseRows,
    structure.pairs,
    rideOffsets,
    runtime,
    durationSeconds,
    {
      beamWidth: rideReoptimizeBeamWidth,
      fullEvaluationLimit: rideReoptimizeFullLimit,
    },
  );
  const cases = [
    finishCase(
      "fixedRide",
      "原任驰骋位置",
      baseRows,
      baseReplay,
      runtime,
      durationSeconds,
    ),
    finishCase(
      "softRide",
      "任驰骋相对激雷软偏移+重排窗口",
      moved.rows,
      moved.replay,
      runtime,
      durationSeconds,
      moved,
    ),
  ];
  for (const candidate of cases) {
    candidate.damageDelta = candidate.totalDamage - cases[0].totalDamage;
    candidate.dpsDelta = candidate.dps - cases[0].dps;
    candidate.dismounts = Number(candidate.summary.actionCounts.dismount ?? 0);
  }
  const checkpointComparison = checkpointsSeconds.map((seconds) => {
    const fixed = replayRows(cases[0].rows, runtime, seconds);
    const soft = replayRows(cases[1].rows, runtime, seconds);
    const damageDelta = soft.state.totalDamage - fixed.state.totalDamage;
    return {
      seconds,
      damageDelta,
      dpsDelta: damageDelta / seconds,
    };
  });
  return {
    durationSeconds,
    beamWidth,
    fullEvaluationLimit,
    rideOffsets,
    rideReoptimizeBeamWidth,
    rideReoptimizeFullLimit,
    sourceStructure: structure,
    checkpointComparison,
    cases,
  };
}

export function buildJointCoordinationReport(
  baselineRows,
  runtime,
  {
    durationSeconds = 180,
    beamWidth = 128,
    fullEvaluationLimit = 24,
    iterations = 2,
    rideOffsets = [-2, -1, 0, 1],
    rideBeamWidth = 32,
    rideFullLimit = 4,
    thunderShortlistSize = 4,
    thunderNearbyRadius = 2,
    thunderBeamWidth = 32,
    thunderFullLimit = 4,
    orangeShortlistSize = 4,
    orangeNearbyRadius = 3,
    orangeFullLimit = 6,
    checkpointsSeconds = [150, 155, 160, 165, 170, 175, 180],
  } = {},
) {
  const optimized = buildThunderOptimizedOrangeCandidateReport(
    baselineRows,
    runtime,
    { durationSeconds, beamWidth, fullEvaluationLimit },
  );
  const leading = optimized.candidates.find((candidate) => candidate.id === "onCooldown");
  if (!leading) throw new Error("缺少冷却到点橙武候选轴");
  const baseRows = leading.rows.map((row) => ({ ...row }));
  const baseReplay = replayRows(baseRows, runtime, durationSeconds);
  let rows = baseRows;
  let replay = baseReplay;
  const phases = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const structure = identifyRideThunderPairs(rows);
    const ride = optimizeRideOffsets(
      rows,
      structure.pairs,
      rideOffsets,
      runtime,
      durationSeconds,
      { beamWidth: rideBeamWidth, fullEvaluationLimit: rideFullLimit },
    );
    phases.push({
      iteration,
      phase: "ride",
      damageGain: ride.damageGain,
      moves: ride.steps.filter((step) => step.damageGain > 0),
    });
    rows = ride.rows;
    replay = ride.replay;

    const thunder = optimizeThunderCoordinatesTwoStage(
      rows,
      thunderRowIndices(rows),
      runtime,
      durationSeconds,
      {
        shortlistSize: thunderShortlistSize,
        nearbyRadius: thunderNearbyRadius,
        refineCandidate: (candidateRows, thunderRowIndex) =>
          reoptimizeThunderWindow(
            candidateRows,
            thunderRowIndex,
            runtime,
            durationSeconds,
            {
              beamWidth: thunderBeamWidth,
              fullEvaluationLimit: thunderFullLimit,
            },
          ),
      },
    );
    phases.push({
      iteration,
      phase: "thunder",
      damageGain: thunder.damageGain,
      moves: thunder.steps.filter((step) => step.damageGain > 0),
    });
    rows = thunder.rows;
    replay = thunder.replay;

    const orange = optimizeOrangeCoordinatesTwoStage(
      rows,
      runtime,
      durationSeconds,
      {
        shortlistSize: orangeShortlistSize,
        nearbyRadius: orangeNearbyRadius,
        fullEvaluationLimit: orangeFullLimit,
      },
    );
    phases.push({
      iteration,
      phase: "orange",
      damageGain: orange.damageGain,
      moves: orange.steps.filter((step) => step.damageGain > 0),
    });
    rows = orange.rows;
    replay = orange.replay;

    if (
      phases.slice(-3).every((phase) => phase.damageGain <= 0)
    ) {
      break;
    }
  }

  const cases = [
    finishCase(
      "jointBase",
      "18秒窗口优化后的冷却到点基准",
      baseRows,
      baseReplay,
      runtime,
      durationSeconds,
    ),
    finishCase(
      "jointOptimized",
      "任驰骋→激雷→橙武联合坐标迭代",
      rows,
      replay,
      runtime,
      durationSeconds,
      { phases },
    ),
  ];
  for (const candidate of cases) {
    candidate.damageDelta = candidate.totalDamage - cases[0].totalDamage;
    candidate.dpsDelta = candidate.dps - cases[0].dps;
    candidate.dismounts = Number(candidate.summary.actionCounts.dismount ?? 0);
    candidate.orangeUses = Number(candidate.summary.actionCounts.orange ?? 0);
  }
  const checkpointComparison = checkpointsSeconds.map((seconds) => {
    const fixed = replayRows(cases[0].rows, runtime, seconds);
    const joint = replayRows(cases[1].rows, runtime, seconds);
    const damageDelta = joint.state.totalDamage - fixed.state.totalDamage;
    return { seconds, damageDelta, dpsDelta: damageDelta / seconds };
  });
  return {
    durationSeconds,
    beamWidth,
    fullEvaluationLimit,
    iterations,
    phases,
    checkpointComparison,
    cases,
  };
}
