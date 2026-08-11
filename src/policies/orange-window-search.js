import { frameToTicks } from "../engine/clock.js";
import { cloneState } from "../engine/state.js";
import { replayProfileRows } from "./profile-replay.js";

const PRIMARY_LABELS = Object.freeze(["龙牙", "龙吟", "灭", "穿云"]);
const PRIMARY_PATTERN = /任驰骋|龙牙|龙吟|穿云|灭/u;

function labelKey(row) {
  return Object.hasOwn(row, "skill") ? "skill" : "label";
}

function labelOf(row) {
  return String(row?.skill ?? row?.label ?? "").trim();
}

export function replaceProfilePrimary(row, primaryLabel) {
  if (!PRIMARY_LABELS.includes(primaryLabel)) {
    throw new Error(`局部搜索不支持主要技能: ${primaryLabel}`);
  }
  const key = labelKey(row);
  const source = labelOf(row);
  if (!PRIMARY_PATTERN.test(source)) {
    throw new Error(`技能表标签缺少主要技能: ${source}`);
  }
  return { ...row, [key]: source.replace(PRIMARY_PATTERN, primaryLabel) };
}

function candidateChoices(row) {
  return labelOf(row).includes("任驰骋")
    ? [{ ...row }]
    : PRIMARY_LABELS.map((primary) => replaceProfilePrimary(row, primary));
}

function enumerateRows(rows, visit, index = 0, current = []) {
  if (index >= rows.length) {
    visit(current);
    return;
  }
  for (const choice of candidateChoices(rows[index])) {
    current.push(choice);
    enumerateRows(rows, visit, index + 1, current);
    current.pop();
  }
}

function isolatedSearchState(inputState) {
  const state = cloneState(inputState);
  state.timeline = [];
  state.sequence = 0;
  state.totalDamage = 0;
  state.damageBreakdown = {};
  return state;
}

function scoreWindow(state, fromTick, untilTick) {
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
    thunderDragonFangs: fangs.filter((event) => event.thunder).length,
    rideDragonFangs: fangs.filter((event) => event.dragonRideBonus).length,
  };
}

export function rankOrangeWindowRotations(
  inputState,
  rows,
  config,
  oracle,
  { orangeFromTick } = {},
) {
  if (!Number.isSafeInteger(orangeFromTick)) {
    throw new Error("局部搜索需要橙武开启时钟");
  }
  const orangeUntilTick = orangeFromTick + frameToTicks(config.durations.orange);
  const initialState = isolatedSearchState(inputState);
  const ranked = [];
  let explored = 0;

  enumerateRows(rows, (candidateRows) => {
    explored += 1;
    try {
      const replay = replayProfileRows(
        initialState,
        candidateRows,
        config,
        oracle,
        { validateResource: false },
      );
      ranked.push({
        rows: candidateRows.map((row) => ({ ...row })),
        skills: candidateRows.map(labelOf),
        ...scoreWindow(replay.state, orangeFromTick, orangeUntilTick),
      });
    } catch {
      // 冷却、战意或马上条件不合法的局部序列直接淘汰。
    }
  });

  ranked.sort(
    (left, right) =>
      right.damage - left.damage ||
      right.dragonFangs - left.dragonFangs ||
      left.skills.join("").localeCompare(right.skills.join(""), "zh-CN"),
  );
  return { explored, legal: ranked.length, ranked };
}

export const ORANGE_WINDOW_PRIMARY_LABELS = PRIMARY_LABELS;
