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
