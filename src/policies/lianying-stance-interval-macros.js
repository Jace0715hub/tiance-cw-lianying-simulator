import { identifyLianyingThunderSegments } from
  "./lianying-segment-resynthesis.js";
import { lianyingCompanionAnchorRows } from
  "./lianying-multisegment-resynthesis.js";

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function dismountAction(pack) {
  return [...(pack?.prefix ?? []), ...(pack?.tail ?? [])].find(
    (action) => actionId(action) === "dismount",
  );
}

function strictlyIncreasing(values) {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

function enumerateAnchorSchedules(
  anchors,
  movableIndices,
  slackRows,
  maximumSchedules,
) {
  const schedules = [];
  const offsets = Array.from(
    { length: slackRows * 2 + 1 },
    (_, index) => index - slackRows,
  ).sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
  const movable = [...movableIndices];
  const visit = (position, schedule) => {
    if (schedules.length >= maximumSchedules) return;
    if (position === movable.length) {
      if (strictlyIncreasing(schedule)) schedules.push(schedule);
      return;
    }
    const anchorIndex = movable[position];
    for (const offset of offsets) {
      const next = [...schedule];
      next[anchorIndex] = anchors[anchorIndex] + offset;
      if (next[anchorIndex] < 0) continue;
      visit(position + 1, next);
      if (schedules.length >= maximumSchedules) return;
    }
  };
  visit(0, [...anchors]);
  return schedules;
}

function companionWindows(
  packs,
  rows,
  {
    blockStartRow,
    blockEndRow,
    slackRows,
    movable,
  },
) {
  return rows.map((row) => {
    const isMovable =
      row >= blockStartRow && row < blockEndRow && movable(row, packs[row - 1]);
    return {
      targetRow: row,
      earliestRow: isMovable ? Math.max(1, row - slackRows) : row,
      latestRow: isMovable ? Math.min(packs.length, row + slackRows) : row,
    };
  });
}

/**
 * 为相邻两次雷区段生成一个有界姿态宏搜索包。
 *
 * `fromThunderOrdinal=2,toThunderOrdinal=3` 表示从第2雷开始，联合重搜
 * 第2、3雷及第4雷前的姿态区间。雷使用显式有限行表；任驰骋与真正改变
 * 姿态的下马使用小窗口，其他伴随动作保持原位。
 */
export function buildLianyingStanceIntervalMacro(
  packs,
  {
    fromThunderOrdinal,
    toThunderOrdinal,
    thunderSlackRows = 1,
    rideSlackRows = 2,
    dismountSlackRows = 6,
    maximumAnchorSchedules = 16,
  },
) {
  const anchors = identifyLianyingThunderSegments(packs).anchors;
  const thunderRows = anchors.map((row) => row + 1);
  const from = Math.floor(Number(fromThunderOrdinal));
  const to = Math.floor(Number(toThunderOrdinal));
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to < from ||
    to > anchors.length
  ) {
    throw new Error("姿态区间的雷序号超出技能轴范围");
  }
  const blockStartRow = thunderRows[from - 1];
  const blockEndRow = thunderRows[to] ?? packs.length + 1;
  const movableAnchorIndices = Array.from(
    { length: to - from + 1 },
    (_, index) => from - 1 + index,
  );
  const allowedAnchorSchedules = enumerateAnchorSchedules(
    anchors,
    movableAnchorIndices,
    Math.max(0, Math.floor(Number(thunderSlackRows))),
    Math.max(1, Math.floor(Number(maximumAnchorSchedules))),
  );
  const companionRows = lianyingCompanionAnchorRows(packs);
  const rideWindows = companionWindows(packs, companionRows.rideRows, {
    blockStartRow,
    blockEndRow,
    slackRows: Math.max(0, Math.floor(Number(rideSlackRows))),
    movable: () => true,
  });
  const dismountWindows = companionWindows(packs, companionRows.dismountRows, {
    blockStartRow,
    blockEndRow,
    slackRows: Math.max(0, Math.floor(Number(dismountSlackRows))),
    movable: (_row, pack) => {
      const action = dismountAction(pack);
      return typeof action !== "object" || action.reason !== "refresh-ride";
    },
  });
  const movableRows = (windows) => windows
    .map((window, index) => ({ window, ordinal: index + 1 }))
    .filter(({ window }) => window.earliestRow !== window.latestRow);

  return {
    macroId: `thunder-${from}-${to}`,
    fromThunderOrdinal: from,
    toThunderOrdinal: to,
    blockStartRow,
    blockEndRow,
    thunderRows,
    movableThunderOrdinals: movableAnchorIndices.map((index) => index + 1),
    movableRideOrdinals: movableRows(rideWindows).map(({ ordinal }) => ordinal),
    movableDismountOrdinals:
      movableRows(dismountWindows).map(({ ordinal }) => ordinal),
    allowedAnchorSchedules,
    companionAnchorTemplate: {
      rideWindows,
      orangeRows: companionRows.orangeRows,
      dismountWindows,
    },
    options: {
      thunderSlackRows,
      rideSlackRows,
      dismountSlackRows,
      maximumAnchorSchedules,
    },
  };
}

