import { BASELINE_COMPONENT_TO_SKILL } from "./baseline-alignment.js";

const COMPONENT_TO_SKILL = Object.freeze({
  ...BASELINE_COMPONENT_TO_SKILL,
  destroyPoLouLan: "灭",
  destroyStrain: "灭",
  dash: "突",
});

function eventExpectedCount(event) {
  return Number(event.expectedCount ?? 1);
}

function damageGroups(state) {
  const groups = new Map();
  for (const event of state.timeline ?? []) {
    if (event.type !== "damage") continue;
    const skill = event.component === "bleedTick"
      ? Number(event.bleedQuality) === 2 ? "流血-战心" : "流血"
      : COMPONENT_TO_SKILL[event.component] ?? event.component;
    const current = groups.get(skill) ?? { count: 0, damage: 0 };
    current.count += eventExpectedCount(event);
    current.damage += Number(event.amount ?? 0);
    groups.set(skill, current);
  }
  return groups;
}

export function buildLianyingExcelSkillCalibration(alignment) {
  return Object.fromEntries((alignment.rows ?? []).map((row) => {
    const simulatedDamage = Number(row.simulatedDamage ?? 0);
    return [row.skill, {
      skill: row.skill,
      factor: simulatedDamage === 0
        ? 1
        : Number(row.excelDamage ?? 0) / simulatedDamage,
      excelDamage: Number(row.excelDamage ?? 0),
      simulatedDamage,
      excelCount: Number(row.excelCount ?? 0),
      simulatedCount: Number(row.simulatedCount ?? 0),
    }];
  }));
}

export function scoreLianyingStateWithSkillCalibration(
  state,
  calibration,
) {
  const groups = damageGroups(state);
  const rows = [...groups.entries()].map(([skill, group]) => {
    const factor = Number(calibration?.[skill]?.factor ?? 1);
    return {
      skill,
      count: group.count,
      eventDamage: group.damage,
      factor,
      calibratedDamage: group.damage * factor,
      correction: group.damage * (factor - 1),
      calibrated: Object.hasOwn(calibration ?? {}, skill),
    };
  }).sort((left, right) => right.eventDamage - left.eventDamage);
  return {
    eventDamage: rows.reduce((sum, row) => sum + row.eventDamage, 0),
    calibratedDamage: rows.reduce(
      (sum, row) => sum + row.calibratedDamage,
      0,
    ),
    correction: rows.reduce((sum, row) => sum + row.correction, 0),
    rows,
  };
}

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function actionSignature(action) {
  if (typeof action === "string") return { id: action };
  return {
    id: action?.id,
    leadFrames: action?.leadFrames ?? null,
    lockFrames: action?.lockFrames ?? null,
    latencyMs: action?.latencyMs ?? null,
  };
}

function actionPackSignature(pack) {
  return JSON.stringify({
    prefix: (pack?.prefix ?? []).map(actionSignature),
    primary: actionSignature(pack?.primary),
    tail: (pack?.tail ?? []).map(actionSignature),
  });
}

export function firstLianyingActionPackDifference(left, right) {
  const length = Math.max(left?.length ?? 0, right?.length ?? 0);
  for (let index = 0; index < length; index += 1) {
    if (actionPackSignature(left?.[index]) !== actionPackSignature(right?.[index])) {
      return index + 1;
    }
  }
  return null;
}

function openingDamageSignature(state, eventCount) {
  return (state.timeline ?? [])
    .filter((event) =>
      event.type === "damage" && event.trigger !== "expectedEquipment")
    .slice(0, eventCount)
    .map((event) => JSON.stringify([
      event.tick,
      event.component,
      Number(event.amount),
    ]));
}

function rankedIds(candidates, field) {
  return [...candidates]
    .sort((left, right) => right[field] - left[field])
    .map((candidate) => candidate.id);
}

const DIVINE_STACK_PLAYER_HIT_ACTIONS = Object.freeze(new Set([
  "dragonFang",
  "destroy",
  "dragonRoar",
  "cloudStrike",
  "charge",
  "dash",
]));

function divineStackPlayerHits(state) {
  return (state.timeline ?? [])
    .filter((event) =>
      (event.type === "cast" || event.type === "offGcd") &&
      DIVINE_STACK_PLAYER_HIT_ACTIONS.has(event.action))
    .map((event) => ({
      tick: Number(event.tick),
      timeMs: Number(event.timeMs),
      action: event.action,
      thunder: Boolean(event.thunder),
      ride: Boolean(event.ride),
      orange: Boolean(event.orange),
      mounted: Boolean(event.mounted),
    }));
}

