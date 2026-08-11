import {
  optimizeLianyingCrossoverBridge,
  optimizeLianyingCrossoverJointBridge,
} from "./lianying-crossover-bridge.js";
import { stripLianyingDashPacks } from "./lianying-segment-resynthesis.js";
import {
  optimizeLianyingDashOverlay,
  replayWhitepaperLianying,
} from "./whitepaper-lianying.js";

function candidateKey(candidate) {
  return JSON.stringify(stripLianyingDashPacks(candidate.packs));
}

export function selectLianyingCrossoverBridgePortfolio(
  candidates,
  limit = 4,
  selectedCandidateNumbers = null,
) {
  const sorted = [...candidates].sort(
    (left, right) => right.totalDamage - left.totalDamage,
  );
  const selected = [];
  const keys = new Set();
  const add = (candidate) => {
    if (!candidate || selected.length >= limit) return;
    const key = candidateKey(candidate);
    if (keys.has(key)) return;
    keys.add(key);
    selected.push(candidate);
  };

  // 一半名额直接保留最接近全局最优的交叉轴，其余名额用于覆盖不同交叉雷和
  // 种子方向。分层只决定计算预算，不影响最终完整伤害排序。
  for (const candidate of sorted.slice(0, Math.max(1, Math.ceil(limit / 2)))) {
    add(candidate);
  }
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
  return Array.isArray(selectedCandidateNumbers)
    ? selected.filter((_, index) => selectedCandidateNumbers.includes(index + 1))
    : selected;
}

function sumSearchMetric(bridge, field) {
  return bridge.resynthesis.passes.reduce(
    (sum, pass) => sum + pass.segments.reduce(
      (inner, segment) => inner + Number(segment[field] ?? 0),
      0,
    ),
    0,
  );
}

export function optimizeLianyingCrossoverBridgePortfolio(
  runtime,
  incumbentPacks,
  candidates,
  {
    durationSeconds = 180,
    candidateLimit = 4,
    selectedCandidateNumbers = null,
    initialDashStates = 128,
    bridgeMode = "separate",
    bridgeOptions = {},
    onProgress = null,
  } = {},
) {
  const incumbent = replayWhitepaperLianying(runtime, incumbentPacks, {
    durationSeconds,
  });
  const selected = selectLianyingCrossoverBridgePortfolio(
    candidates,
    candidateLimit,
    selectedCandidateNumbers,
  );
  if (selected.length === 0) {
    throw new Error("没有可用于组合桥接的交叉候选");
  }
  if (!["separate", "joint"].includes(bridgeMode)) {
    throw new Error("组合桥接模式必须是separate或joint");
  }
  const bridgeOptimizer = bridgeMode === "joint"
    ? optimizeLianyingCrossoverJointBridge
    : optimizeLianyingCrossoverBridge;
  const runs = [];
  let bestPacks = incumbentPacks;
  let bestState = incumbent.state;
  let bestRunIndex = null;

  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index];
    if (typeof onProgress === "function") {
      onProgress({
        stage: "candidate-start",
        candidate: index + 1,
        candidateCount: selected.length,
        prefixSeedId: candidate.prefixSeedId,
        suffixSeedId: candidate.suffixSeedId,
        anchorNumber: candidate.anchorNumber,
      });
    }
    const normalized = optimizeLianyingDashOverlay(
      runtime,
      stripLianyingDashPacks(candidate.packs),
      { durationSeconds, maxStatesPerRow: initialDashStates },
    );
    const bridge = bridgeOptimizer(
      runtime,
      incumbentPacks,
      normalized.packs,
      {
        durationSeconds,
        crossoverAnchorNumber: candidate.anchorNumber,
        ...bridgeOptions,
        onProgress: typeof onProgress === "function"
          ? (event) => onProgress({
            stage: "candidate-bridge",
            candidate: index + 1,
            candidateCount: selected.length,
            bridgeStage: event.stage,
            bridgeEvent: event,
          })
          : null,
      },
    );
    const run = {
      index: index + 1,
      prefixSeedId: candidate.prefixSeedId,
      suffixSeedId: candidate.suffixSeedId,
      anchorNumber: candidate.anchorNumber,
      boundaryRow: candidate.boundaryRow,
      boundaryDistance: candidate.boundaryDistance,
      exactBoundaryState: candidate.exactBoundaryState,
      coarseDamage: candidate.totalDamage,
      normalizedDamage: normalized.state.totalDamage,
      normalizedGap: normalized.state.totalDamage - incumbent.state.totalDamage,
      bridgedDamage: bridge.bridgedDamage,
      bridgeDamageGain: bridge.bridgeDamageGain,
      globalDamageGain: bridge.globalDamageGain,
      dashCount: normalized.dashCount,
      segmentIds: bridge.segmentIds,
      explored: sumSearchMetric(bridge, "explored"),
      legal: sumSearchMetric(bridge, "legal"),
      passes: bridge.resynthesis.passes,
      packs: bridge.candidatePacks,
      state: bridge.candidateState,
    };
    runs.push(run);
    if (run.state.totalDamage > bestState.totalDamage) {
      bestPacks = run.packs;
      bestState = run.state;
      bestRunIndex = index;
    }
    if (typeof onProgress === "function") {
      onProgress({
        stage: "candidate-complete",
        candidate: index + 1,
        candidateCount: selected.length,
        normalizedGap: run.normalizedGap,
        bridgeDamageGain: run.bridgeDamageGain,
        globalDamageGain: run.globalDamageGain,
      });
    }
  }

  const bestAlternative = [...runs].sort(
    (left, right) => right.state.totalDamage - left.state.totalDamage,
  )[0];
  return {
    packs: bestPacks,
    state: bestState,
    accepted: bestState.totalDamage > incumbent.state.totalDamage,
    baselineDamage: incumbent.state.totalDamage,
    damageGain: bestState.totalDamage - incumbent.state.totalDamage,
    selectedCandidateCount: selected.length,
    inputCandidateCount: candidates.length,
    bestRunIndex: bestRunIndex === null ? null : bestRunIndex + 1,
    bestAlternativeRunIndex: bestAlternative.index,
    bestAlternative,
    runs,
    options: {
      durationSeconds,
      candidateLimit,
      selectedCandidateNumbers,
      initialDashStates,
      bridgeMode,
      bridgeOptions,
    },
  };
}

function csvCell(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function lianyingCrossoverBridgePortfolioToCsv(result) {
  const rows = [[
    "候选序号",
    "前缀种子",
    "后缀种子",
    "交叉雷序号",
    "交叉行",
    "边界状态距离",
    "边界完全一致",
    "粗排伤害",
    "完整突重排伤害",
    "重排后相对全局差",
    "桥接后伤害",
    "桥接局部收益",
    "桥接后相对全局差",
    "突次数",
    "桥接区段",
    "探索转移",
    "合法转移",
  ]];
  for (const run of result.runs) {
    rows.push([
      run.index,
      run.prefixSeedId,
      run.suffixSeedId,
      run.anchorNumber,
      run.boundaryRow,
      run.boundaryDistance,
      run.exactBoundaryState,
      run.coarseDamage,
      run.normalizedDamage,
      run.normalizedGap,
      run.bridgedDamage,
      run.bridgeDamageGain,
      run.globalDamageGain,
      run.dashCount,
      run.segmentIds,
      run.explored,
      run.legal,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
