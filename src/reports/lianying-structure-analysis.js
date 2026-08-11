function primaryAction(row) {
  if (row.primaryAction) return row.primaryAction;
  if (row.destroySource) return "destroy";
  const skill = String(row.skill ?? "");
  if (skill.includes("龙牙")) return "dragonFang";
  if (skill.includes("任驰骋")) return "ride";
  if (skill.includes("龙吟")) return "dragonRoar";
  if (skill.includes("穿云")) return "cloudStrike";
  if (skill.includes("灭")) return "destroy";
  return null;
}

function uniqueRows(items) {
  return [...new Map(items.map((item) => [item.rowNumber, item])).values()];
}

function compactRow(row) {
  return {
    rowNumber: row.rowNumber,
    skill: row.skill,
    castSeconds: row.castSeconds,
    rageBeforePrimary: row.rageBeforePrimary,
    rageAfterPrimary: row.rageAfterPrimary,
    dragonRideBefore: row.dragonRideBefore,
    dragonRideAfter: row.dragonRideAfter,
    mountedAtCast: Boolean(row.mountedAtCast ?? row.mountedAfter),
    thunderAtCast: Boolean(row.thunderAtCast),
    rideAtCast: Boolean(row.rideAtCast),
    destroySource: row.destroySource ?? null,
  };
}

function actionRows(rows, actionId) {
  const matches = [];
  for (const row of rows) {
    for (const action of row.offGcdActions ?? []) {
      if (action.action === actionId) matches.push({ row, action });
    }
  }
  return matches;
}

function buildDestroyChains(rows) {
  const chains = [];
  let current = [];
  for (const row of rows) {
    if (primaryAction(row) === "destroy") {
      current.push(row);
      continue;
    }
    if (current.length >= 2) chains.push(current);
    current = [];
  }
  if (current.length >= 2) chains.push(current);
  return chains.map((chain) => ({
    startRow: chain[0].rowNumber,
    endRow: chain.at(-1).rowNumber,
    castSeconds: chain.map((row) => row.castSeconds),
    sources: chain.map((row) => row.destroySource ?? "unknown"),
    rageFlow: chain.map((row) => [row.rageBeforePrimary, row.rageAfterPrimary]),
    underThunder: chain.map((row) => Boolean(row.thunderAtCast)),
    totalRowDamage: chain.reduce(
      (sum, row) => sum + Number(row.rowDamage ?? 0),
      0,
    ),
  }));
}

/**
 * 分析“合法但可能反直觉”的技能轴结构。该报告不把白皮书经验规则
 * 当成合法性条件，只揭示当前最优轴依赖了哪些状态机假设。
 */
