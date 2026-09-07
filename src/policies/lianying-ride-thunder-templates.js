import {
  identifyLianyingThunderSegments,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import { lianyingCompanionAnchorRows } from "./lianying-multisegment-resynthesis.js";

function strictlyIncreasing(rows) {
  return rows.every((row, index) => index === 0 || row > rows[index - 1]);
}

function matchRideThunderRows(rideRows, thunderRows, maximumDistance) {
  const unused = new Set(thunderRows.map((_, index) => index));
  const pairs = [];
  const terminalRideRows = [];
  for (const rideRow of rideRows) {
    const nearest = [...unused]
      .map((thunderIndex) => ({
        thunderIndex,
        distance: Math.abs(thunderRows[thunderIndex] - rideRow),
      }))
      .filter((candidate) => candidate.distance <= maximumDistance)
      .sort((left, right) =>
        left.distance - right.distance || left.thunderIndex - right.thunderIndex)[0];
    if (!nearest) {
      terminalRideRows.push(rideRow);
      continue;
    }
    unused.delete(nearest.thunderIndex);
    pairs.push({
      rideRow,
      thunderOrdinal: nearest.thunderIndex + 1,
      thunderRow: thunderRows[nearest.thunderIndex],
      offsetRows: rideRow - thunderRows[nearest.thunderIndex],
    });
  }
  return {
    pairs: pairs.sort((left, right) =>
      left.thunderOrdinal - right.thunderOrdinal),
    soloThunderOrdinals: [...unused].map((index) => index + 1),
    terminalRideRows,
  };
}

/**
 * 保留当前任雷相位偏移，只改变哪一次雷没有对应任驰骋。
 * 这生成的是少量离散高层行表，不会把远距离移动展开成全行窗口。
 */
export function buildLianyingRideThunderUsageTemplates(
  packs,
  {
    maximumPairDistanceRows = 3,
    soloThunderOrdinals = null,
    maximumTemplates = 8,
  } = {},
) {
  const corePacks = stripLianyingDashPacks(packs);
  const thunderRows = identifyLianyingThunderSegments(corePacks)
    .anchors.map((row) => row + 1);
  const rideRows = lianyingCompanionAnchorRows(corePacks).rideRows;
  const matched = matchRideThunderRows(
    rideRows,
    thunderRows,
    Math.max(0, Math.floor(Number(maximumPairDistanceRows))),
  );
  if (
    matched.soloThunderOrdinals.length !== 1 ||
    matched.terminalRideRows.length !== 1 ||
    matched.pairs.length !== thunderRows.length - 1
  ) {
    throw new Error("当前轴必须恰好包含6组近邻任雷、1次单雷和1次末段任驰骋");
  }
  const incumbentSolo = matched.soloThunderOrdinals[0];
  const phaseOffsets = matched.pairs.map((pair) => pair.offsetRows);
  const requestedSolos = Array.isArray(soloThunderOrdinals)
    ? soloThunderOrdinals
    : thunderRows.map((_, index) => index + 1);
  const templates = [{
    templateId: `solo-thunder-${incumbentSolo}-incumbent`,
    soloThunderOrdinal: incumbentSolo,
    rideRows,
    pairedThunderOrdinals: matched.pairs.map((pair) => pair.thunderOrdinal),
    phaseOffsets,
    isIncumbent: true,
  }];
  const seen = new Set([JSON.stringify(rideRows)]);
  for (const rawOrdinal of requestedSolos) {
    const soloThunderOrdinal = Number(rawOrdinal);
    if (
      !Number.isInteger(soloThunderOrdinal) ||
      soloThunderOrdinal < 1 ||
      soloThunderOrdinal > thunderRows.length ||
      soloThunderOrdinal === incumbentSolo
    ) continue;
    const pairedThunderOrdinals = thunderRows.flatMap((_, index) =>
      index + 1 === soloThunderOrdinal ? [] : [index + 1]);
    const targetRideRows = pairedThunderOrdinals.map(
      (ordinal, index) => thunderRows[ordinal - 1] + phaseOffsets[index],
    );
    targetRideRows.push(...matched.terminalRideRows);
    if (
      targetRideRows.some((row) =>
        !Number.isInteger(row) || row < 1 || row > corePacks.length) ||
      !strictlyIncreasing(targetRideRows)
    ) continue;
    const key = JSON.stringify(targetRideRows);
    if (seen.has(key)) continue;
    seen.add(key);
    templates.push({
      templateId: `solo-thunder-${soloThunderOrdinal}`,
      soloThunderOrdinal,
      rideRows: targetRideRows,
      pairedThunderOrdinals,
      phaseOffsets,
      isIncumbent: false,
    });
    if (templates.length >= Math.max(1, Math.floor(Number(maximumTemplates)))) {
      break;
    }
  }
  return {
    thunderRows,
    incumbentRideRows: rideRows,
    incumbentSoloThunderOrdinal: incumbentSolo,
    phaseOffsets,
    terminalRideRows: matched.terminalRideRows,
    templates,
  };
}