export function analyzeLianyingDivineStackBoundary(
  candidates,
  { requiredStacks = 5, durationMs = 6000 } = {},
) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("神兵无双边界核查至少需要一条候选轴");
  }
  const rows = candidates.map((candidate) => {
    const hits = divineStackPlayerHits(candidate.state);
    const firstHits = hits.slice(0, requiredStacks);
    let maxGapAfterFullMs = 0;
    for (let index = requiredStacks; index < hits.length; index += 1) {
      maxGapAfterFullMs = Math.max(
        maxGapAfterFullMs,
        hits[index].timeMs - hits[index - 1].timeMs,
      );
    }
    return {
      candidateId: candidate.id,
      hitCount: hits.length,
      reachesFullStacks: firstHits.length === requiredStacks,
      firstHits,
      fullStacksAtMs: firstHits.at(-1)?.timeMs ?? null,
      maxGapAfterFullMs,
      keepsFullStacksBetweenLaterHits:
        firstHits.length === requiredStacks && maxGapAfterFullMs < durationMs,
    };
  });
  const baselineSignature = JSON.stringify(rows[0].firstHits);
  const openingPlayerHitStateEquivalent = rows.every(
    (row) => JSON.stringify(row.firstHits) === baselineSignature,
  );
  return {
    requiredStacks,
    durationMs,
    conservativeHitDefinition:
      "只把会直接命中目标的玩家技能动作计为一层；不把自动攻击、流血跳和同一技能的派生伤害另算层数",
    openingPlayerHitStateEquivalent,
    allReachAndKeepFullStacks: rows.every(
      (row) => row.reachesFullStacks && row.keepsFullStacksBetweenLaterHits,
    ),
    candidateSpecificStackPathRisk:
      !openingPlayerHitStateEquivalent || rows.some(
        (row) => !row.reachesFullStacks || !row.keepsFullStacksBetweenLaterHits,
      ),
    candidates: rows,
  };
}

export function analyzeLianyingOrangeHitBoundary(
  candidates,
  {
    durationMs = 6000,
    expectedDragonFangsPerWindow = 5,
    representativeHitDelaysMs = [0, 62.5, 125, 250, 500, 1000],
  } = {},
) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("橙武命中边界核查至少需要一条候选轴");
  }
  const ticksPerMs = 16;
  const rows = candidates.map((candidate) => {
    const timeline = candidate.state?.timeline ?? [];
    const orangeEvents = timeline.filter(
      (event) => event.type === "offGcd" && event.action === "orange",
    );
    const dragonFangEvents = timeline.filter(
      (event) => event.type === "cast" && event.action === "dragonFang",
    );
    const windows = orangeEvents.map((orange, index) => {
      const endTick = Number(orange.tick) + durationMs * ticksPerMs;
      const covered = dragonFangEvents.filter((fang) =>
        Number(fang.tick) >= Number(orange.tick) &&
        Number(fang.tick) < endTick);
      const last = covered.at(-1) ?? null;
      const lastCastMarginMs = last === null
        ? null
        : (endTick - Number(last.tick)) / ticksPerMs;
      return {
        windowIndex: index + 1,
        startMs: Number(orange.timeMs),
        endMs: Number(orange.timeMs) + durationMs,
        dragonFangCount: covered.length,
        lastDragonFangCastMs: last?.timeMs ?? null,
        lastCastMarginMs,
      };
    });
    const margins = windows
      .map((window) => window.lastCastMarginMs)
      .filter((margin) => margin !== null);
    const safeHitDelayExclusiveMs = margins.length === windows.length
      ? Math.min(...margins)
      : null;
    return {
      candidateId: candidate.id,
      orangeWindowCount: windows.length,
      allWindowsHaveExpectedDragonFangs: windows.every(
        (window) => window.dragonFangCount === expectedDragonFangsPerWindow,
      ),
      safeHitDelayExclusiveMs,
      representativeHitDelays: representativeHitDelaysMs.map((hitDelayMs) => ({
        hitDelayMs,
        castAndHitJudgmentEquivalent:
          safeHitDelayExclusiveMs !== null &&
          hitDelayMs < safeHitDelayExclusiveMs,
      })),
      windows,
    };
  });
  const boundarySignature = (row) => JSON.stringify({
    windowCount: row.orangeWindowCount,
    margins: row.windows.map((window) => window.lastCastMarginMs),
    fangCounts: row.windows.map((window) => window.dragonFangCount),
  });
  const candidateBoundariesEquivalent = rows.every(
    (row) => boundarySignature(row) === boundarySignature(rows[0]),
  );
  const globalSafeHitDelayExclusiveMs = rows.every(
    (row) => row.safeHitDelayExclusiveMs !== null,
  )
    ? Math.min(...rows.map((row) => row.safeHitDelayExclusiveMs))
    : null;
  return {
    durationMs,
    expectedDragonFangsPerWindow,
    judgment: "橙武窗口为半开区间；若命中延迟严格小于最后一牙施展时剩余窗口，则施展时与命中时判定完全等价",
    candidateBoundariesEquivalent,
    globalSafeHitDelayExclusiveMs,
    currentAxisAtRiskUnderRepresentativeDelays:
      representativeHitDelaysMs.some((hitDelayMs) =>
        globalSafeHitDelayExclusiveMs === null ||
        hitDelayMs >= globalSafeHitDelayExclusiveMs),
    representativeHitDelaysMs,
    candidates: rows,
  };
}

