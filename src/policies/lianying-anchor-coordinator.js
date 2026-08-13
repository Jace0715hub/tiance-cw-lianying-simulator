import {
  identifyLianyingThunderSegments,
  stripLianyingDashPacks,
} from "./lianying-segment-resynthesis.js";
import {
  lianyingCompanionAnchorRows,
  optimizeLianyingAnchorDriftResynthesis,
} from "./lianying-multisegment-resynthesis.js";

function scheduleKey(rows) {
  return JSON.stringify(rows);
}

function isStrictlyIncreasing(rows) {
  return rows.every((row, index) => index === 0 || row > rows[index - 1]);
}

/**
 * 从全局锚点漂移的合法核心轴中保留少量结构种子。先按“哪几个雷
 * 发生了移动”分组，再按核心伤害排序，避免短名单全被同一个雷的相邻坐标
 * 占满。该函数只分配后续搜索预算，不改变完整180秒选优规则。
 */
export function selectLianyingStructuralSeedCandidates(
  candidates,
  incumbentRows,
  {
    limit = 4,
    maximumCoreDamageLossRatio = 0.05,
  } = {},
) {
  const incumbent = incumbentRows.map(Number);
  const normalized = (candidates ?? []).map((candidate) => {
    const rows = (candidate.anchorRows ?? []).map(Number);
    const changedAnchors = rows.flatMap((row, index) =>
      row === incumbent[index] ? [] : [index + 1]);
    return {
      ...candidate,
      anchorRows: rows,
      changedAnchors,
      anchorDistance: rows.reduce(
        (sum, row, index) => sum + Math.abs(row - incumbent[index]),
        0,
      ),
      structureGroup: changedAnchors.join("+"),
    };
  });
  const incumbentCandidate = normalized.find(
    (candidate) => candidate.changedAnchors.length === 0,
  );
  const baselineDamage = Number(
    incumbentCandidate?.bestCoreDamage ??
      Math.max(...normalized.map((candidate) => Number(candidate.bestCoreDamage))),
  );
  const maximumLossRatio = Math.max(
    0,
    Number(maximumCoreDamageLossRatio),
  );
  const eligible = normalized
    .filter((candidate) => candidate.changedAnchors.length > 0)
    .map((candidate) => ({
      ...candidate,
      coreDamageLoss: baselineDamage - Number(candidate.bestCoreDamage),
      coreDamageLossRatio: baselineDamage > 0
        ? (baselineDamage - Number(candidate.bestCoreDamage)) / baselineDamage
        : 0,
    }))
    .filter((candidate) =>
      Number.isFinite(candidate.bestCoreDamage) &&
      candidate.coreDamageLossRatio <= maximumLossRatio)
    .sort((left, right) =>
      right.bestCoreDamage - left.bestCoreDamage ||
      right.anchorDistance - left.anchorDistance);
  const groupBest = new Map();
  for (const candidate of eligible) {
    if (!groupBest.has(candidate.structureGroup)) {
      groupBest.set(candidate.structureGroup, candidate);
    }
  }
  const selected = [];
  const selectedKeys = new Set();
  const add = (candidate) => {
    if (!candidate || selected.length >= Math.max(0, Math.floor(limit))) return;
    const key = JSON.stringify(candidate.anchorRows);
    if (selectedKeys.has(key)) return;
    selected.push(candidate);
    selectedKeys.add(key);
  };
  for (const candidate of groupBest.values()) add(candidate);
  for (const candidate of eligible) add(candidate);
  return selected;
}

/**
 * 生成少量高层雷锚点模板。默认只允许一个中间雷移动一行，因此7雷轴
 * 最多得到1条原轴和10条单移位模板，不会隐式展开3^5种组合。
 */
