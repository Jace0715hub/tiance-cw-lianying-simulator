import { FRAMES_PER_SECOND } from "../config/defaults.js";
import { replayWhitepaperLianying } from "../policies/whitepaper-lianying.js";

function inferPrimaryAction(row) {
  if (row.primaryAction) return row.primaryAction;
  if (row.destroySource) return "destroy";
  const skill = String(row.skill ?? "");
  if (skill.includes("龙牙")) return "dragonFang";
  if (skill.includes("任驰骋")) return "ride";
  if (skill.includes("龙吟")) return "dragonRoar";
  if (skill.includes("穿云")) return "cloudStrike";
  if (skill.includes("等待")) return "wait";
  throw new Error(`无法从技能名恢复主要技能: ${skill}`);
}

function restoreOffGcdAction(action) {
  return action.reason
    ? { id: action.action, reason: action.reason }
    : action.action;
}

/** 从旧版逐行JSON无损恢复动作包，用于继续搜索和反事实重放。 */
export function lianyingRowsToActionPacks(
  rows,
  { framesPerSecond = FRAMES_PER_SECOND } = {},
) {
  return rows.map((row) => {
    const pack = {
      prefix: [],
      primary: inferPrimaryAction(row),
      tail: [],
    };
    for (const action of row.offGcdActions ?? []) {
      const restored = restoreOffGcdAction(action);
      if (Number(action.seconds) <= Number(row.castSeconds) + 1e-7) {
        pack.prefix.push(restored);
        continue;
      }
      const leadFrames = Math.round(
        (Number(row.endSeconds) - Number(action.seconds)) * framesPerSecond,
      );
      pack.tail.push(
        typeof restored === "string"
          ? { id: restored, leadFrames }
          : { ...restored, leadFrames },
      );
    }
    return pack;
  });
}

function damageDeltaByComponent(baseline, counterfactual) {
  const names = new Set([
    ...Object.keys(baseline.damageBreakdown),
    ...Object.keys(counterfactual.damageBreakdown),
  ]);
  return [...names]
    .map((component) => ({
      component,
      baselineDamage: Number(baseline.damageBreakdown[component] ?? 0),
      counterfactualDamage: Number(
        counterfactual.damageBreakdown[component] ?? 0,
      ),
      damageDelta:
        Number(baseline.damageBreakdown[component] ?? 0) -
        Number(counterfactual.damageBreakdown[component] ?? 0),
    }))
    .filter((row) => Math.abs(row.damageDelta) > 1e-7)
    .sort((left, right) => right.damageDelta - left.damageDelta);
}

/**
 * 固定动作包不变，只切换“下马是否清除任驰骋攻击增益”，测量当前轴
 * 对该模型假设的伤害敏感度。它不是重新优化后的上下界。
 */
export function compareDismountRidePersistence(
  runtime,
  packs,
  { durationSeconds = 180 } = {},
) {
  const baseline = replayWhitepaperLianying(runtime, packs, {
    durationSeconds,
  });
  const counterfactualRuntime = {
    ...runtime,
    config: {
      ...runtime.config,
      dismountClearsRideBuff: true,
    },
  };
  const counterfactual = replayWhitepaperLianying(
    counterfactualRuntime,
    packs,
    { durationSeconds },
  );
  const damageDelta = baseline.state.totalDamage - counterfactual.state.totalDamage;
  return {
    assumption: "dismount-does-not-clear-ride-buff",
    comparisonType: "fixed-axis-counterfactual",
    durationSeconds,
    baseline: {
      dismountClearsRideBuff: false,
      rotationDamage: baseline.state.totalDamage,
      rotationDps: baseline.state.totalDamage / durationSeconds,
    },
    counterfactual: {
      dismountClearsRideBuff: true,
      rotationDamage: counterfactual.state.totalDamage,
      rotationDps: counterfactual.state.totalDamage / durationSeconds,
    },
    dependency: {
      damageDelta,
      dpsDelta: damageDelta / durationSeconds,
      relativeToBaseline: damageDelta / baseline.state.totalDamage,
      affectedComponents: damageDeltaByComponent(
        baseline.state,
        counterfactual.state,
      ),
    },
  };
}