export const LIANYING_FORMULA_UNCERTAINTY_GROUPS = Object.freeze([
  Object.freeze({
    id: "orangeWeapon",
    label: "大橙武附伤",
    skills: Object.freeze(["画角闻龙", "龙牙·神兵"]),
  }),
  Object.freeze({
    id: "dragonFangCore",
    label: "龙牙主体与派生",
    skills: Object.freeze(["龙牙", "龙血", "新破招(牙)"]),
  }),
  Object.freeze({
    id: "resourceFillers",
    label: "龙吟/穿云/断魂刺",
    skills: Object.freeze(["龙吟", "穿云", "断魂刺"]),
  }),
  Object.freeze({
    id: "dashBreak",
    label: "突与破军/破罡",
    skills: Object.freeze(["突", "破军", "破罡"]),
  }),
  Object.freeze({
    id: "periodic",
    label: "流血与梅花枪法",
    skills: Object.freeze(["流血", "流血-战心", "梅花枪法"]),
  }),
  Object.freeze({
    id: "destroy",
    label: "灭及破楼兰/破绽派生",
    skills: Object.freeze(["灭"]),
  }),
]);

function candidateGroupDamage(candidate, group, damageField) {
  return (candidate.skillRows ?? [])
    .filter((row) => group.skills.includes(row.skill))
    .reduce((sum, row) => sum + Number(row[damageField] ?? 0), 0);
}

function cartesianMultipliers(groups, levels, visit, index = 0, current = {}) {
  if (index >= groups.length) {
    visit(current);
    return;
  }
  const group = groups[index];
  for (const level of levels) {
    cartesianMultipliers(groups, levels, visit, index + 1, {
      ...current,
      [group.id]: level,
    });
  }
}

function analyzeFormulaBasis(candidates, groups, {
  totalField,
  damageField,
  grids,
}) {
  const baseline = candidates[0];
  const groupDamage = Object.fromEntries(candidates.map((candidate) => [
    candidate.id,
    Object.fromEntries(groups.map((group) => [
      group.id,
      candidateGroupDamage(candidate, group, damageField),
    ])),
  ]));
  const singleGroupBreakEvens = candidates.slice(1).map((candidate) => {
    const baseDelta = Number(candidate[totalField]) - Number(baseline[totalField]);
    return {
      candidateId: candidate.id,
      baseDelta,
      groups: groups.map((group) => {
        const candidateGroupDelta =
          groupDamage[candidate.id][group.id] -
          groupDamage[baseline.id][group.id];
        const rawMultiplier = Math.abs(candidateGroupDelta) < 1e-9
          ? null
          : 1 - baseDelta / candidateGroupDelta;
        const positiveMultiplier = rawMultiplier !== null && rawMultiplier >= -1e-9
          ? Math.max(0, rawMultiplier)
          : null;
        return {
          groupId: group.id,
          candidateGroupDelta,
          breakEvenMultiplier: positiveMultiplier,
          requiredRelativeChange: positiveMultiplier === null
            ? null
            : positiveMultiplier - 1,
          crossingDirection: positiveMultiplier === null
            ? null
            : candidateGroupDelta > 0 ? "increase" : "decrease",
        };
      }),
    };
  });
  const gridResults = grids.map((grid) => {
    const winnerCounts = Object.fromEntries(
      candidates.map((candidate) => [candidate.id, 0]),
    );
    let scenarioCount = 0;
    let changedWinnerScenarioCount = 0;
    let minimumBaselineMargin = Number.POSITIVE_INFINITY;
    let worstScenario = null;
    const changedWinnerExamples = [];
    cartesianMultipliers(groups, grid.levels, (multipliers) => {
      const scored = candidates.map((candidate) => {
        const adjustment = groups.reduce((sum, group) => sum +
          groupDamage[candidate.id][group.id] *
            (multipliers[group.id] - 1), 0);
        return {
          id: candidate.id,
          damage: Number(candidate[totalField]) + adjustment,
        };
      }).sort((left, right) => right.damage - left.damage);
      const winner = scored[0];
      const baselineScore = scored.find((entry) => entry.id === baseline.id);
      const bestCompetitor = scored.find((entry) => entry.id !== baseline.id);
      const margin = baselineScore.damage - bestCompetitor.damage;
      scenarioCount += 1;
      winnerCounts[winner.id] += 1;
      if (winner.id !== baseline.id) {
        changedWinnerScenarioCount += 1;
        if (changedWinnerExamples.length < 10) {
          changedWinnerExamples.push({
            multipliers,
            winnerId: winner.id,
            winnerMargin: winner.damage - baselineScore.damage,
          });
        }
      }
      if (margin < minimumBaselineMargin) {
        minimumBaselineMargin = margin;
        worstScenario = {
          multipliers,
          bestCompetitorId: bestCompetitor.id,
          baselineMargin: margin,
        };
      }
    });
    return {
      id: grid.id,
      levels: grid.levels,
      scenarioCount,
      winnerCounts,
      changedWinnerScenarioCount,
      baselineWinsAllScenarios: changedWinnerScenarioCount === 0,
      continuousHyperrectangleCertified: minimumBaselineMargin > 1e-6,
      minimumBaselineMargin,
      worstScenario,
      changedWinnerExamples,
    };
  });
  return {
    baselineId: baseline.id,
    totalField,
    damageField,
    groupDamage,
    singleGroupBreakEvens,
    grids: gridResults,
  };
}