export function analyzeLianyingStructure(
  rows,
  { thunderDurationSeconds = 18 } = {},
) {
  const orderedRows = [...rows].sort(
    (left, right) => left.rowNumber - right.rowNumber,
  );
  const thunderStarts = actionRows(orderedRows, "thunder");
  const thunderWindows = thunderStarts.map(({ row, action }, index) => {
    const startSeconds = Number(action.seconds ?? row.castSeconds);
    const configuredEnd = Number(
      action.activeUntilSeconds ?? startSeconds + thunderDurationSeconds,
    );
    const nextStart = thunderStarts[index + 1]
      ? Number(
          thunderStarts[index + 1].action.seconds ??
            thunderStarts[index + 1].row.castSeconds,
        )
      : Number.POSITIVE_INFINITY;
    const endSeconds = Math.min(configuredEnd, nextStart);
    const windowRows = orderedRows.filter(
      (candidate) =>
        Number(candidate.castSeconds) >= startSeconds &&
        Number(candidate.castSeconds) < endSeconds &&
        candidate.thunderAtCast,
    );
    const onFootFangs = windowRows.filter(
      (candidate) =>
        primaryAction(candidate) === "dragonFang" &&
        !Boolean(candidate.mountedAtCast ?? candidate.mountedAfter),
    );
    const rideBuffActiveAtStart = Boolean(action.ride ?? row.rideAtCast);
    const dismounts = actionRows(orderedRows, "dismount")
      .filter(({ action: dismount, row: dismountRow }) => {
        const seconds = Number(dismount.seconds ?? dismountRow.castSeconds);
        return seconds >= startSeconds && seconds < endSeconds;
      })
      .map(({ row: dismountRow, action: dismount }) => {
        const seconds = Number(dismount.seconds ?? dismountRow.castSeconds);
        const inferredLegacyRide = orderedRows.some(
          (candidate) =>
            Number(candidate.castSeconds) >= seconds &&
            Number(candidate.castSeconds) < seconds + 2 &&
            candidate.rideAtCast,
        );
        const rideBuffActive = dismount.ride === null || dismount.ride === undefined
          ? dismountRow.primaryAction
            ? Boolean(dismountRow.rideAtCast)
            : inferredLegacyRide
          : Boolean(dismount.ride);
        return {
          rowNumber: dismountRow.rowNumber,
          seconds,
          rideBuffActive,
          dragonRideStacks: Number(
            dismount.dragonRideStacksAtStart ?? dismountRow.dragonRideBefore,
          ),
          reason: dismount.reason ?? null,
        };
      });
    return {
      index: index + 1,
      startRow: row.rowNumber,
      startSeconds,
      endSeconds,
      rageAtStart: Number(action.rageBefore),
      startedBelowFiveRage: Number(action.rageBefore) < 5,
      mountedAtStart: Boolean(action.mounted),
      dragonRideStacksAtStart: Number(action.dragonRideStacksAtStart ?? 0),
      rideBuffActiveAtStart,
      boundToRideInSameRow: primaryAction(row) === "ride",
      rideThunderBinding: primaryAction(row) === "ride"
        ? "same-row-ride"
        : rideBuffActiveAtStart
          ? "delayed-under-ride-buff"
          : "no-ride-buff",
      dragonFangRows: windowRows
        .filter((candidate) => primaryAction(candidate) === "dragonFang")
        .map((candidate) => candidate.rowNumber),
      onFootDragonFangRows: onFootFangs.map(
        (candidate) => candidate.rowNumber,
      ),
      onFootDragonFangsCoveredByRideBuff: onFootFangs
        .filter((candidate) => candidate.rideAtCast)
        .map((candidate) => candidate.rowNumber),
      onFootDragonFangsAfterRideBuff: onFootFangs
        .filter((candidate) => !candidate.rideAtCast)
        .map((candidate) => candidate.rowNumber),
      dragonRideGainedFromOnFootFangs: onFootFangs.reduce(
        (sum, candidate) =>
          sum +
          Math.max(
            0,
            Number(candidate.dragonRideAfter) -
              Number(candidate.dragonRideBefore),
          ),
        0,
      ),
      dismounts,
    };
  });

  const onFootThunderFangs = uniqueRows(
    thunderWindows.flatMap((window) =>
      window.onFootDragonFangRows.map((rowNumber) =>
        compactRow(orderedRows.find((row) => row.rowNumber === rowNumber)),
      ),
    ),
  );
  const dismountsDuringThunder = uniqueRows(
    thunderWindows.flatMap((window) =>
      window.dismounts.map((dismount) => ({
        rowNumber: dismount.rowNumber,
        seconds: dismount.seconds,
        rideBuffActive: dismount.rideBuffActive,
        dragonRideStacks: dismount.dragonRideStacks,
        reason: dismount.reason,
        thunderWindow: window.index,
      })),
    ),
  );
  const destroyChains = buildDestroyChains(orderedRows);
  const rides = orderedRows.filter((row) => primaryAction(row) === "ride");
  const dashes = actionRows(orderedRows, "dash").map(({ row, action }) => ({
    rowNumber: row.rowNumber,
    seconds: Number(action.seconds ?? row.castSeconds),
    position: Number(action.seconds) > Number(row.castSeconds)
      ? "gcd-tail"
      : "gcd-prefix",
    thunder: Boolean(action.thunder),
    ride: Boolean(action.ride),
    breakArmyWindow: Boolean(action.breakArmyWindow),
    rowSkill: row.skill,
  }));

  return {
    schemaVersion: 1,
    purpose: "expose-model-dependent-but-mechanically-legal-axis-structures",
    modelDependencies: {
      rideBuffIsIndependentFromMountedState: true,
      dismountDoesNotClearRideBuff: true,
      onFootDragonFangBuildsDragonRide: true,
      thunderDragonFangCostAppliesOnFoot: true,
    },
    mechanicConfirmations: {
      dismountDoesNotClearRideBuff: {
        status: "confirmed-by-user",
        confirmedOn: "2026-08-10",
      },
    },
    summary: {
      thunderWindows: thunderWindows.length,
      thunderStartsBelowFiveRage: thunderWindows.filter(
        (window) => window.startedBelowFiveRage,
      ).length,
      thunderStartsBoundToRideSameRow: thunderWindows.filter(
        (window) => window.boundToRideInSameRow,
      ).length,
      thunderStartsDelayedUnderRideBuff: thunderWindows.filter(
        (window) => window.rideThunderBinding === "delayed-under-ride-buff",
      ).length,
      thunderStartsWithoutRideBuff: thunderWindows.filter(
        (window) => window.rideThunderBinding === "no-ride-buff",
      ).length,
      rideCastsWithoutSameRowThunder: rides.filter(
        (row) =>
          !(row.offGcdActions ?? []).some(
            (action) => action.action === "thunder",
          ),
      ).length,
      dismountsDuringThunder: dismountsDuringThunder.length,
      onFootDragonFangsDuringThunder: onFootThunderFangs.length,
      onFootThunderFangsCoveredByRideBuff: onFootThunderFangs.filter(
        (row) => row.rideAtCast,
      ).length,
      onFootThunderFangsAfterRideBuff: onFootThunderFangs.filter(
        (row) => !row.rideAtCast,
      ).length,
      dragonRideGainedFromOnFootThunderFangs: onFootThunderFangs.reduce(
        (sum, row) =>
          sum +
          Math.max(
            0,
            Number(row.dragonRideAfter) - Number(row.dragonRideBefore),
          ),
        0,
      ),
      consecutiveDestroyChains: destroyChains.length,
      dashCasts: dashes.length,
      dashUnderBreakArmy: dashes.filter((dash) => dash.breakArmyWindow).length,
      dashUnderThunder: dashes.filter((dash) => dash.thunder).length,
      dashUnderRide: dashes.filter((dash) => dash.ride).length,
    },
    thunderWindows,
    dismountsDuringThunder,
    onFootThunderFangs,
    consecutiveDestroyChains: destroyChains,
    dashes,
  };
}
