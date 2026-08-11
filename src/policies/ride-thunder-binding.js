function labelKey(row) {
  return Object.hasOwn(row, "skill") ? "skill" : "label";
}

function labelOf(row) {
  return String(row?.skill ?? row?.label ?? "").trim();
}

const PRIMARY_PATTERN = /任驰骋|龙牙|龙吟|穿云|灭/u;

function primaryOf(row) {
  const match = labelOf(row).match(PRIMARY_PATTERN);
  if (!match) throw new Error(`技能表标签缺少主要技能: ${labelOf(row)}`);
  return match[0];
}

function replacePrimary(row, primary) {
  const key = labelKey(row);
  return { ...row, [key]: labelOf(row).replace(PRIMARY_PATTERN, primary) };
}

export function thunderRowIndices(rows) {
  return rows.flatMap((row, rowIndex) =>
    labelOf(row).includes("雷") ? [rowIndex] : [],
  );
}

export function rideRowIndices(rows) {
  return rows.flatMap((row, rowIndex) =>
    labelOf(row).includes("任驰骋") ? [rowIndex] : [],
  );
}

export function moveThunderPrefix(rows, sourceIndex, targetIndex) {
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)) {
    throw new Error("激雷移动行号必须是整数");
  }
  if (!rows[sourceIndex] || !rows[targetIndex]) {
    throw new Error("激雷移动行号超出技能表");
  }
  if (!labelOf(rows[sourceIndex]).includes("雷")) {
    throw new Error(`第${sourceIndex + 1}行没有激雷标记`);
  }
  if (sourceIndex !== targetIndex && labelOf(rows[targetIndex]).includes("雷")) {
    throw new Error(`第${targetIndex + 1}行已有激雷标记`);
  }
  if (sourceIndex === targetIndex) return rows.map((row) => ({ ...row }));

  const moved = rows.map((row) => ({ ...row }));
  const sourceKey = labelKey(moved[sourceIndex]);
  const targetKey = labelKey(moved[targetIndex]);
  moved[sourceIndex][sourceKey] = labelOf(moved[sourceIndex]).replace("雷", "");
  moved[targetIndex][targetKey] = `雷${labelOf(moved[targetIndex])}`;
  return moved;
}

export function moveRidePrimary(rows, sourceIndex, targetIndex) {
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)) {
    throw new Error("任驰骋移动行号必须是整数");
  }
  if (!rows[sourceIndex] || !rows[targetIndex]) {
    throw new Error("任驰骋移动行号超出技能表");
  }
  if (primaryOf(rows[sourceIndex]) !== "任驰骋") {
    throw new Error(`第${sourceIndex + 1}行不是任驰骋`);
  }
  if (sourceIndex === targetIndex) return rows.map((row) => ({ ...row }));
  if (primaryOf(rows[targetIndex]) === "任驰骋") {
    throw new Error(`第${targetIndex + 1}行已是任驰骋`);
  }
  const moved = rows.map((row) => ({ ...row }));
  const targetPrimary = primaryOf(moved[targetIndex]);
  moved[sourceIndex] = replacePrimary(moved[sourceIndex], targetPrimary);
  moved[targetIndex] = replacePrimary(moved[targetIndex], "任驰骋");
  return moved;
}

export function orangeRowIndices(rows) {
  return rows.flatMap((row, rowIndex) =>
    labelOf(row).includes("CW") ? [rowIndex] : [],
  );
}

export function moveOrangeSuffix(rows, sourceIndex, targetIndex) {
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)) {
    throw new Error("橙武移动行号必须是整数");
  }
  if (!rows[sourceIndex] || !rows[targetIndex]) {
    throw new Error("橙武移动行号超出技能表");
  }
  if (!labelOf(rows[sourceIndex]).includes("CW")) {
    throw new Error(`第${sourceIndex + 1}行没有橙武标记`);
  }
  if (sourceIndex !== targetIndex && labelOf(rows[targetIndex]).includes("CW")) {
    throw new Error(`第${targetIndex + 1}行已有橙武标记`);
  }
  if (sourceIndex === targetIndex) return rows.map((row) => ({ ...row }));

  const moved = rows.map((row) => ({ ...row }));
  const sourceKey = labelKey(moved[sourceIndex]);
  const targetKey = labelKey(moved[targetIndex]);
  moved[sourceIndex][sourceKey] = labelOf(moved[sourceIndex])
    .replaceAll("-CW", "")
    .replaceAll("CW", "");
  moved[targetIndex][targetKey] = `${labelOf(moved[targetIndex])}-CW`;
  return moved;
}

export function identifyRideThunderPairs(rows, { maximumRowDistance = 3 } = {}) {
  const rides = rideRowIndices(rows);
  const thunders = thunderRowIndices(rows);
  const unused = new Set(thunders);
  const pairs = [];

  for (const rideRowIndex of rides) {
    const candidates = [...unused]
      .map((thunderRowIndex) => ({
        thunderRowIndex,
        distance: Math.abs(thunderRowIndex - rideRowIndex),
      }))
      .filter((candidate) => candidate.distance <= maximumRowDistance)
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.thunderRowIndex - right.thunderRowIndex,
      );
    const [match] = candidates;
    if (!match) continue;
    unused.delete(match.thunderRowIndex);
    pairs.push({
      rideRowIndex,
      thunderRowIndex: match.thunderRowIndex,
      rowOffset: match.thunderRowIndex - rideRowIndex,
    });
  }

  return {
    pairs,
    soloThunderRows: [...unused].sort((left, right) => left - right),
  };
}
