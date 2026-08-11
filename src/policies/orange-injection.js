import {
  frameToTicks,
  gcdLockTicks,
  millisecondsToTicks,
  ticksToMilliseconds,
} from "../engine/clock.js";

function rowLabel(row) {
  return String(row?.skill ?? row?.label ?? "").trim();
}

function mergeWindows(windows) {
  const sorted = windows
    .map((window) => ({ fromTick: window.fromTick, untilTick: window.untilTick }))
    .sort((left, right) => left.fromTick - right.fromTick);
  const merged = [];
  for (const window of sorted) {
    const previous = merged.at(-1);
    if (!previous || window.fromTick > previous.untilTick) {
      merged.push({ ...window });
    } else {
      previous.untilTick = Math.max(previous.untilTick, window.untilTick);
    }
  }
  return merged;
}

export function profileRowTiming(
  rowIndex,
  config,
  { orangeLeadFrames = 1 } = {},
) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new Error("技能表行号必须是非负整数");
  }
  const gcdTicks = gcdLockTicks(config.gcdFrames, config.latencyMs);
  const startTick = rowIndex * gcdTicks;
  const orangeTick = startTick + gcdTicks - frameToTicks(orangeLeadFrames);
  return {
    rowIndex,
    startTick,
    orangeTick,
    startSeconds: ticksToMilliseconds(startTick) / 1000,
    orangeSeconds: ticksToMilliseconds(orangeTick) / 1000,
  };
}

export function buildThunderWindows(rows, config) {
  const durationTicks = frameToTicks(config.durations.thunder);
  return mergeWindows(
    rows.flatMap((row, rowIndex) => {
      if (!rowLabel(row).includes("雷")) return [];
      const { startTick } = profileRowTiming(rowIndex, config);
      return [{ rowIndex, fromTick: startTick, untilTick: startTick + durationTicks }];
    }),
  );
}

export function windowOverlapTicks(fromTick, untilTick, windows) {
  return mergeWindows(windows).reduce(
    (total, window) =>
      total + Math.max(
        0,
        Math.min(untilTick, window.untilTick) - Math.max(fromTick, window.fromTick),
      ),
    0,
  );
}

function eligibleCandidates(
  rows,
  config,
  {
    durationSeconds = 180,
    orangeLeadFrames = 1,
    requireFullWindow = true,
  } = {},
) {
  const combatEndTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  const orangeDurationTicks = frameToTicks(config.durations.orange);
  return rows.flatMap((row, rowIndex) => {
    const timing = profileRowTiming(rowIndex, config, { orangeLeadFrames });
    if (timing.orangeTick > combatEndTick) return [];
    if (requireFullWindow && timing.orangeTick + orangeDurationTicks > combatEndTick) {
      return [];
    }
    return [{ ...timing, row, label: rowLabel(row) }];
  });
}

function greedilySelectReady(candidates, config) {
  const cooldownTicks = frameToTicks(config.cooldowns.orange);
  const selected = [];
  let readyTick = 0;
  for (const candidate of candidates) {
    if (candidate.orangeTick < readyTick) continue;
    selected.push(candidate);
    readyTick = candidate.orangeTick + cooldownTicks;
  }
  return selected;
}

export function selectOrangeRowsOnCooldown(rows, config, options = {}) {
  return greedilySelectReady(eligibleCandidates(rows, config, options), config);
}

export function selectOrangeRowsThunderAligned(rows, config, options = {}) {
  const candidates = eligibleCandidates(rows, config, options)
    .filter((candidate) => candidate.label.includes("雷"));
  return greedilySelectReady(candidates, config);
}

export function selectOrangeRowsGapAligned(rows, config, options = {}) {
  const candidates = eligibleCandidates(rows, config, options);
  const thunderWindows = buildThunderWindows(rows, config);
  const orangeDurationTicks = frameToTicks(config.durations.orange);
  const zeroOverlap = candidates.filter(
    (candidate) =>
      windowOverlapTicks(
        candidate.orangeTick,
        candidate.orangeTick + orangeDurationTicks,
        thunderWindows,
      ) === 0,
  );
  return greedilySelectReady(zeroOverlap, config);
}

export function injectOrangeIntoRows(rows, selectedRows) {
  const indices = new Set(
    selectedRows.map((selection) =>
      Number.isInteger(selection) ? selection : selection.rowIndex,
    ),
  );
  return rows.map((row, rowIndex) => {
    if (!indices.has(rowIndex)) return { ...row };
    const key = Object.hasOwn(row, "skill") ? "skill" : "label";
    const label = rowLabel(row);
    return {
      ...row,
      [key]: label.includes("CW") ? label : `${label}-CW`,
    };
  });
}

export function buildOrangeLianyingCandidates(rows, config, options = {}) {
  const definitions = [
    ["onCooldown", "冷却到点即开", selectOrangeRowsOnCooldown],
    ["thunderAligned", "激雷行对齐", selectOrangeRowsThunderAligned],
    ["gapAligned", "完整6秒避开激雷", selectOrangeRowsGapAligned],
  ];
  return definitions.map(([id, label, select]) => {
    const selections = select(rows, config, options);
    return {
      id,
      label,
      selections,
      rows: injectOrangeIntoRows(rows, selections),
    };
  });
}