export function buildLianyingBoundedThunderTemplates(
  anchors,
  {
    slackRows = 1,
    fixFirstAnchor = true,
    fixLastAnchor = true,
    movableAnchorNumbers = null,
    maximumShiftedAnchors = 1,
    maximumTemplates = 16,
  } = {},
) {
  const incumbent = anchors.map(Number);
  if (
    incumbent.some((row) => !Number.isInteger(row)) ||
    !isStrictlyIncreasing(incumbent)
  ) {
    throw new Error("雷锚点必须是严格递增的整数行索引");
  }
  const movableAnchorNumberSet = Array.isArray(movableAnchorNumbers)
    ? new Set(movableAnchorNumbers.map(Number).filter((number) =>
        Number.isInteger(number) && number >= 1 && number <= incumbent.length))
    : null;
  const movable = incumbent
    .map((_, index) => index)
    .filter((index) => !(fixFirstAnchor && index === 0))
    .filter((index) => !(fixLastAnchor && index === incumbent.length - 1))
    .filter((index) =>
      movableAnchorNumberSet === null || movableAnchorNumberSet.has(index + 1));
  const deltas = [];
  for (let delta = 1; delta <= Math.max(0, Math.floor(slackRows)); delta += 1) {
    deltas.push(-delta, delta);
  }
  const selected = new Map([[scheduleKey(incumbent), {
    templateId: "incumbent",
    anchorRows: incumbent,
    shiftedAnchors: [],
  }]]);
  let frontier = [incumbent];
  for (
    let depth = 1;
    depth <= Math.max(0, Math.floor(maximumShiftedAnchors));
    depth += 1
  ) {
    const nextFrontier = [];
    for (const schedule of frontier) {
      for (const anchorIndex of movable) {
        if (schedule[anchorIndex] !== incumbent[anchorIndex]) continue;
        for (const delta of deltas) {
          const candidate = [...schedule];
          candidate[anchorIndex] += delta;
          if (!isStrictlyIncreasing(candidate)) continue;
          const key = scheduleKey(candidate);
          if (selected.has(key)) continue;
          const shiftedAnchors = candidate.flatMap((row, index) =>
            row === incumbent[index]
              ? []
              : [{
                  anchorNumber: index + 1,
                  fromRow: incumbent[index] + 1,
                  toRow: row + 1,
                  deltaRows: row - incumbent[index],
                }]);
          selected.set(key, {
            templateId: `shift-${shiftedAnchors.map(
              (shift) => `${shift.anchorNumber}:${shift.deltaRows > 0 ? "+" : ""}${shift.deltaRows}`,
            ).join("+")}`,
            anchorRows: candidate,
            shiftedAnchors,
          });
          nextFrontier.push(candidate);
          if (selected.size >= Math.max(1, Math.floor(maximumTemplates))) {
            return [...selected.values()];
          }
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }
  return [...selected.values()];
}

export function buildLianyingRankedPairThunderTemplates(
  anchors,
  singleTemplateDiagnostics,
  {
    rankedSingleTemplateLimit = 5,
    maximumPairTemplates = 6,
  } = {},
) {
  const incumbent = anchors.map(Number);
  const rankedSingles = (singleTemplateDiagnostics ?? [])
    .map((diagnostic) => {
      const rows = (diagnostic.anchorRows ?? []).map(
        (row) => Number(row) - 1,
      );
      const shifted = rows.flatMap((row, index) =>
        row === incumbent[index]
          ? []
          : [{
              anchorIndex: index,
              anchorNumber: index + 1,
              fromRow: incumbent[index] + 1,
              toRow: row + 1,
              deltaRows: row - incumbent[index],
            }]);
      return { diagnostic, rows, shifted };
    })
    .filter((entry) =>
      entry.rows.length === incumbent.length &&
      entry.shifted.length === 1 &&
      Number.isFinite(Number(entry.diagnostic.bestCoreDamageGain)))
    .sort((left, right) =>
      Number(right.diagnostic.bestCoreDamageGain) -
        Number(left.diagnostic.bestCoreDamageGain))
    .slice(0, Math.max(0, Math.floor(rankedSingleTemplateLimit)));
  const selected = new Map();
  for (let leftIndex = 0; leftIndex < rankedSingles.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < rankedSingles.length;
      rightIndex += 1
    ) {
      const left = rankedSingles[leftIndex];
      const right = rankedSingles[rightIndex];
      if (left.shifted[0].anchorIndex === right.shifted[0].anchorIndex) continue;
      const candidate = [...incumbent];
      candidate[left.shifted[0].anchorIndex] =
        left.rows[left.shifted[0].anchorIndex];
      candidate[right.shifted[0].anchorIndex] =
        right.rows[right.shifted[0].anchorIndex];
      if (!isStrictlyIncreasing(candidate)) continue;
      const key = scheduleKey(candidate);
      if (selected.has(key)) continue;
      const shiftedAnchors = [left.shifted[0], right.shifted[0]]
        .sort((a, b) => a.anchorNumber - b.anchorNumber)
        .map(({ anchorIndex: _anchorIndex, ...shift }) => shift);
      selected.set(key, {
        templateId: `pair-${shiftedAnchors.map(
          (shift) => `${shift.anchorNumber}:${shift.deltaRows > 0 ? "+" : ""}${shift.deltaRows}`,
        ).join("+")}`,
        anchorRows: candidate,
        shiftedAnchors,
        sourceTemplateIds: [
          left.diagnostic.templateId,
          right.diagnostic.templateId,
        ],
        sourceCoreDamageGains: [
          left.diagnostic.bestCoreDamageGain,
          right.diagnostic.bestCoreDamageGain,
        ],
      });
      if (selected.size >= Math.max(0, Math.floor(maximumPairTemplates))) {
        return [...selected.values()];
      }
    }
  }
  return [...selected.values()];
}

function diagnoseTemplate(template, optimized) {
  const finalSchedules = new Set((optimized.finalScheduleRows ?? []).map(
    (schedule) => JSON.stringify(schedule),
  ));
  const oneBasedRows = template.anchorRows.map((row) => row + 1);
  let survivedThroughAnchorCount = 0;
  for (const segment of optimized.segments ?? []) {
    const prefix = oneBasedRows.slice(0, segment.anchorNumber);
    if ((segment.survivingAnchorSchedules ?? []).some(
      (schedule) => JSON.stringify(schedule) === JSON.stringify(prefix),
    )) {
      survivedThroughAnchorCount = segment.anchorNumber;
    } else {
      break;
    }
  }
  const coarse = optimized.coarseCandidates.filter(
    (candidate) => JSON.stringify(candidate.anchorRows) ===
      JSON.stringify(oneBasedRows),
  );
  const bestCoarseDamage = coarse.length > 0
    ? Math.max(...coarse.map((candidate) => candidate.totalDamage))
    : null;
  const core = optimized.coreScheduleDiagnostics?.find(
    (candidate) => JSON.stringify(candidate.anchorRows) ===
      JSON.stringify(oneBasedRows),
  ) ?? null;
  return {
    templateId: template.templateId,
    anchorRows: oneBasedRows,
    survivedThroughAnchorCount,
    reachedFinalBoundary: finalSchedules.has(JSON.stringify(oneBasedRows)),
    reachedCore: core !== null,
    bestCoreDamage: core?.bestCoreDamage ?? null,
    bestCoreDamageGain: core?.bestCoreDamageGain ?? null,
    bestCoreCompanionAnchors: core?.bestCoreCompanionAnchors ?? null,
    reachedCoarse: coarse.length > 0,
    bestCoarseDamage,
    bestCoarseDamageGain: bestCoarseDamage === null
      ? null
      : bestCoarseDamage - optimized.baselineDamage,
  };
}

function attachCoordination(optimized, templates, templateDiagnostics, options) {
  return {
    ...optimized,
    coordination: {
      kind: "bounded-thunder-anchor-coordination",
      evaluationMode: options.evaluationMode ?? "shared",
      maximumShiftedAnchors: options.maximumShiftedAnchors ?? 1,
      maximumTemplates: options.maximumTemplates ?? 16,
      movableAnchorNumbers: Array.isArray(options.movableAnchorNumbers)
        ? [...options.movableAnchorNumbers]
        : null,
      proposedTemplates: templates.map((template) => ({
        ...template,
        anchorRows: template.anchorRows.map((row) => row + 1),
      })),
      proposedTemplateCount: templates.length,
      finalBoundaryTemplateCount: templateDiagnostics.filter(
        (template) => template.reachedFinalBoundary,
      ).length,
      coarseTemplateCount: templateDiagnostics.filter(
        (template) => template.reachedCoarse,
      ).length,
      selectedTemplate: optimized.selectedAnchors,
      templateDiagnostics,
    },
  };
}

export function optimizeLianyingHierarchicalAnchorCoordination(
  runtime,
  packs,
  options = {},
) {
  const corePacks = stripLianyingDashPacks(packs);
  const anchors = identifyLianyingThunderSegments(corePacks).anchors;
  const templates = Array.isArray(options.anchorTemplates)
    ? options.anchorTemplates
    : buildLianyingBoundedThunderTemplates(anchors, {
        slackRows: options.anchorSlackRows ?? 1,
        fixFirstAnchor: options.fixFirstAnchor ?? true,
        fixLastAnchor: options.fixLastAnchor ?? true,
        movableAnchorNumbers: options.movableAnchorNumbers ?? null,
        maximumShiftedAnchors: options.maximumShiftedAnchors ?? 1,
        maximumTemplates: options.maximumTemplates ?? 16,
      });
  if ((options.evaluationMode ?? "shared") !== "independent") {
    const optimized = optimizeLianyingAnchorDriftResynthesis(runtime, packs, {
      ...options,
      allowedAnchorSchedules: templates.map((template) => template.anchorRows),
    });
    return attachCoordination(
      optimized,
      templates,
      templates.map((template) => diagnoseTemplate(template, optimized)),
      options,
    );
  }

  const incumbent = templates[0];
  const targets = templates.length > 1 ? templates.slice(1) : templates;
  const evaluations = targets.map((template, index) => {
    const allowed = template.templateId === "incumbent"
      ? [incumbent.anchorRows]
      : [incumbent.anchorRows, template.anchorRows];
    const optimized = optimizeLianyingAnchorDriftResynthesis(runtime, packs, {
      ...options,
      allowedAnchorSchedules: allowed,
      onProgress: typeof options.onProgress === "function"
        ? (event) => options.onProgress({
            ...event,
            template: index + 1,
            templateCount: targets.length,
            templateId: template.templateId,
          })
        : null,
    });
    return { template, optimized };
  });
  const bestEvaluation = [...evaluations].sort((left, right) =>
    right.optimized.state.totalDamage - left.optimized.state.totalDamage)[0];
  const mergedCoarse = new Map();
  const mergedCore = new Map();
  const mergedScheduleCandidates = new Map();
  for (const evaluation of evaluations) {
    for (const candidate of evaluation.optimized.coarseCandidates ?? []) {
      const key = JSON.stringify(candidate.anchorRows);
      const current = mergedCoarse.get(key);
      if (!current || candidate.totalDamage > current.totalDamage) {
        mergedCoarse.set(key, candidate);
      }
    }
    for (const candidate of evaluation.optimized.coreScheduleDiagnostics ?? []) {
      const key = JSON.stringify(candidate.anchorRows);
      const current = mergedCore.get(key);
      if (!current || candidate.bestCoreDamage > current.bestCoreDamage) {
        mergedCore.set(key, candidate);
      }
    }
    for (const candidate of evaluation.optimized.coreScheduleCandidates ?? []) {
      const key = JSON.stringify(candidate.anchorRows);
      const current = mergedScheduleCandidates.get(key);
      if (!current || candidate.bestCoreDamage > current.bestCoreDamage) {
        mergedScheduleCandidates.set(key, candidate);
      }
    }
  }
  const optimized = {
    ...bestEvaluation.optimized,
    explored: evaluations.reduce(
      (total, evaluation) => total + evaluation.optimized.explored,
      0,
    ),
    legal: evaluations.reduce(
      (total, evaluation) => total + evaluation.optimized.legal,
      0,
    ),
    coarseCandidates: [...mergedCoarse.values()].sort(
      (left, right) => right.totalDamage - left.totalDamage,
    ),
    coreScheduleDiagnostics: [...mergedCore.values()].sort(
      (left, right) => right.bestCoreDamage - left.bestCoreDamage,
    ),
    coreScheduleCandidates: [...mergedScheduleCandidates.values()].sort(
      (left, right) => right.bestCoreDamage - left.bestCoreDamage,
    ),
  };
  const templateDiagnostics = templates.map((template) => {
    const evaluation = template.templateId === "incumbent"
      ? evaluations[0]
      : evaluations.find(
          (candidate) => candidate.template.templateId === template.templateId,
        );
    return diagnoseTemplate(template, evaluation.optimized);
  });
  const result = attachCoordination(
    optimized,
    templates,
    templateDiagnostics,
    options,
  );
  result.coordination.independentEvaluations = evaluations.length;
  result.coordination.exploredTransitions = result.explored;
  result.coordination.legalTransitions = result.legal;
  return result;
}

export function optimizeLianyingRankedPairAnchorCoordination(
  runtime,
  packs,
  singleTemplateDiagnostics,
  options = {},
) {
  const anchors = identifyLianyingThunderSegments(
    stripLianyingDashPacks(packs),
  ).anchors;
  let pairs = buildLianyingRankedPairThunderTemplates(
    anchors,
    singleTemplateDiagnostics,
    options,
  );
  if (Array.isArray(options.pairTemplateIds) && options.pairTemplateIds.length > 0) {
    const selectedIds = new Set(options.pairTemplateIds);
    pairs = pairs.filter((pair) => selectedIds.has(pair.templateId));
  }
  const incumbent = {
    templateId: "incumbent",
    anchorRows: anchors,
    shiftedAnchors: [],
  };
  const companionTypes = new Set(options.preserveCompanionAnchorTypes ?? []);
  const sourceCompanionAnchors = lianyingCompanionAnchorRows(
    stripLianyingDashPacks(packs),
  );
  const companionSlackRows = Math.max(
    0,
    Math.floor(Number(options.companionAnchorSlackRows ?? 0)),
  );
  const companionAnchorTemplate = Object.fromEntries([
    ["ride", "rideRows"],
    ["orange", "orangeRows"],
    ["dismount", "dismountRows"],
  ].flatMap(([type, key]) =>
    companionTypes.has(type)
      ? companionSlackRows > 0
        ? [[key.replace("Rows", "Windows"), sourceCompanionAnchors[key].map(
            (row) => ({
              targetRow: row,
              earliestRow: row - companionSlackRows,
              latestRow: row + companionSlackRows,
            }))]]
        : [[key, sourceCompanionAnchors[key]]]
      : []));
  const result = optimizeLianyingHierarchicalAnchorCoordination(
    runtime,
    packs,
    {
      ...options,
      evaluationMode: "independent",
      maximumShiftedAnchors: 2,
      companionAnchorTemplate: companionTypes.size > 0
        ? companionAnchorTemplate
        : null,
      anchorTemplates: [incumbent, ...pairs],
    },
  );
  result.coordination.kind = "ranked-pair-thunder-anchor-coordination";
  result.coordination.rankedSingleTemplateLimit =
    options.rankedSingleTemplateLimit ?? 5;
  result.coordination.maximumPairTemplates =
    options.maximumPairTemplates ?? 6;
  result.coordination.sourceSingleTemplateIds = [...new Set(
    pairs.flatMap((pair) => pair.sourceTemplateIds),
  )];
  result.coordination.preservedCompanionAnchorTypes = [...companionTypes];
  result.coordination.companionAnchorSlackRows = companionSlackRows;
  result.coordination.companionAnchorTemplate = companionTypes.size > 0
    ? companionAnchorTemplate
    : null;
  return result;
}

export function buildLianyingFocusedCompanionAnchorTemplate(
  packs,
  {
    companionTypes = ["ride"],
    fixedThroughOrdinal = 4,
    beforeRows = 0,
    afterRows = 2,
    companionPolicies = {},
  } = {},
) {
  const anchors = lianyingCompanionAnchorRows(stripLianyingDashPacks(packs));
  const selectedTypes = new Set(companionTypes);
  const fixedCount = Math.max(0, Math.floor(Number(fixedThroughOrdinal)));
  const before = Math.max(0, Math.floor(Number(beforeRows)));
  const after = Math.max(0, Math.floor(Number(afterRows)));
  return Object.fromEntries([
    ["ride", "rideRows"],
    ["orange", "orangeRows"],
    ["dismount", "dismountRows"],
  ].flatMap(([type, key]) => {
    if (!selectedTypes.has(type)) return [];
    const policy = companionPolicies[type] ?? {};
    const typeFixedCount = Math.max(
      0,
      Math.floor(Number(policy.fixedThroughOrdinal ?? fixedCount)),
    );
    const typeBefore = Math.max(
      0,
      Math.floor(Number(policy.beforeRows ?? before)),
    );
    const typeAfter = Math.max(
      0,
      Math.floor(Number(policy.afterRows ?? after)),
    );
    const ordinalWindows = policy.ordinalWindows &&
      typeof policy.ordinalWindows === "object"
      ? policy.ordinalWindows
      : null;
    return [[key.replace("Rows", "Windows"), anchors[key].map(
      (row, index) => {
        const ordinalPolicy = ordinalWindows?.[index + 1] ?? null;
        const isFixed = ordinalWindows !== null
          ? ordinalPolicy === null
          : index < typeFixedCount;
        const rowBefore = isFixed
          ? 0
          : Math.max(
              0,
              Math.floor(Number(ordinalPolicy?.beforeRows ?? typeBefore)),
            );
        const rowAfter = isFixed
          ? 0
          : Math.max(
              0,
              Math.floor(Number(ordinalPolicy?.afterRows ?? typeAfter)),
            );
        return {
          targetRow: row,
          earliestRow: row - rowBefore,
          latestRow: row + rowAfter,
        };
      })]];
  }));
}

export function optimizeLianyingFocusedCompanionAnchorCoordination(
  runtime,
  packs,
  options = {},
) {
  const corePacks = stripLianyingDashPacks(packs);
  const anchors = identifyLianyingThunderSegments(corePacks).anchors;
  const companionAnchorTemplate = buildLianyingFocusedCompanionAnchorTemplate(
    corePacks,
    options,
  );
  const result = optimizeLianyingHierarchicalAnchorCoordination(
    runtime,
    packs,
    {
      ...options,
      evaluationMode: "shared",
      maximumShiftedAnchors: 0,
      companionAnchorTemplate,
      anchorTemplates: [{
        templateId: "focused-incumbent",
        anchorRows: anchors,
        shiftedAnchors: [],
      }],
    },
  );
  result.coordination.kind = "focused-companion-anchor-coordination";
  result.coordination.companionTypes = [...(
    options.companionTypes ?? ["ride"]
  )];
  result.coordination.fixedThroughOrdinal =
    options.fixedThroughOrdinal ?? 4;
  result.coordination.beforeRows = options.beforeRows ?? 0;
  result.coordination.afterRows = options.afterRows ?? 2;
  result.coordination.companionPolicies = options.companionPolicies ?? {};
  result.coordination.companionAnchorTemplate = companionAnchorTemplate;
  return result;
}

/**
 * 在每次接受改进后，以新轴的伴随锚点重新生成有限窗口。
 * 这使落在窗口边界的优胜者可以继续向同一方向探索，同时用轮次上限
 * 保持计算量可控。
 */
export function optimizeLianyingIterativeFocusedCompanionAnchorCoordination(
  runtime,
  packs,
  options = {},
) {
  const maximumPasses = Math.max(
    1,
    Math.floor(Number(options.maximumFocusedPasses ?? 3)),
  );
  const minimumDamageGain = Math.max(
    0,
    Number(options.minimumFocusedDamageGain ?? 0),
  );
  const onProgress = options.onProgress;
  let currentPacks = packs;
  let initialDamage = null;
  let finalResult = null;
  let explored = 0;
  let legal = 0;
  let stopReason = "maximum-passes";
  const passes = [];

  for (let pass = 1; pass <= maximumPasses; pass += 1) {
    const result = optimizeLianyingFocusedCompanionAnchorCoordination(
      runtime,
      currentPacks,
      {
        ...options,
        onProgress: typeof onProgress === "function"
          ? (event) => onProgress({ focusedPass: pass, ...event })
          : undefined,
      },
    );
    if (initialDamage === null) initialDamage = result.baselineDamage;
    explored += result.explored;
    legal += result.legal;
    finalResult = result;
    passes.push({
      pass,
      accepted: result.accepted,
      baselineDamage: result.baselineDamage,
      finalDamage: result.state.totalDamage,
      damageGain: result.damageGain,
      selectedAnchors: result.selectedAnchors,
      companionAnchors:
        result.coordination?.templateDiagnostics?.find(
          (diagnostic) => diagnostic.reachedCore,
        )?.bestCoreCompanionAnchors ?? null,
      explored: result.explored,
      legal: result.legal,
    });
    if (!result.accepted || result.damageGain <= minimumDamageGain) {
      stopReason = result.accepted
        ? "minimum-damage-gain"
        : "converged";
      break;
    }
    currentPacks = result.packs;
  }

  const finalDamage = finalResult.state.totalDamage;
  const accepted = finalDamage > initialDamage;
  const iteration = {
    maximumPasses,
    minimumDamageGain,
    executedPasses: passes.length,
    acceptedPasses: passes.filter((pass) => pass.accepted).length,
    stopReason,
    passes,
  };
  return {
    ...finalResult,
    packs: accepted ? finalResult.packs : packs,
    baselineDamage: initialDamage,
    damageGain: accepted ? finalDamage - initialDamage : 0,
    accepted,
    explored,
    legal,
    iteration,
    coordination: {
      ...finalResult.coordination,
      kind: "iterative-focused-companion-anchor-coordination",
      iteration,
    },
  };
}

export function lianyingAnchorCoordinationTemplatesToCsv(result) {
  const selected = JSON.stringify(result.selectedAnchors ?? []);
  const rows = [[
    "模板",
    "雷锚点行",
    "移动锚点数",
    "移动详情",
    "存活至雷序号",
    "到达最终边界",
    "进入核心复演",
    "核心最佳伤害差",
    "核心任驰骋行",
    "核心橙武行",
    "核心下马行",
    "进入粗排",
    "粗排最佳伤害差",
    "最终选择",
  ]];
  const coarse = new Set((result.coarseCandidates ?? []).map(
    (candidate) => JSON.stringify(candidate.anchorRows)),
  );
  for (const template of result.coordination?.proposedTemplates ?? []) {
    const key = JSON.stringify(template.anchorRows);
    const diagnostic = result.coordination?.templateDiagnostics?.find(
      (candidate) => candidate.templateId === template.templateId,
    );
    rows.push([
      template.templateId,
      template.anchorRows.join("/"),
      template.shiftedAnchors.length,
      template.shiftedAnchors.map(
        (shift) => `${shift.anchorNumber}:${shift.fromRow}→${shift.toRow}`,
      ).join(";"),
      diagnostic?.survivedThroughAnchorCount ?? 0,
      diagnostic?.reachedFinalBoundary ?? false,
      diagnostic?.reachedCore ?? false,
      diagnostic?.bestCoreDamageGain ?? "",
      diagnostic?.bestCoreCompanionAnchors?.rideRows?.join("/") ?? "",
      diagnostic?.bestCoreCompanionAnchors?.orangeRows?.join("/") ?? "",
      diagnostic?.bestCoreCompanionAnchors?.dismountRows?.join("/") ?? "",
      diagnostic?.reachedCoarse ?? coarse.has(key),
      diagnostic?.bestCoarseDamageGain ?? "",
      key === selected,
    ]);
  }
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}
