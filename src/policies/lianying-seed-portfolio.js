import {
  optimizeLianyingAnchorDriftResynthesis,
} from "./lianying-multisegment-resynthesis.js";
import { stripLianyingDashPacks } from "./lianying-segment-resynthesis.js";
import { replayWhitepaperLianying } from "./whitepaper-lianying.js";

export function lianyingPortfolioStructureKey(packs) {
  return JSON.stringify(stripLianyingDashPacks(packs));
}

function csvCell(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function lianyingSeedPortfolioToCsv(result) {
  const rows = [[
    "种子",
    "来源",
    "种子循环伤害",
    "种子排名",
    "本地搜索接受",
    "搜索后循环伤害",
    "相对种子增益",
    "相对全局基线差",
    "原雷坐标",
    "搜索后雷坐标",
    "探索转移",
    "合法转移",
    "末端坐标谱系数",
  ]];
  for (const seed of result.seedReports ?? []) {
    rows.push([
      seed.id,
      seed.sourcePath ?? "",
      seed.seedDamage,
      seed.seedRank,
      seed.localAccepted,
      seed.resultDamage,
      seed.localDamageGain,
      seed.globalDamageGain,
      seed.anchors,
      seed.selectedAnchors,
      seed.explored,
      seed.legal,
      seed.finalSchedules,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function optimizeLianyingAnchorDriftPortfolio(
  runtime,
  seeds,
  {
    durationSeconds = 180,
    maxSeeds = 4,
    optimizerOptions = {},
    onProgress = null,
  } = {},
) {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error("多种子搜索至少需要一条完整技能轴");
  }
  const byStructure = new Map();
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    if (!Array.isArray(seed?.packs) || seed.packs.length === 0) {
      throw new Error(`第${index + 1}条种子没有动作包`);
    }
    const replay = replayWhitepaperLianying(runtime, seed.packs, {
      durationSeconds,
    });
    const prepared = {
      id: seed.id ?? `seed-${index + 1}`,
      sourcePath: seed.sourcePath ?? null,
      packs: seed.packs,
      state: replay.state,
      structureKey: lianyingPortfolioStructureKey(seed.packs),
    };
    const current = byStructure.get(prepared.structureKey);
    if (!current || replay.state.totalDamage > current.state.totalDamage) {
      byStructure.set(prepared.structureKey, prepared);
    }
  }
  const preparedSeeds = [...byStructure.values()]
    .sort((left, right) => right.state.totalDamage - left.state.totalDamage)
    .slice(0, Math.max(1, Number(maxSeeds)));
  const globalBaseline = preparedSeeds[0];
  let best = {
    seed: globalBaseline,
    packs: globalBaseline.packs,
    state: globalBaseline.state,
    result: null,
  };
  const seedReports = [];
  let explored = 0;
  let legal = 0;

  for (let index = 0; index < preparedSeeds.length; index += 1) {
    const seed = preparedSeeds[index];
    if (typeof onProgress === "function") {
      onProgress({
        stage: "seed-start",
        seed: index + 1,
        seedCount: preparedSeeds.length,
        seedId: seed.id,
        seedDamage: seed.state.totalDamage,
      });
    }
    const result = optimizeLianyingAnchorDriftResynthesis(
      runtime,
      seed.packs,
      {
        durationSeconds,
        ...optimizerOptions,
        onProgress: typeof onProgress === "function"
          ? (event) => onProgress({
            ...event,
            seed: index + 1,
            seedCount: preparedSeeds.length,
            seedId: seed.id,
          })
          : null,
      },
    );
    explored += Number(result.explored ?? 0);
    legal += Number(result.legal ?? 0);
    const resultDamage = result.state.totalDamage;
    if (seed.id === globalBaseline.id && best.result === null) {
      best.result = result;
    }
    if (resultDamage > best.state.totalDamage) {
      best = {
        seed,
        packs: result.packs,
        state: result.state,
        result,
      };
    }
    const report = {
      id: seed.id,
      sourcePath: seed.sourcePath,
      seedRank: index + 1,
      seedDamage: seed.state.totalDamage,
      localAccepted: result.accepted,
      resultDamage,
      localDamageGain: resultDamage - seed.state.totalDamage,
      globalDamageGain: resultDamage - globalBaseline.state.totalDamage,
      anchors: result.anchors,
      selectedAnchors: result.selectedAnchors,
      explored: result.explored,
      legal: result.legal,
      finalSchedules: result.finalSchedules,
    };
    seedReports.push(report);
    if (typeof onProgress === "function") {
      onProgress({
        stage: "seed-complete",
        seed: index + 1,
        seedCount: preparedSeeds.length,
        ...report,
      });
    }
  }

  if (!best.result) {
    const selectedIndex = preparedSeeds.indexOf(globalBaseline);
    const report = seedReports[selectedIndex];
    best.result = {
      packs: globalBaseline.packs,
      state: globalBaseline.state,
      accepted: false,
      damageGain: 0,
      anchors: report?.anchors ?? [],
      selectedAnchors: report?.selectedAnchors ?? report?.anchors ?? [],
      segments: [],
      explored: report?.explored ?? 0,
      legal: report?.legal ?? 0,
      finalSchedules: report?.finalSchedules ?? 0,
    };
  }
  const accepted = best.state.totalDamage > globalBaseline.state.totalDamage;
  return {
    packs: accepted ? best.packs : globalBaseline.packs,
    state: accepted ? best.state : globalBaseline.state,
    baselineDamage: globalBaseline.state.totalDamage,
    damageGain: accepted
      ? best.state.totalDamage - globalBaseline.state.totalDamage
      : 0,
    accepted,
    selectedSeedId: accepted ? best.seed.id : globalBaseline.id,
    selectedResult: accepted ? best.result : (
      best.seed.id === globalBaseline.id ? best.result : null
    ),
    inputSeedCount: seeds.length,
    uniqueSeedCount: byStructure.size,
    searchedSeedCount: preparedSeeds.length,
    explored,
    legal,
    seedReports,
    options: {
      durationSeconds,
      maxSeeds,
      optimizerOptions,
    },
  };
}
