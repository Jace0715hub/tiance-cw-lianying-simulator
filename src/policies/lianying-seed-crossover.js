import { millisecondsToTicks } from "../engine/clock.js";
import { executeActionPack } from "../engine/simulator.js";
import { createInitialState } from "../engine/state.js";
import {
  cloneLianyingPack,
  identifyLianyingThunderSegments,
  lianyingDecisionTick,
  lianyingResynthesisStateKey,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import { lianyingBoundaryStateDistance } from "./lianying-segment-resynthesis.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";
import { lianyingPortfolioStructureKey } from "./lianying-seed-portfolio.js";

function clonePacks(packs) {
  return packs.map(cloneLianyingPack);
}

function buildPrefixStates(runtime, packs, endTick) {
  let state = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  const states = [state];
  for (const pack of packs) {
    if (lianyingDecisionTick(state) < endTick) {
      state = executeActionPack(
        state,
        pack,
        runtime.config,
        runtime.oracle,
        { endTick },
      );
    }
    states.push(state);
  }
  return states;
}

function csvCell(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function lianyingSeedCrossoverToCsv(result) {
  const rows = [[
    "前缀种子",
    "后缀种子",
    "交叉雷序号",
    "交叉行",
    "边界状态距离",
    "边界状态完全一致",
    "机制合法",
    "新结构",
    "首次失败行",
    "首次失败原因",
    "核心伤害",
    "相对最高种子核心伤害差",
  ]];
  for (const attempt of result.attempts ?? []) {
    rows.push([
      attempt.prefixSeedId,
      attempt.suffixSeedId,
      attempt.anchorNumber,
      attempt.boundaryRow,
      attempt.boundaryDistance,
      attempt.exactBoundaryState,
      attempt.legal,
      attempt.novel,
      attempt.failureRow ?? "",
      attempt.failure ?? "",
      attempt.coreDamage ?? "",
      attempt.coreDamageGain ?? "",
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function selectCoreCrossovers(candidates, limit) {
  const sorted = [...candidates].sort(
    (left, right) => right.coreDamage - left.coreDamage,
  );
  const selected = [];
  const selectedKeys = new Set();
  const add = (candidate) => {
    if (!candidate || selected.length >= limit) return;
    const key = JSON.stringify(candidate.packs);
    if (selectedKeys.has(key)) return;
    selected.push(candidate);
    selectedKeys.add(key);
  };
  const boundaryBest = new Map();
  const pairBest = new Map();
  for (const candidate of sorted) {
    const boundaryKey = String(candidate.anchorNumber);
    const pairKey = `${candidate.prefixSeedId}->${candidate.suffixSeedId}`;
    if (!boundaryBest.has(boundaryKey)) boundaryBest.set(boundaryKey, candidate);
    if (!pairBest.has(pairKey)) pairBest.set(pairKey, candidate);
  }
  for (const candidate of boundaryBest.values()) add(candidate);
  for (const candidate of pairBest.values()) add(candidate);
  for (const candidate of sorted) add(candidate);
  return selected;
}

function selectDashFinalists(candidates, limit) {
  const incumbent = candidates.find((candidate) => candidate.isIncumbent);
  const selected = [...candidates]
    .filter((candidate) => !candidate.isIncumbent)
    .sort((left, right) => right.totalDamage - left.totalDamage)
    .slice(0, Math.max(0, limit - 1));
  if (incumbent) selected.push(incumbent);
  return selected.sort((left, right) => right.totalDamage - left.totalDamage);
}

export function optimizeLianyingSeedCrossovers(
  runtime,
  seeds,
  {
    durationSeconds = 180,
    maxSeeds = 4,
    coreCandidateLimit = 12,
    coarseDashStates = 8,
    finalDashCandidateCount = 2,
    fullDashStates = 128,
    onProgress = null,
  } = {},
) {
  if (!Array.isArray(seeds) || seeds.length < 2) {
    throw new Error("跨种子区段重组至少需要两条完整技能轴");
  }
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  const byStructure = new Map();
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    const replay = replayWhitepaperLianying(runtime, seed.packs, {
      durationSeconds,
    });
    const corePacks = stripLianyingDashPacks(seed.packs);
    const coreReplay = replayWhitepaperLianying(runtime, corePacks, {
      durationSeconds,
    });
    const prepared = {
      id: seed.id ?? `seed-${index + 1}`,
      sourcePath: seed.sourcePath ?? null,
      packs: seed.packs,
      state: replay.state,
      corePacks,
      coreState: coreReplay.state,
      structureKey: lianyingPortfolioStructureKey(seed.packs),
      anchors: identifyLianyingThunderSegments(corePacks).anchors,
      prefixStates: buildPrefixStates(runtime, corePacks, endTick),
    };
    const current = byStructure.get(prepared.structureKey);
    if (!current || prepared.state.totalDamage > current.state.totalDamage) {
      byStructure.set(prepared.structureKey, prepared);
    }
  }
  const preparedSeeds = [...byStructure.values()]
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, Math.max(2, Number(maxSeeds)));
  if (preparedSeeds.length < 2) {
    throw new Error("去重后不足两条不同主要结构，无法执行跨种子重组");
  }
  const anchorKey = JSON.stringify(preparedSeeds[0].anchors);
  if (preparedSeeds.some((seed) => JSON.stringify(seed.anchors) !== anchorKey)) {
    throw new Error("第一版跨种子重组要求所有种子使用相同雷锚点");
  }
  const anchors = preparedSeeds[0].anchors;
  const incumbent = preparedSeeds[0];
  const seedCoreKeys = new Set(preparedSeeds.map((seed) =>
    JSON.stringify(seed.corePacks)));
  const attempts = [];
  const legalCandidates = new Map();
  const failureReasons = {};
  let legalCrossovers = 0;
  let novelCrossovers = 0;
  let exactBoundaryStates = 0;

  for (const prefixSeed of preparedSeeds) {
    for (const suffixSeed of preparedSeeds) {
      if (prefixSeed.id === suffixSeed.id) continue;
      for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
        const boundaryIndex = anchors[anchorIndex];
        const prefixState = prefixSeed.prefixStates[boundaryIndex];
        const suffixReferenceState = suffixSeed.prefixStates[boundaryIndex];
        const exactBoundaryState =
          lianyingResynthesisStateKey(prefixState) ===
          lianyingResynthesisStateKey(suffixReferenceState);
        if (exactBoundaryState) exactBoundaryStates += 1;
        const boundaryDistance = lianyingBoundaryStateDistance(
          prefixState,
          suffixReferenceState,
        );
        const hybridPacks = [
          ...clonePacks(prefixSeed.corePacks.slice(0, boundaryIndex)),
          ...clonePacks(suffixSeed.corePacks.slice(boundaryIndex)),
        ];
        let state = prefixState;
        let failure = null;
        let failureRow = null;
        for (let rowIndex = boundaryIndex; rowIndex < hybridPacks.length; rowIndex += 1) {
          if (lianyingDecisionTick(state) >= endTick) break;
          try {
            state = executeActionPack(
              state,
              hybridPacks[rowIndex],
              runtime.config,
              runtime.oracle,
              { endTick },
            );
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
            failureRow = rowIndex + 1;
            failureReasons[failure] = Number(failureReasons[failure] ?? 0) + 1;
            break;
          }
        }
        const structureKey = JSON.stringify(hybridPacks);
        const novel = !seedCoreKeys.has(structureKey);
        const attempt = {
          prefixSeedId: prefixSeed.id,
          suffixSeedId: suffixSeed.id,
          anchorNumber: anchorIndex + 1,
          boundaryRow: boundaryIndex + 1,
          boundaryDistance,
          exactBoundaryState,
          legal: failure === null,
          novel,
          failureRow,
          failure,
          coreDamage: failure === null ? state.totalDamage : null,
          coreDamageGain: failure === null
            ? state.totalDamage - incumbent.coreState.totalDamage
            : null,
        };
        attempts.push(attempt);
        if (failure !== null) continue;
        legalCrossovers += 1;
        if (!novel) continue;
        novelCrossovers += 1;
        const candidate = {
          ...attempt,
          packs: hybridPacks,
          coreDamage: state.totalDamage,
        };
        const current = legalCandidates.get(structureKey);
        if (!current || candidate.coreDamage > current.coreDamage) {
          legalCandidates.set(structureKey, candidate);
        }
      }
    }
  }

  const selectedCore = selectCoreCrossovers(
    legalCandidates.values(),
    coreCandidateLimit,
  );
  const coarseCandidates = [{
    isIncumbent: true,
    prefixSeedId: incumbent.id,
    suffixSeedId: incumbent.id,
    anchorNumber: null,
    boundaryRow: null,
    boundaryDistance: 0,
    exactBoundaryState: true,
    packs: incumbent.packs,
    coreDamage: incumbent.coreState.totalDamage,
    totalDamage: incumbent.state.totalDamage,
    dashCount: incumbent.state.timeline.filter(
      (event) => event.type === "offGcd" && event.action === "dash",
    ).length,
  }];
  for (let index = 0; index < selectedCore.length; index += 1) {
    const candidate = selectedCore[index];
    if (typeof onProgress === "function") {
      onProgress({
        stage: "dash-coarse",
        candidate: index + 1,
        candidateCount: selectedCore.length,
        prefixSeedId: candidate.prefixSeedId,
        suffixSeedId: candidate.suffixSeedId,
        anchorNumber: candidate.anchorNumber,
      });
    }
    try {
      const dash = optimizeLianyingDashOverlay(runtime, candidate.packs, {
        durationSeconds,
        maxStatesPerRow: coarseDashStates,
      });
      coarseCandidates.push({
        ...candidate,
        isIncumbent: false,
        packs: dash.packs,
        totalDamage: dash.state.totalDamage,
        dashCount: dash.dashCount,
      });
    } catch {
      // 核心轴合法但突覆盖无完整状态时不进入最终复算。
    }
  }
  const selectedFinal = selectDashFinalists(
    coarseCandidates,
    finalDashCandidateCount,
  );
  const finalCandidates = selectedFinal.map((candidate, index) => {
    if (candidate.isIncumbent) return { ...candidate, state: incumbent.state };
    if (typeof onProgress === "function") {
      onProgress({
        stage: "dash-final",
        candidate: index + 1,
        candidateCount: selectedFinal.length,
        prefixSeedId: candidate.prefixSeedId,
        suffixSeedId: candidate.suffixSeedId,
        anchorNumber: candidate.anchorNumber,
      });
    }
    const dash = optimizeLianyingDashOverlay(
      runtime,
      stripLianyingDashPacks(candidate.packs),
      { durationSeconds, maxStatesPerRow: fullDashStates },
    );
    return {
      ...candidate,
      packs: dash.packs,
      state: dash.state,
      totalDamage: dash.state.totalDamage,
      dashCount: dash.dashCount,
    };
  }).sort((left, right) => right.totalDamage - left.totalDamage);
  const best = finalCandidates[0];
  const bestAlternative = finalCandidates.find((candidate) => !candidate.isIncumbent) ?? null;
  const accepted = Boolean(best && best.totalDamage > incumbent.state.totalDamage);
  return {
    packs: accepted ? best.packs : incumbent.packs,
    state: accepted ? best.state : incumbent.state,
    baselineDamage: incumbent.state.totalDamage,
    damageGain: accepted ? best.totalDamage - incumbent.state.totalDamage : 0,
    accepted,
    selectedCrossover: accepted ? {
      prefixSeedId: best.prefixSeedId,
      suffixSeedId: best.suffixSeedId,
      anchorNumber: best.anchorNumber,
      boundaryRow: best.boundaryRow,
      boundaryDistance: best.boundaryDistance,
      exactBoundaryState: best.exactBoundaryState,
    } : null,
    // 即使交叉轴尚未超过全局最优，也要保留最接近的完整合法候选，供后续
    // 在交叉点附近执行有限桥接，而不是只留下汇总数字后再靠人工重建。
    bestAlternative: bestAlternative ? {
      packs: bestAlternative.packs,
      state: bestAlternative.state,
      prefixSeedId: bestAlternative.prefixSeedId,
      suffixSeedId: bestAlternative.suffixSeedId,
      anchorNumber: bestAlternative.anchorNumber,
      boundaryRow: bestAlternative.boundaryRow,
      boundaryDistance: bestAlternative.boundaryDistance,
      exactBoundaryState: bestAlternative.exactBoundaryState,
      coreDamage: bestAlternative.coreDamage,
      totalDamage: bestAlternative.totalDamage,
      dashCount: bestAlternative.dashCount,
      damageFromIncumbent:
        bestAlternative.totalDamage - incumbent.state.totalDamage,
    } : null,
    anchors: anchors.map((row) => row + 1),
    inputSeedCount: seeds.length,
    uniqueSeedCount: byStructure.size,
    searchedSeedCount: preparedSeeds.length,
    totalCrossovers: attempts.length,
    legalCrossovers,
    illegalCrossovers: attempts.length - legalCrossovers,
    novelCrossovers,
    exactBoundaryStates,
    uniqueLegalCandidates: legalCandidates.size,
    selectedCoreCandidates: selectedCore.length,
    attempts,
    failureReasons,
    // 组合桥接器需要完整动作包作为后续搜索入口；公开字段与下方仅供报告的
    // coarseCandidates汇总分开，避免调用方再从CSV或行标签反向重建动作。
    bridgeCandidates: coarseCandidates
      .filter((candidate) => !candidate.isIncumbent)
      .map((candidate) => ({
        packs: clonePacks(candidate.packs),
        prefixSeedId: candidate.prefixSeedId,
        suffixSeedId: candidate.suffixSeedId,
        anchorNumber: candidate.anchorNumber,
        boundaryRow: candidate.boundaryRow,
        boundaryDistance: candidate.boundaryDistance,
        exactBoundaryState: candidate.exactBoundaryState,
        coreDamage: candidate.coreDamage,
        totalDamage: candidate.totalDamage,
        dashCount: candidate.dashCount,
      })),
    coarseCandidates: coarseCandidates.map((candidate) => ({
      isIncumbent: candidate.isIncumbent,
      prefixSeedId: candidate.prefixSeedId,
      suffixSeedId: candidate.suffixSeedId,
      anchorNumber: candidate.anchorNumber,
      boundaryRow: candidate.boundaryRow,
      boundaryDistance: candidate.boundaryDistance,
      exactBoundaryState: candidate.exactBoundaryState,
      coreDamage: candidate.coreDamage,
      totalDamage: candidate.totalDamage,
      dashCount: candidate.dashCount,
    })),
    options: {
      durationSeconds,
      maxSeeds,
      coreCandidateLimit,
      coarseDashStates,
      finalDashCandidateCount,
      fullDashStates,
    },
  };
}
