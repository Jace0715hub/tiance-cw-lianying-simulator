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
