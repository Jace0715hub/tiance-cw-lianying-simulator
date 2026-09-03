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

/**
 * 强制单次任驰骋离开正式行，用显式行表判断该相位是否可由低层重新合成。
 * 下马不在这里钉死：任驰骋移动后，状态机必须能自行安排必要的合法下马。
 */
export function buildLianyingForcedRideCounterfactual(
  packs,
  {
    rideOrdinal,
    rideOffsets = [-2, -1, 1, 2],
    thunderSlackRows = 2,
    maximumAnchorSchedules = 8,
  } = {},
) {
  const anchors = identifyLianyingThunderSegments(packs).anchors;
  const thunderRows = anchors.map((row) => row + 1);
  const companions = lianyingCompanionAnchorRows(packs);
  const ordinal = Math.floor(Number(rideOrdinal));
  if (
    !Number.isInteger(ordinal) ||
    ordinal < 1 ||
    ordinal > companions.rideRows.length
  ) {
    throw new Error("强制任驰骋序号超出技能轴范围");
  }
  const targetRideRow = companions.rideRows[ordinal - 1];
  const normalizedOffsets = [...new Set((rideOffsets ?? [])
    .map(Number)
    .filter((offset) => Number.isInteger(offset) && offset !== 0))];
  const allowedRideSchedules = normalizedOffsets.flatMap((offset) => {
    const schedule = [...companions.rideRows];
    schedule[ordinal - 1] += offset;
    return schedule[ordinal - 1] >= 1 &&
      schedule[ordinal - 1] <= packs.length &&
      strictlyIncreasing(schedule)
      ? [schedule]
      : [];
  });
  if (allowedRideSchedules.length === 0) {
    throw new Error("强制任驰骋偏移没有生成有效行表");
  }
  const pairedThunderIndex = anchors
    .map((anchor, index) => ({
      index,
      distance: Math.abs(anchor + 1 - targetRideRow),
    }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)[0]
    ?.index;
  if (!Number.isInteger(pairedThunderIndex)) {
    throw new Error("技能轴缺少可匹配的雷锚点");
  }
  const allowedAnchorSchedules = enumerateAnchorSchedules(
    anchors,
    [pairedThunderIndex],
    Math.max(0, Math.floor(Number(thunderSlackRows))),
    Math.max(1, Math.floor(Number(maximumAnchorSchedules))),
  );
  return {
    counterfactualId: `ride-${ordinal}`,
    rideOrdinal: ordinal,
    targetRideRow,
    pairedThunderOrdinal: pairedThunderIndex + 1,
    thunderRows,
    allowedAnchorSchedules,
    allowedRideSchedules,
    companionAnchorTemplate: {
      allowedRideSchedules,
      orangeRows: companions.orangeRows,
    },
    options: {
      rideOffsets: normalizedOffsets,
      thunderSlackRows,
      maximumAnchorSchedules,
    },
  };
}

function clonePack(pack) {
  return {
    prefix: structuredClone(pack?.prefix ?? []),
    primary: structuredClone(pack?.primary),
    tail: structuredClone(pack?.tail ?? []),
  };
}

/**
 * 为强制任驰骋反事实提供不经过束剪枝的最小结构种子。
 * primary-swap只交换任驰骋和目标行主技能；pack-swap同时交换同行动作，
 * 用来覆盖雷或下马必须随任驰骋移动的情形。最终合法性仍由完整状态机判断。
 */
export function buildLianyingForcedRideWarmAxes(packs, counterfactual) {
  const sourceRow = Number(counterfactual?.targetRideRow);
  const rideOrdinal = Number(counterfactual?.rideOrdinal);
  const schedules = counterfactual?.allowedRideSchedules ?? [];
  if (!Number.isInteger(sourceRow) || !Number.isInteger(rideOrdinal)) {
    throw new Error("强制任驰骋反事实缺少来源行或序号");
  }
  const sourceIndex = sourceRow - 1;
  return schedules.flatMap((schedule) => {
    const targetRow = schedule[rideOrdinal - 1];
    const targetIndex = targetRow - 1;
    if (!packs[sourceIndex] || !packs[targetIndex] || targetIndex === sourceIndex) {
      return [];
    }
    const primarySwap = packs.map(clonePack);
    [primarySwap[sourceIndex].primary, primarySwap[targetIndex].primary] = [
      structuredClone(primarySwap[targetIndex].primary),
      structuredClone(primarySwap[sourceIndex].primary),
    ];
    const packSwap = packs.map(clonePack);
    [packSwap[sourceIndex], packSwap[targetIndex]] = [
      packSwap[targetIndex],
      packSwap[sourceIndex],
    ];
    return [
      { kind: "primary-swap", targetRideRow: targetRow, packs: primarySwap },
      { kind: "pack-swap", targetRideRow: targetRow, packs: packSwap },
    ];
  });
}