export function analyzeLianyingFormulaUncertainty(
  candidates,
  {
    groups = LIANYING_FORMULA_UNCERTAINTY_GROUPS,
    grids = [
      { id: "plausible-10-percent", levels: [0.9, 1, 1.1] },
      { id: "stress-25-percent", levels: [0.75, 1, 1.25] },
    ],
  } = {},
) {
  if (!Array.isArray(candidates) || candidates.length < 2) {
    throw new Error("公式误差分析至少需要正式轴和一条对照轴");
  }
  return {
    method: "各互斥技能组相对当前口径独立乘权；总伤害关于乘数为仿射函数，因此包含上下界全部角点的网格若仍有严格正边际，即同时证明连续误差盒内不会翻转",
    groups: groups.map((group) => ({
      id: group.id,
      label: group.label,
      skills: [...group.skills],
    })),
    native: analyzeFormulaBasis(candidates, groups, {
      totalField: "eventDamage",
      damageField: "eventDamage",
      grids,
    }),
    excelCalibrated: analyzeFormulaBasis(candidates, groups, {
      totalField: "calibratedDamage",
      damageField: "calibratedDamage",
      grids,
    }),
  };
}

export function compareLianyingRankingSensitivity(
  candidates,
  calibration,
  { openingDamageEventCount = 5 } = {},
) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("排序敏感性核查至少需要一条候选轴");
  }
  const baseline = candidates[0];
  const baselineOpening = openingDamageSignature(
    baseline.state,
    openingDamageEventCount,
  );
  const scored = candidates.map((candidate) => {
    const score = scoreLianyingStateWithSkillCalibration(
      candidate.state,
      calibration,
    );
    return {
      id: candidate.id,
      label: candidate.label ?? candidate.id,
      source: candidate.source ?? null,
      firstDifferenceRow: firstLianyingActionPackDifference(
        baseline.packs,
        candidate.packs,
      ),
      openingDamageEventsIdentical:
        JSON.stringify(openingDamageSignature(
          candidate.state,
          openingDamageEventCount,
        )) === JSON.stringify(baselineOpening),
      eventDamage: score.eventDamage,
      calibratedDamage: score.calibratedDamage,
      calibrationCorrection: score.correction,
      eventDamageDelta: score.eventDamage - Number(
        baseline.state.totalDamage,
      ),
      skillRows: score.rows,
    };
  });
  const baselineScored = scored[0];
  for (const candidate of scored) {
    candidate.eventDamageDelta = candidate.eventDamage - baselineScored.eventDamage;
    candidate.calibratedDamageDelta =
      candidate.calibratedDamage - baselineScored.calibratedDamage;
  }
  const eventRanking = rankedIds(scored, "eventDamage");
  const calibratedRanking = rankedIds(scored, "calibratedDamage");
  return {
    openingDamageEventCount,
    openingBoundaryEquivalent: scored.every(
      (candidate) => candidate.openingDamageEventsIdentical,
    ),
    eventRanking,
    calibratedRanking,
    rankingStable: JSON.stringify(eventRanking) === JSON.stringify(calibratedRanking),
    winnerStable: eventRanking[0] === calibratedRanking[0],
    candidates: scored,
  };
}

export const LIANYING_SENSITIVITY_COMPONENT_TO_SKILL = COMPONENT_TO_SKILL;
