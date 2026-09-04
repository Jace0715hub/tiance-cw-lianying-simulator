import {
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function packHasAction(pack, id) {
  return [
    ...(pack?.prefix ?? []),
    pack?.primary,
    ...(pack?.tail ?? []),
  ].some((action) => actionId(action) === id);
}

export function lianyingWaitAnchorRows(packs) {
  return (packs ?? []).flatMap((pack, index) =>
    actionId(pack?.primary) === "ride" ||
    packHasAction(pack, "thunder") ||
    packHasAction(pack, "orange")
      ? [index + 1]
      : [],
  );
}

export function insertLianyingWaitBeforeRow(packs, rowNumber, waitFrames) {
  const index = Math.floor(Number(rowNumber)) - 1;
  const frames = Math.floor(Number(waitFrames));
  if (index < 0 || index >= packs.length) {
    throw new Error("等待插入行必须落在现有技能轴内");
  }
  if (!Number.isInteger(frames) || frames <= 0) {
    throw new Error("等待帧数必须是正整数");
  }
  const next = structuredClone(packs);
  next.splice(index, 0, {
    primary: { id: "wait", frames },
    label: `等待${frames}帧`,
  });
  return next;
}

function castCount(state) {
  return (state.timeline ?? []).filter((event) => event.type === "cast").length;
}

export function searchLianyingWaitAnchors(
  runtime,
  packs,
  {
    durationSeconds = 180,
    candidateRows = lianyingWaitAnchorRows(packs),
    maxWaitFrames = 16,
    preserveCastCount = true,
  } = {},
) {
  const baseline = replayWhitepaperLianying(runtime, packs, {
    durationSeconds,
  });
  const baselineCastCount = castCount(baseline.state);
  const candidates = [];
  let explored = 0;
  let legal = 0;
  let preservedCastCount = 0;
  for (const rowNumber of [...new Set(candidateRows.map(Number))]) {
    for (let waitFrames = 1; waitFrames <= maxWaitFrames; waitFrames += 1) {
      explored += 1;
      const candidatePacks = insertLianyingWaitBeforeRow(
        packs,
        rowNumber,
        waitFrames,
      );
      try {
        const replay = replayWhitepaperLianying(runtime, candidatePacks, {
          durationSeconds,
        });
        legal += 1;
        const candidateCastCount = castCount(replay.state);
        if (candidateCastCount === baselineCastCount) preservedCastCount += 1;
        if (preserveCastCount && candidateCastCount !== baselineCastCount) {
          continue;
        }
        candidates.push({
          rowNumber,
          waitFrames,
          packs: candidatePacks,
          state: replay.state,
          castCount: candidateCastCount,
          damageGain: replay.state.totalDamage - baseline.state.totalDamage,
        });
      } catch {
        // 候选必须通过同一状态机的冷却、资源与骑乘合法性校验。
      }
    }
  }
  candidates.sort((left, right) =>
    right.state.totalDamage - left.state.totalDamage ||
    left.waitFrames - right.waitFrames ||
    right.rowNumber - left.rowNumber,
  );
  return {
    baseline,
    baselineCastCount,
    candidateRows: [...new Set(candidateRows.map(Number))],
    maxWaitFrames,
    preserveCastCount,
    explored,
    legal,
    preservedCastCount,
    candidates,
    best: candidates[0] ?? null,
  };
}

export function selectLianyingPairWaitSeeds(
  candidates,
  {
    limit = 3,
    minimumDamageGain = 1e-6,
    damageTolerance = 1e-6,
  } = {},
) {
  const distinct = [];
  for (const candidate of candidates ?? []) {
    if (candidate.damageGain <= minimumDamageGain) continue;
    const equivalent = distinct.find(
      (seed) =>
        seed.rowNumber === candidate.rowNumber &&
        Math.abs(seed.state.totalDamage - candidate.state.totalDamage) <=
          damageTolerance,
    );
    if (!equivalent) {
      distinct.push(candidate);
    } else if (candidate.waitFrames < equivalent.waitFrames) {
      Object.assign(equivalent, candidate);
    }
  }
  distinct.sort((left, right) =>
    right.state.totalDamage - left.state.totalDamage ||
    left.waitFrames - right.waitFrames ||
    right.rowNumber - left.rowNumber,
  );
  return distinct.slice(0, Math.max(0, Math.floor(Number(limit))));
}

export function selectLianyingNonPositivePairWaitSeeds(
  candidates,
  { damageTolerance = 1e-6 } = {},
) {
  const bestByRow = new Map();
  for (const candidate of candidates ?? []) {
    if (candidate.damageGain > damageTolerance) continue;
    const current = bestByRow.get(candidate.rowNumber);
    if (
      !current ||
      candidate.damageGain > current.damageGain ||
      (
        Math.abs(candidate.damageGain - current.damageGain) <= damageTolerance &&
        candidate.waitFrames < current.waitFrames
      )
    ) bestByRow.set(candidate.rowNumber, candidate);
  }
  return [...bestByRow.values()].sort((left, right) =>
    right.damageGain - left.damageGain ||
    left.waitFrames - right.waitFrames ||
    left.rowNumber - right.rowNumber,
  );
}

export function searchLianyingPairWaitAnchors(
  runtime,
  packs,
  {
    durationSeconds = 180,
    totalWaitFrames = 16,
    singleSeedLimit = 3,
    singleSeedMode = "positive",
    preserveCastCount = true,
  } = {},
) {
  const single = searchLianyingWaitAnchors(runtime, packs, {
    durationSeconds,
    maxWaitFrames: totalWaitFrames,
    preserveCastCount,
  });
  if (!["positive", "non-positive"].includes(singleSeedMode)) {
    throw new Error("双等待单点种子模式必须是positive或non-positive");
  }
  const seeds = singleSeedMode === "non-positive"
    ? selectLianyingNonPositivePairWaitSeeds(single.candidates)
    : selectLianyingPairWaitSeeds(single.candidates, {
        limit: singleSeedLimit,
      });
  const candidates = [];
  let explored = single.explored;
  let legal = single.legal;
  let preservedCastCount = single.preservedCastCount;
  for (const seed of seeds) {
    const remainingFrames = totalWaitFrames - seed.waitFrames;
    if (remainingFrames <= 0) continue;
    const second = searchLianyingWaitAnchors(runtime, seed.packs, {
      durationSeconds,
      maxWaitFrames: remainingFrames,
      preserveCastCount,
    });
    explored += second.explored;
    legal += second.legal;
    preservedCastCount += second.preservedCastCount;
    for (const candidate of second.candidates) {
      candidates.push({
        ...candidate,
        firstRowNumber: seed.rowNumber,
        firstWaitFrames: seed.waitFrames,
        secondRowNumber: candidate.rowNumber,
        secondWaitFrames: candidate.waitFrames,
        totalWaitFrames: seed.waitFrames + candidate.waitFrames,
        damageGain:
          candidate.state.totalDamage - single.baseline.state.totalDamage,
      });
    }
  }
  candidates.sort((left, right) =>
    right.state.totalDamage - left.state.totalDamage ||
    left.totalWaitFrames - right.totalWaitFrames ||
    left.firstWaitFrames - right.firstWaitFrames,
  );
  return {
    baseline: single.baseline,
    baselineCastCount: single.baselineCastCount,
    totalWaitFrames,
    singleSeedLimit,
    singleSeedMode,
    preserveCastCount,
    single,
    seeds,
    explored,
    legal,
    preservedCastCount,
    candidates,
    bestSingle: single.best,
    bestPair: candidates[0] ?? null,
    best:
      candidates[0]?.state.totalDamage > (single.best?.state.totalDamage ?? -Infinity)
        ? candidates[0]
        : single.best,
  };
}
