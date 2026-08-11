import { cloneState } from "../engine/state.js";
import { replayProfileRows } from "./profile-replay.js";
import {
  ORANGE_WINDOW_PRIMARY_LABELS,
  replaceProfilePrimary,
} from "./orange-window-search.js";

function labelOf(row) {
  return String(row?.skill ?? row?.label ?? "").trim();
}

function choicesForRow(row) {
  if (labelOf(row).includes("任驰骋")) return [{ ...row }];
  return ORANGE_WINDOW_PRIMARY_LABELS.map((primary) =>
    replaceProfilePrimary(row, primary),
  );
}

function isolatedSearchState(inputState) {
  const state = cloneState(inputState);
  state.timeline = [];
  state.sequence = 0;
  state.totalDamage = 0;
  state.damageBreakdown = {};
  return state;
}

function windowMetrics(state, fromTick, untilTick) {
  const damageEvents = state.timeline.filter(
    (event) =>
      event.type === "damage" && event.tick >= fromTick && event.tick < untilTick,
  );
  const fangs = state.timeline.filter(
    (event) =>
      event.type === "cast" &&
      event.action === "dragonFang" &&
      event.tick >= fromTick &&
      event.tick < untilTick,
  );
  return {
    damage: damageEvents.reduce((sum, event) => sum + Number(event.amount), 0),
    dragonFangs: fangs.length,
    orangeDragonFangs: fangs.filter((event) => event.orange).length,
    rideDragonFangs: fangs.filter((event) => event.dragonRideBonus).length,
  };
}

function stateSignature(state) {
  return JSON.stringify([
    state.tick,
    state.gcdReadyTick,
    state.rage,
    state.bleedStacks,
    state.bleedQuality,
    state.bleedNextTick,
    state.autoAttackNextTick,
    state.dragonRideStacks,
    state.mounted,
    state.mountedFromTick,
    state.executeDestroyToggle,
    state.cooldownReadyTick,
    state.buffTicks,
    state.chargeTicks,
  ]);
}

export function beamSearchThunderWindow(
  inputState,
  rows,
  config,
  oracle,
  {
    windowFromTick,
    windowUntilTick,
    beamWidth = 256,
  } = {},
) {
  if (!Number.isSafeInteger(windowFromTick) || !Number.isSafeInteger(windowUntilTick)) {
    throw new Error("激雷窗口搜索需要整数开始和结束时钟");
  }
  if (!Number.isInteger(beamWidth) || beamWidth <= 0) {
    throw new Error("束宽度必须是正整数");
  }

  let beam = [{
    state: isolatedSearchState(inputState),
    rows: [],
    skills: [],
    ...windowMetrics({ timeline: [] }, windowFromTick, windowUntilTick),
  }];
  let exploredTransitions = 0;
  let legalTransitions = 0;
  const depthStats = [];

  for (let depth = 0; depth < rows.length; depth += 1) {
    const deduplicated = new Map();
    for (const node of beam) {
      for (const choice of choicesForRow(rows[depth])) {
        exploredTransitions += 1;
        try {
          const replay = replayProfileRows(
            node.state,
            [choice],
            config,
            oracle,
            { validateResource: false },
          );
          legalTransitions += 1;
          const metrics = windowMetrics(
            replay.state,
            windowFromTick,
            windowUntilTick,
          );
          const candidate = {
            state: replay.state,
            rows: [...node.rows, { ...choice }],
            skills: [...node.skills, labelOf(choice)],
            ...metrics,
          };
          const signature = stateSignature(replay.state);
          const previous = deduplicated.get(signature);
          if (!previous || candidate.damage > previous.damage) {
            deduplicated.set(signature, candidate);
          }
        } catch {
          // 非法战意、冷却、充能或马上条件不进入下一层。
        }
      }
    }
    const beforePrune = deduplicated.size;
    beam = [...deduplicated.values()]
      .sort(
        (left, right) =>
          right.damage - left.damage ||
          right.dragonFangs - left.dragonFangs ||
          left.skills.join("").localeCompare(right.skills.join(""), "zh-CN"),
      )
      .slice(0, beamWidth);
    depthStats.push({
      depth: depth + 1,
      inputStates: depth === 0 ? 1 : depthStats.at(-1).keptStates,
      deduplicatedStates: beforePrune,
      keptStates: beam.length,
    });
    if (beam.length === 0) break;
  }

  return {
    beamWidth,
    exploredTransitions,
    legalTransitions,
    depthStats,
    ranked: beam,
  };
}
