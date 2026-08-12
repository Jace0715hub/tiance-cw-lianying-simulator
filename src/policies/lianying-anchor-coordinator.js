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
 * 生成少量高层雷锚点模板。默认只允许一个中间雷移动一行，因此7雷轴
 * 最多得到1条原轴和10条单移位模板，不会隐式展开3^5种组合。
 */
export function buildLianyingBoundedThunderTemplates(
  anchors,
  {
    slackRows = 1,
    fixFirstAnchor = true,
    fixLastAnchor = true,
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
  const movable = incumbent
    .map((_, index) => index)
    .filter((index) => !(fixFirstAnchor && index === 0))
    .filter((index) => !(fixLastAnchor && index === incumbent.length - 1));
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
